import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { requireFreshDist } from './helpers/dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(abs(rel), 'utf8'));
const routes = readJson('content/routes.json').routes;

before(requireFreshDist);
const dist = (rel) => readFileSync(abs(`dist/${rel}`));
const page = (route) => cheerio.load(dist(`${route.path.slice(1)}index.html`).toString('utf8'));
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

test('builds every frozen route and a real 404', () => {
  assert.equal(routes.length, 21);
  for (const route of routes) {
    const $ = page(route);
    assert.equal($('html').attr('lang'), route.lang, route.path);
    assert.equal($('title').text(), route.title, route.path);
    assert.equal($('link[rel=canonical]').attr('href'), `https://natur.bg${route.path}`, route.path);
    assert.equal($('script[type="application/ld+json"]').length, 1, route.path);
    assert.equal($('main#main').length, 1, route.path);
  }

  const $404 = cheerio.load(dist('404.html').toString('utf8'));
  assert.equal($404('meta[name=robots]').attr('content'), 'noindex');
  assert.equal($404('script[type="application/ld+json"], link[rel=canonical], link[hreflang]').length, 0);
  assert.ok($404('[lang=bg]').length > 0, '404 is bilingual');

  const index = dist('sitemap_index.xml').toString('utf8');
  assert.match(index, /post-sitemap\.xml/);
  assert.match(index, /page-sitemap\.xml/);
  assert.equal(dist('sitemap.xml').toString('utf8'), index);
  assert.equal(dist('wp-sitemap.xml').toString('utf8'), index);
  const posts = dist('post-sitemap.xml').toString('utf8');
  const pages = dist('page-sitemap.xml').toString('utf8');
  assert.equal(posts.match(/<url>/g).length, 9);
  assert.equal(pages.match(/<url>/g).length, 12);
  assert.match(pages, /hreflang="x-default" href="https:\/\/natur\.bg\/about-us\/"/);
  assert.equal(
    dist('robots.txt').toString('utf8'),
    'User-agent: *\nDisallow:\nSitemap: https://natur.bg/sitemap_index.xml\n',
  );

  assert.ok(dist('favicon.ico').length > 0);
  assert.ok(existsSync(abs('dist/.nojekyll')));
  assert.ok(!existsSync(abs('dist/CNAME')));
  const pdf = 'wp-content/uploads/2021/10/CATALOG-NATUR-BG.pdf';
  assert.ok(dist(pdf).equals(readFileSync(abs('media/originals/2021/10/CATALOG-NATUR-BG.pdf'))));
});

test('contact contract', () => {
  const site = readJson('content/site.json');
  for (const route of routes.filter((r) => r.template === 'contact')) {
    const $ = page(route);
    const mail = $('main a.btn[href="mailto:natur@natur.bg"]');
    assert.equal(mail.length, 1, `${route.path}: styled mailto button`);
    for (const phone of site[route.lang].contacts.phones) {
      assert.ok($(`main a[href="tel:${phone}"]`).length > 0, `${route.path}: ${phone}`);
    }
  }
  for (const file of walk(abs('dist')).filter((f) => /\.(html|xml|txt|js|css)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('878466854'), `${file}: old phone number`);
    assert.ok(!text.includes('/cdn-cgi/'), `${file}: cdn-cgi`);
    assert.ok(!text.includes('wpcf7'), `${file}: wpcf7`);
    if (file.endsWith('.html')) assert.ok(!text.includes('<form'), `${file}: form`);
  }
});

test('policy disclosures', () => {
  const required = [
    'natur_consent',
    'cf_zaraz_client',
    'cfz_google-analytics_v4',
    'cfzs_google-analytics_v4',
    'G-BWBK437736',
  ];
  const legal = routes.filter((r) => r.template === 'legal');
  assert.equal(legal.length, 4);
  for (const route of legal) {
    const text = page(route)('main').text();
    for (const needle of required) assert.ok(text.includes(needle), `${route.path}: ${needle}`);
    for (const gone of ['Contact Form 7', 'WPML', 'Cookie Notice']) {
      assert.ok(!text.includes(gone), `${route.path}: ${gone}`);
    }
  }
});

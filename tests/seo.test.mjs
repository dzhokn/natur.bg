import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { requireFreshDist } from './helpers/dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (rel) => path.join(ROOT, rel);
const routes = JSON.parse(readFileSync(abs('content/routes.json'), 'utf8')).routes;
const ORIGIN = 'https://natur.bg';

before(requireFreshDist);
const distText = (rel) => readFileSync(abs(`dist/${rel}`), 'utf8');
const load = (route) => cheerio.load(distText(`${route.path.slice(1)}index.html`));

// Frozen titles from the plan's Titles clause, kept independent of routes.json.
const TITLES = {
  '/': 'NATUR – Organic Wholegrain Sticks & Crackers from Bulgaria',
  '/products/': 'Organic Wholegrain Sticks & Crackers – Products | NATUR',
  '/about-us/': 'About NATUR – Family Producer & Exporter of Organic Snacks',
  '/contact/': 'Contact NATUR BG – Organic Snacks Producer, Bulgaria',
  '/privacy-policy/': 'Privacy Policy | NATUR',
  '/cookie-policy/': 'Cookie Policy | NATUR',
  '/organic-rye-sticks-wholegrain/': 'Organic Wholegrain Rye Sticks – Vegan, Sourdough | NATUR',
  '/organic-wholegrain-spelt-sticks/': 'Organic Wholegrain Spelt Sticks – Vegan | NATUR Bulgaria',
  '/organic-einkorn-sticks-wholegrain/': 'Organic Wholegrain Einkorn Sticks – Vegan | NATUR Bulgaria',
  '/organic-oat-sticks-with-turmeric/': 'Organic Oat Sticks with Turmeric – Vegan, Wholegrain | NATUR',
  '/organic-crackers/': 'Organic Crackers – Vegan, Clean Label | NATUR Bulgaria',
  '/bg/': 'НАТЮР – био пълнозърнести солети и крекери',
  '/bg/produkti/': 'Био солети и крекери – веган, пълнозърнести | НАТЮР',
  '/bg/za-nas/': 'За нас – семеен производител на био солети | НАТЮР',
  '/bg/kontakti/': 'Контакти | НАТЮР БГ – био солети и крекери',
  '/bg/politika-za-lichni-danni/': 'Политика за защита на личните данни | НАТЮР',
  '/bg/politika-za-biskvitki/': 'Политика за бисквитки | НАТЮР',
  '/bg/bio-palnozarnesti-soleti-ot-raj/': 'Био пълнозърнести солети от ръж – веган, с квас | НАТЮР',
  '/bg/bio-palnozarnesti-soleti-ot-spelta/': 'Био пълнозърнести солети от спелта – веган | НАТЮР',
  '/bg/bio-palnozarnesti-soleti-ot-limets/': 'Био пълнозърнести солети от лимец – веган | НАТЮР',
  '/bg/bio-krekeri/': 'Био крекери – веган, с чист етикет | НАТЮР',
};
const FORBIDDEN = /private label|wholesale|\bprices?\b|\bcheapest\b|\bbest\b|\bleading\b|#1|\bnumber one\b|най-добр|на едро|цена|цени|водещ/i;

test('alternates are reciprocal and absolute', () => {
  const byPath = new Map(routes.map((route) => [route.path, route]));
  for (const route of routes) {
    const $ = load(route);
    const canonical = `${ORIGIN}${route.path}`;
    assert.equal($('link[rel=canonical]').length, 1, route.path);
    assert.equal($('link[rel=canonical]').attr('href'), canonical, route.path);
    assert.equal($('meta[property="og:url"]').attr('content'), canonical, route.path);

    const alternates = Object.fromEntries(
      $('link[rel=alternate][hreflang]').toArray().map((el) => [el.attribs.hreflang, el.attribs.href]),
    );
    if (!route.pair) {
      assert.deepEqual(alternates, {}, `${route.path} has no pair, so no alternates`);
      continue;
    }
    const en = route.lang === 'en' ? route.path : route.pair;
    const bg = route.lang === 'bg' ? route.path : route.pair;
    assert.deepEqual(alternates, {
      en: `${ORIGIN}${en}`,
      bg: `${ORIGIN}${bg}`,
      'x-default': `${ORIGIN}${en}`,
    }, route.path);
    for (const href of Object.values(alternates)) {
      assert.ok(href.startsWith(`${ORIGIN}/`) && href.endsWith('/'), href);
      assert.ok(byPath.has(href.slice(ORIGIN.length)), `${href} is a frozen route`);
    }
    // Reciprocity: the partner page names this page as its own alternate.
    const partner = load(byPath.get(route.pair));
    const back = partner(`link[rel=alternate][hreflang=${route.lang}]`).attr('href');
    assert.equal(back, canonical, `${route.pair} points back to ${route.path}`);
  }
});

test('metadata matches D5 contract', () => {
  const seen = new Set();
  for (const route of routes) {
    const $ = load(route);
    assert.equal($('title').length, 1, route.path);
    assert.equal($('title').text(), TITLES[route.path], route.path);
    assert.equal($('html').attr('lang'), route.lang, route.path);

    const description = $('meta[name=description]');
    assert.equal(description.length, 1, route.path);
    const text = description.attr('content');
    assert.ok(text.length > 0 && text.length <= 155, `${route.path} description ${text.length}`);
    assert.ok(!seen.has(text), `${route.path} description is unique`);
    seen.add(text);

    const claims = [$('title').text(), text, ...$('img').toArray().map((el) => el.attribs.alt ?? '')];
    for (const claim of claims) assert.doesNotMatch(claim, FORBIDDEN, route.path);
    if (route.lang === 'bg') {
      assert.doesNotMatch($('title').text(), /НАТУР(?!Ю)/, `${route.path} brand is НАТЮР`);
    }
  }
  assert.equal(Object.keys(TITLES).length, routes.length);
});

test('structured data contract', () => {
  const ALLOWED = new Set(['Organization', 'WebSite', 'BreadcrumbList']);
  for (const route of routes) {
    const $ = load(route);
    const scripts = $('script[type="application/ld+json"]');
    assert.equal(scripts.length, 1, route.path);
    const raw = scripts.html();
    assert.ok(!raw.includes('</'), `${route.path} escapes < inside JSON-LD`);
    const data = JSON.parse(raw);
    const graph = data['@graph'] ?? [data];
    const types = graph.map((node) => node['@type']);
    for (const type of types) assert.ok(ALLOWED.has(type), `${route.path}: ${type}`);
    assert.ok(!types.includes('Product'), route.path);
    assert.equal(types.filter((type) => type === 'Organization').length, 1, route.path);
    const isHome = route.template === 'home';
    assert.equal(types.includes('WebSite'), isHome, `${route.path} WebSite only on home`);
    assert.equal(types.includes('BreadcrumbList'), !isHome, `${route.path} breadcrumb on non-home`);

    const org = graph.find((node) => node['@type'] === 'Organization');
    assert.equal(org['@id'], `${ORIGIN}/#organization`);
    if (isHome) {
      assert.equal(graph.find((node) => node['@type'] === 'WebSite').inLanguage, route.lang, route.path);
    } else {
      const items = graph.find((node) => node['@type'] === 'BreadcrumbList').itemListElement;
      assert.deepEqual(items.map((item) => item.name), route.breadcrumb.map((crumb) => crumb.name), route.path);
      assert.equal(items.at(-1).item, `${ORIGIN}${route.path}`, route.path);
      assert.equal(items[0].name, route.lang === 'bg' ? 'Начало' : 'Home', route.path);
    }
  }
  const notFound = cheerio.load(distText('404.html'));
  assert.equal(notFound('script[type="application/ld+json"]').length, 0);
});

test('sitemaps and robots', () => {
  assert.equal(distText('robots.txt'), 'User-agent: *\nDisallow:\nSitemap: https://natur.bg/sitemap_index.xml\n');

  const index = distText('sitemap_index.xml');
  assert.equal(distText('sitemap.xml'), index);
  assert.equal(distText('wp-sitemap.xml'), index);
  assert.deepEqual(
    [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
    [`${ORIGIN}/post-sitemap.xml`, `${ORIGIN}/page-sitemap.xml`],
  );

  const pairs = new Map(routes.map((route) => [route.path, route]));
  const listed = [];
  for (const [name, expected] of [['post-sitemap.xml', 9], ['page-sitemap.xml', 12]]) {
    const urls = distText(name).split('<url>').slice(1);
    assert.equal(urls.length, expected, name);
    for (const url of urls) {
      const loc = url.match(/<loc>([^<]+)<\/loc>/)[1];
      listed.push(loc);
      const route = pairs.get(loc.slice(ORIGIN.length));
      assert.ok(route, `${loc} is a frozen route`);
      const links = [...url.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)];
      const found = Object.fromEntries(links.map((match) => [match[1], match[2]]));
      if (!route.pair) {
        assert.deepEqual(found, {}, loc);
        continue;
      }
      const en = route.lang === 'en' ? route.path : route.pair;
      const bg = route.lang === 'bg' ? route.path : route.pair;
      assert.deepEqual(found, {
        en: `${ORIGIN}${en}`,
        bg: `${ORIGIN}${bg}`,
        'x-default': `${ORIGIN}${en}`,
      }, loc);
    }
  }
  assert.deepEqual(
    listed.map((loc) => loc.slice(ORIGIN.length)).sort(),
    routes.map((route) => route.path).sort(),
  );
});

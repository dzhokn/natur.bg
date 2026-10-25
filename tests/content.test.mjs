import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as cheerio from 'cheerio';

const read = (f) => fs.readFileSync(f, 'utf8');
const { routes } = JSON.parse(read('content/routes.json'));
const { products } = JSON.parse(read('content/products.json'));
const site = JSON.parse(read('content/site.json'));
const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));

const PATHS = [
  '/', '/products/', '/about-us/', '/contact/', '/privacy-policy/', '/cookie-policy/',
  '/organic-rye-sticks-wholegrain/', '/organic-wholegrain-spelt-sticks/',
  '/organic-einkorn-sticks-wholegrain/', '/organic-oat-sticks-with-turmeric/', '/organic-crackers/',
  '/bg/', '/bg/produkti/', '/bg/za-nas/', '/bg/kontakti/', '/bg/politika-za-lichni-danni/',
  '/bg/politika-za-biskvitki/', '/bg/bio-palnozarnesti-soleti-ot-raj/',
  '/bg/bio-palnozarnesti-soleti-ot-spelta/', '/bg/bio-palnozarnesti-soleti-ot-limets/', '/bg/bio-krekeri/',
];
const TITLES = [
  'NATUR – Organic Wholegrain Sticks & Crackers from Bulgaria',
  'Organic Wholegrain Sticks & Crackers – Products | NATUR',
  'About NATUR – Family Producer & Exporter of Organic Snacks',
  'Contact NATUR BG – Organic Snacks Producer, Bulgaria',
  'Privacy Policy | NATUR',
  'Cookie Policy | NATUR',
  'Organic Wholegrain Rye Sticks – Vegan, Sourdough | NATUR',
  'Organic Wholegrain Spelt Sticks – Vegan | NATUR Bulgaria',
  'Organic Wholegrain Einkorn Sticks – Vegan | NATUR Bulgaria',
  'Organic Oat Sticks with Turmeric – Vegan, Wholegrain | NATUR',
  'Organic Crackers – Vegan, Clean Label | NATUR Bulgaria',
  'НАТЮР – био пълнозърнести солети и крекери',
  'Био солети и крекери – веган, пълнозърнести | НАТЮР',
  'За нас – семеен производител на био солети | НАТЮР',
  'Контакти | НАТЮР БГ – био солети и крекери',
  'Политика за защита на личните данни | НАТЮР',
  'Политика за бисквитки | НАТЮР',
  'Био пълнозърнести солети от ръж – веган, с квас | НАТЮР',
  'Био пълнозърнести солети от спелта – веган | НАТЮР',
  'Био пълнозърнести солети от лимец – веган | НАТЮР',
  'Био крекери – веган, с чист етикет | НАТЮР',
];
const FORBIDDEN = ['private label', 'wholesale', 'price', 'best', 'cheapest', '№1', 'най-добр', 'цена', 'едро'];
const LEGAL = ['/privacy-policy/', '/cookie-policy/', '/bg/politika-za-lichni-danni/', '/bg/politika-za-biskvitki/'];

const fragmentPath = (r) => `content/pages/${r.lang}/${r.slug}.html`;
const pageRoutes = routes.filter((r) => r.template !== 'product');
const fragments = pageRoutes.map((r) => ({ route: r, html: read(fragmentPath(r)) }));
const tabs = products.flatMap((p) => ['en', 'bg'].flatMap((l) => (p[l] ? p[l].tabs.map((t) => ({ where: `${p.id}/${l}/${t.id}`, html: t.html })) : [])));
const allHtml = [...fragments.map((f) => ({ where: fragmentPath(f.route), html: f.html })), ...tabs];
const textOf = (html) => cheerio.load(`<div>${html}</div>`)('div').text();
const levels = (html) => cheerio.load(html)('h1,h2,h3,h4,h5,h6').map((_, h) => +h.name[1]).get();

test('content model contract', async (t) => {
  await t.test('routes: frozen list, templates, pairs, titles', () => {
    assert.deepEqual(routes.map((r) => r.path), PATHS);
    assert.deepEqual(routes.map((r) => r.title), TITLES);
    const template = (r) => (/^\/(bg\/)?$/.test(r.path) ? 'home' : r.template);
    assert.deepEqual(routes.filter((r) => template(r) === 'home').map((r) => r.path), ['/', '/bg/']);
    assert.deepEqual(routes.filter((r) => r.template === 'products').map((r) => r.path), ['/products/', '/bg/produkti/']);
    assert.equal(routes.filter((r) => r.template === 'product').length, 9);
    assert.deepEqual(routes.filter((r) => r.template === 'legal').map((r) => r.path), LEGAL.sort((a, b) => PATHS.indexOf(a) - PATHS.indexOf(b)));
    assert.equal(routes.filter((r) => r.template === 'about').length, 2);
    assert.equal(routes.filter((r) => r.template === 'contact').length, 2);
    for (const r of routes) {
      if (r.path === '/organic-oat-sticks-with-turmeric/') assert.equal(r.pair, null);
      else {
        assert.ok(byPath[r.pair], `${r.path} pair ${r.pair}`);
        assert.equal(byPath[r.pair].pair, r.path);
        assert.notEqual(byPath[r.pair].lang, r.lang);
      }
      assert.ok(r.ogImage?.startsWith('media/originals/'), `${r.path} ogImage`);
      assert.deepEqual(r.breadcrumb.length === 0, r.template === 'home');
      for (const b of r.breadcrumb) assert.ok(b.name && byPath[b.path], `${r.path} crumb ${b.path}`);
    }
  });

  await t.test('descriptions: length, unique, no forbidden claims, brand', () => {
    const seen = new Set();
    for (const r of routes) {
      assert.ok(r.description.length > 40 && r.description.length <= 155, `${r.path}: ${r.description.length}`);
      assert.ok(!seen.has(r.description), `duplicate description ${r.path}`);
      seen.add(r.description);
      const low = `${r.title} ${r.description}`.toLowerCase();
      for (const w of FORBIDDEN) assert.ok(!low.includes(w), `${r.path} contains "${w}"`);
      assert.ok(!/НАТУР(?!Ю)/.test(r.description + r.title), `${r.path} misspells brand`);
      assert.ok(/NATUR|НАТЮР/.test(r.description) || r.template === 'legal', `${r.path} brand`);
    }
  });

  await t.test('products: counts, order, images, related', () => {
    assert.equal(products.length, 5);
    assert.equal(products.filter((p) => p.en).length, 5);
    assert.equal(products.filter((p) => p.bg).length, 4);
    assert.equal(products.find((p) => p.id === 'organic-oat-sticks-with-turmeric').bg, null);
    const ids = new Set(products.map((p) => p.id));
    for (const p of products) {
      for (const l of ['en', 'bg']) {
        const v = p[l];
        if (!v) continue;
        assert.ok(byPath[v.path]?.template === 'product' && byPath[v.path].lang === l);
        assert.ok(v.info.length >= 4 && v.tabs.length === 3 && v.images.length >= 2);
        assert.equal(v.images[0].role, 'package');
        for (const im of v.images) assert.ok(im.alt && ['package', 'nutrition', 'other'].includes(im.role));
        for (const id of v.related) assert.ok(ids.has(id) && id !== p.id);
      }
    }
  });

  await t.test('site.json strings and contacts', () => {
    assert.equal(site.en.consent.text, 'We use Google Analytics cookies only if you allow them, to see how the site is used.');
    assert.equal(site.bg.consent.text, 'Използваме бисквитки на Google Analytics само ако ги разрешите, за да разберем как се използва сайтът.');
    assert.deepEqual([site.en.consent.allow, site.en.consent.decline, site.en.consent.settings], ['Allow', 'Decline', 'Cookie settings']);
    assert.deepEqual([site.bg.consent.allow, site.bg.consent.decline, site.bg.consent.settings], ['Разрешавам', 'Отказвам', 'Настройки на бисквитките']);
    for (const l of ['en', 'bg']) {
      assert.equal(site[l].contacts.email, 'natur@natur.bg');
      assert.deepEqual(site[l].contacts.phones, ['+359876466854', '+359899494814', '+359878566854']);
      assert.ok(byPath[site[l].consent.policyPath] && byPath[site[l].langSwitch.path]);
      assert.ok(site[l].social.facebook.startsWith('https://www.facebook.com/'));
    }
  });

  await t.test('every media/originals reference exists; no 878466854 or cdn-cgi in content', () => {
    const files = ['content/routes.json', 'content/products.json', 'content/site.json', ...allHtml.map((a) => a.where).filter((w) => w.startsWith('content/'))];
    const refs = new Set();
    for (const f of files) {
      for (const m of read(f).matchAll(/media\/originals\/[^"'\s)<>\\]+/g)) refs.add(m[0]);
    }
    assert.ok(refs.size > 30);
    for (const ref of refs) assert.ok(fs.existsSync(ref), `missing ${ref}`);
    const everything = [...files.map(read), ...tabs.map((x) => x.html)].join('\n');
    assert.ok(!everything.includes('878466854'));
    assert.ok(!everything.includes('/cdn-cgi/'));
  });

  await t.test('EU programme logos kept where the capture had them', () => {
    const had = (r) => {
      const f = `.local/capture/html/${r.lang === 'bg' && r.slug === 'home' ? 'bg_home' : r.slug === 'home' ? 'en_home' : r.path.split('/').filter(Boolean).pop()}.html`;
      return fs.existsSync(f) ? read(f).includes('euprogramlogos.jpg') : r.template === 'home';
    };
    for (const { route, html } of fragments) {
      assert.equal(html.includes('2021/07/euprogramlogos.jpg'), had(route), route.path);
    }
  });

  await t.test('fragments are clean: no Elementor, forms, posts blocks, inline styles', () => {
    for (const { where, html } of allHtml) {
      assert.ok(!/elementor/i.test(html), `${where}: elementor`);
      assert.ok(!/wpcf7|<form|<script|<style|style=/i.test(html), `${where}: form/script/style`);
      assert.ok(!/Partner News|Latest Posts|couldn't find any posts|Не са намерени постове|Последни постове/.test(html), `${where}: posts block`);
      assert.ok(!/data-(id|element_type|settings|widget_type)/.test(html), `${where}: data attrs`);
    }
    const bgs = fragments.flatMap((f) => [...f.html.matchAll(/data-bg="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(bgs.length >= 4 && bgs.every((b) => b.startsWith('media/originals/')));
    assert.ok(!bgs.some((b) => b.endsWith('rye-background.svg')));
  });

  await t.test('contact pages: mailto + three tel links, no form', () => {
    for (const r of routes.filter((x) => x.template === 'contact')) {
      const $ = cheerio.load(read(fragmentPath(r)));
      assert.equal($('a.btn[href="mailto:natur@natur.bg"]').length, 1);
      assert.equal($('.contact-cta + .contact-phones a[href^="tel:"]').length, 3);
      assert.equal($('.contact-cta a').text(), r.lang === 'bg' ? 'Пишете ни' : 'Write to us');
    }
  });

  await t.test('headings: one h1 per page, no skipped levels, none in tabs', () => {
    for (const { route, html } of fragments) {
      const lv = levels(html);
      assert.equal(lv.filter((l) => l === 1).length, 1, `${route.path}: h1 count`);
      assert.equal(lv[0], 1, `${route.path}: first heading`);
      lv.forEach((l, i) => i && assert.ok(l <= lv[i - 1] + 1, `${route.path}: skip ${lv[i - 1]}->${l}`));
    }
    for (const { where, html } of tabs) assert.ok(!levels(html).includes(1), where);
  });

  await t.test('read-more links carry a hidden product suffix', () => {
    for (const { route, html } of fragments) {
      const $ = cheerio.load(html);
      $('a').each((_, a) => {
        const own = $(a).clone().children().remove().end().text().trim();
        if (/^(Read More|Прочети още)$/i.test(own)) assert.equal($(a).children('span.vh').length, 1, route.path);
      });
    }
  });

  await t.test('legal pages: factual cookie disclosures replace the old clauses', () => {
    for (const path of LEGAL) {
      const html = read(fragmentPath(byPath[path]));
      const text = textOf(html);
      for (const s of ['natur_consent', 'cf_zaraz_client', 'G-BWBK437736', 'cfz_google-analytics_v4', 'cfzs_google-analytics_v4']) {
        assert.ok(text.includes(s), `${path}: ${s}`);
      }
      assert.ok(!/Contact Form 7|WPML|Cookie Notice|cookie notice plugin|wordpress\.org|gtag|\b_ga\b/i.test(text + html.replace(/data-replaced="[^"]*"/g, '')), path);
      assert.ok(/data-replaced="(ga|cookie-notice|wpml|cf7)"/.test(html));
      assert.ok(html.includes('<details>'));
    }
  });
});

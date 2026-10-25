import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import { requireFreshDist } from './helpers/dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(abs(rel), 'utf8'));
before(requireFreshDist);
const HERO = 'media/originals/2021/06/naturbg-home-4.jpg';

function contentRefs() {
  const refs = new Set();
  const re = /media\/originals\/[^"'\s<>)\\,;]+\.(?:png|jpe?g|svg)\b/gi;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(json|html)$/.test(name) && !/^(media|fonts)\.json$/.test(name)) {
        for (const m of readFileSync(full, 'utf8').matchAll(re)) refs.add(m[0]);
      }
    }
  };
  walk(abs('content'));
  return [...refs];
}

// Shared files appear in several lists (bg breakpoints, hero desktop), so dedupe by file.
const allVariants = (entry) => [
  ...new Map(
    [
      ...entry.variants,
      ...(entry.art?.mobile ?? []),
      ...(entry.art?.mobileHiDpi ?? []),
      ...Object.values(entry.bg ?? {}).flat(),
    ].map((v) => [v.file, v]),
  ).values(),
];

test('derived media contract', async (t) => {
  const media = readJson('content/media.json');
  const routes = readJson('content/routes.json').routes;

  await t.test('every content reference has an entry with an AVIF + WebP pair per width', () => {
    for (const ref of contentRefs()) {
      const entry = media.images[ref];
      assert.ok(entry, `no media.json entry for ${ref}`);
      if (entry.ogOnly) continue;
      const svg = /\.svg$/i.test(ref);
      const formats = svg ? ['svg'] : ['avif', 'webp'];
      for (const v of allVariants(entry)) assert.ok(formats.includes(v.format), `${ref}: ${v.format}`);
      const widths = new Set(allVariants(entry).map((v) => `${v.file.includes('-m-') ? 'm' : 'd'}${v.w}`));
      assert.ok(widths.size > 0, `${ref}: no variants`);
      for (const w of widths) {
        const at = allVariants(entry).filter((v) => `${v.file.includes('-m-') ? 'm' : 'd'}${v.w}` === w);
        assert.deepEqual(at.map((v) => v.format).sort(), formats, `${ref} @${w}`);
      }
    }
  });

  await t.test('variant files exist with recorded bytes, no upscale, ssim above the floor', () => {
    for (const [ref, entry] of Object.entries(media.images)) {
      const floor = entry.kind === 'photo' ? 0.98 : 0.99;
      for (const v of allVariants(entry)) {
        assert.ok(existsSync(abs(v.file)), `missing ${v.file}`);
        assert.equal(statSync(abs(v.file)).size, v.bytes, v.file);
        if (v.format === 'svg') continue;
        assert.ok(v.w <= entry.width, `${ref}: ${v.w} exceeds source width ${entry.width}`);
        assert.ok(v.ssim >= floor, `${ref} ${v.file}: ssim ${v.ssim} < ${floor}`);
      }
    }
  });

  await t.test('hero has art-directed mobile and desktop sets', () => {
    const art = media.images[HERO].art;
    assert.ok(art.mobile.length > 0 && art.desktop.length > 0);
    const avif = art.mobile.filter((v) => v.format === 'avif').sort((a, b) => a.w - b.w);
    assert.ok(avif[0].bytes <= 80 * 1024, `hero mobile AVIF ${avif[0].bytes}B over 80 KB`);
    assert.ok(art.desktop.some((v) => v.w >= 1280));
    assert.deepEqual([...new Set(art.mobile.map((v) => v.w))].sort((a, b) => a - b), [470]);
    assert.deepEqual([...new Set(art.mobileHiDpi.map((v) => v.w))], [824]);
    assert.ok(art.desktop.some((v) => v.w === 1440));
  });

  await t.test('every background has per-breakpoint sets with existing files above the floor', () => {
    const bgs = Object.entries(media.images).filter(([, e]) => e.bg);
    assert.ok(bgs.length > 0, 'no background entries');
    for (const [ref, entry] of bgs) {
      const floor = entry.kind === 'photo' ? 0.98 : 0.99;
      for (const vw of ['390', '768', '1440']) {
        const list = entry.bg[vw];
        assert.ok(Array.isArray(list) && list.length > 0, `${ref}: no bg.${vw}`);
        for (const v of list) {
          assert.ok(existsSync(abs(v.file)), `missing ${v.file}`);
          assert.ok(v.w <= entry.width, `${ref}: bg ${v.w} upscales`);
          assert.ok(v.ssim >= floor, `${ref} ${v.file}: ssim ${v.ssim} < ${floor}`);
        }
      }
    }
  });

  await t.test('every route ogImage has a JPEG at most 1200 px wide', async () => {
    for (const route of routes) {
      const og = media.images[route.ogImage]?.og;
      assert.ok(og, `${route.path}: no og image`);
      const meta = await sharp(abs(og)).metadata();
      assert.equal(meta.format, 'jpeg');
      assert.ok(meta.width <= 1200, `${og} is ${meta.width} px wide`);
    }
  });

  await t.test('icons exist', async () => {
    for (const name of ['favicon-32.png', 'apple-touch-icon.png', 'favicon.ico']) {
      const icon = media.icons[name];
      assert.ok(icon && existsSync(abs(icon.file)), name);
    }
    const touch = await sharp(abs(media.icons['apple-touch-icon.png'].file)).metadata();
    assert.deepEqual([touch.width, touch.height], [180, 180]);
    const ico = readFileSync(abs(media.icons['favicon.ico'].file));
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.subarray(22, 26).toString('latin1'), '\x89PNG');
  });

  await t.test('fonts: three WOFF2 subsets at most 40 KB with finite fallback metrics', () => {
    const fonts = readJson('content/fonts.json');
    assert.deepEqual(Object.keys(fonts.families).sort(), ['fregat', 'fregat-bold', 'pf-din']);
    assert.ok(fonts.unicodeRange.includes('U+400-45F'));
    for (const [name, fam] of Object.entries(fonts.families)) {
      assert.ok(existsSync(abs(fam.file)), `${name}: missing ${fam.file}`);
      assert.ok(statSync(abs(fam.file)).size <= 40 * 1024, `${name} over 40 KB`);
      assert.equal(readFileSync(abs(fam.file)).subarray(0, 4).toString('latin1'), 'wOF2');
      for (const key of ['sizeAdjust', 'ascentOverride', 'descentOverride', 'lineGapOverride']) {
        assert.ok(Number.isFinite(fam.fallback[key]) && fam.fallback[key] >= 0, `${name}.${key}`);
      }
    }
  });
});

test('lcp preload contract', async (t) => {
  const routes = readJson('content/routes.json').routes;
  const load = (route) =>
    cheerio.load(readFileSync(abs(`dist/${route.path.slice(1)}index.html`), 'utf8'));
  const imagePreloads = ($) => $('head link[rel=preload][as=image]').toArray().map((l) => l.attribs);
  // Phones under 2 dppx get one ~1.125x candidate (Lighthouse emulates 1.75); denser ones the 2x+ set.
  const PHONE_LO = '(max-width: 767px) and (max-resolution: 1.99dppx)';
  const PHONE_HI = '(max-width: 767px) and (min-resolution: 2dppx)';

  await t.test('home: three media-scoped AVIF preloads mirror the hero sources', () => {
    for (const route of routes.filter((r) => r.template === 'home')) {
      const $ = load(route);
      const preloads = imagePreloads($);
      assert.equal(preloads.length, 3, route.path);
      assert.ok(preloads.every((p) => p.type === 'image/avif' && p.fetchpriority === 'high'));
      const sources = $('.hero picture source[type="image/avif"]').toArray().map((s) => s.attribs);
      assert.equal(sources.length, 3, route.path);
      assert.deepEqual(
        preloads.map((p) => [p.imagesrcset, p.imagesizes]),
        sources.map((s) => [s.srcset, s.sizes]),
      );
      // The preloads are narrowed by density so a phone never fetches both mobile files.
      assert.deepEqual(preloads.map((p) => p.media), [PHONE_LO, PHONE_HI, '(min-width: 768px)']);
      assert.deepEqual(sources.map((s) => s.media), [PHONE_LO, '(max-width: 767px)', undefined]);
      assert.equal(sources[0].srcset.split(',').length, 1, `${route.path}: one lo-density candidate`);
      const hero = $('.hero picture img');
      assert.equal(hero.attr('fetchpriority'), 'high');
      assert.notEqual(hero.attr('loading'), 'lazy');
    }
  });

  await t.test('product: the photo and the first package image are preloaded per form factor', () => {
    for (const route of routes.filter((r) => r.template === 'product')) {
      const $ = load(route);
      const preloads = imagePreloads($);
      const first = $('.slides li').first();
      const firstImg = first.find('img');
      assert.notEqual(firstImg.attr('loading'), 'lazy', route.path);
      assert.ok(firstImg.attr('src') && !firstImg.attr('data-src'), `${route.path}: first slide is not gated`);
      const photo = $('.p-photo picture');
      const sets = [first, photo].flatMap((el) =>
        el.find('source[type="image/avif"]').toArray().map((s) => s.attribs.srcset));
      // Phone winner: lo + hi density preloads; desktop winner: one.
      assert.ok(preloads.length === 3, route.path);
      for (const p of preloads) {
        assert.ok(sets.includes(p.imagesrcset), `${route.path}: preload mirrors a visible source`);
        assert.equal(p.fetchpriority, 'high');
      }
      assert.deepEqual(preloads.map((p) => p.media).sort(), [PHONE_HI, PHONE_LO, '(min-width: 768px)'].sort());
      assert.equal($('.bg-in, .p-photo.bg, .p-photo[style]').length, 0, `${route.path}: photo is not a background`);
      // Above-fold photos are eager and discoverable in HTML.
      for (const img of $('.p-photo img, .slides li:first-child img').toArray()) {
        assert.ok(img.attribs.src && img.attribs.loading !== 'lazy', route.path);
      }
    }
  });

  await t.test('about and contact heroes are real eager images, not backgrounds', () => {
    for (const route of routes.filter((r) => ['about', 'contact'].includes(r.template))) {
      const $ = load(route);
      const img = $('section.hero .hero-photo img');
      assert.equal(img.length, 1, route.path);
      assert.ok(img.attr('src') && img.attr('loading') !== 'lazy', route.path);
      assert.equal(img.attr('fetchpriority'), 'high', route.path);
      assert.equal($('section.hero[style], section.hero.bg').length, 0, route.path);
      const preloads = imagePreloads($);
      const avif = $('.hero-photo source[type="image/avif"]').toArray().map((s) => s.attribs.srcset);
      for (const p of preloads) assert.ok(avif.includes(p.imagesrcset), `${route.path}: preload mirrors an AVIF source`);
      assert.deepEqual(preloads.map((p) => p.media), [PHONE_LO, PHONE_HI, '(min-width: 768px)'], route.path);
      assert.equal($('.hero-photo source').first().attr('srcset').split(',').length, 1, route.path);
    }
  });

  await t.test('no route repeats a media condition and no gated or lazy image is preloaded', () => {
    for (const route of routes) {
      const $ = load(route);
      const preloads = imagePreloads($);
      const conditions = new Set(preloads.map((p) => p.media ?? 'all'));
      assert.equal(conditions.size, preloads.length, `${route.path}: duplicate media condition`);
      const lazySets = $('img[loading=lazy]').toArray()
        .filter((i) => !$(i).closest('noscript').length)
        .flatMap((i) => [i.attribs.srcset ?? '', i.attribs['data-srcset'] ?? '']);
      for (const gated of $('picture.lz source').toArray()) lazySets.push(gated.attribs['data-srcset']);
      for (const p of preloads) {
        const files = p.imagesrcset.split(',').map((e) => e.trim().split(' ')[0].replace('.avif', ''));
        for (const set of lazySets) {
          for (const f of files) assert.ok(!set.includes(f), `${route.path}: lazy image preloaded ${f}`);
        }
      }
    }
  });

  await t.test('below-the-fold images are JS-gated with a <noscript> copy', () => {
    for (const route of routes) {
      const $ = load(route);
      const gated = $('picture.lz');
      for (const pic of gated.toArray()) {
        const next = pic.next;
        assert.equal(next?.name, 'noscript', `${route.path}: noscript follows the gated picture`);
        assert.ok($(next).html().includes('srcset='), `${route.path}: noscript copy has srcset`);
      }
    }
    const home = load(routes.find((r) => r.template === 'home'));
    assert.ok(home('picture.lz').length >= 4, 'home product packshots are gated');
  });
});

test('width ladder covers phone, tablet and desktop without upscaling', () => {
  const media = readJson('content/media.json');
  let checked = 0;
  for (const [ref, entry] of Object.entries(media.images)) {
    if (!entry.slots || entry.art) continue;
    const widths = [...new Set(entry.variants.map((v) => v.w))];
    assert.ok(widths.every((w) => w <= entry.width), `${ref}: candidate above source width`);
    // Rounded to 10 px, so allow 5 px of slack under the exact need.
    const need = Math.min(entry.width, entry.slots['390'] * 1.75 - 5);
    assert.ok(widths.some((w) => w >= need), `${ref}: no candidate >= ${need}`);
    if (entry.slots['1440'] > entry.slots['390']) {
      assert.ok(widths.some((w) => w >= Math.min(entry.width, entry.slots['1440'] - 5)), `${ref}: desktop width`);
    }
    checked++;
  }
  assert.ok(checked > 10, `checked ${checked} entries`);
});

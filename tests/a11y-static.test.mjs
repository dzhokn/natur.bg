import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { requireFreshDist } from './helpers/dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (rel) => path.join(ROOT, rel);
const routes = JSON.parse(readFileSync(abs('content/routes.json'), 'utf8')).routes;

before(requireFreshDist);
const loadFile = (rel) => cheerio.load(readFileSync(abs(`dist/${rel}`), 'utf8'));
const pages = [
  ...routes.map((route) => ({ name: route.path, $: loadFile(`${route.path.slice(1)}index.html`) })),
  { name: '404.html', $: loadFile('404.html') },
];

function accessibleName($, el) {
  const own = $(el);
  const text = own.text().replace(/\s+/g, ' ').trim();
  if (text) return text;
  if (own.attr('aria-label')?.trim()) return own.attr('aria-label').trim();
  const labelledby = own.attr('aria-labelledby');
  if (labelledby) {
    const joined = labelledby.split(/\s+/).map((id) => $(`[id="${id}"]`).text().trim()).join(' ').trim();
    if (joined) return joined;
  }
  return own.find('img[alt]').toArray().map((img) => img.attribs.alt.trim()).join(' ').trim();
}

test('static accessibility rules', () => {
  for (const { name, $ } of pages) {
    assert.ok($('html').attr('lang'), `${name} html[lang]`);
    assert.equal($('main h1').length, 1, `${name} one h1 in main`);
    assert.equal($('h1').length, 1, `${name} one h1`);
    for (const landmark of ['header', 'nav', 'main', 'footer']) {
      assert.ok($(landmark).length >= 1, `${name} <${landmark}>`);
    }

    // Levels may drop back up freely but never skip downwards (h2 straight to h4).
    let previous = 0;
    for (const el of $('h1,h2,h3,h4,h5,h6').toArray()) {
      const level = Number(el.tagName[1]);
      assert.ok(level <= previous + 1, `${name}: h${level} after h${previous}`);
      previous = level;
    }

    // <noscript> repeats every gated image; count each image once.
    for (const img of $('img').toArray().filter((el) => !$(el).closest('noscript').length)) {
      assert.ok('alt' in img.attribs, `${name}: img ${img.attribs.src ?? img.attribs['data-src']} lacks alt`);
    }
    for (const gated of $('picture.lz').toArray()) {
      const img = $(gated).find('img');
      assert.equal(img.length, 1, `${name}: gated picture has one img`);
      assert.ok(img.attr('data-src') && img.attr('data-srcset'), `${name}: gated img has data-*`);
      assert.ok(!img.attr('src') && !img.attr('srcset'), `${name}: gated img has no src/srcset`);
      assert.equal(img.attr('loading'), 'lazy', name);
      assert.ok(!gated.next || gated.next.name === 'noscript', `${name}: gated picture is followed by <noscript>`);
    }
    for (const el of $('button, a[href]').toArray()) {
      assert.ok(accessibleName($, el), `${name}: unnamed ${$.html(el).slice(0, 120)}`);
    }

    for (const tab of $('[role=tab]').toArray()) {
      const panel = $(`[id="${tab.attribs['aria-controls']}"]`);
      assert.equal(panel.length, 1, `${name}: ${tab.attribs.id} controls a panel`);
      assert.equal(panel.attr('role'), 'tabpanel', name);
      assert.equal(panel.attr('aria-labelledby'), tab.attribs.id, name);
    }
    for (const el of $('[aria-controls]').toArray()) {
      for (const id of el.attribs['aria-controls'].split(/\s+/)) {
        assert.equal($(`[id="${id}"]`).length, 1, `${name}: aria-controls ${id}`);
      }
    }

    const ids = $('[id]').toArray().map((el) => el.attribs.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dupes, [], `${name} duplicate ids`);
  }
});

test('read more links are descriptive', () => {
  const READ_MORE = /^(?:Read More|Прочети още)$/i;
  let checked = 0;
  for (const { name, $ } of pages) {
    for (const el of $('a').toArray()) {
      const visible = $(el).clone().find('.vh').remove().end().text().replace(/\s+/g, ' ').trim();
      if (!READ_MORE.test(visible)) continue;
      checked += 1;
      const suffix = $(el).find('.vh').text().trim();
      assert.match(suffix, /^(?:about|за) \S+/, `${name}: ${$.html(el)}`);
      assert.ok(suffix.length > 'about '.length + 3, `${name}: suffix names the product`);
    }
  }
  assert.ok(checked >= 8, `found ${checked} read more links`);
});

const GREEN_FILL = /#(?:9cd537|8bc34a|7baf42)\b/i;
const GREEN_TEXT = /#(?:9cd537|8bc34a)\b/i;
const WHITE = /^(?:#fff|#ffffff|white)$/i;

function cssRules() {
  const dir = abs('dist/assets/css');
  const css = readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const vars = Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
  const resolve = (value) => value.replace(/var\((--[\w-]+)\)/g, (_, key) => vars[key] ?? '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    decls: Object.fromEntries(
      body.split(';').map((d) => d.split(/:(.*)/s)).filter((p) => p[1] !== undefined)
        .map(([prop, value]) => [prop.trim().toLowerCase(), resolve(value.trim().replace(/\s*!important$/i, ''))]),
    ),
  }));
  return rules;
}

test('colour tokens follow option A', () => {
  const rules = cssRules();
  assert.ok(rules.length > 50, 'parsed the built CSS');
  assert.ok(rules.some((r) => GREEN_FILL.test(r.decls.background ?? r.decls['background-color'] ?? '')), 'sees green fills');
  for (const { selector, decls } of rules) {
    const fill = `${decls.background ?? ''} ${decls['background-color'] ?? ''}`;
    const colour = decls.color ?? '';
    if (WHITE.test(colour)) {
      assert.ok(!GREEN_FILL.test(fill), `${selector}: white text on a green fill`);
      assert.ok(!/\.btn\b/.test(selector), `${selector}: white text on a button`);
    }
    assert.ok(!GREEN_TEXT.test(colour), `${selector}: green set as text colour`);
  }
});

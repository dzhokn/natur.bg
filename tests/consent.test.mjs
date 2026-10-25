import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { requireFreshDist } from './helpers/dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (rel) => path.join(ROOT, rel);
const readJson = (rel) => JSON.parse(readFileSync(abs(rel), 'utf8'));
const routes = readJson('content/routes.json').routes;
const site = readJson('content/site.json');
const consent = await import(pathToFileURL(abs('src/js/consent.mjs')).href);

before(requireFreshDist);

// A window whose document records listeners so tests can fire zarazConsentAPIReady by hand.
function fakeWindow(zaraz) {
  const listeners = {};
  return {
    zaraz,
    document: { addEventListener: (name, fn) => (listeners[name] ||= []).push(fn) },
    fire: (name) => (listeners[name] || []).splice(0).forEach((fn) => fn()),
  };
}
const fakeZaraz = (ready, stored = {}) => {
  const calls = [];
  return {
    calls,
    consent: {
      APIReady: ready,
      setAll: (v) => calls.push(['setAll', v]),
      getAll: () => stored,
      sendQueuedEvents: () => calls.push(['sendQueuedEvents']),
    },
  };
};

test('consent bar and logic', async (t) => {
  await t.test('every built page carries the bar in its language and a tiny head script', () => {
    const pages = routes.map((r) => ({ file: `${r.path.slice(1)}index.html`, lang: r.lang }));
    pages.push({ file: '404.html', lang: 'en' });
    for (const { file, lang } of pages) {
      const c = site[lang].consent;
      const $ = cheerio.load(readFileSync(abs(`dist/${file}`), 'utf8'));
      const bar = $('body > .consent[role=region]');
      assert.equal(bar.length, 1, file);
      assert.ok(bar.text().includes(c.text), `${file}: text`);
      assert.equal(bar.find('a').attr('href'), c.policyPath, `${file}: policy link`);
      assert.deepEqual(bar.find('button').map((_, b) => $(b).text()).get(), [c.allow, c.decline], file);
      assert.equal($('button.cookie-settings').text(), c.settings, `${file}: footer reopen`);
      const inline = $('head script:not([src])').filter((_, s) => !$(s).attr('type'));
      assert.equal(inline.length, 1, file);
      assert.ok(Buffer.byteLength(inline.text()) <= 300, `${file}: head script too large`);
      assert.match(inline.text(), /natur_consent/);
    }
  });

  await t.test('cookie parse and serialize', () => {
    assert.equal(consent.parseConsent('a=1; natur_consent=granted; b=2'), 'granted');
    assert.equal(consent.parseConsent('natur_consent=denied'), 'denied');
    assert.equal(consent.parseConsent('natur_consent=maybe'), null);
    assert.equal(consent.parseConsent(''), null);
    assert.equal(
      consent.serializeConsent('granted', true),
      'natur_consent=granted; Path=/; Max-Age=15552000; SameSite=Lax; Secure',
    );
    assert.ok(!consent.serializeConsent('denied', false).includes('Secure'));
  });

  await t.test('allow and decline call Zaraz; allow flushes queued events', () => {
    const allow = fakeWindow(fakeZaraz(true));
    consent.applyChoice('granted', allow);
    assert.deepEqual(allow.zaraz.calls, [['setAll', true], ['sendQueuedEvents']]);
    const decline = fakeWindow(fakeZaraz(true));
    consent.applyChoice('denied', decline);
    assert.deepEqual(decline.zaraz.calls, [['setAll', false]]);
  });

  await t.test('waits for zarazConsentAPIReady and never throws without Zaraz', () => {
    const late = fakeWindow(fakeZaraz(false));
    consent.applyChoice('granted', late);
    assert.deepEqual(late.zaraz.calls, []);
    late.zaraz.consent.APIReady = true;
    late.fire('zarazConsentAPIReady');
    assert.deepEqual(late.zaraz.calls, [['setAll', true], ['sendQueuedEvents']]);

    const none = fakeWindow(undefined);
    assert.doesNotThrow(() => consent.applyChoice('granted', none));
    assert.doesNotThrow(() => none.fire('zarazConsentAPIReady'));
    assert.doesNotThrow(() => consent.reconcile('denied', none));
    assert.doesNotThrow(() => consent.applyChoice('granted', undefined));
    const broken = fakeWindow({ consent: { APIReady: true, setAll() { throw new Error('boom'); } } });
    assert.doesNotThrow(() => consent.applyChoice('granted', broken));
  });

  await t.test('a stored choice that differs from Zaraz is re-applied on ready', () => {
    const differs = fakeWindow(fakeZaraz(false, { analytics: false }));
    consent.reconcile('granted', differs);
    assert.deepEqual(differs.zaraz.calls, []);
    differs.zaraz.consent.APIReady = true;
    differs.fire('zarazConsentAPIReady');
    assert.deepEqual(differs.zaraz.calls, [['setAll', true], ['sendQueuedEvents']]);

    const same = fakeWindow(fakeZaraz(false, { analytics: true }));
    consent.reconcile('granted', same);
    same.zaraz.consent.APIReady = true;
    same.fire('zarazConsentAPIReady');
    assert.deepEqual(same.zaraz.calls, []);

    const nothing = fakeWindow(fakeZaraz(true, { analytics: true }));
    consent.reconcile(null, nothing);
    assert.deepEqual(nothing.zaraz.calls, []);
  });
});

// Live-site verification (release step 8). Read-only against --origin; run by the planner at release time.
//   node tools/verify-live.mjs [--origin https://natur.bg] [--consent] [--dry-run]
// Default: routes, 404, redirects, cache, headers, contact mailto, mail DNS. Each line is `ok|FAIL <check> <detail>`.
// --consent: Zaraz server-side GA4 hit counts with a headless installed Chrome; needs ZARAZ_DEBUG_KEY (never printed).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resolver } from 'node:dns/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const origin = (option('--origin') ?? 'https://natur.bg').replace(/\/$/, '');
const CANON = 'https://natur.bg';
const MAIL_IP = '91.196.124.63';
const MAIL_HOSTS = ['_dc-mx.f784b4c3daed.natur.bg', 'mail.natur.bg', 'webmail.natur.bg'];
const POLICY_COOKIES = ['natur_consent', 'cf_zaraz_client', 'cfz_google-analytics_v4', 'cfzs_google-analytics_v4'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const routes = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/routes.json'), 'utf8')).routes;

let failures = 0;
const report = (good, check, detail = '') => {
  if (!good) failures += 1;
  console.log(`${good ? 'ok  ' : 'FAIL'} ${check} ${detail}`.trimEnd());
};

const get = (url) => fetch(url, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html' } });

// Follows redirects by hand so the hop count is observable.
async function follow(url) {
  let current = url;
  for (let hops = 0; hops < 8; hops += 1) {
    const response = await get(current);
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return { hops, url: current, response };
    await response.body?.cancel();
    current = new URL(location, current).href;
  }
  return { hops: 8, url: current, response: null };
}

const canonicalOf = (html) =>
  /<link[^>]+rel=["']canonical["'][^>]*>/i.exec(html)?.[0].match(/href=["']([^"']+)["']/i)?.[1];

const PLAN = [
  ...routes.map((r) => `route ${r.path}: 200, text/html, canonical ${CANON}${r.path}`),
  '404 /nope-<random>/: 404 with bilingual body',
  'redirect http://natur.bg/: 1 hop to https://natur.bg/',
  'redirect https://www.natur.bg/x/: 1 hop to https://natur.bg/x/',
  'redirect /about-us: 1 hop to /about-us/',
  'redirect http://www.natur.bg/: <= 2 hops to https://natur.bg/',
  'cache: one /assets/* URL from the home HTML is cf-cache-status HIT on the second request',
  'headers: no link header contains /wp-json/',
  'contact: mailto:natur@natur.bg present, no email-protection',
  `dns via 1.1.1.1: ${MAIL_HOSTS.join(', ')} A ${MAIL_IP}`,
];
const CONSENT_PLAN = [
  'consent A: fresh context, load /, Decline, load /about-us/: 0 server-side g/collect',
  'consent B: fresh context, load /, Allow: exactly 1 server-side g/collect',
  `cookies after Allow compared with policy: ${POLICY_COOKIES.join(', ')} + Zaraz consent cookie`,
];

async function checkRoutes() {
  let homeHtml = '';
  const links = [];
  for (const route of routes) {
    const response = await get(origin + route.path);
    const html = await response.text();
    if (route.path === '/') homeHtml = html;
    const type = response.headers.get('content-type') ?? '';
    const canonical = canonicalOf(html);
    report(response.status === 200 && type.includes('text/html') && canonical === CANON + route.path,
      `route ${route.path}`, `${response.status} ${type} canonical=${canonical}`);
    links.push(response.headers.get('link'));
    if (route.template === 'contact') {
      report(html.includes('mailto:natur@natur.bg') && !html.includes('email-protection'),
        `contact ${route.path}`, 'mailto:natur@natur.bg, no email-protection');
    }
  }
  return { homeHtml, links };
}

async function check404() {
  const response = await get(`${origin}/nope-${Math.random().toString(36).slice(2, 10)}/`);
  const html = await response.text();
  report(response.status === 404 && html.includes('Page not found') && html.includes('Страницата не е намерена'),
    '404', `${response.status}`);
}

async function checkRedirects() {
  const cases = [
    ['http://natur.bg/', 1, `${CANON}/`],
    ['https://www.natur.bg/x/', 1, `${CANON}/x/`],
    [`${origin}/about-us`, 1, `${origin}/about-us/`],
    ['http://www.natur.bg/', 2, null],
  ];
  for (const [from, maxHops, expected] of cases) {
    const result = await follow(from);
    const endsOk = expected ? result.url === expected : result.url.startsWith(`${CANON}/`);
    const hopsOk = maxHops === 1 ? result.hops === 1 : result.hops >= 1 && result.hops <= maxHops;
    report(hopsOk && endsOk && result.response?.status === 200, `redirect ${from}`, `${result.hops} hop(s) -> ${result.url}`);
  }
}

async function checkCache(homeHtml, links) {
  const asset = /(?:href|src)=["'](\/assets\/[^"']+)["']/.exec(homeHtml)?.[1];
  if (!asset) return report(false, 'cache', 'no /assets/ URL in home HTML');
  const first = await get(origin + asset);
  await first.arrayBuffer();
  const second = await get(origin + asset);
  await second.arrayBuffer();
  links.push(first.headers.get('link'), second.headers.get('link'));
  const status = second.headers.get('cf-cache-status');
  return report(status === 'HIT', `cache ${asset}`, `second request cf-cache-status=${status}`);
}

async function checkDns() {
  const resolver = new Resolver();
  resolver.setServers(['1.1.1.1']);
  for (const host of MAIL_HOSTS) {
    try {
      const addresses = await resolver.resolve4(host);
      report(addresses.includes(MAIL_IP), `dns ${host}`, addresses.join(','));
    } catch (error) {
      report(false, `dns ${host}`, error.code ?? error.message);
    }
  }
}

async function runDefault() {
  const { homeHtml, links } = await checkRoutes();
  await check404();
  await checkRedirects();
  await checkCache(homeHtml, links);
  const wp = links.filter((value) => value?.includes('/wp-json/'));
  report(wp.length === 0, 'headers', wp.length ? `link header with /wp-json/ on ${wp.length} response(s)` : 'no /wp-json/ link header');
  await checkDns();
}

// Counts server-side GA4 hits Zaraz reports in its /cdn-cgi/zaraz/ response bodies (the debug key makes them visible).
async function countCollect(page, url, act) {
  let count = 0;
  const handler = async (response) => {
    if (!response.url().includes('/cdn-cgi/zaraz/')) return;
    try {
      count += (await response.text()).match(/google-analytics\.com\/g\/collect/g)?.length ?? 0;
    } catch { /* opaque body */ }
  };
  page.on('response', handler);
  await page.goto(url, { waitUntil: 'load' });
  if (act) await act();
  await page.waitForTimeout(3000);
  page.off('response', handler);
  return count;
}

async function runConsent() {
  const debugKey = process.env.ZARAZ_DEBUG_KEY;
  if (!debugKey) {
    console.error('--consent needs ZARAZ_DEBUG_KEY in the environment');
    process.exit(2);
  }
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  const fresh = async () => {
    const context = await browser.newContext({ userAgent: UA, extraHTTPHeaders: { Accept: 'text/html' } });
    await context.addCookies([{ name: 'zarazDebug', value: debugKey, domain: new URL(origin).hostname, path: '/' }]);
    return { context, page: await context.newPage() };
  };
  try {
    const a = await fresh();
    const aHome = await countCollect(a.page, `${origin}/`);
    report(aHome === 0, 'consent A /', `${aHome} g/collect before any choice`);
    await a.page.click('[data-consent="denied"]');
    const aAbout = await countCollect(a.page, `${origin}/about-us/`);
    report(aAbout === 0, 'consent A /about-us/ after Decline', `${aAbout} g/collect`);
    await a.context.close();

    const b = await fresh();
    const bAllow = await countCollect(b.page, `${origin}/`, async () => {
      await b.page.click('[data-consent="granted"]');
      await b.page.evaluate(() => globalThis.zaraz?.consent?.sendQueuedEvents?.()).catch(() => {});
    });
    report(bAllow === 1, 'consent B / after Allow', `${bAllow} g/collect`);
    const names = (await b.context.cookies()).map((cookie) => cookie.name);
    const unexpected = names.filter((name) => !POLICY_COOKIES.includes(name) && !/consent/i.test(name));
    const missing = POLICY_COOKIES.filter((name) => !names.includes(name));
    console.log(`info cookies after Allow: ${names.join(', ') || '(none)'}`);
    report(!missing.length && !unexpected.length, 'consent B cookies match policy',
      `missing: ${missing.join(', ') || '(none)'}; not in policy: ${unexpected.join(', ') || '(none)'}`);
    await b.context.close();
  } finally {
    await browser.close();
  }
}

if (flag('--dry-run')) {
  console.log(`origin ${origin}`);
  [...PLAN, ...(flag('--consent') ? CONSENT_PLAN : [])].forEach((line) => console.log(`plan ${line}`));
  process.exit(0);
}

try {
  if (flag('--consent')) await runConsent();
  else await runDefault();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
process.exit(failures ? 1 : 0);

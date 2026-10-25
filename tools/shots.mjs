// Full-page screenshots of the built site plus a built-vs-live comparison page.
//   node tools/shots.mjs [--routes /,/bg/] [--widths 1440,768,390,320] [--dry-run]
// Uses the installed Chrome (channel "chrome"); never downloads a browser. Exits 1 when any
// route/width scrolls horizontally. Output: .local/reports/shots/<slug>-<w>[-denied].png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../scripts/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.local/reports/shots');
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const list = (name, fallback) => (option(name)?.split(',').filter(Boolean) ?? fallback);

const routes = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/routes.json'), 'utf8')).routes.map((r) => r.path);
// The capture names shots by its own slugs (en_home, bg_produkti, ...); reuse them for side-by-side lookups.
const captureSlugs = new Map();
const manifestFile = path.join(ROOT, '.local/capture/manifest.json');
if (fs.existsSync(manifestFile)) {
  for (const r of JSON.parse(fs.readFileSync(manifestFile, 'utf8')).routes) captureSlugs.set(r.path, r.slug);
}
const slugOf = (route) => captureSlugs.get(route)
  ?? (route === '/' ? 'home' : route.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '_'));

const widths = list('--widths', ['1440', '768', '390', '320']).map(Number);
const selected = list('--routes', routes);
const unknown = selected.filter((route) => !routes.includes(route));
if (unknown.length) {
  console.error(`unknown routes: ${unknown.join(', ')}`);
  process.exit(1);
}
// With the bar visible every route is shot; with the choice stored we only need a home and a product page.
const DENIED_ROUTES = ['/', '/organic-rye-sticks-wholegrain/'].filter((route) => selected.includes(route));
const plan = widths.flatMap((width) => [
  ...selected.map((route) => ({ route, width, denied: false })),
  ...DENIED_ROUTES.map((route) => ({ route, width, denied: true })),
]);
const shotFile = ({ route, width, denied }) => `${slugOf(route)}-${width}${denied ? '-denied' : ''}.png`;

if (args.includes('--dry-run')) {
  console.log(`shots plan: ${plan.length} screenshots, widths ${widths.join('/')}, out ${path.relative(ROOT, OUT)}`);
  for (const item of plan) console.log(`${item.route} ${item.width}${item.denied ? ' denied' : ''} -> ${shotFile(item)}`);
  process.exit(0);
}

function writeIndex() {
  const rows = selected.flatMap((route) => widths.map((width) => {
    const slug = slugOf(route);
    const built = `${slug}-${width}.png`;
    const live = `${slug}-${width}.png`;
    const liveExists = fs.existsSync(path.join(ROOT, '.local/capture/shots', live));
    return `<section><h2>${route} <small>${width}px</small></h2><div class="pair">
<figure><figcaption>built</figcaption><img src="${built}" loading="lazy" alt="built ${route} at ${width}px"></figure>
<figure><figcaption>live</figcaption>${liveExists
    ? `<img src="../../capture/shots/${live}" loading="lazy" alt="live ${route} at ${width}px">`
    : '<p>no live shot at this width</p>'}</figure></div></section>`;
  }));
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>natur.bg shots</title>
<style>body{font:14px sans-serif;margin:16px}.pair{display:flex;gap:12px;align-items:flex-start}figure{flex:1;margin:0;min-width:0}
img{max-width:100%;border:1px solid #ccc}h2{margin:24px 0 6px}</style>
<h1>Built vs live</h1>\n${rows.join('\n')}\n`);
}

// Gated images and .reveal sections only appear once scrolled into view: walk the page first.
async function loadEverything(page) {
  await page.evaluate(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await pause(120);
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await pause(300);
  });
  await page.waitForLoadState('networkidle');
  // Lazy images parked horizontally off-screen (carousel slides) never load: wait only for the rest.
  await page.waitForFunction(() => [...document.images].every((img) => {
    if (img.complete) return true;
    const { left, right } = img.getBoundingClientRect();
    return img.loading === 'lazy' && (right <= 0 || left >= window.innerWidth);
  }), null, { timeout: 10000 }).catch((error) => console.warn(`images not all loaded: ${error.message.split('\n')[0]}`));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import('playwright-core');
const server = await startServer({ root: path.join(ROOT, 'dist'), port: 0 });
const overflows = [];
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  for (const width of widths) {
    for (const denied of [false, true]) {
      const items = plan.filter((item) => item.width === width && item.denied === denied);
      if (!items.length) continue;
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      if (denied) await context.addCookies([{ name: 'natur_consent', value: 'denied', url: server.url }]);
      const page = await context.newPage();
      for (const item of items) {
        await page.goto(server.url + item.route, { waitUntil: 'load' });
        await page.waitForTimeout(800);
        await loadEverything(page);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        await page.screenshot({ path: path.join(OUT, shotFile(item)), fullPage: true });
        if (over > 0) overflows.push(`${item.route} @${width}${denied ? ' denied' : ''} (+${over}px)`);
        console.log(`${item.route} ${width}${denied ? ' denied' : ''} overflow=${Math.max(over, 0)} ${shotFile(item)}`);
      }
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
writeIndex();
if (overflows.length) {
  console.log(`shots FAIL horizontal overflow: ${overflows.join('; ')}`);
  process.exit(1);
}
console.log(`shots ok (${plan.length}) -> ${path.relative(ROOT, path.join(OUT, 'index.html'))}`);

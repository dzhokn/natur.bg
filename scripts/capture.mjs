// One-time read-only capture of https://natur.bg. Raw files go to .local/capture/,
// used uploads to media/originals/. Never runs during a build.
//   node scripts/capture.mjs [--no-shots | --shots-only | --verify [--no-shots]]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://natur.bg';
const CAPTURE = path.join(ROOT, '.local', 'capture');
const ORIGINALS = path.join(ROOT, 'media', 'originals');
const MANIFEST = path.join(CAPTURE, 'manifest.json');
const WIDTHS = [1440, 768, 390];
const HEIGHT = 900;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CONCURRENCY = 2;
const TIMEOUT_MS = 20_000;
const RETRIES = 2;
const PDF_PATH = '/wp-content/uploads/2021/10/CATALOG-NATUR-BG.pdf';

const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|svg|avif|ico)$/i;
const FONT_EXT = /\.(?:woff2?|ttf|otf|eot)$/i;
const UPLOAD_REF =
  /((?:https?:)?\/\/[^/\s"'()<>\\]+)?(\/wp-content\/uploads\/[^\s"'()<>\\,]+?\.(?:jpe?g|png|gif|webp|svg|avif|ico|pdf))/gi;
// CSS that can carry page backgrounds or the site fonts; plugin/theme CSS is never scanned.
const SCANNED_CSS = /\/wp-content\/uploads\/(?:elementor\/css\/|useanyfont\/uaf\.css)/;

const log = (...args) => console.log('[capture]', ...args);
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const slugOf = (route) => (route === '/' ? 'en_home' : route === '/bg/' ? 'bg_home' : route.replace(/^\/|\/$/g, '').replaceAll('/', '_'));

function readRoutes() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'routes.json'), 'utf8')).routes;
}

function readManifest() {
  return fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null;
}

async function mapBounded(items, worker, limit = CONCURRENCY) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

/** Read-only GET on natur.bg with a timeout and retries; 404 and other 4xx are returned, not retried. */
async function get(url) {
  if (new URL(url).origin !== ORIGIN) throw new Error(`refusing non-natur.bg URL ${url}`);
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'user-agent': UA, accept: '*/*' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (response.status >= 500 || response.status === 429) throw new Error(`HTTP ${response.status}`);
      return { status: response.status, body, finalUrl: response.url, type: response.headers.get('content-type') ?? '' };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(`${url}: ${lastError.message}`);
}

/** Cloudflare email obfuscation: first byte is the XOR key for the rest. */
function decodeCfEmail(hex) {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

export function decodeEmails(html) {
  return html
    .replace(/<script\b[^>]*email-decode(?:\.min)?\.js[^>]*>\s*<\/script>/gi, '')
    .replace(/<span\b[^>]*\bdata-cfemail="([0-9a-f]+)"[^>]*>[^<]*<\/span>/gi, (_, hex) => decodeCfEmail(hex))
    .replace(/(?:https?:\/\/[^/"'\s]+)?\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi, (_, hex) => `mailto:${decodeCfEmail(hex)}`)
    .replace(/\sdata-cfemail="[0-9a-f]+"/gi, '');
}

const LEFTOVER = /\/cdn-cgi\/|__cf_email__|email-protection/;

function absolute(url, base) {
  try {
    return new URL(url.trim().replace(/&#0?38;|&amp;/g, '&'), base);
  } catch {
    return null;
  }
}

/** Where a referenced URL lands on disk, or null when it is not captured. */
function classify(url, hint) {
  const parsed = absolute(url, ORIGIN);
  if (!parsed || !/^(?:www\.)?natur\.bg$/.test(parsed.hostname)) return null;
  const pathname = decodeURIComponent(parsed.pathname);
  if (pathname.includes('..')) return null;
  const clean = `${ORIGIN}${parsed.pathname}`;
  const base = path.posix.basename(pathname);
  const uploads = pathname.match(/^\/wp-content\/uploads\/(.+)$/);
  if (FONT_EXT.test(pathname)) return { url: clean, dest: path.join(ORIGINALS, 'fonts', base), kind: 'font' };
  if (uploads && pathname.endsWith('.pdf')) return { url: clean, dest: path.join(ORIGINALS, uploads[1]), kind: 'pdf' };
  if (uploads && IMAGE_EXT.test(pathname)) {
    return { url: clean, dest: path.join(ORIGINALS, uploads[1]), kind: hint === 'icon' || /\.ico$/i.test(pathname) ? 'icon' : 'image' };
  }
  if (hint === 'icon' && IMAGE_EXT.test(pathname)) return { url: clean, dest: path.join(ORIGINALS, 'icons', base), kind: 'icon' };
  return null;
}

function srcsetUrls(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function collectHtmlRefs(html) {
  const $ = cheerio.load(html);
  const refs = new Map();
  const add = (url, hint) => {
    if (url && !url.startsWith('data:')) refs.set(url, hint === 'icon' ? 'icon' : (refs.get(url) ?? hint));
  };
  $('img, source').each((_, el) => {
    for (const name of ['src', 'data-src', 'data-lazy-src']) add($(el).attr(name), 'image');
    for (const name of ['srcset', 'data-srcset', 'data-lazy-srcset']) srcsetUrls($(el).attr(name)).forEach((u) => add(u, 'image'));
  });
  $('link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"], link[rel="shortcut icon"]').each((_, el) => add($(el).attr('href'), 'icon'));
  $('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]').each((_, el) => add($(el).attr('content'), 'image'));
  // A regex over the raw text: the parser drops links that sit inside <noscript>/odd wrappers.
  const stylesheets = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)]
    .map((match) => /\bhref=["']([^"']+)["']/i.exec(match[0])?.[1])
    .filter(Boolean);
  // Elementor stores backgrounds in data-settings JSON and inline styles; scan the raw text too.
  const text = html.replaceAll('\\/', '/');
  for (const match of text.matchAll(UPLOAD_REF)) {
    if (!match[1] || /natur\.bg$/.test(match[1])) add(match[2], 'image');
  }
  return { refs, stylesheets };
}

function collectCssRefs(css, cssUrl) {
  const found = [];
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    const target = match[2].trim();
    if (target.startsWith('data:')) continue;
    const resolved = absolute(target, cssUrl);
    if (!resolved) continue;
    resolved.search = '';
    resolved.hash = '';
    found.push(resolved.href);
  }
  return found;
}

async function fetchRoutes(routes) {
  fs.mkdirSync(path.join(CAPTURE, 'html'), { recursive: true });
  return mapBounded(routes, async (route) => {
    const response = await get(`${ORIGIN}${route.path}`);
    const html = decodeEmails(response.body.toString('utf8'));
    if (LEFTOVER.test(html)) log(`WARN ${route.path}: email obfuscation remnants after decoding`);
    const slug = slugOf(route.path);
    const file = path.join(CAPTURE, 'html', `${slug}.html`);
    fs.writeFileSync(file, html);
    const title = cheerio.load(html)('title').first().text().trim();
    log(`${response.status} ${route.path}`);
    return { path: route.path, lang: route.lang, slug, status: response.status, htmlFile: rel(file), title, html };
  });
}

async function fetchWpMedia() {
  const items = [];
  for (const page of [1, 2]) {
    const response = await get(`${ORIGIN}/wp-json/wp/v2/media?per_page=100&page=${page}`);
    if (response.status === 200) items.push(...JSON.parse(response.body.toString('utf8')));
    else log(`WARN wp-json media page ${page}: HTTP ${response.status}`);
  }
  fs.writeFileSync(path.join(CAPTURE, 'wp-media.json'), `${JSON.stringify(items, null, 2)}\n`);
  // Every WordPress size URL points back at its full-size upload.
  const fullSize = new Map();
  for (const item of items) {
    fullSize.set(item.source_url, item.source_url);
    for (const size of Object.values(item.media_details?.sizes ?? {})) fullSize.set(size.source_url, item.source_url);
  }
  return fullSize;
}

/** `name-300x450.png` -> `name.png` when the REST index does not know the derivative. */
const stripSize = (url) => url.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, '$1');

async function main(args) {
  const noShots = args.includes('--no-shots');
  const routes = readRoutes();
  const previous = readManifest();
  fs.mkdirSync(CAPTURE, { recursive: true });
  const downloads = new Map();
  const missing = [];
  const files = [];
  const wanted = (url, hint, from) => {
    const target = classify(url, hint);
    if (target && !downloads.has(target.url)) downloads.set(target.url, { ...target, from });
  };

  const pages = await fetchRoutes(routes);
  const stylesheets = new Map();
  for (const page of pages) {
    const { refs, stylesheets: sheets } = collectHtmlRefs(page.html);
    for (const [url, hint] of refs) wanted(url, hint, page.path);
    for (const href of sheets) {
      const resolved = absolute(href, ORIGIN);
      if (resolved && /^(?:www\.)?natur\.bg$/.test(resolved.hostname)) stylesheets.set(`${ORIGIN}${resolved.pathname}${resolved.search}`, page.path);
    }
  }
  wanted(`${ORIGIN}${PDF_PATH}`, 'pdf', 'catalog');

  const cssDir = path.join(CAPTURE, 'css');
  fs.mkdirSync(cssDir, { recursive: true });
  await mapBounded([...stylesheets.keys()], async (url) => {
    const response = await get(url);
    if (response.status !== 200) return missing.push({ url, status: response.status });
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, '').replaceAll('/', '_');
    const file = path.join(cssDir, name);
    fs.writeFileSync(file, response.body);
    files.push({ url: `${ORIGIN}${parsed.pathname}`, path: rel(file), bytes: response.body.length, sha256: sha256(response.body), kind: 'css' });
    if (SCANNED_CSS.test(parsed.pathname)) {
      for (const ref of collectCssRefs(response.body.toString('utf8'), url)) wanted(ref, 'image', parsed.pathname);
    }
  });

  const fullSize = await fetchWpMedia();
  for (const target of [...downloads.values()]) {
    if (target.kind !== 'image') continue;
    const original = fullSize.get(target.url) ?? stripSize(target.url);
    if (original !== target.url) wanted(original, 'image', target.url);
  }

  await mapBounded([...downloads.values()], async (target) => {
    let body;
    if (fs.existsSync(target.dest)) {
      body = fs.readFileSync(target.dest);
    } else {
      const response = await get(target.url);
      if (response.status !== 200) {
        // Derivative-stripping guesses for full-size originals are expected to miss sometimes.
        if (!fullSize.has(target.url) && /^https?:/.test(target.from)) log(`no full-size at ${target.url} (${response.status})`);
        else missing.push({ url: target.url, status: response.status, from: target.from });
        return;
      }
      body = response.body;
      fs.mkdirSync(path.dirname(target.dest), { recursive: true });
      fs.writeFileSync(target.dest, body);
    }
    files.push({ url: target.url, path: rel(target.dest), bytes: body.length, sha256: sha256(body), kind: target.kind });
  });
  files.sort((a, b) => (a.path < b.path ? -1 : 1));

  const prior = new Map((previous?.routes ?? []).map((route) => [route.path, route]));
  const manifest = {
    capturedAt: new Date().toISOString(),
    routes: pages.map(({ html, ...page }) => ({
      ...page,
      shots: prior.get(page.path)?.shots ?? {},
      measurements: prior.get(page.path)?.measurements ?? {},
      fonts: prior.get(page.path)?.fonts ?? {},
    })),
    files,
    missing,
  };
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const bytes = files.filter((f) => f.path.startsWith('media/')).reduce((sum, f) => sum + f.bytes, 0);
  log(`${pages.length} routes, ${files.length} files (${bytes} bytes under media/originals), ${missing.length} missing`);
  for (const miss of missing) log(`MISSING ${miss.status} ${miss.url} (from ${miss.from ?? 'css'})`);
  if (!noShots) await shots(manifest);
}

// Runs inside the page: only plain DOM APIs, no closure over module scope.
function measurePage(viewportHeight) {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const top = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY);
  const selectorOf = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const classes = [...el.classList].slice(0, 3).map((name) => `.${name}`).join('');
    return `${el.tagName.toLowerCase()}${id}${classes}`;
  };
  const images = [...document.images].filter(visible).map((img) => {
    const rect = img.getBoundingClientRect();
    return {
      src: new URL(img.currentSrc || img.src, location.href).href,
      cssWidth: Math.round(rect.width * 100) / 100,
      cssHeight: Math.round(rect.height * 100) / 100,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      top: top(img),
      aboveFold: top(img) < viewportHeight,
      alt: img.getAttribute('alt'),
    };
  });
  const backgrounds = [];
  const fonts = new Set();
  for (const el of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    const match = /url\((['"]?)(.*?)\1\)/.exec(style.backgroundImage);
    if (match && visible(el)) {
      const rect = el.getBoundingClientRect();
      backgrounds.push({
        url: new URL(match[2], location.href).href,
        cssWidth: Math.round(rect.width * 100) / 100,
        cssHeight: Math.round(rect.height * 100) / 100,
        backgroundSize: style.backgroundSize,
        backgroundPosition: style.backgroundPosition,
        top: top(el),
        aboveFold: top(el) < viewportHeight,
        selector: selectorOf(el),
      });
    }
    const hasText = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
    if (hasText && visible(el)) fonts.add(style.fontFamily);
  }
  return { measurements: [...images, ...backgrounds], fonts: [...fonts].sort() };
}

async function shots(manifest) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  fs.mkdirSync(path.join(CAPTURE, 'shots'), { recursive: true });
  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: HEIGHT }, userAgent: UA });
      await mapBounded(manifest.routes, async (route) => {
        const page = await context.newPage();
        try {
          await page.goto(`${ORIGIN}${route.path}`, { waitUntil: 'load', timeout: 45_000 });
          await page.evaluate(async () => {
            const height = () => document.documentElement.scrollHeight;
            for (let y = 0; y < height(); y += 400) {
              window.scrollTo(0, y);
              await new Promise((resolve) => setTimeout(resolve, 120));
            }
            window.scrollTo(0, height());
          });
          await page.addStyleTag({ content: '.elementor-invisible{visibility:visible!important;opacity:1!important}' });
          await page.evaluate(async () => {
            const pending = [...document.images].map((img) => {
              img.loading = 'eager';
              return img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; });
            });
            await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, 10_000))]);
            window.scrollTo(0, 0);
            await new Promise((resolve) => setTimeout(resolve, 400));
          });
          const file = path.join(CAPTURE, 'shots', `${route.slug}-${width}.png`);
          await page.screenshot({ path: file, fullPage: true });
          const { measurements, fonts } = await page.evaluate(measurePage, HEIGHT);
          route.shots[width] = rel(file);
          route.measurements[width] = measurements;
          if (width === WIDTHS[0]) route.fonts[width] = fonts;
          log(`shot ${route.path} @${width}`);
        } finally {
          await page.close();
        }
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  manifest.capturedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

function verify(args) {
  const problems = [];
  const manifest = readManifest();
  if (!manifest) {
    console.error('verify FAIL: no manifest');
    process.exit(1);
  }
  const expected = readRoutes();
  if (manifest.routes.length !== expected.length) problems.push(`routes ${manifest.routes.length}/${expected.length}`);
  for (const route of manifest.routes) {
    if (route.status !== 200) problems.push(`status ${route.status} ${route.path}`);
    const htmlFile = path.join(ROOT, route.htmlFile);
    if (!fs.existsSync(htmlFile)) problems.push(`html missing ${route.path}`);
    else if (LEFTOVER.test(fs.readFileSync(htmlFile, 'utf8'))) problems.push(`email remnants ${route.path}`);
    if (!args.includes('--no-shots')) {
      for (const width of WIDTHS) {
        if (!route.shots?.[width] || !fs.existsSync(path.join(ROOT, route.shots[width]))) problems.push(`shot ${route.path}@${width}`);
      }
    }
  }
  for (const file of manifest.files) {
    const full = path.join(ROOT, file.path);
    if (!fs.existsSync(full) || fs.statSync(full).size !== file.bytes) problems.push(`file ${file.path}`);
  }
  const summary = `${manifest.routes.filter((r) => r.status === 200).length} routes 200, ${manifest.files.length} files`;
  if (problems.length) {
    console.error(`verify FAIL: ${summary}; ${problems.length} problems: ${problems.slice(0, 10).join('; ')}`);
    process.exit(1);
  }
  console.log(`verify ok: ${summary}`);
}

const args = process.argv.slice(2);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes('--verify')) verify(args);
  else if (args.includes('--shots-only')) {
    const manifest = readManifest();
    if (!manifest) throw new Error('run capture without --shots-only first');
    await shots(manifest);
  } else {
    await main(args).catch((error) => {
      console.error(`[capture] failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

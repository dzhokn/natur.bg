// Static gate over dist/: size budgets, eager request budget, link/asset resolution and
// the no-third-party rules. Writes dist/build-manifest.json and exits 1 on any violation.
//   node scripts/check.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const KB = 1024;
const BUDGET = { html: 30 * KB, css: 25 * KB, js: 4 * KB, inline: 300, eager: 150 * KB, requests: 20 };
const VIEWPORT = { width: 412, dpr: 1.75 };
// Lighthouse image-size-responsive at DPR 1.75: natural width >= ceil(0.75 * 1.5 * displayed).
const RESPONSIVE_RATIO = 1.125;
const CATALOG = '/wp-content/uploads/2021/10/CATALOG-NATUR-BG.pdf';
const ORIGIN = 'https://natur.bg';
const TEXT_FILE = /\.(?:html|css|js|mjs|xml|txt|json|svg|webmanifest)$/;

const violations = [];
const violate = (route, message) => violations.push(`${route}: ${message}`);
const gzip = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const isFile = (file) => fs.existsSync(file) && fs.statSync(file).isFile();
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** Resolves a URL path to a dist file (directory routes -> index.html), or null. */
function distFile(pathname) {
  let clean;
  try {
    clean = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.join(DIST, clean.endsWith('/') ? `${clean}index.html` : clean);
  return !path.relative(DIST, file).startsWith('..') && isFile(file) ? file : null;
}

/** Classifies a reference: null = ignorable, {external} = other origin, {file} = dist path. */
function classify(ref, base) {
  const value = ref.trim();
  if (!value || value.startsWith('#') || /^(?:data|mailto|tel|javascript):/i.test(value)) return null;
  const url = new URL(value, `${ORIGIN}${base}`);
  if (url.origin !== ORIGIN || /^\/\//.test(value)) return { external: url.origin };
  return { pathname: url.pathname };
}

const srcsetUrls = (srcset = '') => srcset.split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
const srcsetCandidates = (srcset = '') => srcset.split(',').map((part) => {
  const [url, descriptor = ''] = part.trim().split(/\s+/);
  return { url, width: /w$/.test(descriptor) ? Number(descriptor.slice(0, -1)) : 0 };
}).filter((c) => c.url);

function mediaMatches(media) {
  if (!media) return true;
  return media.split(/\band\b/i).every((raw) => {
    const m = raw.trim().replace(/^\(|\)$/g, '').match(/^(max-width|min-width|max-resolution|min-resolution)\s*:\s*([\d.]+)(px|dppx)$/);
    if (!m) return false;
    const n = Number(m[2]);
    return { 'max-width': VIEWPORT.width <= n, 'min-width': VIEWPORT.width >= n,
      'max-resolution': VIEWPORT.dpr <= n, 'min-resolution': VIEWPORT.dpr >= n }[m[1]];
  });
}

/** Rendered CSS width from `sizes` (first matching entry), falling back to the width attribute. */
function slotWidth(sizes, widthAttr) {
  for (const entry of (sizes ?? '').split(',')) {
    const m = entry.trim().match(/^(?:\((.+?)\)\s+)?(?:([\d.]+)(px|vw)|calc\(100vw - ([\d.]+)px\))$/);
    if (!m || (m[1] && !mediaMatches(m[1]))) continue;
    if (m[4]) return VIEWPORT.width - Number(m[4]);
    return m[3] === 'vw' ? (Number(m[2]) / 100) * VIEWPORT.width : Number(m[2]);
  }
  return Math.min(Number(widthAttr) || VIEWPORT.width, VIEWPORT.width);
}

/** Smallest candidate covering slot x DPR, else the largest one (what the browser does). */
function pickCandidate(srcset, sizes, widthAttr) {
  const candidates = srcsetCandidates(srcset);
  if (!candidates.length) return null;
  if (!candidates.some((c) => c.width)) return candidates[0].url;
  const target = slotWidth(sizes, widthAttr) * VIEWPORT.dpr;
  const sorted = [...candidates].sort((a, b) => a.width - b.width);
  return (sorted.find((c) => c.width >= target) ?? sorted.at(-1)).url;
}

/** The srcset/sizes pair the phone picks for an <img> (art-directed sources first), gated or not. */
function phoneSet($, img) {
  const el = $(img);
  const pair = (node) => ({
    srcset: node.attr('srcset') ?? node.attr('data-srcset'),
    sizes: node.attr('sizes') ?? el.attr('sizes'),
  });
  for (const source of el.parent('picture').children('source').toArray()) {
    const s = $(source);
    if (/^image\/(?:avif|webp)$/.test(s.attr('type') ?? 'image/avif') && mediaMatches(s.attr('media'))) return pair(s);
  }
  return pair(el);
}

/** The URL a mobile Chrome fetches for an <img> (art-directed <picture> sources first). */
function eagerImageUrl($, img) {
  const el = $(img);
  const picture = el.parent('picture');
  const width = el.attr('width');
  if (picture.length) {
    for (const source of picture.children('source').toArray()) {
      const s = $(source);
      if (!/^image\/(?:avif|webp)$/.test(s.attr('type') ?? 'image/avif') || !mediaMatches(s.attr('media'))) continue;
      return pickCandidate(s.attr('srcset'), s.attr('sizes') ?? el.attr('sizes'), width);
    }
  }
  return pickCandidate(el.attr('srcset'), el.attr('sizes'), width) ?? el.attr('src');
}

const cssCache = new Map();
function readCss(pathname) {
  if (!cssCache.has(pathname)) {
    const file = distFile(pathname);
    cssCache.set(pathname, file ? fs.readFileSync(file) : null);
  }
  return cssCache.get(pathname);
}

function checkRoute(name, htmlFile) {
  const html = fs.readFileSync(htmlFile);
  const $ = cheerio.load(html.toString('utf8'));
  const pagePath = name === '/404.html' ? '/' : name;
  const eager = new Map(); // pathname -> bytes
  const stats = { htmlGzip: gzip(html), cssGzip: 0, jsGzip: 0, inlineJs: 0, preloads: [], fonts: [] };

  const addEager = (pathname, bytes) => { if (!eager.has(pathname)) eager.set(pathname, bytes); };
  const resolveRef = (ref, what, { loaded, base = pagePath }) => {
    const c = classify(ref, base);
    if (!c) return null;
    if (c.external) {
      if (loaded) violate(name, `external origin ${c.external} in ${what} ${ref}`);
      return null;
    }
    if (c.pathname.includes('/cdn-cgi/')) violate(name, `cdn-cgi reference ${ref}`);
    const file = distFile(c.pathname);
    if (!file) violate(name, `${what} ${ref} does not resolve to a dist file`);
    return file ? { pathname: c.pathname, file } : null;
  };
  const eagerFile = (ref, what, text = false) => {
    const hit = resolveRef(ref, what, { loaded: true });
    if (!hit) return null;
    const buf = fs.readFileSync(hit.file);
    addEager(hit.pathname, text ? gzip(buf) : buf.length);
    return buf;
  };

  for (const a of $('a[href]').toArray()) {
    const href = a.attribs.href;
    const host = /^https?:\/\/([^/?#]+)/i.exec(href.trim())?.[1];
    if (host && !host.includes('.')) violate(name, `link ${href} has a host without a dot`);
    resolveRef(href, 'link', { loaded: false });
  }

  for (const link of $('link').toArray()) {
    const rel = (link.attribs.rel ?? '').toLowerCase().split(/\s+/);
    const href = link.attribs.href;
    if (!href && !link.attribs.imagesrcset) continue;
    if (rel.includes('stylesheet')) {
      const buf = eagerFile(href, 'stylesheet', true);
      if (!buf) continue;
      stats.cssGzip += gzip(buf);
      const base = new URL(href, `${ORIGIN}${pagePath}`).pathname;
      for (const m of buf.toString('utf8').matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        resolveRef(m[2], 'css url()', { loaded: true, base });
      }
      checkEagerBackgrounds(name, buf.toString('utf8'));
    } else if (rel.includes('preload')) {
      stats.preloads.push(href ?? link.attribs.imagesrcset);
      if (link.attribs.as === 'font') {
        stats.fonts.push(href);
        eagerFile(href, 'font preload');
      }
      for (const url of srcsetUrls(link.attribs.imagesrcset)) resolveRef(url, 'preload srcset', { loaded: true });
      if (link.attribs.as === 'image' && href) resolveRef(href, 'preload', { loaded: true });
    } else if (rel.some((r) => ['icon', 'apple-touch-icon', 'manifest'].includes(r))) {
      if (rel.includes('apple-touch-icon')) resolveRef(href, rel.join(' '), { loaded: true });
      else eagerFile(href, rel.join(' '));
    }
  }
  const inlineCss = $('style').toArray().map((el) => $(el).text()).join('');
  stats.cssGzip += inlineCss ? gzip(Buffer.from(inlineCss)) : 0;

  for (const script of $('script').toArray()) {
    const { src, type } = script.attribs;
    if (src) {
      const buf = eagerFile(src, 'script', true);
      if (buf) stats.jsGzip += gzip(buf);
    } else if (!/ld\+json/.test(type ?? '')) {
      stats.inlineJs += Buffer.byteLength($(script).text());
    }
  }

  // <noscript> holds the plain copy of every gated image: it must resolve, but never loads eagerly.
  const noscriptImgs = $('noscript').toArray().flatMap((el) => cheerio.load($(el).html() ?? '')('img, source').toArray());
  for (const img of $('img').toArray()) {
    const gated = 'data-src' in img.attribs || 'data-srcset' in img.attribs;
    const lazy = img.attribs.loading === 'lazy' || gated;
    if (gated && (img.attribs.src || img.attribs.srcset)) violate(name, `gated image ${img.attribs['data-src']} has src/srcset`);
    const all = [img.attribs.src, ...srcsetUrls(img.attribs.srcset), img.attribs['data-src'], ...srcsetUrls(img.attribs['data-srcset'])];
    for (const source of $(img).parent('picture').children('source').toArray()) {
      all.push(...srcsetUrls(source.attribs.srcset), ...srcsetUrls(source.attribs['data-srcset']));
    }
    for (const ref of all.filter(Boolean)) resolveRef(ref, 'image', { loaded: true });
    const { srcset, sizes } = phoneSet($, img);
    const largest = Math.max(0, ...srcsetCandidates(srcset).map((c) => c.width));
    const shown = slotWidth(sizes, img.attribs.width);
    if (largest && shown * RESPONSIVE_RATIO > largest) {
      violate(name, `image ${img.attribs.src ?? img.attribs['data-src']} shows ${Math.round(shown)} px on a phone, ` +
        `largest candidate ${largest} px < ${Math.ceil(shown * RESPONSIVE_RATIO)}`);
    }
    if (!lazy) {
      const chosen = eagerImageUrl($, img);
      if (chosen) eagerFile(chosen, 'eager image');
    }
  }
  for (const img of noscriptImgs) {
    for (const ref of [img.attribs.src, ...srcsetUrls(img.attribs.srcset)].filter(Boolean)) {
      resolveRef(ref, 'noscript image', { loaded: true });
    }
  }
  for (const source of $('source[src]').toArray()) resolveRef(source.attribs.src, 'media source', { loaded: true });
  for (const el of $('[style]').toArray()) {
    for (const m of el.attribs.style.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      resolveRef(m[2], 'style url()', { loaded: true });
    }
  }

  const eagerBytes = stats.htmlGzip + [...eager.values()].reduce((sum, n) => sum + n, 0);
  const eagerRequests = 1 + eager.size;
  if (stats.htmlGzip > BUDGET.html) violate(name, `html ${stats.htmlGzip} B gzip > ${BUDGET.html}`);
  if (stats.cssGzip > BUDGET.css) violate(name, `css ${stats.cssGzip} B gzip > ${BUDGET.css}`);
  if (stats.jsGzip > BUDGET.js) violate(name, `js ${stats.jsGzip} B gzip > ${BUDGET.js}`);
  if (stats.inlineJs > BUDGET.inline) violate(name, `inline script ${stats.inlineJs} B > ${BUDGET.inline}`);
  if (eagerBytes > BUDGET.eager) violate(name, `eager payload ${eagerBytes} B > ${BUDGET.eager}`);
  if (eagerRequests > BUDGET.requests) violate(name, `${eagerRequests} eager requests > ${BUDGET.requests}`);
  return { htmlGzip: stats.htmlGzip, cssGzip: stats.cssGzip, jsGzip: stats.jsGzip, inlineJs: stats.inlineJs,
    eagerBytes, eagerRequests, preloads: stats.preloads, fonts: stats.fonts };
}

/** Image backgrounds may only be applied by `.bg-in` (set after JS); anything else would be eager. */
const reportedBackgrounds = new Set();
function checkEagerBackgrounds(route, css) {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!/background(?:-image)?\s*:[^;]*url\(\s*(?!['"]?data:)/.test(m[2])) continue;
    if (/\.bg-in\b/.test(selector) || reportedBackgrounds.has(selector)) continue;
    reportedBackgrounds.add(selector);
    violate(route, `css background in "${selector}" is not behind .bg-in`);
  }
}

function checkWpContent() {
  for (const file of walk(DIST).filter((f) => TEXT_FILE.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = `/${path.relative(DIST, file).split(path.sep).join('/')}`;
    for (const m of text.matchAll(/[^\s"'()<>]*wp-content[^\s"'()<>]*/g)) {
      if (m[0] !== CATALOG && !m[0].endsWith(CATALOG)) violate(rel, `wp-content reference ${m[0]}`);
    }
    if (text.includes('/cdn-cgi/')) violate(rel, 'cdn-cgi reference');
    if (text.includes('878466854')) violate(rel, 'stale phone number 878466854');
  }
  const built = distFile(CATALOG);
  const original = path.join(ROOT, 'media/originals/2021/10/CATALOG-NATUR-BG.pdf');
  if (!built) violate(CATALOG, 'missing from dist');
  else if (!isFile(original) || !fs.readFileSync(built).equals(fs.readFileSync(original))) {
    violate(CATALOG, 'is not byte-identical to media/originals/2021/10/CATALOG-NATUR-BG.pdf');
  }
}

if (!isFile(path.join(DIST, 'index.html'))) {
  console.error('check FAIL: dist/ is missing, run npm run build first');
  process.exit(1);
}

const routes = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/routes.json'), 'utf8')).routes;
const manifest = { routes: {}, violations };
for (const route of routes) {
  const file = distFile(route.path);
  if (!file) violate(route.path, 'built page is missing');
  else manifest.routes[route.path] = checkRoute(route.path, file);
}
if (isFile(path.join(DIST, '404.html'))) manifest.routes['/404.html'] = checkRoute('/404.html', path.join(DIST, '404.html'));
else violate('/404.html', 'missing');
checkWpContent();

fs.writeFileSync(path.join(DIST, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const line of violations) console.log(line);
console.log(violations.length ? `check FAIL ${violations.length}` : 'check ok');
process.exit(violations.length ? 1 : 0);

// Derives responsive AVIF/WebP, og JPEGs and icons from media/originals into assets/ and
// content/media.json. Offline and deterministic; unchanged inputs are never re-encoded.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { LO_RATIO, PHONE_VW, ceil10, phoneWidth, round10 } from './lib/sizes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG_DIR = 'assets/img';
const OG_DIR = 'assets/og';
const ICON_DIR = 'assets/icons';
const CACHE_FILE = path.join(ROOT, '.local/media-cache.json');
const MANIFEST = path.join(ROOT, 'content/media.json');
const CAPTURE = path.join(ROOT, '.local/capture/manifest.json');
const VERSION = 'media-v3';
const WIDTHS = ['390', '768', '1440'];
const AVIF_STEPS = [75, 82, 88, 94];
const WEBP_STEPS = [90, 95, 100];
const HERO = 'media/originals/2021/06/naturbg-home-4.jpg';
const HERO_DESKTOP = [768, 1024, 1440, 1920];
const HERO_MOBILE = { box: [390, 288], offsetX: 40, widths: [470], hiDpiWidths: [824] };
// Fallback 1x widths per capture width when a background has no <img> measurement.
const BG_FALLBACK = { 390: 412, 768: 768, 1440: 1440 };
// A breakpoint's 1x width when the capture has no <img> measurement for it.
const SLOT_CAP = { 390: 390, 768: 768, 1440: Infinity };
// Above-the-fold photos the build renders as <picture> + object-fit: cover (never as .bg-in).
// box = [width, height] of the live element per capture width; sizes mirrors its fluid width.
// crop = the ≤767 px box (aspect-ratio 1050/420, object-position y 30%) as its own art-directed set.
const PHOTO_FILL = {
  crop: { ratio: 2.5, y: 0.3, widths: [420, 780, 1450], sizes: 'calc(100vw - 40px)' },
  sizes: '(max-width: 767px) calc(100vw - 40px), (max-width: 1109px) calc(100vw - 60px), 1050px',
  box: { 390: [350, 140], 768: [708, 372], 1440: [1050, 552] },
};
const HERO_FILL = { sizes: '100vw', box: { 390: [390, 240], 768: [768, 405], 1440: [1440, 405] } };
const FILL = {
  'media/originals/2021/06/contacts-2.jpg': HERO_FILL,
  'media/originals/2021/07/about-us-2.jpg': HERO_FILL,
  'media/originals/2021/05/Organic-rye-sticks-wholegrain.jpg': PHOTO_FILL,
  'media/originals/2021/07/Organic-spelt-sticks-wholegrain.jpg': PHOTO_FILL,
  'media/originals/2021/10/7-scaled.jpg': PHOTO_FILL,
  'media/originals/2021/10/8-scaled.jpg': PHOTO_FILL,
};
const ICON_SOURCE ='media/originals/2021/05/cropped-natur-favicon.png';
const FALLBACK_RENDERED = 800;
const OG_WIDTH = 1200;
// Section backgrounds that only the captured Elementor CSS references; the build styles them.
const CSS_BACKGROUNDS = [
  'media/originals/2021/06/store-home-2.jpg',
  'media/originals/2021/06/contact-background.png',
  'media/originals/2021/10/7-scaled.jpg',
];

const abs = (rel) => path.join(ROOT, rel);
const sha = (buf, n = 8) => createHash('sha256').update(buf).digest('hex').slice(0, n);
const readJson = (rel) => JSON.parse(readFileSync(abs(rel), 'utf8'));
const groupKey = (p) => p.replace(/-\d+x\d+(?=\.\w+$)/, '');
const isSvg = (p) => /\.svg$/i.test(p);
const baseName = (p) =>
  path
    .basename(p, path.extname(p))
    .replace(/-[a-z0-9]{40,}$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collectRefs(skip = []) {
  const refs = new Set(skip.length ? [] : CSS_BACKGROUNDS);
  const re = /media\/originals\/[^"'\s<>)\\,;]+\.(?:png|jpe?g|svg)\b/gi;
  for (const file of walk(abs('content'))) {
    if (!/\.(json|html)$/.test(file) || file.endsWith('media.json') || file.endsWith('fonts.json')) continue;
    if (skip.some((s) => file.endsWith(s))) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(re)) refs.add(m[0]);
  }
  for (const ref of refs) if (!existsSync(abs(ref))) throw new Error(`missing original: ${ref}`);
  return [...refs].sort();
}

// Sources painted as CSS backgrounds (data-bg fragments, product backgrounds[], captured CSS).
function collectBackgrounds() {
  const bgs = new Set(CSS_BACKGROUNDS);
  const walkJson = (node) => {
    if (Array.isArray(node)) node.forEach(walkJson);
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'backgrounds' && Array.isArray(v)) {
          for (const b of v) if (typeof b?.src === 'string') bgs.add(b.src);
        }
        walkJson(v);
      }
    }
  };
  const re = /data-bg=\\?"(media\/originals\/[^"\\]+)/g;
  for (const file of walk(abs('content'))) {
    if (!/\.(json|html)$/.test(file) || file.endsWith('media.json') || file.endsWith('fonts.json')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) bgs.add(m[1]);
    if (file.endsWith('.json')) walkJson(JSON.parse(text));
  }
  return bgs;
}

function collectGroups(node, out = []) {
  if (Array.isArray(node)) {
    const srcs = node.map((n) => n?.src).filter((s) => typeof s === 'string' && s.startsWith('media/originals/'));
    if (srcs.length > 1) out.push(srcs);
    node.forEach((n) => collectGroups(n, out));
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach((n) => collectGroups(n, out));
  }
  return out;
}

// Rendered CSS widths and above-the-fold flags per WordPress upload path, from the live capture.
function loadMeasurements() {
  const byPath = new Map();
  const manifest = JSON.parse(readFileSync(CAPTURE, 'utf8'));
  for (const route of manifest.routes) {
    for (const vw of WIDTHS) {
      for (const m of route.measurements?.[vw] ?? []) {
        const url = m.src ?? m.url ?? '';
        const at = url.indexOf('/wp-content/uploads/');
        if (at < 0) continue;
        const p = `media/originals/${url.slice(at + 20)}`;
        const e = byPath.get(p) ?? { width: 0, perVw: {}, fold: { 390: false, 1440: false } };
        e.width = Math.max(e.width, m.cssWidth ?? 0);
        e.perVw[vw] = Math.max(e.perVw[vw] ?? 0, m.cssWidth ?? 0);
        if (m.aboveFold && vw in e.fold) e.fold[vw] = true;
        byPath.set(p, e);
      }
    }
  }
  return byPath;
}

function groupMeasure(byPath, key) {
  const g = groupKey(key);
  const agg = { width: 0, perVw: {}, fold: { 390: false, 1440: false }, derivs: [] };
  for (const [p, e] of byPath) {
    if (groupKey(p) !== g) continue;
    agg.width = Math.max(agg.width, e.width);
    for (const vw of WIDTHS) agg.perVw[vw] = Math.max(agg.perVw[vw] ?? 0, e.perVw[vw] ?? 0);
    for (const k of ['390', '1440']) agg.fold[k] ||= e.fold[k];
    if (p !== g) agg.derivs.push({ p, width: e.width });
  }
  return agg;
}

function ssimLuma(a, b, w, h, chans) {
  const luma = (buf, i) =>
    chans >= 3 ? 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2] : buf[i];
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  let total = 0;
  let blocks = 0;
  for (let y0 = 0; y0 < h; y0 += 8) {
    for (let x0 = 0; x0 < w; x0 += 8) {
      const bw = Math.min(8, w - x0);
      const bh = Math.min(8, h - y0);
      const n = bw * bh;
      let ma = 0, mb = 0;
      for (let y = y0; y < y0 + bh; y++) {
        for (let x = x0; x < x0 + bw; x++) {
          const i = (y * w + x) * chans;
          ma += luma(a, i);
          mb += luma(b, i);
        }
      }
      ma /= n;
      mb /= n;
      let va = 0, vb = 0, cov = 0;
      for (let y = y0; y < y0 + bh; y++) {
        for (let x = x0; x < x0 + bw; x++) {
          const i = (y * w + x) * chans;
          const da = luma(a, i) - ma;
          const db = luma(b, i) - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      }
      va /= n;
      vb /= n;
      cov /= n;
      total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
      blocks++;
    }
  }
  return total / blocks;
}

const flatRaw = (pipe) =>
  pipe.toColourspace('srgb').flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });

async function encode(target, format, quality) {
  const pipe = target.make();
  const buf =
    format === 'avif'
      ? await pipe.avif({ quality, effort: 6 }).toBuffer()
      : await pipe.webp(quality === 100 ? { lossless: true, effort: 6 } : { quality, effort: 6 }).toBuffer();
  return buf;
}

// Encodes one target in one format, raising quality until the SSIM floor is met.
async function encodeVariant(target, format, floor, ref) {
  const steps = format === 'avif' ? AVIF_STEPS : WEBP_STEPS;
  let last;
  for (const quality of steps) {
    const buf = await encode(target, format, quality);
    const dec = await flatRaw(sharp(buf));
    const ssim = ssimLuma(ref.data, dec.data, ref.info.width, ref.info.height, ref.info.channels);
    last = { buf, quality, ssim };
    if (ssim >= floor) return last;
  }
  throw new Error(`${target.file} ${format}: ssim ${last.ssim.toFixed(4)} < ${floor} at max quality`);
}

function writeHashed(buf, base, w, ext) {
  const name = w == null ? `${base}.${sha(buf)}.${ext}` : `${base}-${w}.${sha(buf)}.${ext}`;
  const rel = `${IMG_DIR}/${name}`;
  mkdirSync(abs(IMG_DIR), { recursive: true });
  writeFileSync(abs(rel), buf);
  return rel;
}

// 390 at 1.75x and 2x, 768 and 1440 at 1x and 2x: what a phone, a tablet and a desktop pick.
// Eager phone images also get the 1.125x width (the only candidate a 1.5-1.99 dppx phone is
// offered) and the 2x width at the 412 px test phone, both from `phone` (its CSS width).
function widthLadder(slots, max, skipPhone, phone) {
  const [a, b, c] = WIDTHS.map((vw) => slots[vw]);
  const extra = phone ? [ceil10(phone * LO_RATIO), phone * 2] : [];
  const mobile = skipPhone ? [] : [a * 1.75, a * 2, ...extra];
  return [...new Set([...mobile, b, b * 2, c, c * 2].map((w) => Math.min(round10(w), max)))]
    .sort((x, y) => x - y);
}

const sizesFrom = (slots) => {
  const [a, b, c] = WIDTHS.map((vw) => slots[vw]);
  return a === b && b === c ? `${a}px` : `(max-width: 767px) ${a}px, (max-width: 1024px) ${b}px, ${c}px`;
};

function planTargets(key, src, meta, rendered, bgRendered, widths, srcCrop, fill) {
  const srcBuf = readFileSync(abs(src));
  const make = (w, h, crop) => () => {
    const c = crop ?? srcCrop;
    let p = sharp(srcBuf);
    if (c) p = p.extract(c);
    return w === meta.width && !c ? p : p.resize(w, h, { kernel: 'lanczos3', fit: 'fill' });
  };
  const dims = (w) => [w, Math.round((meta.height * w) / meta.width)];
  const cap = (list, max) => [...new Set(list.map((w) => Math.min(w, max)))].sort((a, b) => a - b);
  const base = baseName(key);
  const mk = (w, tag = base, crop, cropW) => {
    const [, h] = crop ? [w, Math.round((w * HERO_MOBILE.box[1]) / HERO_MOBILE.box[0])] : dims(w);
    return { w, h, tag, make: make(w, h, crop), cropW };
  };
  // Backgrounds load eagerly at every viewport, so each breakpoint gets its own 1x/2x pair.
  const bg = bgRendered
    ? Object.fromEntries(WIDTHS.map((vw) => {
        const r = bgRendered[vw] || Math.min(meta.width, BG_FALLBACK[vw]);
        return [vw, cap([Math.ceil(r), Math.ceil(r * 2)], meta.width).map((w) => mk(w))];
      }))
    : null;
  if (key !== HERO) {
    const list = widths ?? cap([Math.ceil(rendered), Math.ceil(rendered * 2)], meta.width);
    let mobile = null;
    if (fill?.crop) {
      const { ratio, y, widths: cw } = fill.crop;
      const height = Math.round(meta.width / ratio);
      const box = { left: 0, top: Math.round((meta.height - height) * y), width: meta.width, height };
      mobile = cap(cw, meta.width).map((w) => {
        const h = Math.round(w / ratio);
        return { w, h, tag: `${base}-m`, make: make(w, h, box) };
      });
    }
    return { variants: list.map((w) => mk(w)), art: null, bg, mobile };
  }
  const [bw, bh] = HERO_MOBILE.box;
  const scale = Math.max(bw / meta.width, bh / meta.height);
  const crop = {
    left: Math.round(HERO_MOBILE.offsetX / scale),
    top: 0,
    width: Math.round(bw / scale),
    height: Math.round(bh / scale),
  };
  const crops = (list) => cap(list, crop.width).map((w) => mk(w, `${base}-m`, crop));
  const desktop = cap(HERO_DESKTOP, meta.width).map((w) => mk(w));
  return {
    variants: desktop,
    art: { mobile: crops(HERO_MOBILE.widths), mobileHiDpi: crops(HERO_MOBILE.hiDpiWidths), desktop },
    bg,
  };
}

async function processRaster(key, src, kind, alpha, meta, rendered, bgRendered, widths, crop, fill) {
  const floor = kind === 'photo' ? 0.98 : 0.99;
  const plan = planTargets(key, src, meta, rendered, bgRendered, widths, crop, fill);
  const done = new Map();
  const run = async (t) => {
    const id = `${t.tag}-${t.w}`;
    if (done.has(id)) return done.get(id);
    const ref = await flatRaw(t.make());
    const out = [];
    for (const format of ['avif', 'webp']) {
      const r = await encodeVariant(t, format, floor, ref);
      const file = writeHashed(r.buf, t.tag, t.w, format);
      out.push({ w: t.w, h: t.h, format, file, bytes: r.buf.length, quality: r.quality, ssim: +r.ssim.toFixed(4) });
    }
    done.set(id, out);
    return out;
  };
  const variants = (await Promise.all(plan.variants.map(run))).flat();
  const res = { variants };
  if (plan.art) {
    const mobile = (await Promise.all(plan.art.mobile.map(run))).flat();
    const mobileHiDpi = (await Promise.all(plan.art.mobileHiDpi.map(run))).flat();
    res.art = { mobile, mobileHiDpi, desktop: variants };
  }
  if (plan.mobile) {
    res.crops = { mobile: (await Promise.all(plan.mobile.map(run))).flat(), sizes: fill.crop.sizes };
  }
  if (plan.bg) {
    res.bg = {};
    for (const vw of WIDTHS) res.bg[vw] = (await Promise.all(plan.bg[vw].map(run))).flat();
  }
  return res;
}

function chooseSource(key, agg) {
  const full = groupKey(key);
  if (!existsSync(abs(full))) return key;
  // Cropped derivatives (elementor thumbs, odd WP sizes) win when the full upload's shape differs.
  const best = agg.derivs.filter((d) => existsSync(abs(d.p))).sort((a, b) => b.width - a.width)[0];
  if (!best) return full;
  const m = best.p.match(/-(\d+)x(\d+)\.\w+$/);
  return { full, deriv: best.p, ratio: m ? m[1] / m[2] : null };
}

let originalFiles;
// Elementor thumbs drop the hash suffix of the upload they were cropped from.
function fullOfThumb(key) {
  originalFiles ??= walk(abs('media/originals'))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .filter((f) => !f.startsWith('media/originals/elementor/'));
  const name = path.basename(key).replace(/-[a-z0-9]{40,}(?=\.\w+$)/, '').toLowerCase();
  return originalFiles.find((f) => path.basename(f).toLowerCase() === name) ?? null;
}

// Elementor crops are centred: re-derive the crop from the full upload so wider widths exist
// without upscaling. Null unless the upload is larger and the crop matches the derivative.
async function recrop(deriv, full) {
  const [dm, fm] = await Promise.all([sharp(abs(deriv)).metadata(), sharp(abs(full)).metadata()]);
  if (fm.width <= dm.width) return null;
  const ratio = dm.width / dm.height;
  const wide = fm.width / fm.height > ratio;
  const width = wide ? Math.round(fm.height * ratio) : fm.width;
  const height = wide ? fm.height : Math.round(fm.width / ratio);
  const crop = { left: Math.floor((fm.width - width) / 2), top: Math.floor((fm.height - height) / 2), width, height };
  const ref = await flatRaw(sharp(abs(deriv)));
  const got = await flatRaw(
    sharp(abs(full)).extract(crop).resize(dm.width, dm.height, { kernel: 'lanczos3', fit: 'fill' }));
  const floor = /\.jpe?g$/i.test(deriv) ? 0.98 : 0.99;
  return ssimLuma(ref.data, got.data, dm.width, dm.height, ref.info.channels) >= floor
    ? { src: full, crop } : null;
}

async function pickSource(key, agg) {
  if (key.startsWith('media/originals/elementor/thumbs/')) {
    const full = fullOfThumb(key);
    return (full && (await recrop(key, full))) || { src: key };
  }
  const c = chooseSource(key, agg);
  if (typeof c === 'string') return { src: c };
  if (isSvg(key) || !c.ratio) return { src: c.full };
  const fm = await sharp(abs(c.full)).metadata();
  if (Math.abs(fm.width / fm.height / c.ratio - 1) <= 0.01) return { src: c.full };
  return (await recrop(c.deriv, c.full)) || { src: c.deriv };
}

// Every derived variant of an entry; shared files may repeat across lists.
const entryVariants = (e) => [
  ...e.variants,
  ...(e.art?.mobile ?? []),
  ...(e.art?.mobileHiDpi ?? []),
  ...Object.values(e.bg ?? {}).flat(),
  ...(e.crops?.mobile ?? []),
];

async function processImage(key, ctx) {
  const agg = groupMeasure(ctx.byPath, key);
  const { src, crop } = await pickSource(key, agg);
  const buf = readFileSync(abs(src));
  const meta = await sharp(buf).metadata();
  if (meta.orientation && meta.orientation > 1) throw new Error(`${src}: EXIF orientation not supported`);
  if (crop) Object.assign(meta, { width: crop.width, height: crop.height });
  const common = { source: src, ...(crop && { crop }), width: meta.width, height: meta.height,
    aboveFold: agg.fold };
  if (isSvg(src)) {
    const file = writeHashed(buf, baseName(key), null, 'svg');
    return { kind: 'graphic', alpha: true, ...common, rendered: agg.width || null,
      variants: [{ w: meta.width, h: meta.height, format: 'svg', file, bytes: buf.length }], reused: true };
  }
  const siblings = ctx.groups.filter((g) => g.includes(key)).flat()
    .map((s) => groupMeasure(ctx.byPath, s).width);
  const rendered = agg.width || Math.max(0, ...siblings) || Math.min(meta.width, FALLBACK_RENDERED);
  const kind = /\.jpe?g$/i.test(src) ? 'photo' : 'graphic';
  let alpha = false;
  if (meta.hasAlpha) alpha = (await sharp(buf).stats()).channels.at(-1).min < 255;
  const fill = FILL[key];
  const bgRendered = ctx.backgrounds.has(key) && !fill ? agg.perVw : null;
  // Per-breakpoint CSS widths of the <img> (or of the cover box): they drive the ladder and `sizes`.
  let slots = null;
  if (fill) {
    const aspect = meta.width / meta.height;
    slots = Object.fromEntries(WIDTHS.map((vw) => [vw, Math.ceil(Math.max(fill.box[vw][0], fill.box[vw][1] * aspect))]));
  } else if (agg.width) {
    slots = Object.fromEntries(WIDTHS.map((vw) => [vw, Math.ceil(agg.perVw[vw] || Math.min(rendered, SLOT_CAP[vw]))]));
  }
  // CSS width of an eager image on the 412 px test phone; fluid fills resolve their `sizes`.
  const phone = slots && agg.fold['390'] ? (fill ? phoneWidth((fill.crop ?? fill).sizes, PHONE_VW) : slots['390']) : 0;
  const widths = slots ? widthLadder(slots, meta.width, !!fill?.crop, phone) : null;
  const sizes = fill ? fill.sizes : slots && sizesFrom(slots);
  const inputKey = sha(Buffer.concat([buf, Buffer.from(JSON.stringify(
    { VERSION, rendered, key, bgRendered, slots, sizes, crop, fillCrop: fill?.crop,
      ...(phone && { phone }), ...(key === HERO && { hero: HERO_MOBILE }) }))]), 16);
  const cached = ctx.cache[key];
  const files = (e) => entryVariants(e).every((v) => existsSync(abs(v.file)));
  if (cached?.inputKey === inputKey && files(cached)) return { ...cached, reused: true };
  const res = await processRaster(key, src, kind, alpha, meta, rendered, bgRendered, widths, crop, fill);
  return { kind, alpha, ...common, rendered: Math.round(rendered * 100) / 100,
    ...(slots && { slots, sizes }), ...(fill && { box: fill.box }), inputKey, ...res };
}

async function ogEntry(key) {
  const meta = await sharp(abs(key)).metadata();
  const kind = /.jpe?g$/i.test(key) ? 'photo' : 'graphic';
  return { kind, alpha: false, source: key, width: meta.width, height: meta.height, ogOnly: true,
    aboveFold: { 390: false, 1440: false }, variants: [], reused: true };
}

async function makeOg(routes, images) {
  mkdirSync(abs(OG_DIR), { recursive: true });
  for (const route of routes) {
    const ref = route.ogImage;
    if (!ref) continue;
    const meta = await sharp(abs(ref)).metadata();
    const file = `${OG_DIR}/${baseName(ref)}.jpg`;
    const buf = await sharp(abs(ref))
      .resize({ width: Math.min(OG_WIDTH, meta.width), kernel: 'lanczos3' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    writeFileSync(abs(file), buf);
    images[ref].og = file;
  }
}

function icoFromPng(png) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head[6] = 32;
  head[7] = 32;
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

async function makeIcons() {
  mkdirSync(abs(ICON_DIR), { recursive: true });
  const src = readFileSync(abs(ICON_SOURCE));
  const png32 = await sharp(src).resize(32, 32, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
  const touch = await sharp(src).resize(180, 180, { kernel: 'lanczos3' })
    .flatten({ background: '#ffffff' }).png({ compressionLevel: 9 }).toBuffer();
  const out = { 'favicon-32.png': png32, 'apple-touch-icon.png': touch, 'favicon.ico': icoFromPng(png32) };
  const icons = {};
  for (const [name, buf] of Object.entries(out)) {
    writeFileSync(abs(`${ICON_DIR}/${name}`), buf);
    icons[name] = { file: `${ICON_DIR}/${name}`, bytes: buf.length };
  }
  return icons;
}

function pruneStale(images) {
  const keep = new Set();
  for (const e of Object.values(images)) {
    for (const v of entryVariants(e)) keep.add(v.file);
  }
  for (const name of existsSync(abs(IMG_DIR)) ? readdirSync(abs(IMG_DIR)) : []) {
    if (!keep.has(`${IMG_DIR}/${name}`)) rmSync(abs(`${IMG_DIR}/${name}`));
  }
}

function sizeOf(rel) {
  return statSync(abs(rel)).size;
}

async function main() {
  const t0 = Date.now();
  const refs = collectRefs();
  const routes = readJson('content/routes.json').routes;
  const ogRefs = new Set(routes.map((r) => r.ogImage).filter(Boolean));
  const ogOnly = new Set([...ogRefs].filter((r) => !collectRefs(['routes.json']).includes(r)));
  const groups = [];
  for (const f of ['content/products.json', 'content/site.json']) collectGroups(readJson(f), groups);
  let cache = {};
  for (const file of [CACHE_FILE, MANIFEST]) {
    if (!existsSync(file)) continue;
    const j = JSON.parse(readFileSync(file, 'utf8'));
    cache = { ...(j.images ?? {}), ...cache };
  }
  const ctx = { byPath: loadMeasurements(), groups, cache, backgrounds: collectBackgrounds() };
  const images = {};
  let encoded = 0;
  for (const key of refs) {
    const e = ogOnly.has(key) ? await ogEntry(key) : await processImage(key, ctx);
    const reused = e.reused;
    delete e.reused;
    images[key] = e;
    if (!reused) encoded++;
    const bytes = e.variants.reduce((n, v) => n + v.bytes, 0);
    const worst = Math.min(1, ...e.variants.map((v) => v.ssim ?? 1));
    console.log(`${reused ? 'kept   ' : 'encoded'} ${key} src=${e.source === key ? '=' : e.source} ` +
      `${e.width}x${e.height} r=${e.rendered} w=[${[...new Set(e.variants.map((v) => v.w))]}] ` +
      `${bytes}B ssim>=${worst}`);
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ images: { ...ctx.cache, ...images } }));
  }
  await makeOg(routes, images);
  const icons = await makeIcons();
  pruneStale(images);
  const sources = new Set(Object.values(images).map((e) => e.source));
  const ogFiles = new Set(Object.values(images).map((e) => e.og).filter(Boolean));
  const derivedFiles = new Map(
    Object.values(images).flatMap(entryVariants).map((v) => [v.file, v.bytes]));
  const derivedBytes =
    [...derivedFiles.values()].reduce((n, b) => n + b, 0) +
    [...ogFiles].reduce((n, f) => n + sizeOf(f), 0) +
    Object.values(icons).reduce((n, i) => n + i.bytes, 0);
  const originalBytes = [...sources].reduce((n, s) => n + sizeOf(s), 0);
  const body = { images, icons, totals: { originalBytes, derivedBytes } };
  let generated = new Date().toISOString();
  if (existsSync(MANIFEST)) {
    const prev = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const { generated: g, ...rest } = prev;
    if (JSON.stringify(rest) === JSON.stringify(body)) generated = g;
  }
  writeFileSync(MANIFEST, `${JSON.stringify({ generated, ...body }, null, 2)}\n`);
  console.log(`images=${refs.length} encoded=${encoded} original=${originalBytes}B derived=${derivedBytes}B ` +
    `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

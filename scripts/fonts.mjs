// Subsets the captured brand fonts to WOFF2 and computes Arial-metric fallbacks.
// Writes assets/fonts/*.woff2 and content/fonts.json for the build to emit @font-face.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'media/originals/fonts');
const OUT_DIR = path.join(ROOT, 'assets/fonts');
const OUT_JSON = path.join(ROOT, 'content/fonts.json');

// Elementor registers each face as its own family at weight 400, so the bold face is not weight 700.
const FAMILIES = [
  { name: 'fregat', source: '6739Fregat', weight: 400 },
  { name: 'fregat-bold', source: '8372Fregat-Bold', weight: 400 },
  // pf-din ships thousands of stylistic alternates; closing GSUB over them is 50 KB of unused glyphs.
  { name: 'pf-din', source: '6267PF-Din', weight: 400, noLayoutClosure: true },
];
const RANGES = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x400, 0x45f],
  [0x2010, 0x2027],
  [0x2116, 0x2116],
  [0x20ac, 0x20ac],
];
// Arial's 904/2048 is capsize's frequency-weighted a-z + space average, so fonts are measured the same way.
const ARIAL = { upm: 2048, avgWidth: 904 };
const WEIGHTS = {
  a: 0.0668, b: 0.0122, c: 0.0228, d: 0.0348, e: 0.1039, f: 0.0182, g: 0.0165, h: 0.0499, i: 0.0571,
  j: 0.0013, k: 0.0063, l: 0.0345, m: 0.0205, n: 0.0572, o: 0.0614, p: 0.0159, q: 0.0007, r: 0.0509,
  s: 0.0549, t: 0.0749, u: 0.0227, v: 0.0083, w: 0.0172, x: 0.0013, y: 0.0149, z: 0.0006, ' ': 0.1818,
};

const hex = (n) => n.toString(16).toUpperCase();
const unicodeRange = RANGES.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`)).join(', ');
const text = RANGES.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i))).join('');

function readTables(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = {};
  for (let i = 0, n = view.getUint16(4); i < n; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...buf.subarray(at, at + 4));
    tables[tag] = view.getUint32(at + 8);
  }
  return { view, tables };
}

function cmapFormat4(view, cmapAt) {
  for (let i = 0, n = view.getUint16(cmapAt + 2); i < n; i++) {
    const rec = cmapAt + 4 + i * 8;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const at = cmapAt + view.getUint32(rec + 4);
    if (view.getUint16(at) === 4 && (platform === 0 || (platform === 3 && encoding === 1))) return at;
  }
  throw new Error('font lacks a format 4 cmap subtable');
}

function glyphOf(view, sub, code) {
  const segX2 = view.getUint16(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const offsets = deltas + segX2;
  for (let i = 0; i < segX2; i += 2) {
    if (code > view.getUint16(ends + i)) continue;
    if (code < view.getUint16(starts + i)) return 0;
    const ro = view.getUint16(offsets + i);
    if (ro === 0) return (code + view.getInt16(deltas + i)) & 0xffff;
    const g = view.getUint16(offsets + i + ro + (code - view.getUint16(starts + i)) * 2);
    return g === 0 ? 0 : (g + view.getInt16(deltas + i)) & 0xffff;
  }
  return 0;
}

// Frequency-weighted advance of a-z and space, in font units.
function xWidthAvg(view, tables) {
  const sub = cmapFormat4(view, tables.cmap);
  const count = view.getUint16(tables.hhea + 34);
  const advance = (g) => view.getUint16(tables.hmtx + Math.min(g, count - 1) * 4);
  let sum = 0;
  let weight = 0;
  for (const [ch, w] of Object.entries(WEIGHTS)) {
    sum += w * advance(glyphOf(view, sub, ch.charCodeAt(0)));
    weight += w;
  }
  return sum / weight;
}

function metricsOf(truetype) {
  const { view, tables } = readTables(truetype);
  for (const tag of ['head', 'hhea', 'cmap', 'hmtx']) if (!(tag in tables)) throw new Error(`font lacks ${tag} table`);
  return {
    upm: view.getUint16(tables.head + 18),
    ascender: view.getInt16(tables.hhea + 4),
    descender: view.getInt16(tables.hhea + 6),
    lineGap: view.getInt16(tables.hhea + 8),
    avgWidth: round(xWidthAvg(view, tables)),
  };
}

const round = (n) => Math.round(n * 10000) / 10000;

function fallbackFor(m) {
  const sizeAdjust = m.avgWidth / m.upm / (ARIAL.avgWidth / ARIAL.upm);
  const over = (v) => round(Math.abs(v) / m.upm / sizeAdjust);
  return {
    sizeAdjust: round(sizeAdjust),
    ascentOverride: over(m.ascender),
    descentOverride: over(m.descender),
    lineGapOverride: over(m.lineGap),
  };
}

async function subsetOne(source, noLayoutClosure = false) {
  const opts = { noHinting: true, noLayoutClosure };
  for (const ext of ['woff2', 'woff']) {
    const file = path.join(SRC_DIR, `${source}.${ext}`);
    if (!existsSync(file)) continue;
    try {
      const input = readFileSync(file);
      const woff2 = await subsetFont(input, text, { ...opts, targetFormat: 'woff2' });
      const truetype = await subsetFont(input, text, { ...opts, targetFormat: 'truetype' });
      return { woff2, metrics: metricsOf(truetype), from: ext };
    } catch (err) {
      console.warn(`${source}.${ext} failed (${err.message}); trying next format`);
    }
  }
  throw new Error(`no usable font file for ${source}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const families = {};
  const keep = new Set();
  for (const fam of FAMILIES) {
    const { woff2, metrics, from } = await subsetOne(fam.source, fam.noLayoutClosure);
    const name = `${fam.name}.${createHash('sha256').update(woff2).digest('hex').slice(0, 8)}.woff2`;
    writeFileSync(path.join(OUT_DIR, name), woff2);
    keep.add(name);
    families[fam.name] = {
      file: `assets/fonts/${name}`,
      weight: fam.weight,
      style: 'normal',
      fallback: fallbackFor(metrics),
    };
    console.log(`${fam.name}: ${woff2.length}B from .${from} ${JSON.stringify(metrics)} ` +
      JSON.stringify(families[fam.name].fallback));
  }
  for (const f of readdirSync(OUT_DIR)) if (!keep.has(f)) rmSync(path.join(OUT_DIR, f));
  writeFileSync(OUT_JSON, `${JSON.stringify({ families, unicodeRange }, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

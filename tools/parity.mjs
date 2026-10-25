// Content parity: every visible text segment of the captured WordPress main content must
// appear in the built <main>, unless tools/parity-allow.json explains why not.
//   node tools/parity.mjs [--assert] [--routes /,/bg/]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, summary, figcaption, blockquote, a.elementor-button';
const SKIP_LIVE = [
  'script', 'style', 'noscript', 'template', '.elementor-hidden-desktop', '.screen-reader-text',
  '#cookie-notice', '.cookie-notice-container', '[class*="cookie-notice"]', '[id*="cookie-notice"]',
].join(', ');

// Built blocks sit on separate lines where the live page used <br>, so the substring test ignores spaces.
const squeeze = (text) => text.replace(/ /g, '');
const normalize = (text) => text
  .normalize('NFC')
  .replace(/[‘’‛ʼ]/g, "'")
  .replace(/[“”„]/g, '"')
  .replace(/[‐-―−]/g, '-')
  .replace(/[\s ​]+/g, ' ')
  .trim();

function liveSegments(file) {
  const $ = cheerio.load(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const main = $('main#main').first();
  main.find(SKIP_LIVE).remove();
  main.find('br').replaceWith(' ');
  const seen = new Set();
  const out = [];
  for (const el of main.find(BLOCKS).toArray()) {
    const text = normalize($(el).text());
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

function builtText(route) {
  const $ = cheerio.load(fs.readFileSync(path.join(ROOT, 'dist', route.slice(1), 'index.html'), 'utf8'));
  const main = $('main').first();
  main.find('.vh, script, style, noscript').remove();
  main.find('br').replaceWith(' ');
  return squeeze(normalize(main.text()));
}

const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/parity-allow.json'), 'utf8'));
for (const entry of allow) {
  if (!entry.reason?.trim() || !entry.text) throw new Error(`parity-allow.json entry needs text and reason: ${JSON.stringify(entry)}`);
}
const allowed = new Map(allow.map((entry) => [`${entry.route ?? '*'}\u0000${normalize(entry.text)}`, entry]));
const used = new Set();

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.local/capture/manifest.json'), 'utf8'));
const only = value('--routes')?.split(',');
let missingTotal = 0;
let checked = 0;
for (const route of manifest.routes) {
  if (only && !only.includes(route.path)) continue;
  const built = builtText(route.path);
  const missing = [];
  for (const segment of liveSegments(route.htmlFile)) {
    if (built.includes(squeeze(segment))) continue;
    const key = [`${route.path}\u0000${segment}`, `*\u0000${segment}`].find((k) => allowed.has(k));
    if (key) used.add(key);
    else missing.push(segment);
  }
  checked += 1;
  missingTotal += missing.length;
  for (const segment of missing) console.log(`${route.path}: MISSING ${JSON.stringify(segment)}`);
}
const stale = [...allowed.keys()].filter((key) => !used.has(key) && (!only || key.startsWith('*')));
console.log(`parity: ${checked} routes, ${missingTotal} missing, ${used.size} allowlisted, ${only ? 0 : stale.length} unused allowlist entries`);
if (!only) for (const key of stale) console.log(`unused allowlist entry: ${JSON.stringify(allowed.get(key))}`);
if (flag('--assert') && missingTotal) process.exit(1);

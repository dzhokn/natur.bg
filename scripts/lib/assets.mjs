import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { transform } from 'lightningcss';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DIST = path.join(ROOT, 'dist');

// lightningcss packs versions as major << 16 | minor << 8: the last two stable releases of each
// engine as of the owner's launch date.
const TARGETS = { chrome: 141 << 16, firefox: 142 << 16, safari: 26 << 16 };

const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

export function writeOut(rel, data) {
  const file = path.join(DIST, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

// The swap face is the real font; the "<family> fallback" face is Arial scaled to its metrics,
// so the swap does not move text.
export function fontFaceCss(fonts) {
  const range = fonts.unicodeRange;
  let css = '';
  for (const [family, f] of Object.entries(fonts.families)) {
    const pct = (n) => `${+(n * 100).toFixed(2)}%`;
    css += `@font-face{font-family:${family};src:url(/${f.file}) format("woff2");` +
      `font-weight:${f.weight};font-style:${f.style};font-display:swap;unicode-range:${range}}`;
    css += `@font-face{font-family:"${family} fallback";src:local("Arial");` +
      `size-adjust:${pct(f.fallback.sizeAdjust)};ascent-override:${pct(f.fallback.ascentOverride)};` +
      `descent-override:${pct(f.fallback.descentOverride)};` +
      `line-gap-override:${pct(f.fallback.lineGapOverride)}}`;
  }
  return css;
}

const TEMPLATE_CSS = {
  home: 'home',
  product: 'product',
  products: 'pages',
  about: 'pages',
  contact: 'pages',
  legal: 'pages',
  404: 'pages',
};

function bundleCss(name, fonts) {
  const source = fontFaceCss(fonts) + read('src/css/site.css') + read(`src/css/${name}.css`);
  const { code } = transform({
    filename: `${name}.css`,
    code: Buffer.from(source),
    minify: true,
    targets: TARGETS,
  });
  const file = `assets/css/${name}.${hash8(code)}.css`;
  writeOut(file, code);
  return `/${file}`;
}

// About-page value icons: standalone SVGs instead of ~5 KB of inline markup per page, which would
// push the eager payload over budget. They sit below the fold, so they are never eager.
export const VALUE_ICONS = [1, 2, 3].map((n) => {
  const body = readFileSync(path.join(ROOT, `content/icons/value-${n}.svg`));
  return { body, url: `/assets/icons/value-${n}.${hash8(body)}.svg` };
});

export async function buildAssets(fonts) {
  const css = {};
  for (const icon of VALUE_ICONS) writeOut(icon.url.slice(1), icon.body);
  for (const name of new Set(Object.values(TEMPLATE_CSS))) css[name] = bundleCss(name, fonts);
  const result = await esbuild({
    entryPoints: [path.join(ROOT, 'src/js/site.mjs')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2022',
    write: false,
    legalComments: 'none',
  });
  const js = result.outputFiles[0].contents;
  const jsFile = `assets/js/site.${hash8(js)}.js`;
  writeOut(jsFile, js);
  const cssFor = (template) => css[TEMPLATE_CSS[template]];
  return { cssFor, js: `/${jsFile}` };
}

// Tracked derived media ships as-is: the names are already fingerprinted by scripts/media.mjs.
export function copyStatic() {
  for (const dir of ['img', 'og', 'icons', 'fonts']) {
    const from = path.join(ROOT, 'assets', dir);
    if (existsSync(from)) cpSync(from, path.join(DIST, 'assets', dir), { recursive: true });
  }
  cpSync(path.join(ROOT, 'assets/icons/favicon.ico'), path.join(DIST, 'favicon.ico'));
  const pdf = 'wp-content/uploads/2021/10/CATALOG-NATUR-BG.pdf';
  mkdirSync(path.join(DIST, path.dirname(pdf)), { recursive: true });
  cpSync(path.join(ROOT, 'media/originals/2021/10/CATALOG-NATUR-BG.pdf'), path.join(DIST, pdf));
  writeOut('.nojekyll', '');
}

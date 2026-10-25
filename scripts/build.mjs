import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DIST, ROOT, buildAssets, copyStatic, writeOut } from './lib/assets.mjs';
import { createMedia } from './lib/html.mjs';
import { buildInputHash } from './lib/inputs.mjs';
import { alternates, head404, headHtml, sitemaps } from './lib/seo.mjs';
import { layout, render404, renderRoute } from './lib/templates.mjs';

const json = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));

function loadContent() {
  const media = json('content/media.json');
  return {
    site: json('content/site.json'),
    routes: json('content/routes.json').routes,
    products: json('content/products.json').products,
    fonts: json('content/fonts.json'),
    media,
    mediaTools: createMedia(media),
  };
}

const document = (lang, head, body) =>
  `<!doctype html><html lang="${lang}"><head>${head}</head><body>${body}</body></html>\n`;

async function main() {
  const t0 = Date.now();
  const ctx = loadContent();
  rmSync(DIST, { recursive: true, force: true });
  copyStatic();
  const assets = await buildAssets(ctx.fonts);
  const byPath = new Map(ctx.routes.map((r) => [r.path, r]));
  const fontFile = (family) => ctx.fonts.families[family].file;

  for (const route of ctx.routes) {
    const { page, main } = renderRoute(route, ctx);
    const head = headHtml({
      route,
      ctx,
      css: assets.cssFor(route.template),
      fontPreload: page.fonts.map(fontFile),
      preloads: page.preloads,
      pairs: alternates(route, byPath),
    });
    writeOut(`${route.path.slice(1)}index.html`, document(route.lang, head, layout(page, ctx, main, assets.js)));
  }

  const nf = render404(ctx);
  const head = head404({ ctx, css: assets.cssFor('404'), fontPreload: nf.page.fonts.map(fontFile) });
  writeOut('404.html', document('en', head, layout(nf.page, ctx, nf.main, assets.js)));

  for (const [name, body] of Object.entries(sitemaps(ctx.routes))) writeOut(name, body);
  writeOut('.build-input', buildInputHash());
  console.log(`built ${ctx.routes.length} routes + 404 in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { SITE, esc, jsonLd } from './html.mjs';

const abs = (p) => `${SITE}${p}`;

// Runs before first paint: marks JS support and the stored consent choice so CSS can hide the bar.
export const CONSENT_SCRIPT =
  'document.documentElement.className+=" js";' +
  'var m=document.cookie.match(/(?:^|; )natur_consent=(granted|denied)/);' +
  'if(m)document.documentElement.dataset.consent=m[1]';

const LOCALE = { en: 'en_US', bg: 'bg_BG' };

function organization(site, media) {
  const logo = media.entry(site.en.logo.src).variants
    .filter((v) => v.format === 'webp').sort((a, b) => b.w - a.w)[0];
  return {
    '@type': 'Organization',
    '@id': `${SITE}/#organization`,
    name: 'NATUR BG LTD',
    brand: { '@type': 'Brand', name: 'NATUR' },
    url: `${SITE}/`,
    logo: abs(`/${logo.file}`),
    sameAs: [site.en.social.facebook],
    email: site.en.contacts.email,
    telephone: site.en.contacts.phones,
  };
}

export function structuredData(route, site, media) {
  const graph = [organization(site, media)];
  if (route.path === '/' || route.path === '/bg/') {
    graph.push({
      '@type': 'WebSite',
      '@id': `${abs(route.path)}#website`,
      url: abs(route.path),
      name: route.lang === 'bg' ? 'НАТЮР' : 'NATUR',
      inLanguage: route.lang,
      publisher: { '@id': `${SITE}/#organization` },
    });
  }
  if (route.breadcrumb.length) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: route.breadcrumb.map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: b.name,
        item: abs(b.path),
      })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

// `pairs` = {en, bg} canonical paths for paired routes, else null.
export const alternates = (route, byPath) => {
  if (!route.pair) return null;
  const other = byPath.get(route.pair);
  const en = route.lang === 'en' ? route : other;
  const bg = route.lang === 'bg' ? route : other;
  return { en: en.path, bg: bg.path };
};

export function headHtml({ route, ctx, css, fontPreload, preloads, pairs }) {
  const { site, media, mediaTools } = ctx;
  const url = abs(route.path);
  const og = mediaTools.entry(route.ogImage).og;
  const links = pairs
    ? `<link rel="alternate" hreflang="en" href="${abs(pairs.en)}">` +
      `<link rel="alternate" hreflang="bg" href="${abs(pairs.bg)}">` +
      `<link rel="alternate" hreflang="x-default" href="${abs(pairs.en)}">`
    : '';
  const fonts = fontPreload.map((f) =>
    `<link rel="preload" as="font" type="font/woff2" href="/${f}" crossorigin>`).join('');
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(route.title)}</title>`,
    `<script>${CONSENT_SCRIPT}</script>`,
    fonts,
    preloads.join(''),
    `<link rel="stylesheet" href="${css}">`,
    `<meta name="description" content="${esc(route.description)}">`,
    `<link rel="canonical" href="${url}">`,
    links,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${esc(route.title)}">`,
    `<meta property="og:description" content="${esc(route.description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${abs(`/${og}`)}">`,
    `<meta property="og:locale" content="${LOCALE[route.lang]}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<link rel="icon" type="image/png" sizes="32x32" href="/${media.icons['favicon-32.png'].file}">`,
    `<link rel="apple-touch-icon" href="/${media.icons['apple-touch-icon.png'].file}">`,
    '<meta name="theme-color" content="#ffffff">',
    `<script type="application/ld+json">${jsonLd(structuredData(route, site, mediaTools))}</script>`,
  ].join('');
}

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function sitemaps(routes) {
  const byPath = new Map(routes.map((r) => [r.path, r]));
  const urlset = (list) => {
    const rows = list.map((r) => {
      const p = alternates(r, byPath);
      const alt = p
        ? [['en', p.en], ['bg', p.bg], ['x-default', p.en]]
          .map(([l, h]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${abs(h)}"/>`).join('')
        : '';
      return `<url><loc>${abs(r.path)}</loc>${alt}</url>`;
    }).join('\n');
    return `${XML}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
      `xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows}\n</urlset>\n`;
  };
  const isProduct = (r) => r.template === 'product';
  const index = `${XML}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `<sitemap><loc>${SITE}/post-sitemap.xml</loc></sitemap>\n` +
    `<sitemap><loc>${SITE}/page-sitemap.xml</loc></sitemap>\n</sitemapindex>\n`;
  return {
    'sitemap_index.xml': index,
    'sitemap.xml': index,
    'wp-sitemap.xml': index,
    'post-sitemap.xml': urlset(routes.filter(isProduct)),
    'page-sitemap.xml': urlset(routes.filter((r) => !isProduct(r))),
    'robots.txt': `User-agent: *\nDisallow:\nSitemap: ${SITE}/sitemap_index.xml\n`,
  };
}

export function head404({ ctx, css, fontPreload }) {
  const { media } = ctx;
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Page not found | NATUR – Страницата не е намерена | НАТЮР</title>',
    `<script>${CONSENT_SCRIPT}</script>`,
    fontPreload.map((f) => `<link rel="preload" as="font" type="font/woff2" href="/${f}" crossorigin>`).join(''),
    `<link rel="stylesheet" href="${css}">`,
    '<meta name="robots" content="noindex">',
    `<link rel="icon" type="image/png" sizes="32x32" href="/${media.icons['favicon-32.png'].file}">`,
    `<link rel="apple-touch-icon" href="/${media.icons['apple-touch-icon.png'].file}">`,
  ].join('');
}

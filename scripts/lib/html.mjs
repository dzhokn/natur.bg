import * as cheerio from 'cheerio';
import { LO_RATIO, ceil10, phoneWidth, round10 } from './sizes.mjs';

export const SITE = 'https://natur.bg';

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const stroke = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

export const ICONS = {
  phone: stroke('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  email: stroke('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
  address: stroke('<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
  facebook:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg>',
  menu:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
};

// JSON in <script> must not be able to close the tag.
export const jsonLd = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

const PHONE = '(max-width: 767px)';
// Phones below 2 dppx (Lighthouse emulates 1.75) get ONE ~1.125x candidate: their pick is the
// smallest file that still passes image-size-responsive; >= 2x phones get the denser set.
const PHONE_LO = `${PHONE} and (max-resolution: 1.99dppx)`;
const PHONE_HI = `${PHONE} and (min-resolution: 2dppx)`;

export function createMedia(media) {
  const entry = (src) => {
    const e = media.images[src];
    if (!e) throw new Error(`media.json has no entry for ${src}`);
    return e;
  };
  const url = (file) => `/${file}`;
  const of = (e, fmt) => e.variants.filter((v) => v.format === fmt).sort((a, b) => a.w - b.w);
  const srcset = (list) => list.map((v) => `${url(v.file)} ${v.w}w`).join(', ');
  const sizesFor = (e, override) =>
    override || e.sizes || `min(100vw, ${Math.round(e.rendered || e.width)}px)`;

  // Phone candidates of an eager raster by density: one 1.125x file, and the >= 2x files (the
  // largest when none is wide enough). Art-directed crops replace the full frame.
  function phonePick(e, sizes) {
    const crop = e.crops?.mobile;
    const list = crop ?? e.variants;
    const useSizes = crop ? e.crops.sizes : sizes;
    const pw = phoneWidth(useSizes);
    return {
      sizes: useSizes,
      lo: (fmt) => {
        const l = of({ variants: list }, fmt);
        return [l.find((v) => v.w >= ceil10(pw * LO_RATIO)) ?? l.at(-1)];
      },
      hi: (fmt) => {
        const l = of({ variants: list }, fmt);
        const dense = l.filter((v) => v.w >= round10(pw * 2));
        return dense.length ? dense : [l.at(-1)];
      },
    };
  }

  // Non-eager rasters are JS-gated: Chrome's native lazy threshold (1250-2500 px) would fetch
  // every image near the top at startup. site.js copies data-src/data-srcset when one nears the
  // viewport; <noscript> carries the plain markup.
  function picture(src, o = {}) {
    const e = entry(src);
    const alt = o.alt ?? '';
    const lazy = o.eager ? '' : ' loading="lazy"';
    const high = o.high ? ' fetchpriority="high"' : '';
    const cls = o.cls ? ` class="${o.cls}"` : '';
    const first = e.variants[0];
    if (first.format === 'svg') {
      return `<img${cls} src="${url(first.file)}" width="${first.w}" height="${first.h}" alt="${esc(alt)}"` +
        `${lazy} decoding="async">`;
    }
    const webp = of(e, 'webp');
    const avif = of(e, 'avif');
    const sizes = sizesFor(e, o.sizes);
    // The 1x file is the smallest variant that covers the rendered width.
    const target = e.rendered || e.width;
    const one = webp.find((v) => v.w >= target - 1) || webp[webp.length - 1];
    const build = (gated) => {
      const set = gated ? 'data-srcset' : 'srcset';
      const img = `<img${cls} ${gated ? 'data-' : ''}src="${url(one.file)}" ${set}="${srcset(webp)}" ` +
        `sizes="${sizes}" width="${one.w}" height="${one.h}" alt="${esc(alt)}"${lazy} decoding="async"${high}>`;
      // Art-directed phone crop first, so a phone never fetches the desktop frame.
      const split = !gated && (o.eager || o.high) && avif.length;
      const pick = split && phonePick(e, sizes);
      const phone = split
        ? [[PHONE_LO, 'lo'], [PHONE, 'hi']].flatMap(([media, k]) => ['avif', 'webp'].map((fmt) =>
          `<source media="${media}" type="image/${fmt}" srcset="${srcset(pick[k](fmt))}" sizes="${pick.sizes}">`)).join('')
        : e.crops?.mobile
        ? ['avif', 'webp'].map((fmt) => `<source media="${PHONE}" type="image/${fmt}" ${set}="` +
          `${srcset(of({ variants: e.crops.mobile }, fmt))}" sizes="${e.crops.sizes}">`).join('')
        : '';
      const picked = avif.length
        ? `${phone}<source type="image/avif" ${set}="${srcset(avif)}" sizes="${sizes}">${img}`
        : img;
      return gated ? `<picture class="lz">${picked}</picture>` : avif.length ? `<picture>${picked}</picture>` : img;
    };
    return o.eager || o.high ? build(false) : `${build(true)}<noscript>${build(false)}</noscript>`;
  }

  const link = (media, avif, sizes) => `<link rel="preload" as="image" type="image/avif" media="${media}" ` +
    `imagesrcset="${srcset(avif)}" imagesizes="${sizes}" fetchpriority="high">`;
  // Mirrors the picture's AVIF sources: the desktop set, or o.phone for the lo/hi phone pair.
  const preload = (src, o = {}) => {
    const e = entry(src);
    if (!o.phone) return link('(min-width: 768px)', of(e, 'avif'), sizesFor(e, o.sizes));
    const pick = phonePick(e, sizesFor(e, o.sizes));
    return [[PHONE_LO, 'lo'], [PHONE_HI, 'hi']].map(([media, k]) => link(media, pick[k]('avif'), pick.sizes)).join('');
  };

  // Above-fold area at a capture width (390 = mobile, 1440 = desktop); 0 when it is not above the fold.
  const area = (e, vw) => {
    if (!e.aboveFold?.[vw]) return 0;
    if (e.box?.[vw]) return e.box[vw][0] * e.box[vw][1];
    const w = e.slots?.[vw] ?? e.rendered ?? e.width;
    return (w * w * e.height) / e.width;
  };
  // LCP candidate per form factor: the largest above-fold image. Ties keep the first.
  function lcp(cands) {
    const best = (vw) => cands.reduce((b, src) => {
      const a = area(entry(src), vw);
      return a > b.a ? { a, src } : b;
    }, { a: 0, src: null }).src;
    return { m: best('390'), d: best('1440') };
  }
  // One preload per media condition: the phone lo/hi pair for the phone winner, the desktop set for
  // the desktop winner, each mirroring the picture's sources.
  function lcpLinks(win, o = {}) {
    const links = [];
    if (win.m) links.push(preload(win.m, { phone: true, sizes: o.sizes?.[win.m] }));
    if (win.d) links.push(preload(win.d, { sizes: o.sizes?.[win.d] }));
    return links;
  }

  // Section backgrounds: one custom property per breakpoint, each an image-set with AVIF first.
  function bgStyle(src, position = 'center center', size = 'cover') {
    const e = entry(src);
    const vars = [];
    for (const [key, bp] of [['--bg-m', '390'], ['--bg-t', '768'], ['--bg-d', '1440']]) {
      const list = e.bg?.[bp];
      if (!list) throw new Error(`${src} has no ${bp} background variants`);
      const parts = [];
      for (const [fmt, mime] of [['avif', 'image/avif'], ['webp', 'image/webp']]) {
        const sorted = list.filter((v) => v.format === fmt).sort((a, b) => a.w - b.w);
        sorted.slice(0, 2).forEach((v, i) =>
          parts.push(`url(${url(v.file)}) type('${mime}') ${i + 1}x`));
      }
      vars.push(`${key}:image-set(${parts.join(', ')})`);
    }
    return `${vars.join(';')};--bgp:${position};--bgs:${size}`;
  }

  // Hero art direction: the preloads mirror the sources (AVIF only) so no device fetches two heroes.
  function hero(src, alt = '') {
    const e = entry(src);
    const art = e.art;
    const pair = (list, media, sizes) => ['avif', 'webp'].map((fmt) => {
      const files = list.filter((v) => v.format === fmt).sort((a, b) => a.w - b.w);
      return `<source${media ? ` media="${media}"` : ''} type="image/${fmt}" ` +
        `srcset="${srcset(files)}" sizes="${sizes}">`;
    }).join('');
    const desk = art.desktop.filter((v) => v.format === 'webp').sort((a, b) => a.w - b.w);
    const big = desk.find((v) => v.w >= 1440) || desk[desk.length - 1];
    const markup = `<picture>${pair(art.mobile, PHONE_LO, '100vw')}${pair(art.mobileHiDpi, PHONE, '100vw')}` +
      `<source type="image/avif" srcset="${srcset(art.desktop.filter((v) => v.format === 'avif')
        .sort((a, b) => a.w - b.w))}" sizes="100vw">` +
      `<img src="${url(big.file)}" srcset="${srcset(desk)}" sizes="100vw" width="${big.w}" ` +
      `height="${big.h}" alt="${esc(alt)}" fetchpriority="high" decoding="async"></picture>`;
    const preloads = [
      link(PHONE_LO, art.mobile.filter((v) => v.format === 'avif'), '100vw'),
      link(PHONE_HI, art.mobileHiDpi.filter((v) => v.format === 'avif'), '100vw'),
      link('(min-width: 768px)', art.desktop.filter((v) => v.format === 'avif'), '100vw'),
    ];
    return { markup, preloads };
  }

  return { entry, picture, preload, lcp, lcpLinks, bgStyle, hero, url };
}

// Rewrites a captured content fragment into final markup: <picture> images, lazy section
// backgrounds, inline icons, safe outbound links. `state.n` counts content images so only the
// first `state.eagerMax` can be eager.
export function renderFragment(html, ctx, state) {
  const { mediaTools: m } = ctx;
  const $ = cheerio.load(html, null, false);

  const imgs = $('img[src^="media/originals/"]').toArray().map((el) => {
    const src = $(el).attr('src');
    const e = m.entry(src);
    const decor = $(el).attr('data-role') === 'decor';
    const above = !!(e.aboveFold?.['390'] || e.aboveFold?.['1440']);
    const eager = above && state.n < state.eagerMax && !decor;
    if (!decor) state.n += 1;
    // state.sizes: [selector, sizes] pairs for images whose rendered width differs from the capture.
    const sizes = (state.sizes ?? []).find(([sel]) => $(el).closest(sel).length)?.[1];
    return { el, src, decor, eager, sizes };
  });
  // Photo heroes with a captured box are real images (discoverable, LCP-eligible), not backgrounds.
  const heroes = $('section.hero[data-bg]').toArray().filter((el) => m.entry($(el).attr('data-bg')).box);
  const lcp = m.lcp([...imgs.filter((i) => i.eager).map((i) => i.src), ...heroes.map((el) => $(el).attr('data-bg'))]);
  const high = (src) => src === lcp.m || src === lcp.d;
  imgs.forEach(({ el, src, decor, eager, sizes }) => {
    $(el).replaceWith(m.picture(src, { alt: decor ? '' : $(el).attr('alt') || '', eager, high: eager && high(src), sizes }));
  });
  heroes.forEach((el) => {
    const $el = $(el);
    const src = $el.attr('data-bg');
    const pos = $el.attr('data-bg-position') || 'center';
    $el.prepend(`<div class="hero-photo" aria-hidden="true" style="--op:${esc(pos)}">` +
      `${m.picture(src, { eager: true, high: high(src) })}</div>`);
    $el.removeAttr('data-bg').removeAttr('data-bg-position').removeAttr('data-bg-size');
  });

  $('[data-bg]').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('data-bg');
    if (m.entry(src).art) return; // the home hero is rebuilt by the template
    $el.attr('style', m.bgStyle(src, $el.attr('data-bg-position'), $el.attr('data-bg-size')));
    $el.addClass('bg');
    $el.removeAttr('data-bg').removeAttr('data-bg-position').removeAttr('data-bg-size');
  });

  $('.ico[data-icon]').each((_, el) => {
    $(el).html(ICONS[$(el).attr('data-icon')]).removeAttr('data-icon');
  });
  $('.flip').attr('tabindex', '0');
  $('a[href^="http"]').attr('rel', 'noopener');
  $('[data-role]').removeAttr('data-role');
  $('[data-replaced]').removeAttr('data-replaced');
  const sizes = Object.fromEntries(imgs.filter((i) => i.sizes).map((i) => [i.src, i.sizes]));
  return { $, html: () => $.html(), lcp, sizes };
}

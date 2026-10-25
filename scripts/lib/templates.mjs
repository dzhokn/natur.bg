import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { ROOT, VALUE_ICONS } from './assets.mjs';
import { ICONS, esc, renderFragment } from './html.mjs';

const LABELS = {
  en: { general: 'General Information:', other: 'Other products', image: 'Image', tabs: 'Product details' },
  bg: { general: 'Обща информация:', other: 'Други продукти', image: 'Изображение', tabs: 'Информация за продукта' },
};

// Elementor-only backgrounds (not in the fragments): found in the captured per-page CSS.
const HERO_SRC = 'media/originals/2021/06/naturbg-home-4.jpg';
const STORE_BG = 'media/originals/2021/06/store-home-2.jpg';
const CONTACT_BG = 'media/originals/2021/06/contact-background.png';
const SIMILAR_BG = 'media/originals/2021/05/similar-products.png';
const CRACKERS_BG = 'media/originals/2021/10/7-scaled.jpg';

// Sections below the fold (by index in <main>) that fade in; the rest stay static.
const REVEAL_FROM = { home: 2, about: 3, product: 2 };

// How many content images may be eager per template. media.json's aboveFold flags come from any
// page, so they alone would make the home product cards eager. On about, the first two team photos
// sit above the fold at 412 px (one column) and 1440 px (first row).
const EAGER_MAX = { products: 3, about: 2 };

// Rendered widths that differ from the capture: [selector, sizes]. Package cards never exceed
// 280 px. Team photos render 372 px wide on a phone, but declare 300 px: the 540 w candidate is
// still 1.45x the displayed width (Lighthouse needs 1.125x) and keeps about under the eager budget.
const CARD_SIZES = [['.product-cards', '280px']];
const IMG_SIZES = {
  home: CARD_SIZES,
  products: CARD_SIZES,
  about: [['.team', '(min-width: 768px) 450px, 300px']],
};
// Packshots: 315 px wide on phones and tablets, 400 px from 1025 px (the live carousel).
const SLIDE_SIZES = '(min-width: 1025px) 400px, 315px';

const fragmentCache = new Map();
const fragment = (lang, slug) => {
  const key = `${lang}/${slug}`;
  if (!fragmentCache.has(key)) {
    fragmentCache.set(key, readFileSync(path.join(ROOT, 'content/pages', lang, `${slug}.html`), 'utf8'));
  }
  return fragmentCache.get(key);
};

export function newPage(route, ctx) {
  return {
    route,
    lang: route.lang,
    s: ctx.site[route.lang],
    state: { n: 0, eagerMax: EAGER_MAX[route.template] ?? 0, sizes: IMG_SIZES[route.template] },
    preloads: [],
    fonts: ['fregat-bold'],
  };
}

function consentBar(s) {
  const c = s.consent;
  return `<div class="consent" role="region" aria-label="${esc(c.settings)}">` +
    `<p>${esc(c.text)} <a href="${c.policyPath}">${esc(c.policyLabel)}</a></p>` +
    `<div class="consent-actions"><button type="button" data-consent="granted">${esc(c.allow)}</button>` +
    `<button type="button" data-consent="denied">${esc(c.decline)}</button></div></div>`;
}

function header(page, ctx) {
  const { route, s } = page;
  const home = s.nav[0].path;
  const link = (n) => `<li><a href="${n.path}"${n.path === route.path ? ' aria-current="page"' : ''}>` +
    `${esc(n.label)}</a></li>`;
  const switchTo = route.pair || s.langSwitch.path;
  const logo = ctx.mediaTools.picture(s.logo.src, { alt: s.logo.alt, eager: true, sizes: '120px' });
  return `<header class="site-header"><div class="bar">` +
    `<a class="logo" href="${home}">${logo}</a>` +
    `<button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav">${ICONS.menu}` +
    `<span class="vh">${esc(s.menuLabel)}</span></button>` +
    `<nav id="nav" aria-label="${esc(s.menuLabel)}"><ul class="nav-l">${s.nav.slice(0, -1).map(link).join('')}</ul>` +
    `<ul class="nav-r">${s.nav.slice(-1).map(link).join('')}` +
    `<li class="lang"><a href="${switchTo}" lang="${s.langSwitch.lang}" hreflang="${s.langSwitch.lang}">` +
    `${esc(s.langSwitch.label)}</a></li></ul></nav></div></header>`;
}

function footer(page, ctx) {
  const { s } = page;
  const f = s.footer;
  const tel = f.phonesText.map((t, i) => `<a href="tel:${s.contacts.phones[i]}">${esc(t)}</a>`).join('<br>');
  const legal = f.legal.map((l) => `<a href="${l.path}">${esc(l.label)}</a>`).join(' | ');
  const logo = ctx.mediaTools.picture(f.logo.src, { alt: f.logo.alt, sizes: '400px' });
  return `<footer class="site-footer"><div class="f-grid">` +
    `<div class="f-menu"><p class="f-title">${esc(f.menuTitle)}</p><ul>` +
    f.menu.map((m) => `<li><a href="${m.path}">${esc(m.label)}</a></li>`).join('') + `</ul></div>` +
    `<div class="f-brand">${logo}<p>${esc(f.tagline)}</p></div>` +
    `<div class="f-contact"><p class="f-title">${esc(f.contactsTitle)}</p>` +
    `<p>${tel}<br><a href="mailto:${s.contacts.email}">${s.contacts.email}</a></p>` +
    `<p>${f.address.map(esc).join('<br>')}</p>` +
    `<a class="f-fb" href="${s.social.facebook}" rel="noopener" aria-label="Facebook">${ICONS.facebook}</a></div></div>` +
    `<div class="f-bar"><p>${esc(f.copyright)} | ${legal} | ` +
    `<button type="button" class="cookie-settings">${esc(s.consent.settings)}</button></p>` +
    `<p>${esc(f.credit.label)} <a href="${f.credit.href}" rel="noopener">${esc(f.credit.name)}</a></p></div></footer>`;
}

export function layout(page, ctx, main, js) {
  const { s } = page;
  return `<a class="skip" href="#main">${esc(s.skipLink)}</a>${header(page, ctx)}` +
    `<main id="main" tabindex="-1">${main}</main>${footer(page, ctx)}${consentBar(s)}` +
    `<script src="${js}" defer></script>`;
}

const addReveal = ($, from) => $.root().children().slice(from).addClass('reveal');

function renderContent(page, ctx) {
  const { route, lang } = page;
  const m = ctx.mediaTools;
  const raw = fragment(lang, route.slug);
  const { $, lcp, sizes } = renderFragment(raw, ctx, page.state);
  const bgBox = (src, cls, pos, size) =>
    `<div class="${cls}" aria-hidden="true" style="${m.bgStyle(src, pos, size)}"></div>`;

  if (route.template === 'home') {
    const hero = $('section.hero');
    const { markup, preloads } = m.hero(HERO_SRC);
    page.preloads.push(...preloads);
    hero.attr('class', 'hero hero-art').removeAttr('data-bg').removeAttr('data-bg-position')
      .removeAttr('data-bg-size');
    hero.html(`${markup}<div class="hero-in">${hero.html()}</div>`);
  }
  if (route.template === 'about' || route.template === 'contact') $('section.hero').addClass(`hero-${route.template}`);
  if (route.template === 'about') {
    $('.icon-box').each((i, el) => {
      $(el).prepend(`<img class="value-icon" src="${VALUE_ICONS[i].url}" width="150" height="150" alt="" ` +
        'loading="lazy" decoding="async">');
    });
    $('section.profile').append(bgBox(STORE_BG, 'col col-50 bg profile-photo', 'center center', 'cover'));
  }
  if (route.template === 'contact') {
    $('section.cta').addClass('ov')
      .attr('style', `${m.bgStyle(CONTACT_BG, 'center right', '56% auto')};--bgo:.18`);
  }
  if (route.template !== 'home') page.preloads.push(...m.lcpLinks(lcp, { sizes }));
  if (route.template === 'legal') page.fonts.push('pf-din');
  if (REVEAL_FROM[route.template] !== undefined) addReveal($, REVEAL_FROM[route.template]);
  return $.html();
}

function productCards(lang, ids, ctx, state, headingTag) {
  const $ = cheerio.load(fragment(lang, lang === 'en' ? 'products' : 'produkti'), null, false);
  const byHref = new Map();
  $('.product-cards li').each((_, li) => byHref.set($(li).find('a.card-img').attr('href'), $.html(li)));
  const items = ids.map((id) => {
    const p = ctx.products.find((x) => x.id === id)[lang];
    let html = byHref.get(p.path);
    if (!html) throw new Error(`no listing card for ${p.path}`);
    html = html.replace(/<h2 class="h4">([\s\S]*?)<\/h2>/, `<${headingTag} class="h4">$1</${headingTag}>`);
    return renderFragment(html, ctx, state).html();
  });
  return items.join('');
}

function tabs(p, page, ctx) {
  const t = LABELS[page.lang].tabs;
  const render = (html) => renderFragment(html, ctx, { n: 0, eagerMax: 0 }).html();
  const list = p.tabs.map((tab, i) =>
    `<button type="button" role="tab" id="tab-${tab.id}" aria-controls="panel-${tab.id}" ` +
    `aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(tab.label)}</button>`).join('');
  const panels = p.tabs.map((tab) =>
    `<div role="tabpanel" id="panel-${tab.id}" aria-labelledby="tab-${tab.id}" class="tabpanel">` +
    `<h2 class="tab-h h3">${esc(tab.label)}</h2><div class="tab-body">${render(tab.html)}</div></div>`).join('');
  return `<section class="p-tabs" data-tabs><div class="wrap"><div class="tablist" role="tablist" ` +
    `aria-label="${esc(t)}">${list}</div>${panels}</div></section>`;
}

function renderProduct(page, ctx) {
  const { route, lang } = page;
  const m = ctx.mediaTools;
  const product = ctx.products.find((x) => x.en.path === route.path || x.bg?.path === route.path);
  const p = product[lang];
  const L = LABELS[lang];
  const bgs = p.backgrounds.slice();
  if (product.id === 'organic-crackers') bgs.unshift({ src: CRACKERS_BG });
  const photo = bgs.find((b) => b.src !== SIMILAR_BG);

  // The photo and the first package image compete per form factor; the winner is preloaded.
  const lcp = m.lcp([photo?.src, p.images[0]?.src].filter(Boolean));
  const high = (src) => src === lcp.m || src === lcp.d;
  const slides = p.images.map((img, i) => {
    const first = i === 0;
    return `<li id="slide-${i + 1}">${m.picture(img.src, { alt: img.alt, eager: first, high: first && high(img.src), sizes: SLIDE_SIZES })}</li>`;
  }).join('');
  page.preloads.push(...m.lcpLinks(lcp, { sizes: { [p.images[0]?.src]: SLIDE_SIZES } }));
  const dots = p.images.length > 1
    ? `<ul class="dots">${p.images.map((_, i) =>
      `<li><a href="#slide-${i + 1}" aria-label="${L.image} ${i + 1}"></a></li>`).join('')}</ul>`
    : '';
  const info = p.info.map((t) => `<li>${esc(t)}</li>`).join('');
  const top = `<section class="p-top">` +
    (photo ? `<div class="p-photo" aria-hidden="true">${m.picture(photo.src, { eager: true, high: high(photo.src) })}</div>` : '') +
    `<div class="p-grid"><div class="carousel" role="group" aria-roledescription="carousel" aria-label="${esc(p.name)}">` +
    `<ul class="slides">${slides}</ul>${dots}</div>` +
    `<div class="p-card"><h1>${esc(p.name)}</h1><h2 class="h5">${L.general}</h2><ul class="info">${info}</ul></div></div></section>`;

  const relState = { n: 0, eagerMax: 0, sizes: [['img', '280px']] };
  const related = `<section class="p-related ov" style="${m.bgStyle(SIMILAR_BG, 'center right', 'contain')};--bgo:.5">` +
    `<div class="wrap"><h2>${L.other}</h2><ul class="product-cards">` +
    `${productCards(lang, p.related, ctx, relState, 'h3')}</ul></div></section>`;
  const $ = cheerio.load(top + tabs(p, page, ctx) + related, null, false);
  addReveal($, REVEAL_FROM.product);
  return $.html();
}

export function renderRoute(route, ctx) {
  const page = newPage(route, ctx);
  const main = route.template === 'product' ? renderProduct(page, ctx) : renderContent(page, ctx);
  return { page, main };
}

export function render404(ctx) {
  const page = newPage({ path: '/404.html', lang: 'en', pair: '/bg/' }, ctx);
  const main = `<section class="notfound"><h1>Page not found</h1>` +
    `<p>The page you are looking for does not exist. <a href="/">Go to the home page</a>.</p>` +
    `<h2 lang="bg" class="h3">Страницата не е намерена</h2>` +
    `<p lang="bg">Страницата, която търсите, не съществува. <a href="/bg/">Към началната страница</a>.</p></section>`;
  return { page, main };
}

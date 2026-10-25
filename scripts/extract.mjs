// One-time capture -> content/ extraction. Not part of the build: its output is hand-curated afterwards.
import * as cheerio from 'cheerio';
import fs from 'node:fs';
const CAP = '.local/capture';
const manifest = JSON.parse(fs.readFileSync(`${CAP}/manifest.json`, 'utf8'));
const existing = JSON.parse(fs.readFileSync('content/routes.json', 'utf8')).routes;
const html = (r) => fs.readFileSync(`${CAP}/html/${r.slug}.html`, 'utf8');
const byPath = Object.fromEntries(manifest.routes.map((r) => [r.path, r]));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const warn = (...a) => console.warn('WARN', ...a);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'form']);
const TEMPLATE = {
  '/': 'home', '/bg/': 'home', '/products/': 'products', '/bg/produkti/': 'products',
  '/about-us/': 'about', '/bg/za-nas/': 'about', '/contact/': 'contact', '/bg/kontakti/': 'contact',
};
const LEGAL = new Set(['/privacy-policy/', '/cookie-policy/', '/bg/politika-za-lichni-danni/', '/bg/politika-za-biskvitki/']);
const templateOf = (p) => TEMPLATE[p] || (LEGAL.has(p) ? 'legal' : 'product');
const pageSlug = (p) => (p === '/' || p === '/bg/' ? 'home' : p.split('/').filter(Boolean).pop());
const TITLES = {
  '/': 'NATUR – Organic Wholegrain Sticks & Crackers from Bulgaria',
  '/products/': 'Organic Wholegrain Sticks & Crackers – Products | NATUR',
  '/about-us/': 'About NATUR – Family Producer & Exporter of Organic Snacks',
  '/contact/': 'Contact NATUR BG – Organic Snacks Producer, Bulgaria',
  '/privacy-policy/': 'Privacy Policy | NATUR',
  '/cookie-policy/': 'Cookie Policy | NATUR',
  '/organic-rye-sticks-wholegrain/': 'Organic Wholegrain Rye Sticks – Vegan, Sourdough | NATUR',
  '/organic-wholegrain-spelt-sticks/': 'Organic Wholegrain Spelt Sticks – Vegan | NATUR Bulgaria',
  '/organic-einkorn-sticks-wholegrain/': 'Organic Wholegrain Einkorn Sticks – Vegan | NATUR Bulgaria',
  '/organic-oat-sticks-with-turmeric/': 'Organic Oat Sticks with Turmeric – Vegan, Wholegrain | NATUR',
  '/organic-crackers/': 'Organic Crackers – Vegan, Clean Label | NATUR Bulgaria',
  '/bg/': 'НАТЮР – био пълнозърнести солети и крекери',
  '/bg/produkti/': 'Био солети и крекери – веган, пълнозърнести | НАТЮР',
  '/bg/za-nas/': 'За нас – семеен производител на био солети | НАТЮР',
  '/bg/kontakti/': 'Контакти | НАТЮР БГ – био солети и крекери',
  '/bg/politika-za-lichni-danni/': 'Политика за защита на личните данни | НАТЮР',
  '/bg/politika-za-biskvitki/': 'Политика за бисквитки | НАТЮР',
  '/bg/bio-palnozarnesti-soleti-ot-raj/': 'Био пълнозърнести солети от ръж – веган, с квас | НАТЮР',
  '/bg/bio-palnozarnesti-soleti-ot-spelta/': 'Био пълнозърнести солети от спелта – веган | НАТЮР',
  '/bg/bio-palnozarnesti-soleti-ot-limets/': 'Био пълнозърнести солети от лимец – веган | НАТЮР',
  '/bg/bio-krekeri/': 'Био крекери – веган, с чист етикет | НАТЮР',
};
// Written from on-page facts; allowed claims only (see master Hard Contracts: Titles).
const DESCRIPTIONS = {
  "/": "NATUR makes organic wholegrain sticks and crackers in Bulgaria: vegan certified, clean label, baked with coconut oil. Family producer and exporter.",
  "/products/": "Organic wholegrain rye, spelt, einkorn and oat sticks plus crackers from NATUR. Vegan certified, clean label, coconut oil instead of palm oil.",
  "/about-us/": "NATUR BG LTD is a family-run Bulgarian producer and exporter of organic wholegrain snacks, vegan certified and made with premium organic ingredients.",
  "/contact/": "Contact NATUR BG LTD in Kazanlak, Bulgaria: email natur@natur.bg or call us about our organic wholegrain sticks and crackers.",
  "/privacy-policy/": "How NATUR BG LTD collects and uses personal data on natur.bg: types of data, purposes, storage, sharing and your rights.",
  "/cookie-policy/": "Which cookies natur.bg uses and why, and how to allow or decline them. Google Analytics cookies are set only after you allow them.",
  "/organic-rye-sticks-wholegrain/": "Organic wholegrain rye sticks by NATUR: vegan certified, clean label, made with sourdough and Himalayan salt, baked with coconut oil, no palm oil.",
  "/organic-wholegrain-spelt-sticks/": "Organic wholegrain spelt sticks by NATUR: vegan certified, clean label, made with Himalayan salt and baked with coconut oil, no palm oil.",
  "/organic-einkorn-sticks-wholegrain/": "Organic wholegrain einkorn sticks by NATUR: vegan certified, clean label, rich in fiber, baked with coconut oil and no palm oil. From Bulgaria.",
  "/organic-oat-sticks-with-turmeric/": "Organic wholegrain oat sticks with turmeric by NATUR: vegan certified, clean label, baked with coconut oil and no palm oil. Made in Bulgaria.",
  "/organic-crackers/": "Organic wholegrain crackers by NATUR with sesame and poppy seed: vegan certified, clean label, made with coconut oil. Family producer from Bulgaria.",
  "/bg/": "НАТЮР предлага био пълнозърнести солети и крекери – веган сертифицирани, с чист етикет, с кокосово масло, без палмово. Семейно производство от България.",
  "/bg/produkti/": "Био пълнозърнести солети от ръж, спелта и лимец и био крекери от НАТЮР – веган, с кокосово масло вместо палмово и с чист етикет, от България.",
  "/bg/za-nas/": "НАТЮР БГ ЕООД е семейна компания от България, която произвежда и изнася био пълнозърнести продукти – веган сертифицирани, от висококачествени съставки.",
  "/bg/kontakti/": "Свържете се с НАТЮР БГ в Казанлък: пишете на natur@natur.bg или се обадете по телефон за био пълнозърнести солети и крекери.",
  "/bg/politika-za-lichni-danni/": "Как НАТЮР БГ събира и използва лични данни на natur.bg: видове данни, цели, съхранение, споделяне и вашите права.",
  "/bg/politika-za-biskvitki/": "Какви бисквитки използва natur.bg и защо, и как да ги разрешите или откажете. Бисквитките на Google Analytics се задават само ако ги разрешите.",
  "/bg/bio-palnozarnesti-soleti-ot-raj/": "Био пълнозърнести солети от ръж от НАТЮР – веган сертифицирани, с квас и хималайска сол, изпечени с кокосово масло, без палмово. Чист етикет.",
  "/bg/bio-palnozarnesti-soleti-ot-spelta/": "Био пълнозърнести солети от спелта от НАТЮР – веган сертифицирани, богати на фибри, изпечени с кокосово, а не с палмово масло. Чист етикет.",
  "/bg/bio-palnozarnesti-soleti-ot-limets/": "Био пълнозърнести солети от лимец от НАТЮР – веган сертифицирани, богати на фибри, изпечени с кокосово масло. Продукт с чист етикет.",
  "/bg/bio-krekeri/": "Био крекери от НАТЮР с ръжено и спелтово брашно, сусам и маково семе – веган, пълнозърнести, с кокосово масло. Продукт с чист етикет."
};
// Class names for top-level sections, in kept order; curated after the first run.
const SECTION_NAMES = {"en/home":["hero","benefits","products","leaf","story","cta","logos"],"bg/home":["hero","benefits","products","leaf","story","cta","logos"],"en/about-us":["hero","leaf","team","team","features","story","profile","cta"],"bg/za-nas":["hero","leaf","team","team","features","story","profile","cta"],"en/contact":["hero","details","cta"],"bg/kontakti":["hero","details","cta"],"en/products":["listing"],"bg/produkti":["listing"],"en/privacy-policy":["policy"],"en/cookie-policy":["policy"],"bg/politika-za-lichni-danni":["policy"],"bg/politika-za-biskvitki":["policy"]};
// ---------- paths, media, links ----------
const toPath = (u) => {
  const url = new URL(u, 'https://natur.bg');
  let p = url.pathname;
  if (!/\.[a-z0-9]+$/i.test(p) && !p.endsWith('/')) p += '/';
  return p;
};
const media = (u) => {
  const m = new URL(u, 'https://natur.bg').pathname.match(/\/wp-content\/uploads\/(.+)$/);
  if (!m) return null;
  const full = m[1].replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
  for (const c of [m[1].startsWith('elementor/') ? m[1] : full, m[1]]) {
    if (fs.existsSync(`media/originals/${c}`)) return `media/originals/${c}`;
  }
  warn('missing media', u);
  return null;
};
const href = (h) => {
  if (!h) return '';
  if (/^(mailto:|tel:|#)/.test(h)) return h.replace('tel:+359878466854', 'tel:+359878566854');
  const u = new URL(h, 'https://natur.bg');
  return u.hostname.replace(/^www\./, '') === 'natur.bg' ? toPath(h) : h;
};
const imgSrc = ($i) => {
  const s = $i.attr('data-src') || $i.attr('src') || '';
  return s.startsWith('data:') ? '' : s;
};
// ---------- Elementor background images (top-level rules only; @media overrides ignored) ----------
const bgById = {};
function scanCss(css) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const sel = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0, j++;
    const body = css.slice(open + 1, j - 1);
    i = j;
    if (sel.startsWith('@')) continue;
    const url = body.match(/background-image:url\(["']?([^"')]+)/);
    const id = sel.match(/elementor-element-([0-9a-f]{7})/);
    if (!url || !id || bgById[id[1]]) continue;
    bgById[id[1]] = {
      src: url[1],
      position: (body.match(/background-position:([^;}]+)/) || [])[1],
      size: (body.match(/background-size:([^;}]+)/) || [])[1],
    };
  }
}
for (const f of fs.readdirSync(`${CAP}/css`).filter((f) => /elementor_css_(post|global)/.test(f))) {
  scanCss(fs.readFileSync(`${CAP}/css/${f}`, 'utf8'));
}
// ---------- brand spelling (body text keeps verbatim unless it misspells the brand) ----------
const brandFixes = [];
const brand = (s, where) =>
  s.replace(/(?<![а-яА-Яa-z])(НАТУР|Натур)(?![а-яА-Я])/g, (m, w, off) => {
    brandFixes.push(`${where}: "${s.slice(Math.max(0, off - 20), off + 25)}"`);
    return 'НАТЮР';
  });
// ---------- sanitized semantic HTML ----------
function sanitize($, root, ctx) {
  const out = [];
  const walk = (n) => {
    if (n.type === 'text') return n.data.replace(/\s+/g, ' ');
    if (n.type !== 'tag' || SKIP_TAGS.has(n.name)) return '';
    const $n = $(n), kids = () => n.children.map(walk).join('');
    switch (n.name) {
      case 'br': return '<br>';
      case 'a': {
        const h = href(n.attribs.href);
        const ext = /^https?:/.test(h) ? ' rel="noopener"' : '';
        return `<a href="${h}"${ext}>${kids().trim()}</a>`;
      }
      case 'img': {
        const src = media(imgSrc($n));
        if (!src) return '';
        const alt = (n.attribs.alt || '').trim();
        return `<img src="${src}" alt="${alt}" data-role="${alt ? 'content' : 'decor'}">`;
      }
      case 'strong': case 'b': case 'em': case 'i': case 'li': case 'ul': case 'ol': case 'table':
      case 'tbody': case 'thead': case 'tr': case 'td': case 'th': case 'h1': case 'h2': case 'h3':
      case 'h4': case 'h5': case 'h6': {
        const tag = n.name === 'b' ? 'strong' : n.name === 'i' ? 'em' : n.name;
        if (n.name === 'i' && !$n.text().trim()) return '';
        const attrs = ['colspan', 'rowspan'].filter((a) => n.attribs[a]).map((a) => ` ${a}="${n.attribs[a]}"`).join('');
        return `<${tag}${attrs}>${kids()}</${tag}>`;
      }
      case 'p': return splitPara(kids());
      case 'div':
        return /scroll-table/.test(n.attribs.class || '')
          ? `<div class="scroll-table">${kids()}</div>`
          : kids();
      default: return kids();
    }
  };
  for (const c of root.contents().toArray()) out.push(walk(c));
  let s = out.join('').trim();
  // WordPress used <br><br> runs as paragraph separators; split them into real paragraphs
  if (!/<p>|<ul>|<table>|<h\d>/.test(s) && s) s = splitPara(s);
  return brand(s, ctx);
}
function splitPara(inner) {
  return inner
    .split(/(?:\s*<br>\s*){2,}/)
    .map((x) => x.replace(/^(\s*<br>)+|(<br>\s*)+$/g, '').trim())
    .filter((x) => x.replace(/&nbsp;|\s/g, ''))
    .map((x) => `<p>${x}</p>`)
    .join('');
}
const decoded = (s) => cheerio.load(`<i>${s}</i>`)('i').text();
const EU_ALT = {
  en: 'European Union – European Regional Development Fund; SME Promotion Agency; Operational Programme Innovation and Competitiveness',
  bg: 'Европейски съюз – Европейски фонд за регионално развитие; Изпълнителна агенция за насърчаване на малките и средните предприятия; Оперативна програма Иновации и конкурентоспособност',
};
// ---------- Elementor tree -> semantic fragment ----------
function makeConverter($, lang, names) {
  const dropped = [];
  let sectionIdx = 0, formDone = false;
  const readMore = lang === 'bg' ? 'Прочети още' : 'Read More';
  const cards = (el) => {
    const items = $(el).find('.uael-post-wrapper').map((_, w) => {
      const $w = $(w), a = $w.find('.uael-post__title a'), name = norm(a.text()), h = href(a.attr('href'));
      const src = media(imgSrc($w.find('.uael-post__thumbnail img').first()));
      const label = norm($w.find('.uael-post__read-more').text());
      const gen = label.toLowerCase() === readMore.toLowerCase();
      const vh = gen ? `<span class="vh"> ${lang === 'bg' ? 'за' : 'about'} ${name}</span>` : '';
      return `<li><a class="card-img" href="${h}"><img src="${src}" alt="${name} – ${lang === 'bg' ? 'опаковка' : 'package'}" data-role="content"></a><h4><a href="${h}">${name}</a></h4><a class="btn" href="${h}">${label}${vh}</a></li>`;
    }).get();
    return `<ul class="product-cards">${items.join('')}</ul>`;
  };
  const sanitizeBlock = (el) => sanitize($, $(el).find('.elementor-widget-container').first(), 'body');
  const widgets = {
    heading(el) {
      const h = $(el).find('.elementor-heading-title').first();
      const tag = h.prop('tagName').toLowerCase();
      const inner = sanitize($, h, 'body').replace(/^<p>|<\/p>$/g, '');
      return /^h[1-6]$/.test(tag) ? `<${tag}>${inner}</${tag}>` : `<p class="role">${inner}</p>`;
    },
    'text-editor': sanitizeBlock,
    image(el) {
      const $i = $(el).find('img').first();
      const src = media(imgSrc($i));
      if (!src) return '';
      let alt = brand((($i.attr('alt') || '').trim()), 'alt');
      if (src.endsWith('euprogramlogos.jpg')) alt = EU_ALT[lang];
      const img = `<img src="${src}" alt="${alt}" data-role="${alt ? 'content' : 'decor'}">`;
      const a = $(el).find('a').first();
      return a.length ? `<a href="${href(a.attr('href'))}">${img}</a>` : img;
    },
    button(el) {
      const a = $(el).find('a').first();
      return `<p class="cta"><a class="btn" href="${href(a.attr('href'))}">${norm(a.text())}</a></p>`;
    },
    'icon-list'(el) {
      const li = $(el).find('li').map((_, l) => `<li>${sanitize($, $(l).find('.elementor-icon-list-text'), 'body')}</li>`).get();
      return `<ul class="icon-list">${li.join('')}</ul>`;
    },
    sina_flip_box(el) {
      const $e = $(el), src = media(imgSrc($e.find('.sina-flipbox-icon img').first()));
      const t = norm($e.find('.sina-flipbox-title').text());
      const front = sanitize($, $e.find('.sina-flipbox-front .sina-flipbox-desc').first(), 'body');
      const back = sanitize($, $e.find('.sina-flipbox-back .sina-flipbox-desc').first(), 'body');
      const alt = t ? '' : brand(($e.find('.sina-flipbox-icon img').attr('alt') || '').trim(), 'alt');
      return `<div class="flip">${src ? `<img src="${src}" alt="${alt}" data-role="${alt ? 'content' : 'decor'}">` : ''}${t ? `<h3>${t}</h3>` : ''}${front}<div class="flip-back">${back}</div></div>`;
    },
    'icon-box'(el) {
      const $e = $(el);
      return `<div class="icon-box"><h3>${norm($e.find('.elementor-icon-box-title').text())}</h3><p>${norm($e.find('.elementor-icon-box-description').text())}</p></div>`;
    },
    icon(el) {
      const c = ($(el).find('i').attr('class') || '').match(/fa-([a-z-]+)/g) || [];
      return `<span class="ico" data-icon="${(c[c.length - 1] || 'fa-icon').replace('fa-', '')}" aria-hidden="true"></span>`;
    },
    'uael-faq'(el) {
      const items = $(el).find('.uael-faq-accordion').map((_, a) => {
        const q = norm($(a).find('.uael-accordion-title h5, .uael-accordion-title .uael-question-span').first().text());
        const body = sanitize($, $(a).find('.uael-accordion-content').first(), 'body');
        return `<details><summary><h2>${q}</h2></summary>${body}</details>`;
      }).get();
      return `<div class="faq">${items.join('')}</div>`;
    },
    'uael-posts'(el) {
      return $(el).find('.uael-post__grid-empty').length ? '@@EMPTY@@' : cards(el);
    },
    divider: () => '<hr>',
    spacer: () => '',
    sina_content_slider: () => '',
    'image-carousel': () => '',
    tabs: () => '',
    'uael-cf7-styler': () => {
      if (formDone) return '';
      formDone = true;
      return '@@FORM@@';
    },
  };
  const hiddenOn = (cls) => new Set([...cls.matchAll(/elementor-hidden-(desktop|tablet|phone)/g)].map((m) => m[1]));
  const leafText = (el) => $(el).find('[data-widget_type]').map((_, w) => norm($(w).clone().find('noscript,style,script').remove().end().text())).get().filter(Boolean);
  function conv(el) {
    if (el.type !== 'tag' || SKIP_TAGS.has(el.name)) return '';
    const cls = el.attribs.class || '', hid = hiddenOn(cls);
    if (hid.has('desktop') || hid.size === 3) {
      dropped.push(...leafText(el));
      return '';
    }
    const wt = el.attribs['data-widget_type'];
    if (wt) {
      const key = wt.split('.')[0];
      if (!(key in widgets)) { warn('unknown widget', wt); return ''; }
      return widgets[key](el);
    }
    const isSec = /\belementor-section\b(?!-)/.test(cls);
    const kids = isSec
      ? $(el).find('.elementor-column').filter((_, c) => $(c).closest('.elementor-section')[0] === el).toArray().map(conv).filter(Boolean)
      : el.children.map(conv).filter(Boolean);
    if (!kids.length) return '';
    const id = el.attribs['data-id'];
    const isSection = isSec, isCol = /\belementor-column\b/.test(cls);
    const bg = id && bgById[id];
    let bgAttr = '';
    if (bg && (isSection || isCol)) {
      const src = media(bg.src);
      if (src) bgAttr = ` data-bg="${src}"${bg.position ? ` data-bg-position="${bg.position}"` : ''}${bg.size ? ` data-bg-size="${bg.size}"` : ''}`;
    }
    if (isCol) {
      const w = (cls.match(/elementor-col-(\d+)/) || [])[1];
      return `<div class="col${w && w !== '100' ? ` col-${w}` : ''}"${bgAttr}>${kids.join('')}</div>`;
    }
    if (isSection) {
      const lone = kids.length === 1 && kids[0].startsWith('<div class="col">');
      const inner = lone ? kids[0].slice(17, -6) : kids.length > 1 ? `<div class="cols">${kids.join('')}</div>` : kids.join('');
      if (inner.includes('@@EMPTY@@')) { dropped.push('(empty posts block)'); return ''; }
      if (/elementor-top-section/.test(cls)) {
        const name = names[sectionIdx++] || `s${sectionIdx}`;
        return `<section class="${name}"${bgAttr}>${inner}</section>`;
      }
      return `<div class="inner"${bgAttr}>${inner}</div>`;
    }
    return kids.join('');
  }
  return { conv, dropped, get sections() { return sectionIdx; } };
}
// Renumber headings: exactly one h1, no skips; a changed level keeps its look through class="hN".
function renumber($, root) {
  const stack = [];
  let first = true;
  root.find('h1,h2,h3,h4,h5,h6').each((_, h) => {
    const orig = +h.name[1];
    while (stack.length && stack.at(-1).orig >= orig) stack.pop();
    const lvl = stack.length ? stack.at(-1).lvl + 1 : first ? 1 : 2;
    first = false;
    stack.push({ orig, lvl });
    if (lvl !== orig) { h.name = `h${lvl}`; $(h).addClass(`h${orig}`); }
  });
}
function pretty(s) {
  return s
    .replace(/(<(?:section|div|ul|ol|li|p|h[1-6]|details|summary|table|tr|figure|hr)\b)/g, '\n$1')
    .replace(/(<\/(?:section|ul|ol|details|table)>)/g, '$1\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim() + '\n';
}
function pageFragment(route, ctx) {
  const lang = route.lang, slug = pageSlug(route.path);
  const $ = cheerio.load(html(byPath[route.path]));
  const names = SECTION_NAMES[`${lang}/${slug}`] || [];
  const c = makeConverter($, lang, names);
  const tops = $('.entry-content section.elementor-top-section').filter((_, s) => !$(s).parents('.elementor-top-section').length);
  let out = tops.toArray().map(c.conv).join('');
  const cta = lang === 'bg' ? 'Пишете ни' : 'Write to us';
  const phones = ['+359876466854', '+359899494814', '+359878566854'].map((p) => `<a href="tel:${p}">${p.replace(/(\+359)(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4')}</a>`);
  out = out.replace('@@FORM@@', `<p class="contact-cta"><a class="btn" href="mailto:natur@natur.bg">${cta}</a></p><p class="contact-phones">${phones.join('<br>')}</p>`);
  const $o = cheerio.load(`<main id="x">${out}</main>`);
  renumber($o, $o('#x'));
  const final = pretty($o('#x').html());
  const kept = norm(decoded(final.replace(/<[^>]+>/g, ' ')));
  const missed = c.dropped.filter((t) => t.length > 12 && !kept.includes(t.slice(0, 40)));
  console.log(`${lang}/${slug}: ${c.sections} sections, dropped ${c.dropped.length} hidden/empty blocks, text only in dropped: ${missed.length}`);
  for (const m of missed) console.log('   DROPPED-ONLY:', m.slice(0, 100));
  fs.mkdirSync(`content/pages/${lang}`, { recursive: true });
  fs.writeFileSync(`content/pages/${lang}/${slug}.html`, final);
  return final;
}
// ---------- products ----------
function readProduct(route) {
  const $ = cheerio.load(html(byPath[route.path]));
  const q = (sel, root) => (root ? $(root).find(sel) : $(sel));
  const name = norm($('.site-content h1').first().text());
  const images = [];
  $('.elementor-image-carousel .swiper-slide:not(.swiper-slide-duplicate) img').each((_, i) => {
    const src = media(imgSrc($(i)));
    if (src && !images.some((x) => x.src === src)) images.push({ src, alt: ($(i).attr('alt') || '').trim() });
  });
  const info = $('.site-content .elementor-icon-list-text').map((_, t) => brand(norm($(t).text()), 'info')).get();
  const tabs = $('.elementor-tabs-wrapper .elementor-tab-title').map((_, t) => {
    const id = $(t).attr('id').replace('elementor-tab-title-', '');
    const panel = $(`#elementor-tab-content-${id}`);
    return { label: norm($(t).text()), html: sanitize($, panel, 'body') };
  }).get();
  const related = q('.uael-post__title a').map((_, a) => toPath($(a).attr('href'))).get();
  const card = (path) => norm($(`.uael-post__title a[href$="${path}"]`).first().text());
  const backgrounds = [];
  $('.site-content [data-id]').each((_, e) => {
    const bg = bgById[e.attribs['data-id']];
    const src = bg && media(bg.src);
    if (src && !backgrounds.some((b) => b.src === src)) backgrounds.push({ src, position: bg.position, size: bg.size });
  });
  return { path: route.path, name, images, info, tabs, related, backgrounds };
}
// ---------- head data and chrome ----------
function headData(route) {
  const $ = cheerio.load(html(byPath[route.path]));
  const pair = {};
  $('link[rel=alternate][hreflang]').each((_, l) => { pair[$(l).attr('hreflang')] = toPath($(l).attr('href')); });
  const other = route.lang === 'en' ? pair.bg : pair.en;
  const og = $('meta[property="og:image"]').attr('content');
  return { pair: other && other !== route.path ? other : null, og: og && media(og), yoastDesc: $('meta[name=description]').attr('content') };
}
function chrome(lang) {
  const home = lang === 'en' ? '/' : '/bg/';
  const $ = cheerio.load(html(byPath[home]));
  const header = $('header').first();
  const nav = header.find('nav ul').last().find('a').map((_, a) => ({ label: norm($(a).text()), path: href($(a).attr('href')) })).get();
  const sw = header.find('[data-widget_type^="shortcode"] a').first();
  const footer = $('footer').first();
  const aside = (n) => footer.find(`aside[aria-label="Footer Widget ${n}"]`);
  const menuLinks = aside(2).find('nav a').map((_, a) => ({ label: norm($(a).text()) || $(a).find('img').attr('alt'), path: href($(a).attr('href')) })).get();
  const tel = aside(3).find('a[href^=tel]').map((_, a) => ({ label: norm($(a).text()), href: href($(a).attr('href')) })).get();
  const copy = footer.find('p').filter((_, p) => /rights reserved|права/i.test($(p).text())).first();
  const legal = copy.find('a[href^="/"]').map((_, a) => ({ label: norm($(a).text()), path: href($(a).attr('href')) })).get();
  const credit = copy.find('a[href^=http]').first();
  const lg = (el) => ({ src: media(imgSrc($(el))), alt: ($(el).attr('alt') || '').trim() });
  return {
    nav,
    langSwitch: { label: norm(sw.text()), path: href(sw.attr('href')), lang: lang === 'en' ? 'bg' : 'en' },
    footer: {
      menuTitle: norm(aside(2).find('h2').text()),
      menu: menuLinks,
      logo: lg(aside(4).find('img').first()),
      tagline: norm(aside(4).find('p').text()),
      contactsTitle: norm(aside(3).find('h2').text()),
      address: aside(3).find('p').last().html().split(/<br\s*\/?>/).map((x) => norm(decoded(x))).filter(Boolean),
      phonesText: tel.map((t) => t.label),
      copyright: norm(copy.contents().first().text()).replace(/\s*\|$/, ''),
      legal,
      credit: { label: norm(copy.contents().filter((_, n) => n.type === 'text').last().text()).replace(/^\|?\s*/, ''), name: norm(credit.text()), href: credit.attr('href') },
    },
    contacts: { email: 'natur@natur.bg', phones: ['+359876466854', '+359899494814', '+359878566854'] },
    social: { facebook: footer.find('a[aria-label=Facebook]').attr('href') },
    logo: lg(header.find('[data-widget_type^="image"] img').first()),
  };
}
// ---------- main ----------
const CONSENT = {
  en: { text: 'We use Google Analytics cookies only if you allow them, to see how the site is used.', allow: 'Allow', decline: 'Decline', settings: 'Cookie settings' },
  bg: { text: 'Използваме бисквитки на Google Analytics само ако ги разрешите, за да разберем как се използва сайтът.', allow: 'Разрешавам', decline: 'Отказвам', settings: 'Настройки на бисквитките' },
};
const listing = (path) => {
  const $ = cheerio.load(html(byPath[path]));
  return $('.entry-content .uael-post__title a').map((_, a) => ({ path: toPath($(a).attr('href')), short: norm($(a).text()) })).get();
};
const cardName = { ...Object.fromEntries(listing('/products/').map((x) => [x.path, x.short])), ...Object.fromEntries(listing('/bg/produkti/').map((x) => [x.path, x.short])) };
const heads = {}, pages = {}, prods = {};
for (const r of existing) {
  heads[r.path] = headData(r);
  if (templateOf(r.path) === 'product') prods[r.path] = readProduct(r);
  else pages[r.path] = pageFragment(r);
}
const chromes = { en: chrome('en'), bg: chrome('bg') };
const idOf = (p) => (p.startsWith('/bg/') ? Object.keys(heads).find((k) => heads[k].pair === p) : p).replaceAll('/', '');
const goodAlt = (a) => a && /\s/.test(a) &&!/[_()]/.test(a);
const suffix = { en: { package: 'package', nutrition: 'nutrition facts' }, bg: { package: 'опаковка', nutrition: 'хранителни стойности' } };
function productLang(path, lang) {
  const p = prods[path];
  const short = brand(cardName[path] || byPath[path].title.split(' | ')[0], 'name');
  const images = p.images.map((im, i) => {
    const role = i === 0 ? 'package' : /table/i.test(im.src) ? 'nutrition' : 'other';
    const alt = goodAlt(im.alt) ? brand(im.alt, 'alt') : `${short} – ${suffix[lang][role === 'other' ? 'package' : role]}`;
    return { src: im.src, alt, role };
  });
  const tabKeys = ['flavor', 'ingredients', 'benefits'];
  return {
    path, name: p.name, short, images, info: p.info,
    tabs: p.tabs.map((t, i) => ({ id: tabKeys[i], label: t.label, html: t.html })),
    related: p.related.map(idOf), backgrounds: p.backgrounds,
  };
}
const order = listing('/products/').map((x) => x.path);
const products = order.map((path) => {
  const bgPath = heads[path].pair;
  return { id: idOf(path), en: productLang(path, 'en'), bg: bgPath ? productLang(bgPath, 'bg') : null };
});
const h1 = (h) => norm(decoded(((h.match(/<h1[^>]*>(.*?)<[/]h1>/s) || [, ''])[1]).replace(/<[^>]+>/g, '')));
const crumbName = (r) => {
  const nav = chromes[r.lang].nav.find((n) => n.path === r.path);
  if (nav) return nav.label;
  if (templateOf(r.path) === 'legal') return TITLES[r.path].split(' | ')[0];
  return templateOf(r.path) === 'product' ? cardName[r.path] || byPath[r.path].title.split(' | ')[0] : h1(pages[r.path]);
};
const routes = existing.map((r) => {
  const tpl = templateOf(r.path), h = heads[r.path];
  const chain = r.path === '/' || r.path === '/bg/' ? [] : [r.lang === 'en' ? '/' : '/bg/', ...(tpl === 'product' ? [r.lang === 'en' ? '/products/' : '/bg/produkti/'] : []), r.path];
  const rt = (p) => ({ path: p, lang: r.lang, template: templateOf(p) });
  const nameOf = (p) => chromes[r.lang].nav.find((n) => n.path === p)?.label || (p === r.path ? crumbName(r) : '');
  return {
    path: r.path, lang: r.lang, slug: pageSlug(r.path), template: tpl, pair: h.pair,
    title: TITLES[r.path], description: DESCRIPTIONS[r.path], ogImage: h.og || heads[r.lang === 'en' ? '/' : '/bg/'].og,
    breadcrumb: chain.map((p) => ({ name: nameOf(p), path: p })),
  };
});
const site = {};
for (const lang of ['en', 'bg']) {
  const c = chromes[lang];
  const cookie = c.footer.legal.find((l) => /cookie|бисквитки/i.test(l.label));
  site[lang] = {
    nav: c.nav,
    footer: { ...c.footer, menu: c.footer.menu.filter((m) => c.nav.some((n) => n.path === m.path)) },
    contacts: c.contacts, social: c.social,
    langSwitch: c.langSwitch,
    consent: { ...CONSENT[lang], policyLabel: cookie.label, policyPath: cookie.path },
    skipLink: lang === 'en' ? 'Skip to content' : 'Към съдържанието',
    menuLabel: lang === 'en' ? 'Menu' : 'Меню',
    logo: c.logo,
  };
}
const dump = (f, o) => fs.writeFileSync(f, `${JSON.stringify(o, null, 2)}
`);
dump('content/routes.json', { routes });
dump('content/products.json', { products });
dump('content/site.json', site);
console.log('brand fixes:', brandFixes);
for (const r of routes) console.log(r.path, '->', r.pair, r.ogImage, r.description.length, JSON.stringify(r.breadcrumb.map((b) => b.name)));

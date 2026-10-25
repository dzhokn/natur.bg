# natur.bg static site launch

- Status: READY_FOR_IMPLEMENTATION
- Tier: full
- Owner: Miroslav Dzhokanov
- Created: 2026-10-25
- Execution checkout: `D:/_projects/natur.bg`, branch `task/static-site-launch`. Bootstrap: the plan commit is on `main`, pushed to the new public `dzhokn/natur.bg` (`gh repo create dzhokn/natur.bg --public --source . --push`, owner request + D1); Pages stays disabled until Release step 3.

## Problem

https://natur.bg is a WordPress 2021-era site (Astra + Elementor + Ultimate Addons + WPML + Contact Form 7 + Yoast + Smush + Cookie Notice + "Use Any Font") on SuperHosting.bg, proxied by a Cloudflare zone (`albert`/`kim.ns.cloudflare.com`, `cf-edge-cache: platform=wordpress` header from the Cloudflare WordPress plugin; APO state unproven). The owner will replace it today with a static site in the new public repo `dzhokn/natur.bg`, served by GitHub Pages behind the same Cloudflare zone, and requires 100 in all four PageSpeed Insights categories.

Evidence captured 2026-10-25 (scratch evidence, not tracked):
- Inventory: 21 indexable URLs (Yoast sitemaps = WP REST): EN at root (6 pages + 5 products), BG under `/bg/` (6 pages + 4 products; the oat-turmeric product has no BG page). Pages reference 88 media files, 11.7 MiB (PNG 10 MiB). Each page loads ~30 JS + ~33 CSS files, ~70 KB inline CSS, gtag.js 167 KB.
- Local Lighthouse 13.5.0, single runs (PSI API anonymous quota returned HTTP 429): EN home mobile/desktop perf 60/89, a11y 81/95, BP 100, SEO 92, mobile LCP 9.7 s; BG spelt product perf 42/85, a11y 78/86, BP 100, SEO 100, mobile LCP 13.0 s, CLS 0.362.
- Failing audits: `color-contrast` (white on `#9cd537` = 1.75:1; `#9cd537` text on white 1.75:1; `#8bc34a` on white 2.10:1), `link-text` (5x "Read More"), `heading-order`, `target-size`, `aria-*`, `landmark-one-main`, `bf-cache` (WP `no-store`). Home LCP = hero background `2021/06/naturbg-home-4.jpg` (630 KB, Elementor parallax), element render delay 1072 ms.
- SEO defects: titles "Home | Natur BG" / "Начало | Natur BG"; `/products/` has no H1; home `og:url` points to `/bg/`; hreflang `en` = `https://natur.bg` (no slash), no `x-default`; 12 images without alt per product page; brand spelled NATUR/НАТЮР/НАТУР.
- Data defects: one contact-page link per language dials `+359878466854` while the shown number is `+359 878 566 854` (all other 21 pages use `tel:+359878566854`). EN home shows an empty "Partner News" block ("Sorry, we couldn't find any posts"); BG home shows the empty "Новини" block ("Не са намерени постове").
- Cloudflare Email Address Obfuscation is on: the 21 pages carry `natur@natur.bg` 47 times only as `__cf_email__`/`/cdn-cgi/l/email-protection#…` plus an injected `email-decode.min.js`. No other Cloudflare HTML injection (no Rocket Loader, no Insights beacon). `www.natur.bg` → `https://natur.bg/` 301 comes from WordPress (`x-redirect-by: WordPress`), not a Cloudflare rule.
- GA4 `G-BWBK437736` fires before any consent (observed `region1.google-analytics.com/g/collect` during an unclicked Lighthouse run).
- DNS: apex/www proxied; `mail`, `webmail`, `cpanel`, `ftp` and the MX helper `_dc-mx.f784b4c3daed.natur.bg` resolve to `91.196.124.63` (SuperHosting). SPF includes superhosting.bg.
- Owner's other sites (rusal.pro, dzho.kn, camaro.to, kiasorento.blue) are public GitHub Pages repos behind the Cloudflare proxy. Server wait from Sofia, n=15: dzho.kn median 11 ms / p95 155 ms; catwing.ai (Workers) 17 / 32 ms; natur.bg WP 25 / 37 ms.

## Solution / Goals

1. All 21 URLs (exact paths, trailing slash) plus a real 404 serve prebuilt HTML from GitHub Pages behind Cloudflare, with content text verbatim from the capture except the changes listed in Hard Contracts.
2. Lighthouse 13.x medians (3 runs) = 100 in Performance, Accessibility, Best Practices and SEO, mobile and desktop, for all 21 routes on the local server; then PSI medians (3 runs) = 100 on production for all 21 routes when `PSI_API_KEY` is available, else for the 6 representative routes in Release step 10.
3. Technical SEO: correct canonical/hreflang/x-default, unique titles/descriptions per D5, alt text, sitemaps, robots.txt, JSON-LD (Organization, WebSite, BreadcrumbList).
4. GA4 only through Cloudflare Zaraz, loaded only after consent from a minimal bar; zero GA requests before consent.
5. Contact by direct email `natur@natur.bg` + the three phone numbers; no form backend.
6. Mail service (`_dc-mx`, `mail`, `webmail`, `cpanel`, `ftp`) unchanged through cutover; rollback to WordPress in minutes.

## Non-Goals

- No CMS, server code, form relay, Worker, CAPTCHA, trackers or third-party widgets in built pages.
- No new pages or new body copy (BG oat page, B2B content, prices: follow-ups F2-F4).
- No Product JSON-LD: Google's Product snippet requires `offers`, `review` or `aggregateRating`; the site has none, so Rich Results Test would report an invalid item. Revisit with F4.
- No WordPress decommission, mailbox change, or DNS change beyond apex/www/redirect/cache rules.
- No preview environment (owner decision D6).

## Alternatives Measured

| Direction | Metric | Number | Verdict |
|---|---|---|---|
| Do nothing (WordPress) | Local LH 13.5 mobile perf / a11y | home 60/81, product 42/78 | rejected |
| Hosting: Cloudflare Workers Static Assets | Sofia server wait median/p95 (n=15) | 17 / 32 ms | rejected (D1: owner pattern, same speed class) |
| Hosting: GitHub Pages + Cloudflare | same | 11 / 155 ms (Fastly expiry tail) | chosen |
| Images: lossless WebP | bytes vs current files (packshot / nutrition table, 400x600) | 296→200 KB (−32%), 243→139 KB (−43%) | rejected |
| Images: AVIF q75 (+WebP q90 fallback) | bytes, exploratory luma SSIM | 28 KB (0.994), 27 KB (0.997); WebP 41/39 KB | chosen |
| Analytics: gtag.js direct | transfer | 167 KB third-party JS | rejected |
| Analytics: Zaraz GA4 | CatWing local LH12 mobile with/without | score 99 vs 99, LCP 1362 vs 1366 ms | chosen, consent-gated |
| Inline all CSS | CatWing local LH12 mobile | LCP 1366 → 1512 ms (worse) | not default; trial only if gate misses (step 9) |

- Metric: Lighthouse category scores and LCP, because the owner's acceptance is PSI (same engine).
- Checklist: baseline n=1 per page (PSI quota), so do-nothing numbers are indicative only; SSIM is an own luma 8x8 implementation on 3 images; TTFB is Sofia-only. Interleaving applies to the step 9 CSS trial (3 warmups, 5 interleaved pairs, medians/IQR).
- After delivery: PSI medians (3 runs) per route on natur.bg, mobile and desktop.

## Specialist Routing

- Retail-Expert: Not required: informational catalog, no Catwing retail semantics.
- DBA: Not required: no database.
- Architectify: Not required: single static build, no Catwing packages or pipeline stages.
- Re-Architectify: Not required: new repository.
- Designify: Not required: targets Catwing app UI; visual choices are owner decisions D4/A4 and the fidelity gates below.
- Speedify: Not required: targets Catwing app/DB; page performance is gated by Lighthouse here.
- Migrate: Not required: no migrations.
- SQL-Check: Not required: no SQL.

## Implementation

### Hard Contracts

Owner decisions (2026-10-25): D1 public repo + GitHub Pages behind Cloudflare. D2 GA4 via Zaraz behind a minimal consent bar. D3 direct email + phones, no form. D4 colour option A. D5 BG pages target Bulgarian shoppers, EN pages target trade buyers, equal weight. D6 straight to production, no preview. Owner-confirmed assumptions A1-A16 are encoded below.

- Routes (frozen, `content/routes.json`): EN `/`, `/products/`, `/about-us/`, `/contact/`, `/privacy-policy/`, `/cookie-policy/`, `/organic-rye-sticks-wholegrain/`, `/organic-wholegrain-spelt-sticks/`, `/organic-einkorn-sticks-wholegrain/`, `/organic-oat-sticks-with-turmeric/`, `/organic-crackers/`; BG `/bg/`, `/bg/produkti/`, `/bg/za-nas/`, `/bg/kontakti/`, `/bg/politika-za-lichni-danni/`, `/bg/politika-za-biskvitki/`, `/bg/bio-palnozarnesti-soleti-ot-raj/`, `/bg/bio-palnozarnesti-soleti-ot-spelta/`, `/bg/bio-palnozarnesti-soleti-ot-limets/`, `/bg/bio-krekeri/`. Each is `<route>index.html` in `dist/`. EN↔BG pairs come from the captured `hreflang` links; the oat page has no BG pair and its language switch links to `/bg/` (as today).
- Head per route: `<html lang="en|bg">`, one `<title>`, one meta description, canonical `https://natur.bg<route>`, hreflang `en`/`bg` for paired routes plus `x-default` = EN URL, all absolute with trailing slash; `og:url` = canonical; `og:image` = derived 1200 px JPEG of the captured Yoast og image.
- Titles (exact; descriptions ≤ 155 chars written from on-page facts with the same keyword focus):
  - EN: `/` "NATUR – Organic Wholegrain Sticks & Crackers from Bulgaria"; `/products/` "Organic Wholegrain Sticks & Crackers – Products | NATUR"; `/about-us/` "About NATUR – Family Producer & Exporter of Organic Snacks"; `/contact/` "Contact NATUR BG – Organic Snacks Producer, Bulgaria"; legal "Privacy Policy | NATUR", "Cookie Policy | NATUR"; rye "Organic Wholegrain Rye Sticks – Vegan, Sourdough | NATUR"; spelt "Organic Wholegrain Spelt Sticks – Vegan | NATUR Bulgaria"; einkorn "Organic Wholegrain Einkorn Sticks – Vegan | NATUR Bulgaria"; oat "Organic Oat Sticks with Turmeric – Vegan, Wholegrain | NATUR"; crackers "Organic Crackers – Vegan, Clean Label | NATUR Bulgaria".
  - BG: `/bg/` "НАТЮР – био пълнозърнести солети и крекери"; `/bg/produkti/` "Био солети и крекери – веган, пълнозърнести | НАТЮР"; `/bg/za-nas/` "За нас – семеен производител на био солети | НАТЮР"; `/bg/kontakti/` "Контакти | НАТЮР БГ – био солети и крекери"; legal "Политика за защита на личните данни | НАТЮР", "Политика за бисквитки | НАТЮР"; raj "Био пълнозърнести солети от ръж – веган, с квас | НАТЮР"; spelta "Био пълнозърнести солети от спелта – веган | НАТЮР"; limets "Био пълнозърнести солети от лимец – веган | НАТЮР"; krekeri "Био крекери – веган, с чист етикет | НАТЮР".
  - Claims allowed in metadata/alt: organic, wholegrain, vegan certified, clean label, sourdough/квас (rye only), coconut oil not palm oil, family producer, exporter, Bulgaria. Forbidden: private label, wholesale, prices, superlatives. Brand: "NATUR" in EN, "НАТЮР" in BG (fix "НАТУР").
- Visible copy verbatim from the capture, except: D4 colours; `/products/` and `/bg/produkti/` promote their existing top heading to `<h1>` with unchanged look; card/heading levels renumbered to remove skips with unchanged look; "Read More"/"Прочети още" links get a visually hidden suffix " about <product name>" / " за <име на продукта>"; empty posts blocks (EN "Partner News", BG "Новини") removed; the CF7 form replaced per D3; the consent bar added per D2; policy text updated per the policy clause below. The EU programme logos image (`2021/07/euprogramlogos.jpg`) stays wherever it appears today.
- Colours (D4): green fills stay `#9cd537` / `#8bc34a`; text on any green fill is `#4c1a02`; text set in green becomes `#5c811b`; hover darkens the fill to `#7baf42` with `#4c1a02` text. No other palette change.
- Contact (D3): `/contact/` and `/bg/kontakti/` keep their headings/intro text; the form area shows `natur@natur.bg` as a visible `mailto:` link styled as the site button (label "Write to us" / "Пишете ни") plus the three `tel:` links. Phones everywhere: `+359876466854`, `+359899494814`, `+359878566854`; the string `878466854` must not appear in `dist/`. Capture decodes every `data-cfemail` / `email-protection#` value (XOR with the first byte) back to the literal address; `dist/` contains literal `natur@natur.bg` wherever the live site shows it and no `/cdn-cgi/` reference. Production keeps the literal address because Release step 2 turns Email Obfuscation off for natur.bg.
- Consent (D2): every page carries, in its language, a fixed bottom bar (non-modal, no backdrop, `position: fixed`, `max-height: 140px` in CSS px at a 412 px-wide viewport (Lighthouse mobile emulates 412x823, DPR 1.75), never the route's LCP element: `tools/lighthouse.mjs --assert` fails if the reported LCP node is inside the bar) with text EN "We use Google Analytics cookies only if you allow them, to see how the site is used." BG "Използваме бисквитки на Google Analytics само ако ги разрешите, за да разберем как се използва сайтът.", a link to the cookie policy, and two equal buttons EN "Allow" / "Decline", BG "Разрешавам" / "Отказвам". The footer gets "Cookie settings" / "Настройки на бисквитките" that reopens it. A ≤ 300-byte inline head script reads cookie `natur_consent=granted|denied` (first-party, `Path=/; Max-Age=15552000; SameSite=Lax; Secure` on HTTPS) and sets `data-consent` on `<html>`; CSS hides the bar when set. Buttons write the cookie, then call `zaraz.consent.setAll(true|false)` and, on allow, `zaraz.consent.sendQueuedEvents()`; if `window.zaraz` is absent they wait for the `zarazConsentAPIReady` document event and never throw. On that event, a stored choice that differs from `zaraz.consent.getAll()` is re-applied. Step 7 verifies these API names against Cloudflare's Zaraz Consent API docs before coding; stop and report if they differ.
- Policies (A11): in `/privacy-policy/`, `/cookie-policy/`, `/bg/politika-za-lichni-danni/`, `/bg/politika-za-biskvitki/` replace only the clauses about Contact Form 7 data, WPML cookies, Cookie Notice cookies and direct Google Analytics with factual text: email correspondence instead of the form; `natur_consent` (choice, 180 days); Zaraz consent cookie; after "Allow" only: Cloudflare Zaraz loads GA4 `G-BWBK437736` and sets `cf_zaraz_client` (365 days), `cfz_google-analytics_v4` (365 days), `cfzs_google-analytics_v4` (session). Cookie names come from CatWing's live probe of the identical Zaraz GA4 tool and are re-probed after cutover (Release step 9). Every other clause stays verbatim.
- Images (A1): no visible loss at displayed size. Each content image is served as `<picture>` with AVIF (sharp quality 75, effort 6) and WebP (quality 90, effort 6) sources at 1x and 2x of its largest rendered CSS width (capped at source width), explicit `width`/`height`, `loading="lazy" decoding="async"` below the fold, `fetchpriority="high"` + `<link rel="preload" as="image" imagesrcset imagesizes type="image/avif">` for the route's LCP image only. Source = full-size upload when its aspect ratio matches the WordPress derivative within 1%, else the derivative itself; never upscale. `scripts/media.mjs` writes per-variant SSIM (luma, 8x8 blocks, alpha flattened on white) to `content/media.json` and fails below 0.99 for PNG/graphics, 0.98 for photos. Decorative images (leaves, grains, dividers) get `alt=""`; product images get `"<product name> – package"` / `"<product name> – nutrition facts"` (`"… – опаковка"` / `"… – хранителни стойности"`) unless the capture has a better non-empty alt.
- Hero (A4): the home hero becomes an `<img>` (cover-fit, same focal point as the source `background-position`) inside `<picture>` with an art-directed portrait source for `max-width: 767px` (target ≤ 80 KB AVIF) and landscape widths for wider screens. Precedence: the SSIM floors and the 150 KB eager budget are hard; 80 KB is a target. On conflict shrink the mobile crop or its rendered pixel size, or drop the font preload; if it still does not fit, write the Step 9 shortfall report. No parallax and no entrance animation above the fold. Below-the-fold slide-ins: CSS transitions toggled by a tiny IntersectionObserver; content is visible without JS; `prefers-reduced-motion: reduce` disables them. The below-fold parallax (`2021/06/story-home.jpg`) becomes a static background image.
- Widgets (A5): product image carousels = CSS scroll-snap with anchor dots (no JS); product tabs = WAI-ARIA tabs with all panel text in the HTML (all panels visible without JS); legal FAQ accordions = `<details>`; mobile menu = button with `aria-expanded`; Astra/Elementor icon fonts replaced by inline SVG.
- Fonts (A6): self-host `fregat`, `fregat-bold`, `pf-din` from the capture as WOFF2 subset to U+0020-007E, U+00A0-00FF, U+0400-045F, U+2010-2027, U+2116, U+20AC (`subset-font`); `font-display: swap` with metric-adjusted fallbacks (`size-adjust`/`ascent-override`) so swap causes no CLS; preload only the font used by above-the-fold text. Open Sans only if a captured element visibly renders in it; else dropped.
- Budgets (`scripts/check.mjs` over `dist/`, per route): HTML ≤ 30 KB gzip; CSS ≤ 25 KB gzip total; JS ≤ 4 KB gzip total (plus the inline consent script); eager page-owned payload (HTML, CSS, JS, preloaded fonts, non-lazy images, counting the mobile variant of art-directed images) ≤ 150 KB (≈ 0.75 s at Lantern's 1.6 Mbps; the Lighthouse loop remains the real gate); ≤ 20 eager requests; zero external origins in `src`/`href` of loaded resources (outbound `<a>` to Facebook, `mailto:`, `tel:` allowed); no `/cdn-cgi/` reference; every internal link and asset resolves to a `dist/` file; no `wp-content` reference except `/wp-content/uploads/2021/10/CATALOG-NATUR-BG.pdf`, copied byte-identical to that path (A3).
- Sitemaps/robots: `sitemap_index.xml` → `post-sitemap.xml` (9 product URLs) + `page-sitemap.xml` (12 page URLs), the Yoast names, each `<url>` with `xhtml:link` alternates; `sitemap.xml` and `wp-sitemap.xml` are written with the same index content (both URLs serve the index today, and Pages cannot redirect); `robots.txt` = `User-agent: *`, `Disallow:`, `Sitemap: https://natur.bg/sitemap_index.xml`. `404.html` is bilingual, `noindex`, no JSON-LD.
- JSON-LD (one `<script type="application/ld+json">` per route, `<` escaped): Organization `@id https://natur.bg/#organization`, name "NATUR BG LTD", brand "NATUR", logo, `sameAs` the Facebook URL, `email` natur@natur.bg, `telephone` the three numbers; WebSite on `/` and `/bg/` with `inLanguage`; BreadcrumbList on every non-home route (Home › [Products ›] Page) in the route's language.
- Build: Node ≥ 22.19 (`lighthouse@13.5.0` engine floor; `engines` field and CI `node-version: 22`), ES modules; pinned deps `cheerio@1.2.0`, `lightningcss@1.33.0`, `sharp@0.35.5`; dev `esbuild@0.28.2`, `lighthouse@13.5.0`, `playwright-core@1.64.1` (installed Chrome via `channel: "chrome"`, never download browsers), `subset-font@2.9.0`. `npm run build` is offline and reproducible from tracked `content/`, `media/`, `assets/`, `src/`; generated `assets/img/*`, `assets/fonts/*`, `content/media.json` are tracked; fingerprinted output under `/assets/`; `dist/` and `.local/` gitignored. Source files ≤ 300 lines preferred, 500 cap; tests ≤ 800.
- Deploy: `.github/workflows/pages.yml` runs on `pull_request`, push to `main` and `workflow_dispatch`: build job = `npm ci`, `npm run build`, `npm test`, `npm run check`, upload `dist/` as the Pages artifact (skipped on `pull_request`); deploy job (`actions/deploy-pages`) runs only when `github.event_name != 'pull_request' && vars.PAGES_ENABLED == 'true'`. Actions pinned to their current major tags at implementation. Merging to `main` after Release step 3 is a production deploy.
- Source of truth: tracked `content/` + `media/originals/` after capture; WordPress only for the one-time capture and for rollback.
- Backout: `git revert`; production rollback = Release & Recovery rollback block (DNS restore). No env switches.
- Exclusions: never send mail, mutate Cloudflare/DNS/GitHub settings, or enable Pages from code or tests; Release steps are run by the owner (or an agent with the owner's explicit go and credentials, never committed).

### Affected Files

All new (repository is empty except README, `.gitignore`, `.gitattributes`, this plan).
- New:
  - `AGENTS.md` — cap n/a: repo contract (static-only rules, D1-D6, gates, never deploy/cutover unasked, rtk prefix, shared SDLC skills path `D:/_projects/__CAT_WING/catwing/.agents/skills/`).
  - `package.json`, `package-lock.json` — cap n/a.
  - `.github/workflows/pages.yml` — cap n/a.
  - `scripts/capture.mjs` — ~220 / cap 500.
  - `scripts/extract.mjs` — ~250 / cap 500 (one-time capture → `content/`).
  - `scripts/media.mjs` — ~220 / cap 500; `scripts/fonts.mjs` — ~80 / cap 500.
  - `scripts/build.mjs` — ~200 / cap 500; `scripts/lib/html.mjs` — ~250 / cap 500; `scripts/lib/templates.mjs` — ~280 / cap 500 (home, products, product, about, contact, legal, 404); `scripts/lib/seo.mjs` — ~150 / cap 500; `scripts/lib/assets.mjs` — ~120 / cap 500.
  - `scripts/check.mjs` — ~220 / cap 500; `scripts/serve.mjs` — ~90 / cap 500 (Pages-like: directory index, 301 to trailing slash, real 404, gzip).
  - `src/css/site.css` ~280, `src/css/home.css` ~200, `src/css/product.css` ~200, `src/css/pages.css` ~180 — cap 500 each.
  - `src/js/site.mjs` — ~150 / cap 500 (menu, tabs, reveal, consent).
  - `tools/gate.mjs` ~60, `tools/lighthouse.mjs` ~200, `tools/shots.mjs` ~180, `tools/parity.mjs` ~180, `tools/verify-live.mjs` ~160, `tools/psi.mjs` ~100 — cap 500 each; `tools/parity-allow.json` — cap n/a.
  - `content/site.json`, `content/routes.json`, `content/products.json`, `content/media.json`, `content/pages/{en,bg}/*.html` — cap n/a.
  - `media/originals/**` (captured originals, WP path layout), `assets/img/**`, `assets/fonts/**`, `assets/icons/**` — cap n/a.
  - Tests: `tests/content.test.mjs` ~150, `tests/build.test.mjs` ~300, `tests/seo.test.mjs` ~250, `tests/a11y-static.test.mjs` ~220, `tests/media.test.mjs` ~180, `tests/consent.test.mjs` ~150 — cap 800 each.
- Pattern anchors (read-only): `D:/_projects/__CAT_WING/catwing-public-website/scripts/serve.mjs` (Pages-like serving), `scripts/check.mjs` (budget manifest shape), `scripts/lib/seo.mjs` (JSON-LD escaping, robots), `tools/shots.mjs` (screenshots + overflow), `scripts/capture.mjs` (bounded capture: ≤ 2 concurrent, 20 s timeout, 2 retries).

### Test Contract

| Contract clause | Test (file::name) | Type |
|---|---|---|
| 21 frozen routes + 404 built at exact paths | `tests/build.test.mjs::builds every frozen route and a real 404` | integration |
| hreflang/x-default/canonical/og:url absolute, reciprocal, oat unpaired | `tests/seo.test.mjs::alternates are reciprocal and absolute` | behaviour |
| exact titles, unique descriptions ≤ 155, no forbidden claims | `tests/seo.test.mjs::metadata matches D5 contract` | behaviour |
| JSON-LD parses, Organization/WebSite/BreadcrumbList only, no `</` | `tests/seo.test.mjs::structured data contract` | behaviour |
| sitemaps (Yoast names, 9 + 12 URLs, alternates) and robots.txt | `tests/seo.test.mjs::sitemaps and robots` | behaviour |
| one h1, no heading skips, landmarks, html lang, img alt present | `tests/a11y-static.test.mjs::static accessibility rules` | behaviour |
| no generic link text without hidden suffix | `tests/a11y-static.test.mjs::read more links are descriptive` | behaviour |
| D4 colours: no white text on green fills in built CSS | `tests/a11y-static.test.mjs::colour tokens follow option A` | boundary |
| contact: mailto natur@natur.bg + 3 tel links, no 878466854, no form | `tests/build.test.mjs::contact contract` | behaviour |
| consent bar present per language; logic no-throw without zaraz; sync on ready | `tests/consent.test.mjs::consent bar and logic` | behaviour |
| policy pages contain new disclosures, no CF7/WPML/Cookie Notice clauses | `tests/build.test.mjs::policy disclosures` | behaviour |
| every image variant exists, AVIF+WebP pair, width/height, SSIM floors | `tests/media.test.mjs::derived media contract` | integration |
| LCP preload only on routes with hero/LCP image, fetchpriority high | `tests/media.test.mjs::lcp preload contract` | behaviour |
| content inventory: products/pages schema, EU logos kept, empty posts dropped | `tests/content.test.mjs::content model contract` | boundary |
| budgets, no external origins, internal links resolve, PDF path kept | `scripts/check.mjs` via `npm run check` | integration |

15 rows = expected test cases (the last row is the static gate).

### Task Sizing

```json
{
  "schema_version": "task_sizing.v1",
  "external_inputs": ["live natur.bg WordPress (read-only)", "owner decisions D1-D6, A1-A16"],
  "affected_files": ["AGENTS.md", "package.json", "scripts/", "src/", "content/", "media/", "assets/", "tools/", "tests/", ".github/workflows/pages.yml"],
  "tasks": [
    {"id": "scaffold", "outcome": "Pinned Node project with Pages-like local server and gate runner", "depends_on": [], "inputs": ["external:owner decisions D1-D6, A1-A16"], "outputs": ["toolchain"], "files": ["AGENTS.md", "package.json", "package-lock.json", "scripts/serve.mjs", "tools/gate.mjs"], "acceptance": {"command": "npm ci && node scripts/serve.mjs --self-test", "expect": "install succeeds; self-test proves index, 301 to trailing slash, 404 status, gzip"}, "rejects": "Missing slash redirect or 200 for unknown paths"},
    {"id": "capture", "outcome": "Read-only capture of 21 routes, media originals, fonts, PDF and live screenshots", "depends_on": ["scaffold"], "inputs": ["external:live natur.bg WordPress (read-only)", "toolchain"], "outputs": ["capture", "media-originals"], "files": ["scripts/capture.mjs", "media/originals/"], "acceptance": {"command": "node scripts/capture.mjs --verify", "expect": "21 routes 200, every referenced media/font/PDF fetched, 3 widths of live shots per route"}, "rejects": "Any route or referenced file missing"},
    {"id": "content", "outcome": "Tracked content model extracted and curated", "depends_on": ["capture"], "inputs": ["capture"], "outputs": ["content-model"], "files": ["scripts/extract.mjs", "content/", "tests/content.test.mjs"], "acceptance": {"command": "node --test tests/content.test.mjs", "expect": "21 routes, pairs, 5 EN + 4 BG products, EU logos kept, empty posts dropped"}, "rejects": "Route inventory differs from the frozen list"},
    {"id": "media-fonts", "outcome": "Derived AVIF/WebP variants and subset fonts with quality floors", "depends_on": ["content"], "inputs": ["media-originals", "content-model"], "outputs": ["derived-assets"], "files": ["scripts/media.mjs", "scripts/fonts.mjs", "assets/", "content/media.json", "tests/media.test.mjs"], "acceptance": {"command": "node --test tests/media.test.mjs", "expect": "every variant exists with SSIM >= floor and dimensions"}, "rejects": "A variant below its SSIM floor or upscaled"},
    {"id": "site-build", "outcome": "All pages rendered with templates, CSS, JS, SEO, consent, contact and policy contracts", "depends_on": ["media-fonts"], "inputs": ["content-model", "derived-assets"], "outputs": ["dist"], "files": ["scripts/build.mjs", "scripts/lib/", "src/", "tests/build.test.mjs", "tests/seo.test.mjs", "tests/a11y-static.test.mjs", "tests/consent.test.mjs"], "acceptance": {"command": "npm run build && npm test", "expect": "all node tests green"}, "rejects": "Any contract test red"},
    {"id": "proof", "outcome": "Static gate, local Lighthouse 100s, text parity and screenshot review", "depends_on": ["site-build"], "inputs": ["dist", "capture"], "outputs": ["proof-receipts"], "files": ["scripts/check.mjs", "tools/lighthouse.mjs", "tools/parity.mjs", "tools/parity-allow.json", "tools/shots.mjs"], "acceptance": {"command": "node tools/gate.mjs && node tools/lighthouse.mjs --assert && node tools/parity.mjs --assert", "expect": "gate green; every route/form factor median 100 x4; 0 unallowlisted missing text"}, "rejects": "Any category median below 100 or missing text"},
    {"id": "ci-deploy", "outcome": "Pages workflow gating every PR and push; deploy dormant until PAGES_ENABLED", "depends_on": ["proof"], "inputs": ["proof-receipts"], "outputs": ["workflow"], "files": [".github/workflows/pages.yml", "tools/verify-live.mjs", "tools/psi.mjs"], "acceptance": {"command": "gh pr checks task/static-site-launch --repo dzhokn/natur.bg", "expect": "build pass; deploy skipped or absent"}, "rejects": "Deploy runs on a PR or without PAGES_ENABLED"}
  ]
}
```

### Steps

1. Scaffold.
   - Files: `AGENTS.md`, `package.json` (scripts: `capture`, `extract`, `media`, `fonts`, `build`, `test` = `node --test`, `check`, `serve`, `gate`, `lighthouse`, `shots`, `parity`), `scripts/serve.mjs`, `tools/gate.mjs`.
   - Edit: per Hard Contracts (Build). `serve.mjs --port 4190`; `--self-test` boots on a temp dir and asserts the four behaviours. `gate.mjs` = build + test + check with one-line output.
   - Stop: self-test green.
2. Capture (only networked step; run once, before any DNS change).
   - Files: `scripts/capture.mjs`.
   - Edit: fetch the 21 routes (desktop UA), their CSS (reference only, never shipped), every image in `img src/srcset/data-src`, Elementor per-page and `global.css` backgrounds, `uaf.css` fonts, favicons, Yoast og images, and the PDF; resolve full-size originals via WP REST `media` (`?per_page=100&page=1..2`); decode Cloudflare-obfuscated emails in the stored HTML (Contact clause); write raw files to `.local/capture/` and used originals to `media/originals/<WP path>`. Live screenshots via `playwright-core` (`channel: "chrome"`) at 1440/768/390, full page, after scrolling to the end and forcing `.elementor-invisible{visibility:visible!important}` → `.local/capture/shots/`. Bounded per anchor. Writes `.local/capture/manifest.json`.
   - Stop: `--verify` green.
3. Content model.
   - Files: `scripts/extract.mjs`, `content/*`.
   - Edit: cheerio extraction of title/description/canonical/hreflang/og image per route into `routes.json` (then apply the exact titles), products (name, images, info bullets, tab texts, related order) into `products.json`, bespoke page bodies as semantic HTML fragments in `content/pages/{en,bg}/` with text verbatim; nav/footer/contacts/social/consent strings in `site.json`. Remove the empty posts blocks and the CF7 form; keep EU logos. Hand-curate after extraction; `extract.mjs` is not part of the build.
   - Stop: `tests/content.test.mjs` green.
4. Media and fonts.
   - Files: `scripts/media.mjs`, `scripts/fonts.mjs`, outputs.
   - Edit: per Images, Hero, Fonts clauses; rendered widths from the live screenshots' DOM measurements recorded by capture (store per image in `content/media.json`). Produce og JPEGs (1200 px, q85) and favicons.
   - Stop: `tests/media.test.mjs` green; record total bytes before/after in the PR body.
5. Templates and CSS.
   - Files: `scripts/build.mjs`, `scripts/lib/*`, `src/css/*`.
   - Edit: semantic header/nav/main/footer; one external fingerprinted CSS per route (site + template CSS bundled by lightningcss, minified); layout matched to the live screenshots at 1440/768/390.
   - Stop: `npm run build` writes 21 routes + 404 + sitemaps + robots; `tests/build.test.mjs` green.
6. SEO and accessibility.
   - Files: `scripts/lib/seo.mjs`, templates, `tests/seo.test.mjs`, `tests/a11y-static.test.mjs`.
   - Edit: per Head, Titles, JSON-LD, Sitemaps, Colours, visible-copy clauses.
   - Stop: both test files green.
7. Consent, contact, policies, JS.
   - Files: `src/js/site.mjs`, templates, `content/pages/*/` policy fragments, `tests/consent.test.mjs`.
   - Edit: first verify the Zaraz Consent API names (`zaraz.consent.setAll`, `getAll`, `sendQueuedEvents`, `zarazConsentAPIReady`) in Cloudflare docs; stop if absent. Then per Consent, Contact, Policies, Widgets clauses; JS bundled/minified by esbuild.
   - Stop: tests green; JS ≤ 4 KB gzip.
8. Static gate and proof tools.
   - Files: `scripts/check.mjs`, `tools/lighthouse.mjs`, `tools/parity.mjs`, `tools/parity-allow.json`, `tools/shots.mjs`.
   - Edit: `check.mjs` per Budgets (writes `dist/build-manifest.json`). `lighthouse.mjs` serves `dist/` via `serve.mjs` (gzip), runs Lighthouse 13.5.0 node API with installed Chrome, mobile default + `--preset desktop`, 3 runs per route, writes `.local/reports/lighthouse/<build-hash>.json` with medians and each run's LCP node, read from `audits['lcp-breakdown-insight'].details` (node `selector`/`path`; Lighthouse 13 has no `largest-contentful-paint-element` audit), `--assert` fails on any median < 100, a missing LCP node, or an LCP node inside the consent bar's root selector, `--routes` for subsets. `parity.mjs` compares normalized visible text of captured main content vs built `<main>`; allowlist entries need a reason (form fields, empty posts, hidden suffixes, consent bar, policy clauses replaced). `shots.mjs` screenshots `dist/` at 1440/768/390/320 and writes `.local/reports/shots/index.html` side by side with the live captures; fails on horizontal overflow.
   - Stop: `node tools/gate.mjs`, `node tools/parity.mjs --assert` green; review the shots sheet and fix layout gaps.
9. Lighthouse 100 loop.
   - Run `node tools/lighthouse.mjs --assert` (detached; see Proof budget). For any miss, fix the cause shown by the failing audit. Only if mobile FCP/LCP keeps the score below 100 after LCP image/font fixes, trial inlining the route CSS: 3 warmups + 5 interleaved pairs on the failing routes, keep only if the median LCP improves beyond the IQR. Record every trial (kept or refuted) in the PR body.
   - Stop: all 21 routes x 2 form factors median 100 in all four categories, or a written shortfall report with numbers (owner decides whether to cut over).
10. CI workflow.
   - Files: `.github/workflows/pages.yml`, `tools/verify-live.mjs`, `tools/psi.mjs` (PSI API medians; reads `PSI_API_KEY` from env, never committed; without a key prints the pagespeed.web.dev URLs).
   - `verify-live.mjs` default mode = Release step 8 checks (routes, canonicals, 404, redirect hops: `http://natur.bg/` 1, `https://www.natur.bg/x/` 1, `/about-us` 1, `http://www.natur.bg/` ≤ 2, all ending on `https://natur.bg/…`, `/assets/*` HIT on second request, no WordPress `link: …/wp-json/` header, literal `mailto:natur@natur.bg` present and `email-protection` absent, `_dc-mx`/`mail`/`webmail` → 91.196.124.63). `--consent` mode copies `collectFacts` from `D:/_projects/__CAT_WING/catwing-public-website/tools/zaraz.mjs`: headless Chrome with the `zarazDebug` cookie (key from env `ZARAZ_DEBUG_KEY`, owner-held, never committed) and a browser `Accept: text/html` header; it counts server-side `google-analytics.com/g/collect` entries in `/cdn-cgi/zaraz/` responses and lists cookies.
   - Stop: push the branch, open a PR, `gh pr checks task/static-site-launch --repo dzhokn/natur.bg` shows build pass and deploy skipped or absent; merge to `main` only on the owner's go for cutover.

## Testing

- Acceptance criteria:
  - `curl -sI http://127.0.0.1:4190/about-us` → `301` to `/about-us/`; `/nope/` → `404` with the bilingual page.
  - Every route: Lighthouse medians 100/100/100/100 mobile and desktop (local), then PSI 100 on production.
  - Zaraz sends GA4 server-side, so browser requests prove nothing: with the debug key, `verify-live --consent` must count 0 server-side `g/collect` entries before any click and after "Decline" (persisting across two pages), and exactly 1 after "Allow" (Release step 9).
  - Failure case: deleting one product image variant makes `tests/media.test.mjs` fail; adding `tel:+359878466854` makes `tests/build.test.mjs` fail; a white-on-green rule makes `tests/a11y-static.test.mjs` fail.
- Focused tests:
  - `node --test` → all 14 node contract cases green (the 15th Test Contract row is `npm run check`).
  - `node tools/gate.mjs` → "gate ok" with build manifest, zero budget violations.
  - `node tools/parity.mjs --assert` → 0 unallowlisted missing text segments across 21 routes.
- Broader gates: None (single small repo; the gate is the full suite).
- Proof budget:
  - `tools/lighthouse.mjs` full run = 21 routes x 2 form factors x 3 runs ≈ 126 runs ≈ 30-40 min: start it in the background (`run_in_background` / a detached shell) and check the receipt next turn; iterate with `--routes` subsets meanwhile.
- Manual smoke / data proof:
  - Owner reviews `.local/reports/shots/index.html` and the media contact sheet before cutover (optional, D6).
  - Rich Results Test on `/` and one product after cutover: 0 errors.

## Release & Recovery

Run by the owner (or an agent with the owner's explicit go and dashboard/API access), after the gates pass and the PR is merged. The apex stays Cloudflare-proxied for the whole cutover, matching the owner's other Pages sites (`build_type: legacy`, no GitHub certificate, `https_enforced: false`, served through Cloudflare): Cloudflare terminates TLS with its edge certificate and connects to GitHub in SSL **Full** (encrypted, origin certificate not validated). No DNS-only window, no GitHub certificate dependency. Zaraz goes on only after the DNS switch, otherwise it would inject GA into WordPress pages that still run gtag. A failed check means stop and run that step's rollback; PSI below 100 means fix forward, not roll back.

1. Backup state.
   - Command: dashboard → natur.bg → DNS → Export (BIND) to `.local/release/natur.bg-dns-<ts>.txt`; screenshot or note to `.local/release/state-<ts>.md`: apex and `www` records (type, content, proxy), whether AAAA records exist, SSL/TLS mode, APO on/off (Speed → Optimization → APO), Email Address Obfuscation (Scrape Shield), existing Rules (Redirect, Configuration, Cache, Page Rules), Zaraz tools and consent settings.
   - Expected: `_dc-mx`, `mail`, `webmail`, `cpanel`, `ftp` → 91.196.124.63; the apex origin IP recorded.
   - Failure: export missing the apex origin → stop (no rollback target).
2. Pre-create Cloudflare rules (safe while WordPress still serves).
   - Command (dashboard): Single Redirect `http.host eq "www.natur.bg"` → `concat("https://natur.bg", http.request.uri.path)` 301, preserve query; Configuration Rule `http.host eq "natur.bg"` → SSL: Full, Email Obfuscation: Off; Cache Rule `http.host eq "natur.bg" and starts_with(http.request.uri.path, "/assets/")` → eligible for cache, Edge TTL 1 year, Browser TTL 1 year.
   - Expected: `curl -sI https://www.natur.bg/x/` → 301 `location: https://natur.bg/x/` without `x-redirect-by: WordPress`; WordPress pages show literal `natur@natur.bg`.
   - Rollback: delete the three rules.
3. Enable GitHub Pages with the custom domain before the first deploy.
   - Command: `gh api -X POST repos/dzhokn/natur.bg/pages -f build_type=workflow`; `gh api -X PUT repos/dzhokn/natur.bg/pages -f cname=natur.bg`; `gh variable set PAGES_ENABLED --body true --repo dzhokn/natur.bg`; `gh workflow run pages.yml --repo dzhokn/natur.bg --ref main`.
   - Expected: run green including the deploy job; `gh api repos/dzhokn/natur.bg/pages --jq .cname` = `natur.bg` (GitHub's DNS check may warn because the apex is proxied; same as the owner's other sites). Smoke GitHub before any DNS change: `curl -sk --resolve natur.bg:443:185.199.108.153 -o /dev/null -w '%{http_code}' https://natur.bg/about-us/` → `200` and the same for `/nope/` → `404`; stop before step 4 otherwise.
   - Rollback: `gh variable set PAGES_ENABLED --body false --repo dzhokn/natur.bg`; `gh api -X DELETE repos/dzhokn/natur.bg/pages`.
4. Switch the apex to GitHub Pages, proxied.
   - Command (dashboard): replace the apex A with `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` and add AAAA `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`, all proxied (orange), TTL Auto. Leave `www` and every other record untouched.
   - Expected within 5 minutes: `curl -sI https://natur.bg/` → 200 with `x-github-request-id`; `nslookup _dc-mx.f784b4c3daed.natur.bg 1.1.1.1` → 91.196.124.63.
   - Rollback: restore the apex A from the step 1 export, delete the four GitHub AAAA unless step 1 recorded AAAA (then restore those), keep proxy state as recorded.
5. Post-switch cleanup.
   - Command (dashboard): Single Redirects (301): `/feed*`, `/comments/feed*` → `https://natur.bg/`; `/bg/feed*` → `https://natur.bg/bg/`; `/category/*` → `https://natur.bg/products/`; `/bg/category/*` → `https://natur.bg/bg/produkti/`. If step 1 recorded APO on: disable APO. Caching → Purge Everything.
   - Expected: `curl -sI https://natur.bg/feed/` → 301 to `/`; no response carries `link: <https://natur.bg/wp-json/>`.
   - Rollback: delete these redirects; re-enable APO only if step 1 recorded it on; Purge Everything.
6. Zaraz GA4 with consent.
   - Command (dashboard → Zaraz): add tool Google Analytics 4, Measurement ID `G-BWBK437736`, action Pageview on trigger Pageview; Consent → enable, one purpose "Analytics" assigned to GA4, automatic consent modal off (the site bar drives the API); set a Debug Key (owner keeps it; export it as `ZARAZ_DEBUG_KEY` for step 9 only).
   - Expected: page HTML contains the Zaraz loader for a browser `Accept: text/html` request.
   - Rollback: restore the Zaraz state recorded in step 1 (remove the GA4 tool, consent purpose and debug key if they were absent).
7. Search Console.
   - Command: owner submits `https://natur.bg/sitemap_index.xml` (Domain property via Cloudflare DNS TXT if not yet verified).
   - Failure: none blocking; follow-up F5.
8. Production crawl.
   - Command: `node tools/verify-live.mjs --origin https://natur.bg`.
   - Expected: all checks listed in Step 10 green.
   - Failure: content/link defects → fix forward via PR; mail DNS or WordPress headers → full rollback.
9. Consent and policy facts.
   - Command: `ZARAZ_DEBUG_KEY=… node tools/verify-live.mjs --consent --origin https://natur.bg`.
   - Expected: 0 server-side `g/collect` before a click and after Decline (two pages), exactly 1 after Allow; cookie names equal the policy pages.
   - Failure: GA fires without consent → remove the GA4 tool immediately (step 6 rollback), then fix; cookie names differ → patch policy clauses and redeploy.
10. PSI acceptance.
   - Command: `node tools/psi.mjs --origin https://natur.bg --runs 3` (all 21 routes, needs `PSI_API_KEY`) or pagespeed.web.dev manually for `/`, `/bg/`, `/products/`, `/bg/bio-palnozarnesti-soleti-ot-spelta/`, `/about-us/`, `/contact/`.
   - Expected: medians 100 in all four categories, mobile and desktop.
   - Failure: fix forward and re-run; report numbers to the owner.

Full rollback (minutes, any time after step 4): step 6, 5 and 4 rollbacks in that order, then `PAGES_ENABLED=false`, delete the step 2 Configuration Rule (Email Obfuscation and SSL return to the zone defaults recorded in step 1) and Cache Rule, Purge Everything. The `www` redirect may stay (it equals WordPress behaviour). WordPress at SuperHosting stays untouched for at least 14 days (A15); its origin certificate is valid for natur.bg and www until 2026-11-30.

## Risks

- Mobile Performance stays below 100 (hero LCP, fonts): art-directed ≤ 80 KB AVIF hero with preload, `fetchpriority`, swap fonts with matched fallbacks, step 9 trial protocol; report the shortfall with numbers rather than cut over silently. CatWing's comparable build reached 99, not 100.
- Cached WordPress HTML survives the origin change (APO on or edge cache): Purge Everything and APO off if recorded on (Release step 5); `verify-live` fails on WordPress headers. APO state is unproven from outside (`cf-cache-status: DYNAMIC`, no `cf-apo-via`), so step 1 records it.
- Cloudflare-to-GitHub TLS is encrypted but unauthenticated (SSL Full, no GitHub certificate): same as the owner's other Pages sites; it avoids a DNS-only certificate window and a proxied renewal that could fail around day 90 and return 526.
- Email Obfuscation rewrites `natur@natur.bg` and injects a script: Configuration Rule turns it off for natur.bg (Release step 2); capture decodes the obfuscated values; `verify-live` asserts the literal mailto.
- Mail breaks: only apex records change (plus the `www` redirect rule); Release steps 4 and 8 verify `_dc-mx`/`mail`/`webmail`; no test mail is sent by agents.
- Zaraz Consent API differs from docs: Step 7 stop gate; fallback is Zaraz's own consent modal restyled minimal, re-measured.
- Consent proof false-passes because GA4 is sent server-side by Zaraz: proof counts server-side `g/collect` with the debug key (Release step 9), never browser requests.
- Local Lighthouse differs from PSI (CPU, location): PSI on production is the acceptance; local 100 is the entry gate.
- Hotlinked `/wp-content/uploads/` images from third parties break: accepted (A3); follow-up F6 checks 404s.
- Public repo exposes commercial font files: accepted by the owner (D1); fonts are subset.
- Google crawls during cutover: accepted (D6); URLs are unchanged, so no redirects are needed.

## Reviews

- Self-review: done 2026-10-25 against the plan-create lens (evidence, alternatives, commands, secrets, rollback, stop gates).
- Plan-review: round 1 READY_WITH_EDITS (4 High: TLS/certificate cutover, Email Obfuscation, server-side consent proof, repo/CI bootstrap; 2 Medium: www redirect premise, per-step rollback; Lows), all patched; round 2 READY_WITH_EDITS confirmed every round-1 fix and raised 5 Low (PR-checks command, LCP node source, image limit precedence, pre-DNS GitHub smoke, wording/hop list), all patched; reviewer stated no further round needed.
- Refuted pre-registered metrics: None.
- Open findings:
  - None.

## Completion Contract

This repository has no `tools/plans/contract-parser.mjs`; closure runs these commands by hand from the repo root.

```yaml
completion_contract:
  schema_version: plan_completion_contract.v1
  freeze_at_status: READY_FOR_IMPLEMENTATION
  required_assertions:
    - id: gate_green
      type: command
      command: "node tools/gate.mjs"
    - id: lighthouse_all_100
      type: command
      command: "node tools/lighthouse.mjs --assert"
    - id: text_parity
      type: command
      command: "node tools/parity.mjs --assert"
    - id: workflow_present
      type: file_changed
      path: ".github/workflows/pages.yml"
```

## Next Actions

- Follow-ups (separate plans): F1 Git-based CMS at `/admin/` for NATUR staff; F2 BG oat-turmeric page; F3 B2B content (certifications, private label, MOQ, export markets: owner facts); F4 prices or where-to-buy (enables Product rich results); F5 Search Console domain property + `PSI_API_KEY`; F6 404 log review for old `/wp-content/uploads/` paths.
- After READY: `git switch -c task/static-site-launch`, then `/implement .agents/plans/active/2026_10_25_static_site_launch.md` in this session; resume line `cd D:/_projects/natur.bg && claude "/implement .agents/plans/active/2026_10_25_static_site_launch.md"`.

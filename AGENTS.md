# natur.bg — static site

Static rebuild of https://natur.bg (NATUR BG LTD, organic wholegrain sticks). Plain Node ESM, no framework.
Built pages are static only: no CMS, no server code, no Workers, no trackers or third-party origins in built pages.

## Decisions (owner, 2026-10-25)

- D1: public repo, GitHub Pages behind Cloudflare.
- D2: GA4 through Cloudflare Zaraz, behind a minimal consent bar (no cookie before consent).
- D3: direct email and phone numbers, no contact form.
- D4: colour option A.
- D5: BG pages target Bulgarian shoppers, EN pages target trade buyers, equal weight.
- D6: straight to production, no preview.

## Layout

- `scripts/` capture, extract, media, fonts, build, check, serve. `tools/` gate, lighthouse, parity, shots.
- `content/` tracked content model. `media/originals/` tracked byte-identical uploads. `dist/` and `.local/` are gitignored.
- `.local/capture/` holds the raw live capture (HTML, CSS, shots, manifest). Capture is read-only against natur.bg.

## Gates

- `node tools/gate.mjs` (build, test, check).
- `node tools/lighthouse.mjs --assert` (Chrome runs with `--disable-gpu-vsync --disable-frame-rate-limit` to avoid a Windows headless frame stall). It measures over HTTP/2+TLS for production protocol parity (`--h1` for HTTP/1.1); home mobile 2026-10-25: h1 97 / ~2490 ms LCP vs h2 100 / ~1450 ms (trial notes in local-only `.local/reports/trials/h2-vs-h1.md`).
- `node tools/parity.mjs --assert`.

## Never

- Deploy, enable Pages, change DNS or Cloudflare settings, or cut over unless the owner asks.
- Touch mail DNS: `_dc-mx`, `mail`, `webmail`, `cpanel`, `ftp`.
- Commit secrets (`PSI_API_KEY`, `ZARAZ_DEBUG_KEY` stay in env).

## Working rules

- Prefix shell commands with `rtk`. Use forward slashes in Git Bash.
- Pin dependencies exactly. Never download Playwright browsers; use installed Chrome (`channel: "chrome"`).
- Shared SDLC skills live at `D:/_projects/__CAT_WING/catwing/.agents/skills/`.

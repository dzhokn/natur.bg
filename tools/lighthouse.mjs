// Lighthouse loop over dist/ with the installed Chrome (never downloads a browser).
//   node tools/lighthouse.mjs [--routes /,/bg/] [--runs 3] [--form mobile|desktop] [--h1] [--assert] [--dry-run]
// Defaults: all 21 routes, mobile + desktop, 3 runs each, four categories, one fresh Chrome per run.
// Served over HTTP/2+TLS (production protocol) unless --h1.
// Report: .local/reports/lighthouse/<build-hash>.json. --assert exits 1 on any median < 100, a run
// without an LCP node, or an LCP node inside the consent bar.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../scripts/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
// The vsync/frame-rate flags: headless Chrome on Windows intermittently paints nothing for ~1 s after
// first commit, which lowers Speed Index (see .local/reports/trials/h2-vs-h1.md).
const CHROME_FLAGS = ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--ignore-certificate-errors', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const allRoutes = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/routes.json'), 'utf8')).routes.map((r) => r.path);
const routes = option('--routes')?.split(',').filter(Boolean) ?? allRoutes;
const forms = option('--form') ? [option('--form')] : ['mobile', 'desktop'];
const runs = Number(option('--runs') ?? 3);
const protocol = flag('--h1') ? 'h1' : 'h2';

const unknown = routes.filter((route) => !allRoutes.includes(route));
if (unknown.length || forms.some((f) => !['mobile', 'desktop'].includes(f)) || !(runs >= 1)) {
  console.error(`bad arguments: routes=${unknown.join(',') || 'ok'} form=${forms} runs=${runs}`);
  process.exit(1);
}

function buildHash() {
  const manifest = path.join(DIST, 'build-manifest.json');
  if (fs.existsSync(manifest)) return crypto.createHash('sha256').update(fs.readFileSync(manifest)).digest('hex');
  const files = fs.existsSync(DIST)
    ? fs.readdirSync(DIST, { recursive: true }).map((f) => String(f).replaceAll('\\', '/')).sort()
    : [];
  return crypto.createHash('sha256').update(files.join('\n')).digest('hex');
}

if (flag('--dry-run')) {
  console.log(`lighthouse plan: ${routes.length} routes x ${forms.join('+')} x ${runs} runs = ${routes.length * forms.length * runs} runs`);
  console.log(`categories: ${CATEGORIES.join(', ')}; report .local/reports/lighthouse/${buildHash().slice(0, 12)}….json`);
  for (const route of routes) console.log(`${route} ${forms.join(',')}`);
  process.exit(0);
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error('Chrome not found; set CHROME_PATH');
  return found;
}

const median = (values) => {
  const sorted = values.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** First `type: "node"` entry anywhere in the LCP breakdown insight details. */
function findNode(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'node') return { selector: value.selector ?? '', path: value.path ?? '', snippet: value.snippet ?? '' };
  for (const child of Object.values(value)) {
    const hit = findNode(child);
    if (hit) return hit;
  }
  return null;
}

function summarize(lhr) {
  const audits = lhr.audits;
  const score = (id) => Math.round((lhr.categories[id]?.score ?? 0) * 100);
  const failing = Object.entries(audits)
    .filter(([, a]) => a.score !== null && a.score < 1 && !['notApplicable', 'informative', 'manual'].includes(a.scoreDisplayMode))
    .map(([id]) => id);
  return {
    scores: { performance: score('performance'), accessibility: score('accessibility'), bestPractices: score('best-practices'), seo: score('seo') },
    lcpMs: audits['largest-contentful-paint']?.numericValue ?? null,
    cls: audits['cumulative-layout-shift']?.numericValue ?? null,
    tbtMs: audits['total-blocking-time']?.numericValue ?? null,
    fcpMs: audits['first-contentful-paint']?.numericValue ?? null,
    lcpNode: findNode(audits['lcp-breakdown-insight']?.details),
    failingAudits: failing,
  };
}

async function oneRun(lighthouse, chromeLauncher, desktopConfig, url, form) {
  const chrome = await chromeLauncher.launch({ chromePath: chromePath(), chromeFlags: CHROME_FLAGS });
  try {
    const result = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: CATEGORIES },
      form === 'desktop' ? desktopConfig : undefined);
    return summarize(result.lhr);
  } finally {
    await chrome.kill();
  }
}

const inConsent = (node) => /(^|[\s.#>])consent\b/.test(`${node.selector} ${node.path}`) || /class="consent\b/.test(node.snippet);

const { default: lighthouse } = await import('lighthouse');
const { default: desktopConfig } = await import('lighthouse/core/config/desktop-config.js');
const chromeLauncher = await import('chrome-launcher');
const server = await startServer({ root: DIST, port: 0, h2: protocol === 'h2' });
const report = { builtAt: new Date().toISOString(), protocol, hash: buildHash(), runsPerRoute: runs, results: [] };
const problems = [];
try {
  for (const route of routes) {
    for (const form of forms) {
      const entry = { route, form, runs: [] };
      for (let n = 1; n <= runs; n += 1) {
        const run = await oneRun(lighthouse, chromeLauncher, desktopConfig, server.url + route, form);
        entry.runs.push(run);
        const s = run.scores;
        console.log(`${route} ${form} run ${n}/${runs} P${s.performance} A${s.accessibility} BP${s.bestPractices} SEO${s.seo} LCP ${Math.round(run.lcpMs ?? 0)}ms`);
        if (!run.lcpNode) problems.push(`${route} ${form} run ${n}: no LCP node`);
        else if (inConsent(run.lcpNode)) problems.push(`${route} ${form} run ${n}: LCP node is inside .consent (${run.lcpNode.selector})`);
      }
      entry.median = {
        performance: median(entry.runs.map((r) => r.scores.performance)),
        accessibility: median(entry.runs.map((r) => r.scores.accessibility)),
        bestPractices: median(entry.runs.map((r) => r.scores.bestPractices)),
        seo: median(entry.runs.map((r) => r.scores.seo)),
        lcpMs: median(entry.runs.map((r) => r.lcpMs)),
        cls: median(entry.runs.map((r) => r.cls)),
        tbtMs: median(entry.runs.map((r) => r.tbtMs)),
        fcpMs: median(entry.runs.map((r) => r.fcpMs)),
      };
      for (const [name, value] of Object.entries(entry.median).slice(0, 4)) {
        if (value < 100) problems.push(`${route} ${form}: median ${name} ${value} < 100`);
      }
      report.results.push(entry);
    }
  }
} finally {
  await server.close();
}

const outDir = path.join(ROOT, '.local/reports/lighthouse');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${report.hash}.json`), `${JSON.stringify(report, null, 2)}\n`);

console.log(`\nprotocol ${protocol}`);
console.log('route'.padEnd(45) + 'form'.padEnd(9) + 'P    A    BP   SEO  LCP ms');
for (const { route, form, median: m } of report.results) {
  console.log(`${route.padEnd(45)} ${form.padEnd(8)}${[m.performance, m.accessibility, m.bestPractices, m.seo].map((v) => String(v).padEnd(5)).join('')}${Math.round(m.lcpMs ?? 0)}`);
}
for (const problem of problems) console.log(`problem: ${problem}`);
if (flag('--assert') && problems.length) {
  console.log(`lighthouse FAIL ${problems.length}`);
  process.exit(1);
}
console.log(problems.length ? `lighthouse done with ${problems.length} problems (no --assert)` : 'lighthouse ok');

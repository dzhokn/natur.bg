// PageSpeed Insights loop (release step 10). Planner-only: it calls Google against --origin.
//   node tools/psi.mjs [--origin https://natur.bg] [--runs 3] [--routes /,/bg/] [--dry-run]
// With PSI_API_KEY in the environment (all routes in content/routes.json unless --routes): sequential API calls, medians per route/strategy, report in
// .local/reports/psi/<ISO>.json, exit 1 when any median < 100. Without a key: prints analysis URLs for 6 representative routes, exit 0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const origin = (option('--origin') ?? 'https://natur.bg').replace(/\/$/, '');
const runs = Number(option('--runs') ?? 3);
const REPRESENTATIVE = ['/', '/bg/', '/products/', '/bg/bio-palnozarnesti-soleti-ot-spelta/', '/about-us/', '/contact/'];
const key = process.env.PSI_API_KEY;
const allRoutes = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'content/routes.json'), 'utf8')).routes.map((route) => route.path);
const routes = option('--routes')?.split(',').filter(Boolean) ?? (key ? allRoutes() : REPRESENTATIVE);
const STRATEGIES = ['mobile', 'desktop'];
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

if (!(runs >= 1) || !routes.length) {
  console.error(`bad arguments: runs=${runs} routes=${routes.join(',')}`);
  process.exit(1);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const requestUrl = (route, strategy, apiKey) => {
  const query = new URLSearchParams({ url: origin + route, strategy });
  CATEGORIES.forEach((category) => query.append('category', category));
  query.append('key', apiKey);
  return `${API}?${query}`;
};

if (flag('--dry-run')) {
  console.log(`origin ${origin} runs ${runs} key ${key ? 'set' : 'missing'}`);
  for (const route of routes) {
    for (const strategy of STRATEGIES) {
      console.log(`plan ${runs}x ${requestUrl(route, strategy, 'PSI_API_KEY')}`);
    }
  }
  process.exit(0);
}

if (!key) {
  console.log('PSI_API_KEY not set; open these in a browser:');
  routes.forEach((route) => console.log(`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(origin + route)}`));
  process.exit(0);
}

const results = [];
let below = 0;
for (const route of routes) {
  for (const strategy of STRATEGIES) {
    const scores = Object.fromEntries(CATEGORIES.map((category) => [category, []]));
    const lcp = [];
    for (let run = 0; run < runs; run += 1) {
      // Only the status is reported on failure: the request URL carries the key.
      const response = await fetch(requestUrl(route, strategy, key));
      if (!response.ok) {
        console.error(`PSI ${route} ${strategy}: HTTP ${response.status}`);
        process.exit(1);
      }
      const { lighthouseResult } = await response.json();
      for (const category of CATEGORIES) scores[category].push(Math.round(lighthouseResult.categories[category].score * 100));
      lcp.push(lighthouseResult.audits['largest-contentful-paint'].numericValue);
    }
    const medians = Object.fromEntries(CATEGORIES.map((category) => [category, median(scores[category])]));
    const lcpMs = Math.round(median(lcp));
    if (Object.values(medians).some((value) => value < 100)) below += 1;
    results.push({ route, strategy, medians, lcpMs, scores });
    console.log(`${route} ${strategy} perf ${medians.performance} a11y ${medians.accessibility} bp ${medians['best-practices']} seo ${medians.seo} lcp ${lcpMs}ms`);
  }
}

const dir = path.join(ROOT, '.local/reports/psi');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(file, JSON.stringify({ origin, runs, results }, null, 2));
console.log(`report ${path.relative(ROOT, file)}`);
process.exit(below ? 1 : 0);

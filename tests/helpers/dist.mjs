import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DIST } from '../../scripts/lib/assets.mjs';
import { buildInputHash } from '../../scripts/lib/inputs.mjs';

export function requireFreshDist() {
  let built = null;
  try {
    built = readFileSync(path.join(DIST, '.build-input'), 'utf8').trim();
  } catch {}
  if (built !== buildInputHash()) throw new Error('dist/ is stale or missing: run npm run build');
}

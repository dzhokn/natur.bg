import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './assets.mjs';

const walk = (rel) =>
  readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((e) => {
    const child = `${rel}/${e.name}`;
    return e.isDirectory() ? walk(child) : [child];
  });

// Content, sources and build scripts by content; assets/ by file list only (binaries are copied).
export function buildInputHash() {
  const hash = createHash('sha256');
  for (const rel of ['content', 'src', 'scripts'].flatMap(walk).sort()) {
    hash.update(`${rel}\0`).update(readFileSync(path.join(ROOT, rel))).update('\0');
  }
  for (const rel of walk('assets').sort()) hash.update(`${rel}\0`);
  return hash.digest('hex');
}

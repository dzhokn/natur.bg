// Default gate: build, test, check in order; stops at the first failure.
//   node tools/gate.mjs
// Prints exactly one line: `gate ok (<ms> ms)` or `gate FAIL <step>: <last error line>`.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEPS = ['build', 'test', 'check'];
const NPM_NOISE = /^npm (?:error|ERR!|warn)\b|^>\s|^Node\.js v|^at\s|^\^*$/i;

const started = Date.now();
for (const step of STEPS) {
  const result = spawnSync('npm', ['run', step], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const lines = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const useful = [...lines].reverse().filter((line) => !NPM_NOISE.test(line));
    const last = useful.find((line) => /error|cannot|fail|not ok/i.test(line)) ?? useful[0] ?? 'no output';
    console.log(`gate FAIL ${step}: ${last}`);
    process.exit(1);
  }
}
console.log(`gate ok (${Date.now() - started} ms)`);

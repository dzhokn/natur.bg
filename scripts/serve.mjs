// Pages-like local static server: trailing-slash routing, gzip for text,
// correct content types and a real 404. No SPA fallback. `h2: true` serves HTTP/2 over a
// self-signed localhost cert (HTTP/1.1 still accepted) to match the production protocol.

import fs from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};
const GZIP = /\b(?:text\/|application\/(?:xml|json)|image\/svg)/;

const CERT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.local/certs');

const isFile = (file) => fs.existsSync(file) && fs.statSync(file).isFile();

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Maps a URL path to a file under root, or null; traversal outside root is refused. */
function resolveFile(root, pathname) {
  const clean = decode(pathname);
  if (clean === null || clean.includes('\0')) return null;
  const file = path.join(root, clean.endsWith('/') ? `${clean}index.html` : clean);
  const relative = path.relative(root, file);
  return !relative.startsWith('..') && !path.isAbsolute(relative) && isFile(file) ? file : null;
}

/** Self-signed 127.0.0.1 key/cert under .local/certs (gitignored), generated on first use. */
function localCert() {
  const keyFile = path.join(CERT_DIR, 'localhost-key.pem');
  const certFile = path.join(CERT_DIR, 'localhost-cert.pem');
  if (!isFile(keyFile) || !isFile(certFile)) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const cmd = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyFile, '-out', certFile];
    const run = spawnSync('openssl', cmd, { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8' });
    if (run.error || run.status !== 0) {
      throw new Error(`h2 needs openssl; failed: openssl ${cmd.join(' ')}${run.error ? ` (${run.error.message})` : `\n${run.stderr}`}`);
    }
  }
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
}

export function startServer({ root = 'dist', port = 4190, host = '127.0.0.1', h2 = false } = {}) {
  const base = path.resolve(root);
  const handler = (req, res) => {
    const [pathname, ...query] = (req.url ?? '/').split('?');
    const search = query.length ? `?${query.join('?')}` : '';
    const clean = decode(pathname);
    if (clean !== null && !clean.endsWith('/') && !resolveFile(base, pathname) && resolveFile(base, `${pathname}/`)) {
      res.writeHead(301, { location: `${pathname}/${search}`, 'cache-control': 'no-cache', 'content-length': '0' });
      res.end();
      return;
    }
    const file = resolveFile(base, pathname);
    const target = file ?? path.join(base, '404.html');
    let body = Buffer.from('404 Not Found');
    let type = 'text/plain; charset=utf-8';
    if (isFile(target)) {
      body = fs.readFileSync(target);
      type = TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
    }
    const headers = { 'content-type': type, 'cache-control': 'no-cache' };
    if (file && clean.startsWith('/assets/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
    if (GZIP.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      body = zlib.gzipSync(body);
      headers['content-encoding'] = 'gzip';
      headers.vary = 'Accept-Encoding';
    }
    headers['content-length'] = String(body.length);
    res.writeHead(file ? 200 : 404, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const server = h2 ? http2.createSecureServer({ ...localCert(), allowHTTP1: true }, handler) : http.createServer(handler);
  const sessions = new Set();
  if (h2) {
    server.on('session', (session) => {
      sessions.add(session);
      session.on('close', () => sessions.delete(session));
    });
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const url = `${h2 ? 'https' : 'http'}://${host}:${server.address().port}`;
      resolve({
        url,
        close: () => new Promise((done) => {
          server.close(done);
          if (h2) for (const session of sessions) session.destroy();
          else server.closeAllConnections();
        }),
      });
    });
  });
}

async function selfTest() {
  const failures = [];
  await selfTestProtocol(false, failures);
  await selfTestProtocol(true, failures);
  if (failures.length) {
    console.error(`self-test FAIL: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('self-test ok');
}

async function selfTestProtocol(h2, failures) {
  const label = h2 ? 'h2' : 'h1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natur-serve-'));
  fs.mkdirSync(path.join(dir, 'about-us'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>home</title>');
  fs.writeFileSync(path.join(dir, 'about-us', 'index.html'), '<!doctype html><title>about</title>');
  fs.writeFileSync(path.join(dir, '404.html'), '<!doctype html><title>missing page</title>');
  fs.writeFileSync(path.join(dir, 'site.css'), 'body{margin:0}');
  const { url, close } = await startServer({ root: dir, port: 0, h2 });
  const expect = (name, ok) => {
    if (!ok) failures.push(`${label} ${name}`);
  };
  const get = (pathname, headers = {}) => {
    if (!h2) {
      return new Promise((resolve, reject) => {
        http.get(url + pathname, { headers }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        }).on('error', reject);
      });
    }
    return new Promise((resolve, reject) => {
      const client = http2.connect(url, { rejectUnauthorized: false });
      client.on('error', reject);
      const req = client.request({ ':path': pathname, ...headers });
      const chunks = [];
      let responseHeaders;
      req.on('response', (h) => { responseHeaders = h; });
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        client.close();
        resolve({ status: responseHeaders[':status'], headers: responseHeaders, body: Buffer.concat(chunks) });
      });
      req.on('error', reject);
      req.end();
    });
  };
  try {
    const home = await get('/');
    expect('/ 200 html', home.status === 200 && home.headers['content-type'].startsWith('text/html'));
    const moved = await get('/about-us?a=1');
    expect('/about-us 301', moved.status === 301 && moved.headers.location === '/about-us/?a=1');
    const missing = await get('/nope/');
    expect('/nope/ 404 body', missing.status === 404 && missing.body.toString().includes('missing page'));
    const zipped = await get('/', { 'accept-encoding': 'gzip' });
    expect('gzip html', zipped.headers['content-encoding'] === 'gzip');
  } finally {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
  };
  if (process.argv.includes('--self-test')) {
    await selfTest();
  } else {
    const root = arg('--root', 'dist');
    const { url } = await startServer({ root, port: Number(arg('--port', '4190')), host: arg('--host', '127.0.0.1'),
      h2: process.argv.includes('--h2') });
    console.log(`[serve] ${url} -> ${path.resolve(root)}`);
  }
}

#!/usr/bin/env node
/**
 * Static SPA server for the Expo web export.
 *
 * `web.output` is "single", so every route is served by the one index.html and
 * resolved client-side. Anything not on disk falls back to it -- without that,
 * a deep link like /host/dj 404s. See design/FIDELITY.md note F.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve(import.meta.dirname, '..', 'dist');
const PORT = Number(process.env.PORT ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

if (!existsSync(DIST)) {
  console.error('No dist/. Run: pnpm export:web');
  process.exit(1);
}

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const direct = [join(DIST, path), join(DIST, `${path}.html`), join(DIST, path, 'index.html')]
    .find((f) => f.startsWith(DIST) && existsSync(f) && extname(f));
  const file = direct ?? join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(PORT, '127.0.0.1', () => console.log(`serving dist/ on http://127.0.0.1:${PORT}`));

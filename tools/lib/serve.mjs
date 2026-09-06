/**
 * The static server every browser lane needs, written once.
 *
 * FIVE COPIES OF THIS EXISTED. `serve-dist.mjs` (canonical), `shoot-app.mjs`,
 * `smoke-live.mjs`, `measure-text-margin.mjs` and `render-canvas.mjs` each carried their own
 * `createServer` handler and their own MIME table -- roughly a hundred lines replicated four
 * times, differing only in which extensions someone happened to need that day, `MIME` vs
 * `TYPES`, and `content-type` vs `Content-Type`.
 *
 * They also diverged where it matters: two of them bound `0.0.0.0` rather than `127.0.0.1`,
 * publishing a build of the app to the local network for the life of the run. The default
 * here is the safe one, and binding wider has to be asked for.
 *
 * IMPORTED, NOT SPAWNED, and that is a decision rather than an accident. `verify-qr.mjs`
 * spawned `serve-dist.mjs` and scraped its URL off stdout -- and if the server hits its
 * `No dist/` guard it writes to STDERR and exits 1, so the promise never settles and the
 * lane hangs instead of failing. Adopting that shape in four more scripts would have
 * propagated the hang four more times. Importing also gives every caller a `close()` it can
 * reach from a failure handler, which a child process does not.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

/** The union of the five tables this replaces. */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jsx': 'text/jsx; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Serve `dir` over HTTP and resolve once it is listening.
 *
 * @param {string} dir absolute path to serve
 * @param {{ port?: number, host?: string, spa?: boolean, index?: string }} [opts]
 *   `spa` (default true) falls back to `index` for anything not on disk -- `web.output` is
 *   "single", so every route is served by the one index.html and resolved client-side
 *   (FIDELITY note F). Set it false to serve a directory of real files and 404 honestly.
 * @returns {Promise<{ url: string, port: number, close: () => void }>}
 */
export async function serveDir(dir, opts = {}) {
  const { port = 0, host = '127.0.0.1', spa = true, index = 'index.html' } = opts;

  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const candidates =
      path === '/'
        ? [join(dir, index)]
        : [join(dir, path), join(dir, `${path}.html`), join(dir, path, index)];
    // `startsWith(dir)` is the traversal guard, kept from the canonical implementation.
    const direct = candidates.find((f) => f.startsWith(dir) && existsSync(f) && extname(f));

    // A ROUTE FALLS BACK; AN ASSET DOES NOT. `/host/dj` has no extension and must resolve to
    // index.html or the deep link 404s. `/missing.js` has one, and answering it with HTML
    // labelled `text/javascript` is how a broken build looks like a working one -- the
    // browser fails to parse something the server said was fine. The copies this replaces
    // fell back for both.
    const isAsset = extname(path) !== '' && extname(path) !== '.html';
    const file = direct ?? (spa && !isAsset ? join(dir, index) : null);

    if (!file || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });

  await new Promise((r) => server.listen(port, host, r));
  const actual = server.address().port;
  return {
    url: `http://${host}:${actual}`,
    port: actual,
    close: () => server.close(),
  };
}

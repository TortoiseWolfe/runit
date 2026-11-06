/**
 * A small stand-in for Cloudflare Pages, serving THIS BRANCH's `web/` directory.
 *
 * WHY IT EXISTS. Lane G (`tools/verify-links.mjs`) used to read only the LIVE site, so a pull
 * request that fixed a live page could never pass before it merged: the check looked at the
 * page the PR was about to replace. Main failed the same workflow for the same reason. With
 * this server lane G can run the same measurements against the files the branch would deploy,
 * and the live measurement moves to after the deploy (`.github/workflows/live-links.yml`).
 *
 * WHAT IT HONOURS, because the traps this repo has measured live in these files:
 *   - `web/_redirects`: first matching rule wins, `*` and `:splat`, status 200 rewrites. A
 *     rewrite BEATS a real static file at the same path, exactly as on Cloudflare Pages, so a
 *     deleted `/help` pass-through line sends `/help/` to the catch-all here too.
 *   - `web/_headers`: path patterns with `*`, merged in file order.
 *   - `web/functions/api/*.js`: a Pages Function is run in-process through its `onRequestGet`.
 *
 * WHAT IT CANNOT HONOUR, and says so rather than pretending: the catch-all `/* -> /` serves the
 * Expo web app at the root of the deployed site, and that build is not in `web/`. A request the
 * catch-all captures answers 404 with a plain marker body here, which is never a page lane G
 * would accept. Cloudflare's own behaviour (the 308 off an explicit `index.html`, skipping
 * `node_modules` paths, edge caching) is only visible on the live host.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** `/a/*` + `/b/:splat` style pattern to a RegExp; returns captured splat in group 1. */
function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.*)');
  return new RegExp(`^${escaped}$`);
}

export function parseRedirects(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [from, to, status] = line.split(/\s+/);
    if (!from || !to) continue;
    rules.push({ from, to, status: Number(status ?? 302), re: patternToRegExp(from) });
  }
  return rules;
}

export function parseHeaders(text) {
  const blocks = [];
  let current = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\S/.test(raw)) {
      current = { re: patternToRegExp(raw.trim()), headers: {} };
      blocks.push(current);
    } else if (current) {
      const i = raw.indexOf(':');
      if (i > 0) current.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
    }
  }
  return blocks;
}

/** Apply `_redirects` to a path. Returns the rewritten path (status 200 rules only). */
export function rewrite(rules, path) {
  for (const r of rules) {
    const m = r.re.exec(path);
    if (!m) continue;
    if (r.status !== 200) return { redirect: r.to, status: r.status };
    return { path: r.to.replace(':splat', m[1] ?? '') };
  }
  return { path };
}

export async function startWebServer(webDir, { port = 0 } = {}) {
  const read = (n) => (existsSync(join(webDir, n)) ? readFileSync(join(webDir, n), 'utf8') : '');
  const rules = parseRedirects(read('_redirects'));
  const headerBlocks = parseHeaders(read('_headers'));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const headersFor = (p) => Object.assign({}, ...headerBlocks.filter((b) => b.re.test(p)).map((b) => b.headers));
    const send = (status, body, extra = {}) => {
      res.writeHead(status, extra);
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    // A Pages Function takes the route before static files and _redirects, as on Cloudflare.
    const fn = /^\/api\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1];
    if (fn && existsSync(join(webDir, 'functions', 'api', `${fn}.js`))) {
      const mod = await import(pathToFileURL(join(webDir, 'functions', 'api', `${fn}.js`)).href);
      const r = await mod.onRequestGet({ request: new Request(url, { method: 'GET' }) });
      const hdrs = Object.fromEntries(r.headers);
      return send(r.status, Buffer.from(await r.arrayBuffer()), hdrs);
    }

    const rw = rewrite(rules, url.pathname);
    if (rw.redirect) return send(rw.status, '', { Location: rw.redirect });
    const target = normalize(rw.path).replace(/^(\.\.[/\\])+/, '');
    let file = join(webDir, target);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile() || !file.startsWith(webDir)) {
      // The catch-all lands here: on the live host this is the Expo app shell, which is not in web/.
      return send(404, 'not in web/ (on the live host this path is the app shell)\n', { 'Content-Type': 'text/plain' });
    }
    // Headers are matched against the path the visitor asked for, as Pages does.
    const type = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
    return send(200, readFileSync(file), { ...type, ...headersFor(url.pathname) });
  });

  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  const { port: bound } = server.address();
  return { url: `http://127.0.0.1:${bound}`, close: () => new Promise((ok) => server.close(ok)) };
}

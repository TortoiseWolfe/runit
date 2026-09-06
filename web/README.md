# `web/` — where invitations land

Three static files that make a printed QR useful to somebody who does not have the app.
No build step, no framework, no backend.

| File | What it is |
|---|---|
| `.well-known/apple-app-site-association` | Tells iOS that `runit.pages.dev/i/*` belongs to this app, so the link opens it. |
| `_headers` | Forces `Content-Type: application/json` on that file. **This is why the site is here.** |
| `_redirects` | Rewrites `/i/ANYCODE` to the one page, without changing the URL. |
| `i/index.html` | The page a stranger sees. Shows the code big enough to type, links to the App Store. |

## Why not GitHub Pages, where the legal pages already live

Two measured reasons, not preferences.

**Apple fetches the file from the domain ROOT** — `https://<host>/.well-known/apple-app-site-association`. `runit-legal` is a GitHub Pages *project* site, so it can only ever answer under `/runit-legal/`. The apex `tortoisewolfe.github.io` returns 404 and no user-site repo exists.

**GitHub Pages cannot set a Content-Type.** The association file deliberately has no extension, so a static host guesses. Probing `runit-legal/.nojekyll` — also extensionless — returns `application/octet-stream`, where Apple documents `application/json`. Cloudflare Pages lets `_headers` say it outright.

The legal pages stay exactly where they are. App Store Connect's privacy and support URLs are unchanged.

## Deploying it

One-time, in the Cloudflare dashboard:

1. **Workers & Pages → Create → Pages → Connect to Git**, and pick `TortoiseWolfe/runit`.
2. Framework preset **None**, build command **empty**, **build output directory `web`**.
3. Name the project **`runit`** so the host is `runit.pages.dev`.

**If that name is taken, the host changes and three files must follow it** — `INVITE_ORIGIN` in `src/lib/invite.ts`, `associatedDomains` in `app.json`, and this README. `src/lib/invite.test.ts` fails if they disagree, which is the point.

Then check it:

```bash
curl -sI https://runit.pages.dev/.well-known/apple-app-site-association | grep -i content-type
#   want: content-type: application/json

curl -s https://runit.pages.dev/i/HOUSE7 | grep -o 'id="code"'
#   want: one match — the page renders and fills the code from the path
```

## What none of this proves

**That iOS actually opens the app.** There is no Mac in this environment, Apple's CDN caches the association file for days, and a misconfigured universal link fails silently by opening Safari instead. `src/lib/invite.test.ts` proves the four artefacts describe the same app at the same address; `tools/verify-qr.mjs` proves the QR encodes the link. A real iPhone is the only thing that proves the rest.

Until one has: **treat the universal link as unverified.** The change is still an improvement without it — the fallback went from a dead `runit://` string to a page showing the code.

To check on a device once installed: **Settings → Developer → Universal Links → Diagnostics**, and paste an `/i/<CODE>` URL.

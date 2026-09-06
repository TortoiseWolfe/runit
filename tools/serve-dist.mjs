#!/usr/bin/env node
/**
 * Static SPA server for the Expo web export, as a CLI.
 *
 * `web.output` is "single", so every route is served by the one index.html and resolved
 * client-side. Anything not on disk falls back to it -- without that, a deep link like
 * /host/dj 404s. See design/FIDELITY.md note F.
 *
 * THIS IS NOW A WRAPPER around `lib/serve.mjs`, which the browser lanes import directly.
 * It stays a CLI because `playwright.config.ts` runs it as its `webServer`, and its stdout
 * line is what a human reads to find the port.
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { serveDir } from './lib/serve.mjs';

const DIST = resolve(import.meta.dirname, '..', 'dist');
const PORT = Number(process.env.PORT ?? 4173);

if (!existsSync(DIST)) {
  console.error('No dist/. Run: pnpm export:web');
  process.exit(1);
}

await serveDir(DIST, { port: PORT });
console.log(`serving dist/ on http://127.0.0.1:${PORT}`);

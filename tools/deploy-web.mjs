#!/usr/bin/env node
/**
 * DEPLOY THE INVITATION HOST AND THE BROWSER GUEST APP, AS ONE SITE (#78).
 *
 * `runit-app.pages.dev` is a DIRECT-UPLOAD project, so a push to `main` does not redeploy
 * it. This is the command that does, and it exists rather than a README line because
 * staging the two halves by hand loses files silently -- the first attempt shipped 6 of 26
 * and reported success.
 *
 * WHAT IS SERVED WHERE:
 *   /                     the app        (dist-guest, built by `pnpm export:web:guest`)
 *   /i/CODE               the bridge     (web/i/index.html)
 *   /.well-known/*        the association files, untouched by either
 *
 * THREE TRAPS, ALL MEASURED AGAINST THE LIVE SITE RATHER THAN REASONED ABOUT:
 *
 * 1. **Cloudflare Pages skips any path containing `node_modules`.** expo writes 18 router
 *    assets to `assets/node_modules/expo-router/assets/`, and wrangler uploads none of them
 *    without a word. They are staged as `assets/_nm/` here and `web/_redirects` maps the
 *    path the bundle asks for onto that.
 *
 * 2. **A `_redirects` rule beats a real static file at the same path** -- the opposite of
 *    the assumption. A bare `/* / 200` served the app's HTML shell for the 2.8MB JS bundle
 *    and for `assetlinks.json`, under three green 200s. Every real directory is passed
 *    through explicitly before the catch-all; `web/_redirects` carries the order.
 *
 * 3. **A deploy from any branch but `main` is a PREVIEW, and it says "Deployment complete!"**
 *    wrangler reads the branch from git. From a feature branch it publishes to
 *    `<hash>.runit-app.pages.dev` and leaves `runit-app.pages.dev` exactly as it was --
 *    measured on 2026-09-21, when a new Android link went "live" and the production page
 *    kept serving the old APK through six cache-busted fetches. So this refuses to run off
 *    `main`, and passes `--branch=main` so the environment is stated rather than inferred.
 *    Deploying only from `main` also means the live site is always something that was merged.
 *
 * 4. **The app must be the GUEST build.** `dist-live` carries `EXPO_PUBLIC_FIDELITY=1` and
 *    would hand a guest a synthetic 1x1 photo, four fixture songs and a fake scan button.
 *    `audit:guest-build` is run here rather than trusted to have been run.
 *
 * 5. **A bundle of ANY age deploys cleanly and reports success** (#86). This script used to
 *    require `dist-guest/` to already exist and then only gate it, so the freshness of the
 *    bytes was a thing a person remembered. On 2026-09-22 it published a bundle built the
 *    PREVIOUS EVENING -- two merges' worth of work "deployed" and none of it shipped. The
 *    only tell was `Uploaded 0 files (24 already uploaded)`, and
 *    `wrangler pages deployment list` named the right commit on BOTH rows, because wrangler
 *    reads git rather than the bundle. So a stale deploy is indistinguishable from a correct
 *    one in the place you would go to check it, which is worse than the four traps above --
 *    each of those had a symptom somewhere.
 *
 *    So it BUILDS, rather than checking an mtime and complaining. `audit:guest-build` exists
 *    because "run the right export" was being trusted rather than checked; the export it
 *    guards was still something a person had to remember to run. Now neither is.
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { envLocal } from './lib/env.mjs';

const ROOT = join(import.meta.dirname, '..');
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

const PROJECT = 'runit-app';
const DIST = join(ROOT, 'dist-guest');
const WEB = join(ROOT, 'web');
const DRY = process.argv.includes('--dry');

// Trap 3. Checked first, because every other step is wasted if the result is a preview.
const branch = execFileSync('git', ['-C', ROOT, 'branch', '--show-current']).toString().trim();
if (branch !== 'main' && !DRY) {
  console.error(red(`REFUSED: on branch "${branch}", not main.`));
  console.error('  A deploy from here is a PREVIEW. It reports "Deployment complete!" and changes');
  console.error('  nothing a guest sees. Merge first, then deploy from main.');
  process.exit(1);
}

/**
 * Trap 5. BUILD IT, every time.
 *
 * The two values come from `.env.local` through `envLocal`, which prefers `process.env` --
 * so CI can pass them and a laptop need not. Neither is a secret: the project URL and the
 * publishable key are compiled into every shipped bundle by construction, which is the same
 * reasoning `envLocal`'s own docblock sets out.
 *
 * REFUSING WITHOUT THEM rather than exporting anyway. `expo export` succeeds with an empty
 * `EXPO_PUBLIC_SUPABASE_URL` and produces a bundle that boots to a screen that can never
 * join anything -- a green build of a dead app, which is the shape this whole file exists
 * to stop.
 */
const SUPABASE_URL = envLocal('EXPO_PUBLIC_SUPABASE_URL');
const SUPABASE_KEY = envLocal('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(red('FAIL: no Supabase URL or publishable key.'));
  console.error('  They live in .env.local, or pass them in the environment:');
  console.error('    EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  console.error('  Exporting without them builds an app that boots and can never join.');
  process.exit(1);
}

/**
 * EVEN ON `--dry`, DELIBERATELY. A dry run that reuses whatever bundle is lying around is
 * the same trap one step smaller: it would rehearse the staging of bytes the real run would
 * then replace. It costs a real export (~40s) and that is the price of a rehearsal that
 * rehearses.
 */
{
  rmSync(DIST, { recursive: true, force: true });
  console.log('building dist-guest/ against production...');
  try {
    execFileSync('pnpm', ['export:web:guest'], {
      stdio: 'inherit',
      cwd: ROOT,
      env: {
        ...process.env,
        EXPO_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SUPABASE_KEY,
        // Belt and braces: `export:web:guest` does not set it, and an inherited one from a
        // shell that ran `export:web` would silently produce the harness bundle. The audit
        // below would catch that -- this stops it happening at all.
        EXPO_PUBLIC_FIDELITY: '',
      },
    });
  } catch {
    console.error(red('FAIL: the guest export did not build. Not deploying.'));
    process.exit(1);
  }
}

if (!existsSync(DIST)) {
  console.error(red('FAIL: no dist-guest/. Build it first, against PRODUCTION:'));
  console.error('  set -a && . ./.env.local && set +a && pnpm export:web:guest');
  process.exit(1);
}

// The gate, run rather than assumed. It reads dist-guest and fails on a harness bundle.
try {
  execFileSync('node', [join(ROOT, 'tools/audit-guest-build.mjs')], { stdio: 'inherit' });
} catch {
  console.error(red('FAIL: the guest-build audit refused this bundle. Not deploying.'));
  process.exit(1);
}

const stage = join(tmpdir(), `runit-deploy-${Date.now()}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// The app first, then the site over it -- web/ owns _headers, _redirects, i/ and .well-known.
cpSync(DIST, stage, { recursive: true });
cpSync(WEB, stage, { recursive: true });
rmSync(join(stage, 'README.md'), { force: true });

// Trap 1. Rename out of Cloudflare's skip list; `_redirects` maps the original path here.
const nm = join(stage, 'assets', 'node_modules');
let moved = 0;
if (existsSync(nm)) {
  const dest = join(stage, 'assets', '_nm');
  renameSync(nm, dest);
  const count = (d) => readdirSync(d).reduce(
    (n, f) => n + (statSync(join(d, f)).isDirectory() ? count(join(d, f)) : 1), 0);
  moved = count(dest);
}

const files = (d) => readdirSync(d, { withFileTypes: true }).reduce(
  (n, e) => n + (e.isDirectory() ? files(join(d, e.name)) : 1), 0);
console.log(`\n  staged ${files(stage)} files (${moved} moved out of Cloudflare's node_modules skip list)`);

if (DRY) {
  console.log(green(`  --dry: nothing uploaded. Staged at ${stage}`));
  process.exit(0);
}

execFileSync('npx', ['--yes', 'wrangler@latest', 'pages', 'deploy', stage,
  `--project-name=${PROJECT}`, '--branch=main', '--commit-dirty=true'], { stdio: 'inherit' });

rmSync(stage, { recursive: true, force: true });
console.log(green('\nOK: deployed. Verify with `pnpm verify:links` (lane G).'));

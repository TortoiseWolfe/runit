#!/usr/bin/env node
/**
 * LANE G -- is the invitation host ours, and does it serve what iOS needs?
 *
 * WHY THIS EXISTS, AND IT IS NOT A HYPOTHETICAL. `INVITE_ORIGIN` was set to
 * `runit.pages.dev` for exactly one commit. That name belongs to a stranger, and their
 * project answers **200 on every path** with an OAuth callback page. So for one commit
 * every QR this app generates pointed at somebody else's website.
 *
 * The unit tests passed throughout, and they were right to: `src/lib/invite.test.ts`
 * asserts that `INVITE_ORIGIN`, `app.json`'s `associatedDomains` and the association file
 * all AGREE. They did agree. **Agreement is not ownership.**
 *
 * And a status code is not ownership either -- checking `200` would have passed against
 * the stranger's catch-all too. The only thing that distinguishes our host from anyone
 * else's is what comes back in the BODY: an association file naming OUR appID, and a
 * landing page carrying OUR App Store id. That is what this reads.
 *
 * IT SKIPS LOUDLY when the host does not resolve, exactly like Lane E. Cloudflare Pages
 * has to be connected by a human in a browser, so failing closed would make this a gate
 * nobody can turn green -- and a gate that cannot be satisfied gets deleted. Skipping and
 * naming what went unchecked is the honest middle.
 *
 * WHAT IT STILL CANNOT PROVE: that iOS accepts the file. Apple's CDN fetches it
 * separately and caches for days, and a misconfigured universal link fails SILENTLY by
 * opening Safari. Only a device settles that -- Settings > Developer > Universal Links >
 * Diagnostics. See web/README.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

/** Read the origin from source rather than keeping a second copy that can drift. */
const ORIGIN = /INVITE_ORIGIN = '([^']+)'/.exec(read('src/lib/invite.ts'))?.[1];
if (!ORIGIN) {
  console.error(red('FAIL: could not read INVITE_ORIGIN out of src/lib/invite.ts'));
  process.exit(1);
}

const appJson = JSON.parse(read('app.json'));
const eas = JSON.parse(read('eas.json'));
const EXPECTED_APP_ID = `${eas.submit.production.ios.appleTeamId}.${appJson.expo.ios.bundleIdentifier}`;
const ASC_APP_ID = eas.submit.production.ios.ascAppId;

const problems = [];
const note = (m) => problems.push(m);

async function get(path) {
  const url = `${ORIGIN}${path}`;
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  return { url, res, body: await res.text() };
}

let aasa;
try {
  aasa = await get('/.well-known/apple-app-site-association');
} catch {
  // No DNS, no TLS, no answer. An unclaimed <name>.pages.dev does not resolve at all,
  // which is the ordinary state before anyone has connected the project.
  console.log(yellow('SKIPPED: invitation links (lane G)'));
  console.log(`  ${ORIGIN} does not answer, so NOTHING ABOUT THE INVITATION HOST WAS CHECKED.`);
  console.log('  Connect Cloudflare Pages to this repo (output dir `web`) and re-run.');
  console.log('  Until then a scanned QR is a dead end, and the universal link cannot work.');
  console.log('  Steps: web/README.md');
  process.exit(0);
}

/* ------------------------------------------------ the association file */

if (aasa.res.status !== 200) {
  note(`the association file returned ${aasa.res.status}, so iOS has nothing to fetch.`);
}

// Apple documents application/json. The file has no extension, so a static host GUESSES --
// GitHub Pages guesses application/octet-stream, which is why the site is on a host that
// can be told. This is the assertion that keeps that decision from silently regressing.
const ct = aasa.res.headers.get('content-type') ?? '(none)';
if (!ct.includes('application/json')) {
  note(
    `Content-Type is "${ct}", not application/json.\n` +
      `    web/_headers is what sets this. A host that cannot set headers cannot serve this file.`,
  );
}

let parsed = null;
try {
  parsed = JSON.parse(aasa.body);
} catch {
  note(
    'the association file is not JSON. The first 120 characters were:\n' +
      `    ${aasa.body.slice(0, 120).replace(/\s+/g, ' ')}`,
  );
}

if (parsed) {
  const ids = parsed?.applinks?.details?.flatMap((d) => d.appIDs ?? []) ?? [];
  // THE OWNERSHIP CHECK. A stranger's host can return 200 and valid JSON; what it cannot
  // do is name our team and our bundle id.
  if (!ids.includes(EXPECTED_APP_ID)) {
    note(
      `the association file does not name this app.\n` +
        `    want: ${EXPECTED_APP_ID}\n` +
        `    got:  ${ids.length ? ids.join(', ') : '(no appIDs at all)'}\n` +
        `    THIS HOST IS PROBABLY NOT OURS. pages.dev names are global and first-come.`,
    );
  }
  const patterns = parsed?.applinks?.details?.flatMap((d) => (d.components ?? []).map((c) => c['/'])) ?? [];
  if (!patterns.includes('/i/*')) {
    note(`no component matches /i/*, so invitation links would not open the app. Got: ${patterns.join(', ') || '(none)'}`);
  }
}

/* ------------------------------------------------------- the landing page */

try {
  const page = await get('/i/HOUSE7');
  if (page.res.status !== 200) {
    note(`/i/HOUSE7 returned ${page.res.status}; a scanned QR would show an error page.`);
  }
  // Same ownership logic as above. The stranger's project answered 200 here too, on a
  // catch-all -- so the check has to be for something only our page contains.
  if (!page.body.includes(`id${ASC_APP_ID}`)) {
    note(
      `/i/HOUSE7 does not carry our App Store id (id${ASC_APP_ID}).\n` +
        `    Either the page is not deployed, or THIS HOST IS NOT OURS.`,
    );
  }
  if (!page.body.includes('id="code"')) {
    note('/i/HOUSE7 has no code element, so a guest would not see the code to type.');
  }
} catch (e) {
  note(`/i/HOUSE7 could not be fetched: ${e instanceof Error ? e.message : String(e)}`);
}

/* ------------------------------------------------------------------ report */

if (problems.length) {
  console.error(red(`\nFAIL: ${problems.length} problem(s) with ${ORIGIN}\n`));
  for (const p of problems) console.error(`  ${p}\n`);
  console.error('  web/README.md has the deploy steps and what each file is for.\n');
  process.exit(1);
}

console.log(green(`ok: ${ORIGIN} serves our association file and our invitation page`));
console.log(`  appID ${EXPECTED_APP_ID} · Content-Type ${ct}`);
console.log(yellow('  Still UNVERIFIED on a device: only an iPhone proves iOS accepts it.'));

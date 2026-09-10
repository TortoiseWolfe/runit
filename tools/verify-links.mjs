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

/* ------------------------------------------- the ANDROID association file */

/**
 * ANDROID HAS ITS OWN FILE AND ITS OWN FAILURE MODE, and lane G has never looked for it.
 *
 * The Apple half above has been checked since this lane existed; `assetlinks.json` did not
 * exist at all, so a texted link opened Chrome rather than the app for every Android guest
 * and nothing on the board said so.
 *
 * IT FAILS SILENTLY AND PERMANENTLY, which is why it is worth a gate. Android verifies app
 * links at INSTALL time: if this file is missing, malformed, or names the wrong signing
 * certificate, the system quietly declines to associate the app and the link opens a
 * browser forever. Nobody sees an error -- not the guest, not the host, not a build log.
 *
 * THE FINGERPRINT IS THE OWNERSHIP CLAIM, exactly as the appID is on the Apple side. Any
 * host can serve valid JSON; only ours can name the certificate our APK is actually signed
 * with. It comes from `apksigner verify --print-certs` on the built APK -- EAS reuses the
 * project keystore across builds, so it survives rebuilds and would change only if the
 * keystore were replaced, which is precisely when this check should go red.
 */
const local = JSON.parse(read('web/.well-known/assetlinks.json'));
const LOCAL_PKG = local?.[0]?.target?.package_name;
const LOCAL_FP = local?.[0]?.target?.sha256_cert_fingerprints?.[0];

if (LOCAL_PKG !== appJson.expo.android.package) {
  note(
    `web/.well-known/assetlinks.json names package "${LOCAL_PKG}", app.json says ` +
      `"${appJson.expo.android.package}". They must agree or Android refuses the association.`,
  );
}

// The intent filter is the half that lives in the APK. A perfect assetlinks.json against a
// build that declares no https filter associates nothing -- which was the state until #60,
// and is invisible without asking.
const filters = appJson.expo.android.intentFilters ?? [];
const https = filters.find((f) =>
  (f.data ?? []).some((d) => d.scheme === 'https' && d.host === new URL(ORIGIN).host),
);
if (!https) {
  note(
    `app.json declares no https intent filter for ${new URL(ORIGIN).host}.\n` +
      `    Without it the APK cannot open an https link no matter what this host serves.`,
  );
} else if (https.autoVerify !== true) {
  note(
    'the Android intent filter does not set autoVerify.\n' +
      '    On Android 12+ an unverified https filter does not open the app at all -- the user\n' +
      '    must enable "Open supported links" by hand, which nobody does.',
  );
}

try {
  const al = await get('/.well-known/assetlinks.json');
  if (al.res.status !== 200) {
    note(`/.well-known/assetlinks.json returned ${al.res.status}; Android links cannot verify.`);
  } else {
    let served = null;
    try {
      served = JSON.parse(al.body);
    } catch {
      note('the served assetlinks.json is not JSON, so Android will reject the association.');
    }
    if (served) {
      const t = served?.[0]?.target ?? {};
      if (t.package_name !== LOCAL_PKG) {
        note(`served assetlinks.json names "${t.package_name}", we expect "${LOCAL_PKG}". DEPLOY IT.`);
      }
      if (!(t.sha256_cert_fingerprints ?? []).includes(LOCAL_FP)) {
        note(
          'the served assetlinks.json does not carry our signing fingerprint.\n' +
            `    want: ${LOCAL_FP}\n` +
            `    got:  ${(t.sha256_cert_fingerprints ?? []).join(', ') || '(none)'}\n` +
            '    Android verifies at INSTALL time and does not retry loudly. This fails silently.',
        );
      }
    }
  }
} catch (e) {
  note(`could not fetch /.well-known/assetlinks.json: ${e instanceof Error ? e.message : e}`);
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

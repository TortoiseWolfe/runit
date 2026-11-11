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
 * IT FAILS LOUDLY when the host does not resolve. Cloudflare Pages
 * has to be connected by a human in a browser, so a down site must not look like a pass.
 * Failing with a clear message is the honest signal.
 *
 * WHAT IT STILL CANNOT PROVE: that iOS accepts the file. Apple's CDN fetches it
 * separately and caches for days, and a misconfigured universal link fails SILENTLY by
 * opening Safari. Only a device settles that -- Settings > Developer > Universal Links >
 * Diagnostics. See web/README.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startWebServer } from './serve-web.mjs';

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

/**
 * TWO TARGETS, ONE SET OF MEASUREMENTS (2026-11-06).
 *
 *   node tools/verify-links.mjs            the LIVE site (INVITE_ORIGIN). Runs after a deploy:
 *                                          .github/workflows/live-links.yml, on push to main and daily.
 *   node tools/verify-links.mjs --local    THIS BRANCH's web/, served by tools/serve-web.mjs.
 *                                          Runs in every pull request through run-checks.sh.
 *
 * It used to read only the live site, so a pull request that fixed a live page could not pass
 * before it merged -- the check looked at the page the PR was about to replace -- and main
 * failed the same workflow from the day a page changed until someone deployed. The ASSERTIONS
 * are identical in both modes; only the host they are asked of differs. Nothing was dropped,
 * and what a local run cannot see is printed at the end rather than left out.
 */
const LOCAL = process.argv.includes('--local');
let BASE = ORIGIN;
let stopServer = async () => {};
if (LOCAL) {
  const server = await startWebServer(join(ROOT, 'web'));
  BASE = server.url;
  stopServer = server.close;
  console.log(`  LOCAL MODE: serving this branch's web/ at ${BASE} (live host ${ORIGIN} is NOT asked)`);
}
const finish = async (code) => {
  await stopServer();
  process.exit(code);
};

/**
 * Core verification logic. Returns { ok: boolean, problems: string[] }.
 * In live mode (LOCAL=false), a fetch failure on the first request is a FAIL.
 * In local mode (LOCAL=true), a fetch failure on the first request is a FAIL.
 */
async function verify(base, isLocal) {
  const problems = [];
  const note = (m) => problems.push(m);

  async function get(path) {
    const url = `${base}${path}`;
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    return { url, res, body: await res.text() };
  }

  let aasa;
  try {
    aasa = await get('/.well-known/apple-app-site-association');
  } catch (e) {
    // No DNS, no TLS, no answer.
    if (isLocal) {
      console.error(red(`FAIL: the local server at ${base} did not answer, so NOTHING WAS CHECKED.`));
      return { ok: false, problems: [] };
    }
// Live mode: a site that does not answer is a failure, not a skip.
  console.error(red(`FAIL: ${base} does not answer, so NOTHING ABOUT THE INVITATION HOST WAS CHECKED.`));
    console.error(`  ${e instanceof Error ? e.message : String(e)}`);
    console.error('  Connect Cloudflare Pages to this repo (output dir `web`) and re-run.');
    console.error('  Until then a scanned QR is a dead end, and the universal link cannot work.');
    console.error('  Steps: web/README.md');
    return { ok: false, problems: [] };
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
    // #78's route. It is the page's FILLED button now, and the only way into a party that
    // does not start with an install -- so its absence is not cosmetic.
    if (!page.body.includes('id="web"')) {
      note('/i/HOUSE7 has no browser route (id="web"): a guest who will not install has no way in.');
    }

    /*
     * THE ANDROID INSTALL LINK HAS A FOURTEEN-DAY FUSE, measured on 2026-09-21. EAS
     * internal-distribution artifacts expire 14 days after they are built: the APK this page
     * served from 2026-09-11 expires 2026-09-25. When one does, the install button this page
     * shows every Android visitor answers 400 and the page says nothing -- a door that will not
     * open, at the top of the funnel, which is what `empty-world.spec.ts`'s aria-disabled gate
     * exists to catch everywhere else in the app.
     *
     * HEAD, not GET: the artifact is ~130MB and HEAD answers in half a second -- 200 while it
     * lives, 400 once it is gone. Its own try, so a network failure here is reported as THIS and
     * not as the landing page being unreachable.
     *
     * It catches the death on the next board, not before it. Warning ahead would need the
     * build id and an EAS token, and this lane is credential-free on purpose. CLAUDE.md records
     * the fuse so a person rebuilds before it burns.
     */
    const tag = /<a\b[^>]*\bid="android"[^>]*>/.exec(page.body)?.[0];
    const apkUrl = tag ? /\bhref="([^"]+)"/.exec(tag)?.[1] : undefined;
    /*
     * AND NOW IT CAN WARN AHEAD (2026-10-05), which this comment said it could not. The page
     * carries EAS's own expiry for the build it links (`data-expires`), so the date is a fact on
     * the page rather than a token call away. Missing is a failure -- the page would then fail
     * silently on the day -- and under four days is a yellow line, not a red one: a gate that
     * reds a working link is a gate that gets switched off.
     */
    const apkDies = tag ? Date.parse(/\bdata-expires="([^"]+)"/.exec(tag)?.[1] ?? '') : NaN;
    if (tag && Number.isNaN(apkDies)) {
      note('/i/HOUSE7\'s Android link carries no data-expires, so the page cannot say when the download dies.');
    } else if (tag) {
      const days = (apkDies - Date.now()) / 86_400_000;
      if (days < 4) {
        console.log(yellow(`  todo: the Android download expires ${new Date(apkDies).toISOString().slice(0, 16)}Z (${days < 0 ? 'already' : `in ${days.toFixed(1)} days`}).`));
        console.log(yellow('        Rebuild (`eas build -p android --profile preview`), repoint id="android" and its data-expires, `pnpm deploy:web`.'));
      } else {
        console.log(`  Android download live until ${new Date(apkDies).toISOString().slice(0, 10)} (${Math.floor(days)} days)`);
      }
    }
    if (!apkUrl) {
      note('/i/HOUSE7 has no Android install link (id="android").');
    } else {
      try {
        const r = await fetch(apkUrl, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15_000) });
        if (!r.ok) {
          note(
            `the Android install link answered ${r.status} -- the APK has EXPIRED.\n` +
              `    ${apkUrl}\n` +
              '    EAS internal builds live 14 days. Rebuild (`eas build -p android --profile preview`),\n' +
              '    repoint `id="android"` in web/i/index.html, and `pnpm deploy:web`.',
          );
        }
      } catch (e) {
        note(`the Android install link could not be checked: ${e instanceof Error ? e.message : e}`);
      }
    }
  } catch (e) {
    note(`/i/HOUSE7 could not be fetched: ${e instanceof Error ? e.message : String(e)}`);
  }

  /**
   * THE HELP PAGE IS THE HELP PAGE, AND NOT THE APP SHELL WEARING ITS URL (2026-10-05).
   * `web/help/index.html` is the one page any guest, tester or host can be sent instead of a
   * hand-written set of steps. It is a real file -- and on this host a `_redirects` rule beats a
   * real file, so if the two `/help` lines in `web/_redirects` go missing the catch-all answers
   * with the app's HTML shell under a 200 and every link to the guide lands on the join screen.
   * A status code cannot tell those apart; the marker can. Both spellings are read, because a
   * person types the one without the slash.
   */
  for (const path of ['/help/', '/help']) {
    try {
      const help = await get(path);
      if (help.res.status !== 200 || !help.body.includes('id="help-guide"')) {
        problems.push(
          `${path} answered ${help.res.status} without id="help-guide" -- the guide is not what is being served\n` +
            '    (a _redirects catch-all serving the app shell looks exactly like this; see web/_redirects).',
        );
      } else {
        console.log(`  ${path} serves the help page`);
      }
    } catch (e) {
      problems.push(`${path} could not be fetched: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * ROBOTS.TXT IS A ROBOTS FILE (2026-10-07). Link previewers read it before the page, and the
   * catch-all answered it with the app's HTML; LinkedIn showed no preview for /beta while it did.
   */
  try {
    const robots = await get('/robots.txt');
    const type = robots.res.headers.get('content-type') ?? '';
    if (robots.res.status !== 200 || !type.startsWith('text/plain') || !/^User-agent:/m.test(robots.body)) {
      problems.push(`/robots.txt answered ${robots.res.status} ${type} -- link previewers read it first (see web/_redirects).`);
    } else {
      console.log('  /robots.txt is a robots file');
    }
  } catch (e) {
    problems.push(`/robots.txt could not be fetched: ${e instanceof Error ? e.message : e}`);
  }

  /**
   * THE BETA PAGE (2026-10-07): served, and carrying the SAME Android download as the invite page.
   * Two pages link one APK, and the APK is repointed every two weeks; a repoint that touched one
   * page and not the other would send half the testers to a dead file while every status code
   * stayed green. So the href and the data-expires are compared, not merely checked to exist.
   */
  try {
    const beta = await get('/beta/');
    const invite = await get('/i/HOUSE7');
    const androidOf = (body) => {
      const t = /<a\b[^>]*\bid="android"[^>]*>/.exec(body)?.[0] ?? '';
      return { href: /\bhref="([^"]+)"/.exec(t)?.[1], expires: /\bdata-expires="([^"]+)"/.exec(t)?.[1] };
    };
    if (beta.res.status !== 200 || !beta.body.includes('id="beta-page"')) {
      problems.push(`/beta/ answered ${beta.res.status} without id="beta-page" -- the beta page is not what is being served (see web/_redirects).`);
    } else {
      const a = androidOf(beta.body), b = androidOf(invite.body);
      if (!a.href || a.href !== b.href || a.expires !== b.expires) {
        problems.push(`/beta/ and /i/ disagree about the Android download:\n    beta   ${a.href} (${a.expires})\n    invite ${b.href} (${b.expires})\n    Repoint BOTH id="android" links and their data-expires together.`);
      } else if (!beta.body.includes('testflight.apple.com/join/')) {
        problems.push('/beta/ carries no public TestFlight link, so an iPhone visitor has nowhere to go.');
      } else if (/testflight\.apple\.com\/join\/([A-Za-z0-9]+)/.exec(beta.body)?.[1] !== /id="tfcode">([^<]+)</.exec(beta.body)?.[1]?.trim()) {
        problems.push('/beta/ shows a TestFlight code that is not its own public link\'s: repoint the link and the copy box together.');
      } else {
        // The link-preview image, which the catch-all would answer with HTML if `_redirects` let it.
        const img = await fetch(`${base}/beta/runit-card-v2.jpg`, { signal: AbortSignal.timeout(15_000) });
        const imgType = img.headers.get('content-type') ?? '';
        if (!img.ok || !imgType.startsWith('image/')) {
          problems.push(`/beta/runit-card-v2.jpg answered ${img.status} ${imgType} -- a pasted link would preview with no picture.`);
        } else {
          // EVERY <img> ON THE PAGE, resolved from `/beta` with no trailing slash -- the URL people
          // are actually sent -- exactly as a browser resolves it. A relative src passes from `/beta/`
          // and breaks from `/beta`, where it lands on the root and the catch-all serves HTML.
          const broken = [];
          for (const m of beta.body.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) {
            const u = new URL(m[1], `${base}/beta`);
            const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
            if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) broken.push(`${m[1]} -> ${u.pathname} (${r.status} ${r.headers.get('content-type')})`);
          }
          if (broken.length) {
            problems.push(`/beta shows a broken image, resolved the way a browser does from the no-slash URL:\n    ${broken.join('\n    ')}`);
          } else {
            console.log('  /beta/ serves the beta page, with the same Android download as /i/, a preview image, and images that load from /beta');
          }
        }
      }
    }
  } catch (e) {
    problems.push(`/beta/ could not be fetched: ${e instanceof Error ? e.message : e}`);
  }

  /**
   * THE SONG TYPE-AHEAD'S PROXY ANSWERS ON THIS HOST (spec 003 follow-up). `web/functions/api/
   * music.js` is a Pages Function, and since #117 it is the browser's FALLBACK: the browser asks
   * Apple from its own connection first, because from Cloudflare's shared egress Apple answers
   * 429. A degraded upstream is therefore a `todo:`, not a failure. What is asserted is the SHAPE -- JSON with a `results` array --
   * never that Apple answered: the function returns 200 and no results when Apple is down,
   * so this cannot go red on a third party's outage. It CAN go red on a `_redirects` catch-all
   * swallowing the route and serving the app's HTML shell, which is the failure measured on
   * this host before (bundle paths, assetlinks) and the reason this is checked by reading the
   * body back.
   */
  try {
    const music = await get('/api/music?term=journey');
    const type = music.res.headers.get('content-type') ?? '';
    let shape = null;
    try { shape = JSON.parse(music.body); } catch { shape = null; }
    if (music.res.status !== 200 || !type.includes('application/json') || !Array.isArray(shape?.results)) {
      problems.push(`/api/music answered ${music.res.status} ${type || '(no content-type)'} -- the song type-ahead is dead in the browser (a _redirects catch-all serving the app shell looks exactly like this).`);
    } else {
      console.log(`  /api/music answers JSON (${shape.results.length} result(s) for "journey"; upstream ${shape.upstream ?? 'n/a'})`);
      if (shape.upstream && shape.upstream !== 'ok') {
        console.log(yellow(`  todo: the fallback proxy's upstream answered "${shape.upstream}" -- browsers still ask Apple directly first (#117), so this only bites a guest whose network blocks itunes.apple.com.`));
      }
    }
  } catch (e) {
    problems.push(`/api/music could not be fetched: ${e instanceof Error ? e.message : e}`);
  }

  return { ok: problems.length === 0, problems, ct };
}

/**
 * SELFTEST -- runs with `--selftest`. No network for the logic tests;
 * the live-mode unreachable test makes a real fetch to a .invalid host.
 */
async function selftest() {
  const fails = [];
  let cases = 0;
  const check = (name, cond) => { cases += 1; if (!cond) fails.push(name); };

  // Test 1: live mode with an unresolvable host should exit 1 (real fetch to .invalid)
  // .invalid TLD is guaranteed not to resolve (RFC 6761)
  const testBase = 'http://verify-links-selftest.invalid';
  const result = await verify(testBase, false);
  check('live mode with unresolvable host returns ok=false', result.ok === false);
  check('live mode with unresolvable host produces no problems array (early exit)', Array.isArray(result.problems));

  // Test 2: local mode with an unresolvable host should also fail (same behavior)
  const resultLocal = await verify(testBase, true);
  check('local mode with unresolvable host returns ok=false', resultLocal.ok === false);

  // Test 3: verify logic function exists and is callable
  check('verify function is callable', typeof verify === 'function');

  if (fails.length) {
    console.error(red(`FAIL: ${fails.length} selftest case(s).`));
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(green(`ok: verify-links selftest passes ${cases} synthetic case(s)`));
  process.exit(0);
}

if (process.argv.includes('--selftest')) {
  await selftest();
  // selftest calls process.exit, but guard anyway
}

/* ------------------------------------------------------- main execution */

if (!process.argv.includes('--selftest')) {
  const { ok, problems: mainProblems, ct } = await verify(BASE, LOCAL);

  if (mainProblems.length) {
    console.error(red(`\nFAIL: ${mainProblems.length} problem(s) with ${LOCAL ? "this branch's web/ (local)" : ORIGIN}\n`));
    for (const p of mainProblems) console.error(`  ${p}\n`);
    console.error('  web/README.md has the deploy steps and what each file is for.\n');
    await finish(1);
  }

  if (LOCAL) {
    console.log(green("ok: this branch's web/ serves our association file, our invitation pages and the Android link"));
    console.log(`  appID ${EXPECTED_APP_ID} · Content-Type ${ct}`);
    // Said out loud so a green pull request is not read as a green site (CLAUDE.md, lane G).
    console.log(yellow('  LIVE ONLY, NOT MEASURED HERE (the post-deploy job .github/workflows/live-links.yml asks the live host):'));
    console.log(yellow(`    - that ${ORIGIN} is OURS and serves these files (ownership, deploy state)`));
    console.log(yellow('    - Cloudflare behaviour: the app shell at the root, the 308 off index.html, node_modules paths, edge caching'));
    console.log(yellow("    - /api/music through Cloudflare rather than in-process"));
  } else {
    console.log(green(`ok: ${ORIGIN} serves our association file and our invitation page`));
    console.log(`  appID ${EXPECTED_APP_ID} · Content-Type ${ct}`);
  }
  console.log(yellow('  Still UNVERIFIED on a device: only an iPhone proves iOS accepts it.'));
  await finish(0);
}

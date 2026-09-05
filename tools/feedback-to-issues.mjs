#!/usr/bin/env node
/**
 * The channel for testers who have no terminal.
 *
 * A tester screenshots inside the app, taps "Share Beta Feedback", and types a
 * sentence. Apple keeps it. Nobody reads it, because reading it means REMEMBERING
 * to -- and a report nobody files is a report nobody fixes. This turns each one
 * into a GitHub issue with their words, their device, their build, and the picture.
 *
 * NOT A GATE, AND IT MUST NOT BECOME ONE. It never exits non-zero because a tester
 * found a bug. Putting it in docker/run-checks.sh would make a green board a claim
 * about tester SILENCE, which is not a thing this project can verify. It borrows the
 * tools/ header, colours and exit conventions and nothing else.
 *
 * WHY THE SCREENSHOTS ARE COMMITTED. eas-cli's own type says it outright --
 * `TestFlightScreenshot`: "Its URL expires after a short while." An issue whose only
 * evidence is a signed Apple URL is an issue that decays into a description of a
 * picture nobody can see. So the bytes land in design/feedback/, which is the
 * design/device/ side of the .gitignore rule: irreproducible evidence off a real
 * device is committed; regenerated output is not.
 *
 * WHY THE REST API AND NOT `gh`. This same file runs from a laptop and from an EAS
 * workflow container, and `gh` is not guaranteed there. One code path, two callers,
 * no drift. Locally the token falls back to `gh auth token`, so there is nothing new
 * to configure by hand.
 *
 * THE TESTER'S EMAIL IS DELIBERATELY NOT WRITTEN DOWN. App Store Connect hands us
 * `testerEmail` and we drop it. A private repo can be made public later, and git
 * history is forever; the name is enough to know who to thank, and the address is
 * one click away in App Store Connect if you need to reply.
 *
 *   pnpm feedback:sync                 # everything not yet filed
 *   node tools/feedback-to-issues.mjs <id-or-url>   # one item (the workflow case)
 *
 * Exits non-zero only when it cannot do its job -- a missing CLI, a refused API call.
 * Finding nothing is success and says so.
 */
import { execFileSync } from 'node:child_process';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const OFF = '\x1b[0m';

/** `eas testflight:feedback` and `:crashes` landed here. eas.json's floor is 16.28.0. */
const EAS_MIN = [21, 3, 0];

const FEEDBACK_LABEL = 'tester-feedback';
const CRASH_LABEL = 'crash-report';

/* ------------------------------------------------------------------ the token */

function githubToken() {
  // RUNIT_GH_TOKEN first and by name: a bare GH_TOKEN is silently consumed by any `gh`
  // in the same shell, and GITHUB_TOKEN is what GitHub Actions injects for free -- either
  // would make "which credential wrote this issue" ambiguous in a log. The other two stay
  // as fallbacks so a laptop needs no setup at all.
  const fromEnv = process.env.RUNIT_GH_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const token = githubToken();
if (!token) {
  // The verify-policies.mjs shape: say what went unchecked, in the same voice as a
  // failure, and name the fix. A channel that fails silently is the failure this
  // file exists to correct.
  console.log(`${YELLOW}SKIPPED: tester feedback -> issues${OFF}`);
  console.log('  No GitHub token (RUNIT_GH_TOKEN, GH_TOKEN, GITHUB_TOKEN or `gh auth login`),');
  console.log('  so ANY');
  console.log('  TESTER FEEDBACK SUBMITTED SINCE THE LAST RUN WENT UNFILED.');
  console.log('  Nothing is lost -- App Store Connect keeps it either way, and this is');
  console.log('  idempotent, so a later run picks up everything it missed.');
  console.log('  Set a token and re-run to turn it into tracked issues.');
  process.exit(0);
}

/* -------------------------------------------------------------------- the repo */

const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
const slug = remote.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
const [OWNER, REPO] = slug.split('/');
if (!OWNER || !REPO) {
  console.error(`${RED}FAIL${OFF}: could not read owner/repo from origin (${remote}).`);
  process.exit(1);
}

/* ----------------------------------------------------------------- the eas cli */

let easVersion;
try {
  easVersion = execFileSync('eas', ['--version'], { encoding: 'utf8' }).match(/eas-cli\/(\d+)\.(\d+)\.(\d+)/);
} catch {
  console.error(`${RED}FAIL${OFF}: eas-cli is not on PATH. It is installed globally, not as a devDependency:`);
  console.error('  pnpm add -g eas-cli');
  process.exit(1);
}
const have = easVersion.slice(1, 4).map(Number);
const olderThanMin = have.some((n, i) => n < EAS_MIN[i] && have.slice(0, i).every((m, j) => m === EAS_MIN[j]));
if (olderThanMin) {
  // eas.json declares `"cli": {"version": ">= 16.28.0"}` -- a FLOOR, not a pin, and five
  // majors below what these commands need. Honouring that floor gets you an unparseable
  // JSON crash instead of a sentence. Same shape as closed issue #5.
  console.error(`${RED}FAIL${OFF}: eas-cli ${have.join('.')} has no \`testflight:feedback\`.`);
  console.error(`  It landed in ${EAS_MIN.join('.')}. eas.json's ">= 16.28.0" does not cover it.`);
  console.error('  pnpm add -g eas-cli@latest');
  process.exit(1);
}

/* -------------------------------------------------------------------- plumbing */

function easJson(args) {
  let out;
  try {
    out = execFileSync('eas', [...args, '--json', '--non-interactive'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], // the "Using App Store Connect API Key" line is stderr
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    // A workflow can hand us an id App Store Connect no longer serves, and a stack trace
    // is not a report. Say which call failed and what eas said.
    console.error(`${RED}FAIL${OFF}: eas ${args.join(' ')}`);
    const said = (e.stderr ?? '').toString().trim() || (e.stdout ?? '').toString().trim();
    for (const line of said.split('\n').slice(0, 6)) console.error(`  ${line}`);
    process.exit(1);
  }
  try {
    return JSON.parse(out);
  } catch {
    // The shape changed under us -- a newer eas-cli, most likely. The version floor above
    // cannot catch that; only this can.
    console.error(`${RED}FAIL${OFF}: eas ${args.join(' ')} did not return JSON.`);
    console.error(`  eas-cli ${have.join('.')} may have changed its output. First 200 chars:`);
    console.error(`  ${out.slice(0, 200)}`);
    process.exit(1);
  }
}

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${res.status} ${init.method ?? 'GET'} ${path}\n${text.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

const marker = (kind, id) => `<!-- testflight:${kind}:${id} -->`;


/* ---------------------------------------------------------------- what is filed */

/**
 * Markers of everything already filed.
 *
 * Read from the ISSUES LIST, never from `search/issues`. Search is an index and it is
 * eventually consistent -- an issue created seconds ago may not appear in it for a
 * minute, so a workflow and a manual run firing on the same item would BOTH decide it
 * was new and file it twice. The list endpoint reads the database.
 */
async function alreadyFiled() {
  const seen = new Set();
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(
      `/repos/${OWNER}/${REPO}/issues?state=all&per_page=100&page=${page}&labels=${FEEDBACK_LABEL},${CRASH_LABEL}`,
    );
    for (const issue of batch) {
      const m = /<!-- testflight:(crash|screenshot):([^\s>]+) -->/.exec(issue.body ?? '');
      if (m) seen.add(`${m[1]}:${m[2]}`);
    }
    if (batch.length < 100) break;
  }
  return seen;
}

async function ensureLabels() {
  const wanted = [
    [FEEDBACK_LABEL, 'B60205', 'Reported by a TestFlight tester, filed automatically'],
    [CRASH_LABEL, 'D93F0B', 'Crash reported through TestFlight, filed automatically'],
  ];
  for (const [name, color, description] of wanted) {
    try {
      await gh(`/repos/${OWNER}/${REPO}/labels`, {
        method: 'POST',
        body: JSON.stringify({ name, color, description }),
      });
      console.log(`  created label ${name}`);
    } catch (e) {
      if (e.status !== 422) throw e; // 422 = it already exists, which is the normal case
    }
  }
}

/* ------------------------------------------------------------------ screenshots */

/**
 * Commit the bytes and return a permalink.
 *
 * The Contents API writes a commit straight from base64 -- no checkout, no push
 * credentials -- which is the whole reason one script can serve a laptop and an
 * ephemeral EAS container without branching on which it is.
 *
 * A 422 means the path already exists, which is a DATABASE-backed "already handled"
 * and a second line of defence behind the marker scan above.
 */
/**
 * A submission id is remote data, and it becomes a PATH.
 *
 * App Store Connect issues UUIDs, but "it has always been a UUID" is not a permission
 * check. A `..` or a `/` in an id would walk the PUT out of design/feedback/ and write
 * anywhere in the repo the token can reach -- and this token can reach all of it.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function safeId(id, kind) {
  if (typeof id === 'string' && SAFE_ID.test(id) && !id.includes('..')) return id;
  console.error(`${RED}FAIL${OFF}: App Store Connect returned a ${kind} id that cannot be a path`);
  console.error(`  component: ${JSON.stringify(id).slice(0, 120)}`);
  console.error('  Refusing to write it. This is either a change at Apple or something worse.');
  process.exit(1);
}

async function commitScreenshot(url, path) {
  const res = await fetch(url);
  if (!res.ok) {
    // Expected eventually: the type's own comment says these URLs expire.
    console.log(`  ${YELLOW}screenshot URL expired or unreachable (${res.status}); filing without it${OFF}`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Sniff, do not trust. An expired or rewritten URL can answer 200 with an HTML error
  // page, and committing that as a .png produces evidence that is not evidence -- the
  // exact failure this whole file exists to prevent, one layer down.
  const isPng = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpg = buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (!isPng && !isJpg) {
    console.log(`  ${YELLOW}not an image (${buf.subarray(0, 4).toString('hex')}); filing without it${OFF}`);
    return null;
  }
  const content = buf.toString('base64');
  try {
    await gh(`/repos/${OWNER}/${REPO}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `Tester screenshot: ${path.split('/').pop()}`, content }),
    });
    console.log(`  committed ${path}`);
  } catch (e) {
    // 422 (and sometimes 409) means the path exists and we did not pass its blob sha.
    // That is a DATABASE-backed "already handled" -- a second line of defence behind the
    // marker scan, and the one that survives a search index that has not caught up.
    if (e.status !== 422 && e.status !== 409) throw e;
    console.log(`  ${path} already committed`);
  }
  return `https://github.com/${OWNER}/${REPO}/blob/main/${path}`;
}

/* ----------------------------------------------------------------- issue bodies */

const bytes = (n) => (n == null ? null : `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`);

function facts(s) {
  // Only what helps reproduce. testerEmail is available and deliberately omitted --
  // see the header.
  return [
    ['Device', [s.deviceModel, s.deviceFamily].filter(Boolean).join(' · ')],
    ['iOS', s.osVersion],
    ['Build', s.buildVersion],
    ['Tester', s.testerName],
    ['Submitted', s.createdDate],
    ['Locale', [s.locale, s.timeZone].filter(Boolean).join(' · ')],
    ['Connection', s.connectionType],
    ['Battery', s.batteryPercentage == null ? null : `${Math.round(s.batteryPercentage * 100)}%`],
    ['Disk free', bytes(s.diskBytesAvailable)],
  ].filter(([, v]) => v);
}

const table = (rows) => ['| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');

function feedbackIssue(f, links) {
  const said = f.comment?.trim();
  const title = said
    ? `Tester on ${f.deviceModel}, iOS ${f.osVersion}: "${said.split('\n')[0].slice(0, 90)}"`
    : `Tester on ${f.deviceModel}, iOS ${f.osVersion} sent a screenshot with no comment`;
  const body = [
    said ? `> ${said.split('\n').join('\n> ')}` : '_No comment — the screenshot is the whole report._',
    '',
    table(facts(f)),
    '',
    links.length
      ? `Screenshot${links.length > 1 ? 's' : ''}, committed because Apple's URLs expire:\n` +
        links.map((l) => `- ${l}`).join('\n')
      : "_Apple's screenshot URL had already expired when this was filed._",
    '',
    'There are no reproduction steps here. A screenshot proves a screen looked this way',
    'on one device at one moment; it does not say what the tester did to reach it. Ask',
    'before assuming a repro.',
    '',
    'Filed automatically from TestFlight by `tools/feedback-to-issues.mjs`.',
    marker('screenshot', f.id),
  ].join('\n');
  return { title, body, labels: [FEEDBACK_LABEL] };
}

function crashIssue(c, logText) {
  const first = logText?.split('\n').find((l) => l.trim()) ?? '';
  const title = `Crash on ${c.deviceModel}, iOS ${c.osVersion}${c.buildVersion ? `, build ${c.buildVersion}` : ''}` +
    (first ? `: ${first.slice(0, 70)}` : '');
  const body = [
    c.comment?.trim() ? `> ${c.comment.trim().split('\n').join('\n> ')}\n` : '',
    table(facts(c)),
    '',
    logText
      ? `<details><summary>Crash log</summary>\n\n\`\`\`\n${logText.slice(0, 60000)}\n\`\`\`\n\n</details>`
      : '_App Store Connect has no log for this submission._',
    '',
    'Filed automatically from TestFlight by `tools/feedback-to-issues.mjs`.',
    marker('crash', c.id),
  ].join('\n');
  return { title, body, labels: [CRASH_LABEL] };
}

/* ----------------------------------------------------------------------- main */

/**
 * The one argument, and it is NOT trusted.
 *
 * It arrives from an EAS workflow trigger, i.e. from App Store Connect, and is handed
 * straight to an `eas` argv slot. execFileSync takes an array so no shell sees it -- but
 * a value beginning with `-` is read by eas as a FLAG, not an id, which is argument
 * injection even without a shell. Accept only the two shapes that are real: an ASC
 * submission id, or an api.appstoreconnect.apple.com URL.
 */
const ASC_ID = /^[0-9a-fA-F-]{8,64}$/;
const ASC_URL = /^https:\/\/api\.appstoreconnect\.apple\.com\/[A-Za-z0-9/_.-]+$/;
const only = process.argv[2];
if (only !== undefined && !ASC_ID.test(only) && !ASC_URL.test(only)) {
  console.error(`${RED}FAIL${OFF}: refusing an argument that is neither an App Store Connect`);
  console.error('  submission id nor an api.appstoreconnect.apple.com URL:');
  console.error(`    ${JSON.stringify(only).slice(0, 120)}`);
  process.exit(1);
}
const filed = await alreadyFiled();

const feedback = only
  ? (easJson(['testflight:feedback', only, '--type', 'screenshot']).feedback ?? []).filter(Boolean)
  : easJson(['testflight:feedback', '--limit', '100']).feedback;
const crashes = only ? [] : easJson(['testflight:crashes', '--limit', '100']).crashes;

console.log(`TestFlight: ${feedback.length} screenshot submission(s), ${crashes.length} crash(es)`);

let created = 0;
if (feedback.length || crashes.length) await ensureLabels();

for (const f of feedback) {
  safeId(f.id, 'feedback');
  if (filed.has(`screenshot:${f.id}`)) continue;
  const links = [];
  for (const [i, shot] of (f.screenshots ?? []).entries()) {
    const link = await commitScreenshot(shot.url, `design/feedback/${safeId(f.id, 'feedback')}-${i + 1}.png`);
    if (link) links.push(link);
  }
  const issue = await gh(`/repos/${OWNER}/${REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify(feedbackIssue(f, links)),
  });
  console.log(`  ${GREEN}filed #${issue.number}${OFF}  ${issue.title}`);
  created++;
}

for (const c of crashes) {
  safeId(c.id, 'crash');
  if (filed.has(`crash:${c.id}`)) continue;
  let logText = null;
  try {
    logText = easJson(['testflight:crashes', c.id, '--type', 'crash']).logText ?? null;
  } catch {
    /* the log is a bonus, not a requirement */
  }
  const issue = await gh(`/repos/${OWNER}/${REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify(crashIssue(c, logText)),
  });
  console.log(`  ${GREEN}filed #${issue.number}${OFF}  ${issue.title}`);
  created++;
}

console.log(
  created
    ? `${GREEN}ok: filed ${created} new issue(s) from TestFlight${OFF}`
    : `${GREEN}ok: no new tester feedback${OFF}`,
);

#!/usr/bin/env node
/**
 * THE CHANNEL FOR CUSTOMERS WHO HAVE NO GITHUB ACCOUNT -- #77.
 *
 * `feedback-to-issues.mjs` beside this calls itself "the channel for testers who have no
 * terminal", and it is the same idea one audience further out. It stops working the day the
 * app leaves TestFlight, because that feedback exists only for beta builds. After launch a
 * customer's only route to us is a support URL on a static page, so the app grew its own
 * "Something not right?" and writes a `public.feedback` row. This turns those rows into
 * issues.
 *
 * THE GITHUB TOKEN NEVER REACHES A SERVER, which is why this is a laptop tool rather than a
 * third Edge Function beside `send-push` and `delete-account`. Those hold the SERVICE ROLE,
 * which is this project's own secret. A token that can file an issue is a credential for
 * somebody else's system and the narrowest one that can post to a tracker can also read every
 * private repo it is scoped to. It stays where `gh auth token` already is.
 *
 * NOT A GATE, and it must never enter `run-checks.sh` -- the same rule its sibling states.
 * Exiting non-zero because a customer found a bug would make a green board a claim about
 * customer silence, which is not a thing this project can verify.
 *
 * DEDUPE READS THE ISSUES LIST, NEVER `search/issues`, for the reason the sibling documents:
 * search is an eventually-consistent index, so two runs seconds apart would both decide a
 * row was new and file it twice. The list endpoint reads the database.
 *
 *   pnpm feedback:app          # everything not yet filed
 *   pnpm feedback:app --dry    # what it would file, writing nothing
 *
 * NEEDS A SERVICE-ROLE READ. `public.feedback` has NO select policy for any client role --
 * deliberately, because a queue a guest could read is a list of other people's complaints.
 *
 * TWO WAYS TO READ, AND THE NARROW ONE IS PREFERRED (2026-09-21).
 *
 * `.github/workflows/feedback.yml` runs this every hour, so a tester's report becomes an issue
 * without anybody typing a command -- the owner's decision, over keeping it a laptop tool. It
 * reads with `SUPABASE_SERVICE_ROLE_KEY`, which the workflow fills from the repo secret
 * `SUPABASE_FEEDBACK_KEY`: a DEDICATED `sb_secret_` key named `github_feedback_action`,
 * created for this and nothing else, so revoking it in the dashboard cuts off exactly this
 * and leaves the Edge Functions' key alone. It is scoped to ONE project.
 *
 * The laptop fallback is the Management API with `SUPABASE_ACCESS_TOKEN`, which is the legacy
 * token and reads and writes EVERY project on the account. That is acceptable passed for one
 * invocation on a machine; it is not acceptable stored in CI, which is why the Action does not
 * use it and why the project key is tried first.
 *
 * The GitHub side is unchanged: the Action's own `GITHUB_TOKEN`, scoped to this repository and
 * expiring with the run. No token that can reach GitHub ever sits on a Supabase server.
 */
import { execFileSync } from 'node:child_process';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const OFF = '\x1b[0m';

const OWNER = 'TortoiseWolfe';
const REPO = 'runit';
const LABEL = 'from-a-customer';
const PROJECT_REF = 'qwusbxallkbzfladvgfx';
const DRY = process.argv.includes('--dry');

// Read by hoisted functions below, so declared before anything runs (TDZ).
const TRAILING_MARKER = /<!-- app-feedback:([0-9a-f-]{36}) -->\s*$/;
const MAX_BODY = 2000;
const MAX_CELL = 120;

/** `gh auth token` locally; an env var in anything that is not a laptop. */
function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    console.error(`${RED}FAIL${OFF}: no GITHUB_TOKEN and \`gh auth token\` did not work.`);
    process.exit(1);
  }
}
// Resolved on first use, not at import: `--selftest` and `--dry` must run with no token.
let tokenCache = null;
const tokenOf = () => (tokenCache ??= githubToken());

/** Like `gh`, but a non-2xx is thrown to the caller rather than ending the process. */
async function ghSoft(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tokenOf()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tokenOf()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${RED}FAIL${OFF}: GitHub ${init.method ?? 'GET'} ${path} -> ${res.status}`);
    console.error(`  ${text.slice(0, 300)}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : null;
}

/** The Supabase Management API, the same route `schema:check` and the deploys use. */
async function sql(query) {
  const { envLocal } = await import('./lib/env.mjs');
  const t = envLocal('SUPABASE_ACCESS_TOKEN');
  if (!t) {
    console.log(`${YELLOW}SKIPPED${OFF}: no SUPABASE_ACCESS_TOKEN, so nothing was read.`);
    process.exit(0);
  }
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) {
    // A fine-grained token reads auth config and NOT the database -- that is a real and
    // recoverable state, not a crash, and saying which token is missing is the whole help.
    console.log(`${YELLOW}SKIPPED${OFF}: could not read public.feedback (${r.status}).`);
    console.log(`  This needs the legacy full-access token, the one that applies SQL here.`);
    console.log(`  ${text.slice(0, 160)}`);
    process.exit(0);
  }
  return JSON.parse(text);
}

const marker = (id) => `<!-- app-feedback:${id} -->`;

/**
 * ONLY A TRAILING MARKER COUNTS. The reporter's own words are in the body ABOVE the marker,
 * and the first version matched the first marker-shaped thing anywhere in the issue -- so a
 * report whose text contained `<!-- app-feedback:x -->` was recorded as "x", never as
 * itself, and re-filed every hour forever. The real marker is the last line, and nothing a
 * reporter writes can be the last line because `issueBody` puts it there.
 */
export function markerIn(body) {
  const m = TRAILING_MARKER.exec(body ?? '');
  return m ? m[1] : null;
}

async function alreadyFiled() {
  const seen = new Set();
  // No page cap: a cap is a silent "everything past here is new", which re-files old reports
  // the day the label crosses it.
  for (let page = 1; ; page++) {
    const batch = await gh(
      `/repos/${OWNER}/${REPO}/issues?state=all&per_page=100&page=${page}&labels=${LABEL}`,
    );
    for (const issue of batch) {
      const id = markerIn(issue.body);
      if (id) seen.add(id);
    }
    if (batch.length < 100) break;
  }
  return seen;
}

/**
 * UNTRUSTED TEXT GOES IN A FENCE, AND THE THINGS GITHUB REACTS TO ARE DEFUSED FIRST. Inside
 * a code fence GitHub does not render `@mentions` (no notifications), `#123` and
 * `owner/repo#123` (no backlinks from this repo onto strangers' issues), or HTML comments
 * (no forged marker). A fence can still be CLOSED by three backticks in the text, so those
 * are broken up; and `<!--` is broken up as belt to that brace. Length is bounded here as
 * well as in the database, because a 65k body is a 422 from GitHub and this ran unattended.
 */
export function fenced(text) {
  const safe = String(text ?? '')
    .slice(0, MAX_BODY)
    .replace(/```/g, '`\u200b``')
    .replace(/<!--/g, '<!\u200b--')
    .replace(/\r/g, '');
  return ['```text', safe, '```'].join('\n');
}
/** One table cell: no pipes, no newlines, bounded. Markdown tables have no escaping. */
export function cell(v) {
  return String(v ?? '').replace(/[|\r\n]+/g, ' ').replace(/<!--/g, '<!\u200b--').slice(0, MAX_CELL);
}

/** A title somebody can scan in a list: their own first line, trimmed. */
function titleFor(body) {
  const first = body.trim().split('\n')[0].trim().replace(/[@#<>`]/g, ' ').replace(/\s+/g, ' ');
  const short = first.length > 68 ? `${first.slice(0, 65)}…` : first;
  return `Customer: ${short}`;
}

/**
 * THE PICTURE IS NOT PUBLISHED, AND THIS REPOSITORY BEING PUBLIC IS THE WHOLE REASON.
 *
 * This tool used to COMMIT the bytes to `design/feedback/`, on the sibling tool's rule that
 * a signed URL "expires after a short while" and an issue whose only evidence is one decays
 * into a description of a picture nobody can see. That rule is right. The premise underneath
 * it was not: `CLAUDE.md` asserted this repository was private, and it has been public since
 * the day it was created.
 *
 * A screenshot of THIS product is other people's photographs. Somebody reporting "my photo
 * never appeared" screenshots the album -- which is a room full of guests who never heard of
 * us, under their own nicknames. An hourly job that publishes that to a public repository,
 * irreversibly, is not a thing to leave running while the argument for it is re-read.
 *
 * THE DECAY ARGUMENT DOES NOT BITE HERE, which is what makes this cheap. Unlike the
 * TestFlight channel, this one has a DURABLE reference: `feedback.screenshot_path` names an
 * object in a bucket that does not expire. So the issue records the report id, and a
 * maintainer runs `pnpm feedback:shot <id>` to pull the bytes into `.feedback-shots/`, which
 * is gitignored. The workflow therefore needs `contents: read`, not `write`.
 *
 * THE PATH ITSELF IS NOT PRINTED EITHER. It is `{auth_user_id}/{uuid}.ext`, so publishing it
 * would put a reporter's identity in a public issue -- pseudonymous, but it links every
 * report from one device, and this channel promises that nothing identifying travels. The
 * row id is already in the dedupe marker and is enough for the fetch tool to find the rest.
 *
 * AND THE PATH-SHAPE GUARD WENT WITH IT, deliberately, rather than being deleted. It belongs
 * wherever that client-written string is interpolated into a service-role URL, and that is
 * now `tools/feedback-shot.mjs`.
 */

function issueBody(row) {
  const ctx = row.context ?? {};
  const facts = [
    ['Platform', [ctx.platform, ctx.os].filter(Boolean).join(' ')],
    ['App', [ctx.app, ctx.build && `(${ctx.build})`].filter(Boolean).join(' ')],
    ['Locale', [ctx.locale, ctx.timezone].filter(Boolean).join(' · ')],
    ['Route', ctx.route],
    ['Seat', ctx.seat],
    ['Connection', ctx.connection],
    // THE UUID, NEVER THE CODE. The six-character code is the admission credential; this
    // issue is public. A maintainer with the service role can resolve the uuid.
    ['Event', row.event_id],
    ['Sent', row.created_at],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  return [
    fenced(row.body),
    '',
    '| | |',
    '|---|---|',
    ...facts.map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`),
    '',
    // TWO CAUSES, NOT ONE -- the distinction the sibling tool draws and for the same
    // reason. "No picture" and "a picture we could not fetch" are different facts, and
    // asserting the first over the second states a cause that was never established.
    ...(row.screenshot_path
      ? [
          '',
          'They attached a screenshot. It is **not** published here -- this repository is',
          'public and the picture is very likely other guests. Pull it into the gitignored',
          '`.feedback-shots/` with:',
          '',
          '```',
          `pnpm feedback:shot ${row.id}`,
          '```',
        ]
      : []),
    '',
    'Filed by `pnpm feedback:app` from `public.feedback`. The reporter has no GitHub',
    'account and cannot see this issue; there is no reply path back to them, by design --',
    'nothing identifying was collected.',
    '',
    marker(row.id),
  ].join('\n');
}

/* --------------------------------------------------------------------------- run */

/**
 * The rows, through PostgREST with the project key when there is one -- the path CI takes --
 * and through the Management API otherwise. Both return the same shape, so nothing below
 * knows which ran. `events(code)` is the embedded foreign key `feedback.event_id` declares.
 */
/**
 * NEWEST FIRST, IN PAGES, UNTIL A PAGE IS ENTIRELY OLD NEWS. The first version read the
 * 200 OLDEST rows and rows are never deleted -- so from the 201st report on nothing new was
 * ever filed, and filling those slots was a way to switch the channel off. `created_at` is
 * server-stamped now (feedback_guard), so newest-first is a trustworthy order.
 */
const PAGE = 200;
async function reports(filed) {
  const { envLocal } = await import('./lib/env.mjs');
  const url = envLocal('EXPO_PUBLIC_SUPABASE_URL');
  const key = envLocal('SUPABASE_SERVICE_ROLE_KEY');
  if (url && key) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(
      `${url}/rest/v1/feedback?select=id,body,context,screenshot_path,created_at,event_id` +
        `&order=created_at.desc&limit=${PAGE}&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    const text = await res.text();
    if (!res.ok) {
      // Loud rather than SKIPPED: with a key present, a refusal means the key was revoked or
      // is wrong, and an hourly job that quietly measures nothing is the failure lane E spent
      // a year being.
      console.error(`${RED}FAIL${OFF}: could not read public.feedback with the project key (${res.status}).`);
      console.error(`  ${text.slice(0, 200)}`);
      process.exit(1);
    }
    const page = JSON.parse(text).map((r) => ({
      id: String(r.id),
      body: r.body,
      context: r.context,
      screenshot_path: r.screenshot_path,
      created_at: String(r.created_at),
      event_id: r.event_id ?? null,
    }));
    out.push(...page);
    if (page.length < PAGE || page.every((r) => filed.has(r.id))) break;
    }
    return out;
  }
  return sql(`
    select f.id::text, f.body, f.context, f.screenshot_path, f.created_at::text,
           f.event_id::text as event_id
      from public.feedback f
     order by f.created_at desc
     limit 1000`);
}

/* --------------------------------------------------------------------- selftest */

/**
 * `--selftest` runs the text-handling with no network and no credential, because every
 * real run takes the happy path and the hostile inputs below would otherwise be reachable
 * only by a stranger. Same doctrine as `audit:auth-config --selftest`.
 */
if (process.argv.includes('--selftest')) {
  const fails = [];
  const check = (name, ok) => { if (!ok) fails.push(name); console.log(`  ${ok ? 'ok' : 'FAIL'}  ${name}`); };
  const fake = '<!-- app-feedback:11111111-1111-4111-8111-111111111111 -->';
  const real = '22222222-2222-4222-8222-222222222222';
  const body = issueBody({ id: real, body: `hello ${fake}\n@octocat see owner/repo#1`, context: { platform: 'ios | web\nx' }, screenshot_path: null, event_id: 'e', created_at: 'now' });
  check('the dedupe marker is the real id, not one typed in the report', markerIn(body) === real);
  check('a forged marker cannot appear as a live comment', !body.includes(fake));
  check('the words are inside a fence', /```text\n[\s\S]*```/.test(body));
  check('a fence in the text cannot close ours', !fenced('```\n@x').split('```').some((_, i, a) => a.length > 3));
  check('a pipe in a context value does not break the table', !/\| ios \| web/.test(body));
  check('a body is bounded', fenced('a'.repeat(10000)).length < 2200);
  check('the event is named by id and never by code', body.includes('| Event | e |'));
  if (fails.length) { console.error(`${RED}FAIL${OFF}: ${fails.length} selftest case(s)`); process.exit(1); }
  console.log(`${GREEN}ok${OFF}: feedback filer selftest, 7 cases`);
  process.exit(0);
}



const filed = DRY ? new Set() : await alreadyFiled();
const rows = await reports(filed);

if (rows.length === 0) {
  console.log(`${GREEN}ok${OFF}: nothing has been reported.`);
  process.exit(0);
}

const fresh = rows.filter((r) => !filed.has(r.id));

console.log(`${rows.length} report(s), ${fresh.length} not yet filed`);

if (fresh.length === 0) {
  console.log(`${GREEN}ok${OFF}: every report is already an issue.`);
  process.exit(0);
}

if (!DRY) {
  try {
    await gh(`/repos/${OWNER}/${REPO}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        name: LABEL,
        color: '0E8A16',
        description: 'Reported from inside the app by somebody with no GitHub account',
      }),
    });
  } catch {
    // Already exists. `gh()` exits on failure, so this is belt-and-braces for a 422 that
    // a future version might not treat as fatal.
  }
}

for (const row of fresh) {
  const title = titleFor(row.body);
  if (DRY) {
    console.log(`  would file: ${title}`);
    continue;
  }
  // A row GitHub refuses (a 422 over a body it will not take) is skipped and named, not
  // fatal: `gh()` exits on any non-2xx, and one hostile row used to end every run after it.
  let issue;
  try {
    issue = await ghSoft(`/repos/${OWNER}/${REPO}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body: issueBody(row), labels: [LABEL] }),
    });
  } catch (e) {
    console.error(`  ${YELLOW}skipped ${row.id}: ${String(e).slice(0, 120)}${OFF}`);
    continue;
  }
  console.log(`  #${issue.number}  ${title}`);
}

console.log('');
console.log(`${YELLOW}These are what customers asked for.${OFF} Read them before the backlog:`);
console.log(`  https://github.com/${OWNER}/${REPO}/issues?q=is%3Aissue+label%3A${LABEL}`);

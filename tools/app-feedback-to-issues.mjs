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
 * deliberately, because a queue a guest could read is a list of other people's complaints --
 * so this reads it through the Management API with the token that already applies SQL here.
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
const token = githubToken();

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

async function alreadyFiled() {
  const seen = new Set();
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(
      `/repos/${OWNER}/${REPO}/issues?state=all&per_page=100&page=${page}&labels=${LABEL}`,
    );
    for (const issue of batch) {
      const m = /<!-- app-feedback:([^\s>]+) -->/.exec(issue.body ?? '');
      if (m) seen.add(m[1]);
    }
    if (batch.length < 100) break;
  }
  return seen;
}

/** A title somebody can scan in a list: their own first line, trimmed. */
function titleFor(body) {
  const first = body.trim().split('\n')[0].trim();
  const short = first.length > 68 ? `${first.slice(0, 65)}…` : first;
  return `Customer: ${short}`;
}

/**
 * COMMIT THE PICTURE, DO NOT LINK TO IT -- and this is the sibling tool's hardest-won rule.
 * `feedback-to-issues.mjs` says it outright: a signed URL "expires after a short while", so
 * an issue whose only evidence is one decays into a description of a picture nobody can see.
 * The bucket is private, so a raw link would be worse than useless.
 *
 * `design/feedback/` is the same destination and the same side of the .gitignore rule that
 * `design/device/` sits on: irreproducible evidence off a real device is committed.
 *
 * A FAILURE HERE DOES NOT STOP THE ISSUE. The sentence is the report; the picture is evidence
 * for it, and filing nothing because an image could not be fetched would throw away the thing
 * we actually asked for. Returns null and the body says which of the two happened.
 */
async function commitScreenshot(row) {
  const { envLocal } = await import('./lib/env.mjs');
  const url = envLocal('EXPO_PUBLIC_SUPABASE_URL');
  const key = envLocal('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;

  /*
   * REFUSE ANYTHING THAT IS NOT TWO UUIDS AND A KNOWN EXTENSION, before it reaches a URL.
   *
   * This string comes from a column a CLIENT writes, and the fetch below carries the
   * SERVICE ROLE -- which reads every folder in every bucket, whatever RLS tells a client.
   * Unchecked, `../event-photos/<event>/<photo>.jpg` would fetch a guest's private
   * photograph and this tool would COMMIT IT TO THE REPOSITORY.
   *
   * The database now refuses to store such a path at all, in two places: a CHECK constraint
   * on the shape and `feedback_guard` comparing the prefix to the reporter's own identity.
   * This is here anyway, because rows written before those guards existed are still in the
   * table, and because the thing on the other side of this interpolation is somebody else's
   * photographs.
   */
  if (!/^[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.(jpg|png|webp)$/.test(row.screenshot_path ?? '')) {
    console.error(`  refusing a screenshot path that is not {uuid}/{uuid}.ext: ${row.id}`);
    return null;
  }

  try {
    const res = await fetch(
      `${url}/storage/v1/object/feedback/${row.screenshot_path}`,
      { headers: { Authorization: `Bearer ${key}`, apikey: key } },
    );
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    const path = `design/feedback/app-${row.id}.jpg`;
    await gh(`/repos/${OWNER}/${REPO}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Screenshot from a customer report (${row.id})`,
        content: bytes.toString('base64'),
      }),
    });
    return `https://github.com/${OWNER}/${REPO}/blob/main/${path}`;
  } catch {
    return null;
  }
}

function issueBody(row, shotLink) {
  const ctx = row.context ?? {};
  const facts = [
    ['Platform', [ctx.platform, ctx.os].filter(Boolean).join(' ')],
    ['App', [ctx.app, ctx.build && `(${ctx.build})`].filter(Boolean).join(' ')],
    ['Locale', [ctx.locale, ctx.timezone].filter(Boolean).join(' · ')],
    ['Route', ctx.route],
    ['Seat', ctx.seat],
    ['Connection', ctx.connection],
    ['Event', row.event_code],
    ['Sent', row.created_at],
  ].filter(([, v]) => v);

  return [
    '> ' + row.body.trim().split('\n').join('\n> '),
    '',
    '| | |',
    '|---|---|',
    ...facts.map(([k, v]) => `| ${k} | ${v} |`),
    '',
    // TWO CAUSES, NOT ONE -- the distinction the sibling tool draws and for the same
    // reason. "No picture" and "a picture we could not fetch" are different facts, and
    // asserting the first over the second states a cause that was never established.
    ...(row.screenshot_path
      ? shotLink
        ? ['', `Screenshot: ${shotLink}`]
        : ['', 'They attached a screenshot and it could not be fetched from storage.']
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

const rows = await sql(`
  select f.id::text, f.body, f.context, f.screenshot_path, f.created_at::text,
         e.code as event_code
    from public.feedback f
    left join public.events e on e.id = f.event_id
   order by f.created_at
   limit 200`);

if (rows.length === 0) {
  console.log(`${GREEN}ok${OFF}: nothing has been reported.`);
  process.exit(0);
}

const filed = DRY ? new Set() : await alreadyFiled();
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
  const shotLink = row.screenshot_path ? await commitScreenshot(row) : null;
  const issue = await gh(`/repos/${OWNER}/${REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title, body: issueBody(row, shotLink), labels: [LABEL] }),
  });
  console.log(`  #${issue.number}  ${title}`);
}

console.log('');
console.log(`${YELLOW}These are what customers asked for.${OFF} Read them before the backlog:`);
console.log(`  https://github.com/${OWNER}/${REPO}/issues?q=is%3Aissue+label%3A${LABEL}`);

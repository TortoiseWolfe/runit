#!/usr/bin/env node
/**
 * Write `tools/dns-intent.mjs` into Cloudflare. DRY RUN BY DEFAULT -- #18.
 *
 *   node tools/dns-apply.mjs            # plan only, writes nothing
 *   node tools/dns-apply.mjs --apply    # write it
 *   node tools/dns-apply.mjs --only dkim
 *
 * Ported from `ScriptHammer/scripts/ci/cloudflare-apply.mjs`, which already manages one DNS
 * record (the root `_dmarc` TXT) with this exact shape: declared intent, a `plans[]` array,
 * dry run unless told otherwise, and `--only` to narrow. Reinventing it would have meant
 * re-learning its lessons, which were paid for once already.
 *
 * IT STORES NO ZONE OR RECORD IDS. Everything is discovered by NAME. That is what lets the
 * same file run against a different zone the day RunIt moves to its own apex domain -- the
 * intent changes, this does not. ScriptHammer's equivalent carries a test that greps its own
 * source for a 32-hex id to keep that honest.
 *
 * A DRY RUN THAT PLANS NOTHING IS THE ASSERTION. Once applied, re-running without `--apply`
 * printing "0 changes" is how you know live DNS still matches the file -- cheaper than a
 * separate checker, and it cannot drift from what the applier would do because it IS the
 * applier.
 *
 * WHICH TOKEN. `CLOUDFLARE_API_TOKEN`, needing Zone:DNS:Edit on this zone and nothing else.
 * A token scoped narrower than the person running it is the point; see ACCOUNTS.md for what
 * exists today and what it can reach.
 */
import { RECORDS, ZONE, assertFqdn } from './dns-intent.mjs';

const API = 'https://api.cloudflare.com/client/v4';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
if (!token) {
  console.log(yellow('SKIPPED: no CLOUDFLARE_API_TOKEN, so nothing was planned or written.'));
  console.log(yellow('  Needs Zone:DNS:Edit on ' + ZONE + ' and nothing else.'));
  process.exit(0);
}

async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    // `lane()` in run-checks.sh BUFFERS a lane's output, so a hung fetch is a silent hang of
    // the whole run with nothing on screen. A timeout is not optional here.
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (!body.success) {
    const msgs = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ');
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${msgs}`);
  }
  return body.result;
}

/** TXT content comes back quoted, and a >255-char value comes back as chunks. */
const normalise = (type, content) =>
  type === 'TXT' ? content.replace(/^"|"$/g, '').replace(/"\s+"/g, '') : content;

const zones = await cf(`/zones?name=${encodeURIComponent(ZONE)}`);
const zone = zones[0];
if (!zone) throw new Error(`this token cannot see the zone ${ZONE}`);

const wanted = RECORDS.filter((r) => !only || r.kind === only);
if (wanted.length === 0) throw new Error(`--only ${only} matched no declared record`);

const plans = [];
for (const r of wanted) {
  assertFqdn(r.name);
  const existing = await cf(
    `/zones/${zone.id}/dns_records?type=${r.type}&name=${encodeURIComponent(r.name)}`,
  );
  // MX is the one type where several records legitimately share a name, so it matches on
  // content too; everything else is one-per-name and matches on the name alone.
  const match =
    r.type === 'MX'
      ? existing.find((e) => normalise(r.type, e.content) === r.content)
      : existing[0];

  if (!match) {
    plans.push({ r, action: 'create' });
  } else if (
    normalise(r.type, match.content) !== r.content ||
    (r.priority !== undefined && match.priority !== r.priority)
  ) {
    plans.push({ r, action: 'update', id: match.id, from: normalise(r.type, match.content) });
  } else {
    plans.push({ r, action: 'none' });
  }
}

console.log(`${apply ? 'APPLY' : 'dry run'} — ${ZONE}, ${wanted.length} declared record(s)\n`);
for (const p of plans) {
  const tag = { create: green('create'), update: yellow('update'), none: dim('  ok  ') }[p.action];
  console.log(`  ${tag}  ${p.r.type.padEnd(3)} ${p.r.name}`);
  if (p.action !== 'none') console.log(dim(`          ${p.r.why}`));
  if (p.action === 'update') console.log(dim(`          was: ${p.from.slice(0, 70)}`));
}

const changes = plans.filter((p) => p.action !== 'none');
if (changes.length === 0) {
  console.log(green('\nok: live DNS already matches the declared intent'));
  process.exit(0);
}

if (!apply) {
  console.log(yellow(`\n${changes.length} change(s) planned. Nothing written — pass --apply.`));
  process.exit(0);
}

for (const p of changes) {
  const payload = {
    type: p.r.type,
    name: p.r.name,
    content: p.r.content,
    ttl: 1, // Cloudflare's "Auto", which is what Resend's panel asks for
    ...(p.r.priority !== undefined ? { priority: p.r.priority } : {}),
  };
  if (p.action === 'create') await cf(`/zones/${zone.id}/dns_records`, { method: 'POST', body: JSON.stringify(payload) });
  else await cf(`/zones/${zone.id}/dns_records/${p.id}`, { method: 'PUT', body: JSON.stringify(payload) });
  console.log(green(`  wrote ${p.r.type} ${p.r.name}`));
}

console.log(green(`\nok: ${changes.length} record(s) written. Verify with: pnpm audit:mail`));
if (!process.env.CI) console.log(dim('Cloudflare is fast but not instant; give it a few seconds.'));

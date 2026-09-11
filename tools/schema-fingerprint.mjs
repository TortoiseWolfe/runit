#!/usr/bin/env node
/**
 * DOES THE DEPLOYED SCHEMA STILL MATCH THE COMMITTED MIGRATION? -- issue #49.
 *
 *   pnpm schema:fingerprint          # print this database's fingerprint
 *   pnpm schema:check                # compare it to the committed baseline
 *
 * Lane E asserts what the policies DO. It cannot notice an extra column, a missing index,
 * a trigger that was dropped by hand, or a function that exists in production and in no
 * file -- and this repo deploys migrations statement-by-statement through the Supabase MCP
 * rather than through `supabase db push` (which is a silent no-op here, #48). So the
 * committed migration is a DESCRIPTION of what was meant to happen, and until #49 nothing
 * checked the description against the thing.
 *
 * It is a FINGERPRINT, not a diff, and that is deliberate. Six md5s over ordered listings
 * of policies, functions, columns, triggers, indexes and the tier_limits seed. A diff would
 * be more useful when it fails and vastly more code; a hash answers the only question that
 * needs asking on a schedule -- "has anything moved?" -- in six numbers. When one changes,
 * `supabase/schema-fingerprint.sql` is the query to run by hand on both sides to find out
 * what.
 *
 * WHY A COMMITTED BASELINE RATHER THAN LIVE-VS-LIVE. Reaching production needs a credential
 * CI does not have. The baseline is what production ACTUALLY WAS at a recorded moment, so
 * the local CI job can assert that the migration still builds that same schema -- which
 * catches the whole class of "the file changed and nobody deployed it", with no credential
 * at all. It does NOT catch someone changing production behind the file's back; that needs
 * a live run, and `--url` takes one when somebody has access.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SQL = join(ROOT, 'supabase/schema-fingerprint.sql');
const BASELINE = join(ROOT, 'supabase/schema-fingerprint.json');

const args = process.argv.slice(2);
const check = args.includes('--check');
const write = args.includes('--write');
const url =
  args.find((a) => a.startsWith('--url='))?.slice(6) ??
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const { default: pg } = await import('pg');
// Same rule as verify-policies.mjs: loopback serves no TLS, everything else must verify.
const isLoopback = /@(localhost|127\.0\.0\.1|\[::1\]):/.test(url);
const client = new pg.Client({
  connectionString: url,
  ssl: isLoopback ? false : { rejectUnauthorized: true },
});

await client.connect();
let rows;
try {
  ({ rows } = await client.query(readFileSync(SQL, 'utf8')));
} finally {
  await client.end();
}

const actual = Object.fromEntries(rows.map((r) => [r.kind, { n: Number(r.n), fingerprint: r.fingerprint }]));

if (write) {
  const existing = (() => {
    try {
      return JSON.parse(readFileSync(BASELINE, 'utf8'));
    } catch {
      return {};
    }
  })();
  writeFileSync(
    BASELINE,
    JSON.stringify({ ...existing, schema: actual }, null, 2) + '\n',
  );
  console.log(`wrote ${BASELINE}`);
  process.exit(0);
}

if (!check) {
  console.log(JSON.stringify(actual, null, 2));
  process.exit(0);
}

const doc = JSON.parse(readFileSync(BASELINE, 'utf8'));
const baseline = doc.schema;

/**
 * A DIVERGENCE THAT IS ON PURPOSE, DATED, AND THEREFORE TEMPORARY.
 *
 * The baseline records PRODUCTION, which is what makes it worth having. CI compares it to
 * a LOCAL build from the migration. Those two can only agree while production and the file
 * agree -- and #63 deliberately made them disagree, raising `max_guests` to 40 and
 * `max_hosts` to 2 on `house_party` for one party, in the database only, with a revert
 * date.
 *
 * So this step went red on the merge that did it and stayed red: THREE consecutive runs of
 * `policies.yml` failed on `Schema fingerprint` before anyone looked, and the next two
 * merges landed under it. That is the failure mode this repo keeps re-learning -- a gate
 * that is permanently red is a gate nobody reads, and it would have swallowed a real drift
 * exactly as happily as it swallowed this one.
 *
 * The fix is not to widen the gate. It is to say, in the baseline, WHICH group diverges,
 * WHAT the other side hashes to, WHY, and UNTIL WHEN -- so the allowance is as narrow as
 * one fingerprint, and it EXPIRES loudly rather than quietly becoming the new normal. A
 * group with an allowance still fails on any value that is neither the baseline's nor the
 * named one.
 */
const today = new Date().toISOString().slice(0, 10);
const allowances = Object.fromEntries(
  (doc.expectedDivergence ?? []).map((d) => [d.group, d]),
);

const status = (k) => {
  const b = baseline[k];
  const a = actual[k];
  if (b?.fingerprint === a?.fingerprint && b?.n === a?.n) return 'ok';
  const d = allowances[k];
  if (!d || d.fingerprint !== a?.fingerprint) return 'drift';
  return d.until >= today ? 'known' : 'expired';
};

const kinds = [...new Set([...Object.keys(baseline), ...Object.keys(actual)])].sort();
const drifted = kinds.filter((k) => status(k) !== 'ok' && status(k) !== 'known');

const MARK = {
  ok: '\x1b[32mok   \x1b[0m',
  known: '\x1b[33mknown\x1b[0m',
  drift: '\x1b[31mDRIFT\x1b[0m',
  expired: '\x1b[31mSTALE\x1b[0m',
};

for (const k of kinds) {
  const b = baseline[k];
  const a = actual[k];
  const st = status(k);
  console.log(
    `  ${MARK[st]} ${k.padEnd(12)} ${
      a ? `${a.n} @ ${a.fingerprint.slice(0, 12)}` : '(absent)'
    }${st === 'ok' ? '' : `   baseline: ${b ? `${b.n} @ ${b.fingerprint.slice(0, 12)}` : '(absent)'}`}`,
  );
  if (st === 'known') console.log(`        allowed until ${allowances[k].until}: ${allowances[k].reason}`);
  if (st === 'expired') {
    console.log(`        \x1b[31mthe allowance expired on ${allowances[k].until}\x1b[0m: ${allowances[k].reason}`);
  }
}

if (drifted.length) {
  console.error(`\n\x1b[31mFAIL: ${drifted.length} schema group(s) drifted from the baseline.\x1b[0m`);
  console.error(`  ${drifted.join(', ')}`);
  console.error('');
  console.error('  Either the migration changed and the baseline was not refreshed, or the');
  console.error('  deployed schema no longer matches the file. Find out WHICH before doing');
  console.error('  anything: run supabase/schema-fingerprint.sql against both sides.');
  console.error('');
  console.error('  If the migration change is intended AND deployed, refresh the baseline:');
  console.error('    pnpm schema:fingerprint --write');
  console.error('  and say in the commit message that production was re-checked. A baseline');
  console.error('  refreshed without that check records a wish rather than a fact.');
  process.exit(1);
}

const known = kinds.filter((k) => status(k) === 'known');
if (known.length) {
  console.log(
    `\n\x1b[33mok: ${kinds.length - known.length} group(s) match the baseline; ` +
      `${known.join(', ')} diverge(s) on purpose and the allowance expires ` +
      `${known.map((k) => allowances[k].until).join(', ')}\x1b[0m`,
  );
} else {
  console.log(`\n\x1b[32mok: the schema matches the committed baseline across all ${kinds.length} groups\x1b[0m`);
}

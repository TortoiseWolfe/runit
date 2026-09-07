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

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).schema;
const kinds = [...new Set([...Object.keys(baseline), ...Object.keys(actual)])].sort();
const drifted = kinds.filter(
  (k) => baseline[k]?.fingerprint !== actual[k]?.fingerprint || baseline[k]?.n !== actual[k]?.n,
);

for (const k of kinds) {
  const b = baseline[k];
  const a = actual[k];
  const ok = b?.fingerprint === a?.fingerprint && b?.n === a?.n;
  console.log(
    `  ${ok ? '\x1b[32mok  \x1b[0m' : '\x1b[31mDRIFT\x1b[0m'} ${k.padEnd(12)} ${
      a ? `${a.n} @ ${a.fingerprint.slice(0, 12)}` : '(absent)'
    }${ok ? '' : `   baseline: ${b ? `${b.n} @ ${b.fingerprint.slice(0, 12)}` : '(absent)'}`}`,
  );
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

console.log(`\n\x1b[32mok: the schema matches the committed baseline across all ${kinds.length} groups\x1b[0m`);

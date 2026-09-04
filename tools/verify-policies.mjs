#!/usr/bin/env node
/**
 * LANE E as a GATE rather than a document.
 *
 * `supabase/verify-policies.sql` proved thirteen RLS behaviours once, by hand, pasted
 * into a SQL editor. That is a measurement, not a guard: nothing re-ran it after the
 * next migration edit, and a policy regression is silent by construction -- a denied
 * UPDATE affects zero rows and raises nothing.
 *
 * WHY THIS SKIPS LOUDLY INSTEAD OF FAILING CLOSED. Running it needs a database URL
 * containing a password, and CI here is a single public-repo job with no secret store.
 * A gate that fails without credentials would be disabled within a week. A gate that
 * skips SILENTLY is exactly the failure this file exists to correct. So it skips, says
 * so in the same shape as a failure, and names what went unchecked.
 *
 *   export SUPABASE_DB_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres'
 *   pnpm verify:policies
 *
 * The SQL rolls itself back -- it ends by RAISING -- so this is safe against the live
 * project and leaves nothing behind.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQL = join(import.meta.dirname, '..', 'supabase', 'verify-policies.sql');
const url = process.env.SUPABASE_DB_URL;

if (!url) {
  console.log('\x1b[33mSKIPPED: policy verification (lane E)\x1b[0m');
  console.log('  SUPABASE_DB_URL is not set, so THIRTEEN RLS BEHAVIOURS WENT UNCHECKED.');
  console.log('  Nothing else in this suite can see row-level security: lane B has no');
  console.log('  backend and lane C is one emulator with one identity.');
  console.log('  Set it and re-run before trusting a green board after a migration change.');
  process.exit(0);
}

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

let report;
try {
  await client.query(readFileSync(SQL, 'utf8'));
  // Unreachable: the script's last statement is a RAISE, which is how it rolls back.
  throw new Error('verify-policies.sql completed without raising — it was expected to.');
} catch (e) {
  report = e.message ?? String(e);
} finally {
  await client.end();
}

console.log(report);
// The report opens with "<n> FAILURE(S)."; anything but zero is a red gate.
const m = /^(\d+) FAILURE\(S\)/m.exec(report);
if (!m) {
  console.error('\x1b[31mFAIL: could not parse the policy report. Did the SQL change shape?\x1b[0m');
  process.exit(1);
}
if (Number(m[1]) > 0) {
  console.error(`\x1b[31mFAIL: ${m[1]} policy assertion(s) failed.\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32mok: 13/13 policy assertions hold against the live database\x1b[0m');

#!/usr/bin/env node
/**
 * LANE E as a GATE rather than a document.
 *
 * `supabase/verify-policies.sql` proved a set of RLS behaviours once, by hand, pasted
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
  console.log('  SUPABASE_DB_URL is not set, so THE RLS BEHAVIOUR ASSERTIONS WENT UNCHECKED.');
  console.log('  Nothing else in this suite can see row-level security: lane B has no');
  console.log('  backend and lane C is one emulator with one identity.');
  console.log('  Set it and re-run before trusting a green board after a migration change.');
  process.exit(0);
}

const { default: pg } = await import('pg');

/**
 * TLS IS VERIFIED. This is the one connection in the repo that carries a database
 * PASSWORD to a live project, which makes it the last place to accept an
 * unauthenticated peer -- `rejectUnauthorized: false` here would hand that password
 * to anyone able to intercept the connection, and it would do it silently.
 *
 * That flag is the usual first move when a Supabase connection fails a handshake,
 * which is exactly why it is called out rather than just omitted: the handshake is
 * failing because the certificate is not trusted, and turning off the check does not
 * fix that, it agrees to be lied to.
 *
 * If your setup needs a specific root (some Supabase direct connections present a
 * chain that is not in the default store), point SUPABASE_CA_CERT at the PEM that
 * Supabase publishes for the project. Never trade verification for convenience on a
 * connection like this one.
 */
const caPath = process.env.SUPABASE_CA_CERT;
let ca;
if (caPath) {
  try {
    ca = readFileSync(caPath, 'utf8');
  } catch {
    // A stack trace here would be the wrong answer to the one message whose whole
    // job is to lead someone out of a TLS failure without disabling verification.
    console.error(`\x1b[31mFAIL: SUPABASE_CA_CERT points at a file that cannot be read.\x1b[0m`);
    console.error(`  ${caPath}`);
    process.exit(1);
  }
}
const ssl = { rejectUnauthorized: true, ...(ca ? { ca } : {}) };

const client = new pg.Client({ connectionString: url, ssl });
try {
  await client.connect();
} catch (e) {
  const msg = String(e?.message ?? e);
  if (/self[- ]signed|unable to (verify|get local issuer)|certificate/i.test(msg)) {
    console.error('\x1b[31mFAIL: the database certificate could not be verified.\x1b[0m');
    console.error(`  ${msg}`);
    console.error('  Download the project CA from the Supabase dashboard');
    console.error('  (Settings -> Database -> SSL Configuration) and set:');
    console.error('    export SUPABASE_CA_CERT=/path/to/prod-ca.crt');
    console.error('  Do NOT disable certificate verification -- this connection carries');
    console.error('  the database password.');
    process.exit(1);
  }
  throw e;
}

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
console.log('\x1b[32mok: all policy assertions hold against the live database\x1b[0m');

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
 * containing a password, and a gate that fails for want of a credential is disabled
 * within a week. A gate that skips SILENTLY is exactly the failure this file exists to
 * correct. So it skips, says so in the same shape as a failure, and names what went
 * unchecked.
 *
 * THIS FILE USED TO SAY CI WAS "a single public-repo job with no secret store", and so
 * did CLAUDE.md, twice. The repository is PRIVATE, and private repositories have
 * encrypted Actions secrets like any other -- so the stated reason the one lane that can
 * see row-level security never ran in CI was never true. `checks.yml` passes
 * `secrets.SUPABASE_DB_URL` through now; set it and this runs on every push. Until it is
 * set the secret expands to an empty string and this skips, exactly as it does locally.
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
  console.log('');
  console.log('  NO PRODUCTION PASSWORD NEEDED — run it against a local stack instead:');
  console.log('    npx supabase start');
  console.log('    docker exec -i supabase_db_runit psql -U postgres -v ON_ERROR_STOP=1 \\');
  console.log('      < supabase/migrations/00000000000000_init.sql');
  console.log('    SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \\');
  console.log('      pnpm verify:policies');
  console.log('  That proves the COMMITTED migration\'s policies behave. Only the live run');
  console.log('  additionally proves production has not drifted from it. docs/lane-e.md');
  console.log('');
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
/**
 * LOOPBACK HAS NO TLS TO VERIFY, and that is a different statement from "do not verify".
 *
 * `supabase start` runs Postgres in a container on 127.0.0.1:54322 with TLS off entirely,
 * so a strict `ssl` option there fails the handshake and the lane cannot run locally at
 * all -- which mattered, because running it locally is the ONLY way anyone without the
 * production database password can execute these assertions.
 *
 * This is narrow on purpose. It matches the loopback HOST, not a flag, an env var or a
 * "skip TLS" switch, so it can never be turned on for a remote database by accident or by
 * a tired person at 2am: every other host keeps `rejectUnauthorized: true`, and the
 * credential on this path is the well-known local `postgres`, not a secret.
 *
 * The one case it reads wrong is a remote database reached through an SSH tunnel bound to
 * localhost -- and there the traffic is already inside the tunnel's encryption.
 */
const isLoopback = /@(localhost|127\.0\.0\.1|\[::1\]):/.test(url);
const ssl = isLoopback ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) };

const client = new pg.Client({ connectionString: url, ssl });
try {
  await client.connect();
} catch (e) {
  const msg = String(e?.message ?? e);
  /**
   * A CONNECTION THAT NEVER OPENS, named rather than thrown. This path only became
   * reachable when the secret was wired into CI, and an unhandled rejection there prints
   * a stack trace whose top frame is node's module loader -- which says nothing about the
   * URL being wrong, and is the least useful thing a gate can do with a bad credential.
   */
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|password authentication|does not exist/i.test(msg)) {
    console.error('\x1b[31mFAIL: could not connect to the database.\x1b[0m');
    console.error(`  ${msg}`);
    console.error('  SUPABASE_DB_URL must be the DIRECT connection string, shaped:');
    console.error('    postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres');
    console.error('  In CI it comes from the SUPABASE_DB_URL Actions secret.');
    process.exit(1);
  }
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
  // AN ABORT LANDS HERE, and that is the point. If any statement raises outside a
  // `begin ... exception` block, the closing RAISE never runs, so there is no report to
  // parse -- which is #31's original failure wearing a different hat. The message names
  // the shape rather than the cause, so read the raised error above it: it carries the
  // CONTEXT line naming the PL/pgSQL line number that actually blew up.
  console.error('\x1b[31mFAIL: could not parse the policy report. Did the SQL change shape?\x1b[0m');
  console.error('  A DO block that ABORTS never reaches its closing RAISE, so it produces');
  console.error('  no report at all. The error printed above names the line.');
  process.exit(1);
}
if (Number(m[1]) > 0) {
  console.error(`\x1b[31mFAIL: ${m[1]} policy assertion(s) failed.\x1b[0m`);
  process.exit(1);
}

/**
 * THE COVERAGE FLOOR, and it is the same doctrine as lane A's and lane A2's.
 *
 * "0 FAILURE(S)" over forty assertions and over eighty look identical on the board. An
 * abort cannot hide here -- it never reaches the RAISE, so it lands in `!m` above -- but
 * these can, and all three are real ways this file has shrunk or could:
 *
 *   - a section deleted, or lost to a bad merge on a file this large;
 *   - a `begin ... exception when others` widened until it swallows a whole block;
 *   - assertions rewritten into one that reports a single line.
 *
 * A gate that passes having measured less than it did last time is the exact bug #31 was
 * filed for. Raise this number when you add assertions; that is the intended friction.
 *
 * IT IS A FLOOR, SO ONLY AN UNDERCOUNT FAILS. 142 is the first number here ever produced
 * by a COMPLETE run of the file. It replaces 143, which was arithmetic -- 101 from a
 * whole-file run plus six sets counted in separate in-context runs (7 storage, 7 headcount,
 * 4 seen-by, 9 nickname, 8 song-merge, 7 retention) -- and those addends were estimates for
 * assertions that, as it turned out, had never executed at all. Lowering this number is
 * normally the wrong move and it is the right one exactly once: when the previous value was
 * never measured. It is measured now.
 *
 * Raise it when you add assertions, and RUN THE FILE to get the number rather than adding
 * to it. That is the whole lesson of #31 and it has now cost three separate bugs.
 */
const EXPECTED_ASSERTIONS = 153;
// The FIRST assertion shares its line with the "0 FAILURE(S)." preamble -- `format()`
// joins the array after it -- so an anchored line match silently undercounts by one.
const counted = report
  .split('\n')
  .map((line) => line.replace(/^\s*\d+ FAILURE\(S\)\.\s*/, '').trim())
  .filter((line) => /^(PASS|FAIL) /.test(line)).length;
if (counted < EXPECTED_ASSERTIONS) {
  console.error(
    `\x1b[31mFAIL: only ${counted} assertions ran, and ${EXPECTED_ASSERTIONS} were expected.\x1b[0m`,
  );
  console.error('  Zero failures over a shrunken file is not a pass -- it is a smaller');
  console.error('  measurement reported in the same words. Something stopped asserting.');
  console.error('  If you deliberately removed assertions, lower EXPECTED_ASSERTIONS here');
  console.error('  in the same commit, so the number always states what is actually covered.');
  process.exit(1);
}

// NAME WHICH DATABASE. This used to say "against the live database" unconditionally, which
// became a false statement the moment a local stack could run it -- and "the assertions pass"
// means something different depending on the target. Locally it proves the committed
// migration's policies behave; only the live run additionally proves production has not
// drifted from that migration.
console.log(
  `\x1b[32mok: all ${counted} policy assertions hold against the ${
    isLoopback ? 'LOCAL stack (built from supabase/migrations/)' : 'LIVE project'
  }\x1b[0m`,
);

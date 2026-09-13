/**
 * SET THE SMTP PASSWORD, AND PROVE IT BY SENDING.
 *
 * `check-auth-config.mjs --apply` deliberately WITHHOLDS `smtp_pass` -- it is declared as
 * `env(...)`, and a feature whose secret is missing is withheld entirely rather than
 * half-applied. This is the other half: the one command that writes it, kept separate because
 * it is the only auth-config write that carries a credential.
 *
 * `RESEND_API_KEY` COMES FROM `.env.local` LIKE EVERY OTHER CREDENTIAL HERE. The first
 * version refused to read it from a file at all, reasoning that `~/.claude` archives every
 * file edit outside gitleaks. That reasoning does not survive contact: the key has to be
 * SOMEWHERE to be used twice, and writing it to `.env.local` is itself a file edit, so
 * refusing to READ the file bought nothing once the file existed. It only made the owner
 * retype a secret every time, which is how secrets end up in shell history instead.
 *
 * The rule that DOES hold is the Supabase one, and it is a different rule: an account-wide
 * token stays out of the file because this repo has no standing need for one -- it needs GET,
 * and the legacy token is passed for a single invocation. `RESEND_API_KEY` has a standing
 * need, is scoped to sending as one domain, and sits beside the publishable key and the
 * fine-grained token that are already there. `.env.local` is gitignored; rotation is the
 * control, and `ACCOUNTS.md` carries the date.
 *
 * IT SENDS THE WHOLE SMTP BLOCK, NEVER JUST THE PASSWORD, AND THAT COST AN OUTAGE.
 * The first version PATCHed `{ smtp_pass }` alone. `PATCH /v1/projects/{ref}/config/auth`
 * does not MERGE into the SMTP block -- it REPLACES it, so that write nulled `smtp_host`,
 * `smtp_port`, `smtp_user`, `smtp_admin_email` and `smtp_sender_name` in one go and silently
 * turned custom SMTP off. Supabase then fell back to its BUILT-IN mailer, and the two sends
 * that answered 200 straight afterwards were the built-in 2/hour allowance being spent --
 * which read exactly like success, from an address the whole sending domain exists to replace.
 * `rate_limit_email_sent` dropped 30 -> 2 by itself, which is the tell.
 *
 * THE REPO ALREADY KNEW THIS TRAP UNDER ANOTHER VENDOR'S NAME. `dns-apply.mjs` carries it:
 * "a Cloudflare rule PATCH REPLACES the rule (replay every field)". Same shape here. And it
 * is the one place `check-auth-config.mjs --apply`'s rule -- send only the fields that
 * drifted -- is actively wrong: that is right for independent scalars and unsafe for a
 * composite block, where the unsent siblings are not left alone, they are erased.
 *
 * A 200 IS NOT A WORKING MAILER, and here that is not a slogan -- it is the exact defect this
 * file was written for. On 2026-09-13 the project had all six SMTP fields set correctly, DNS
 * green in `audit:mail`, and `audit:auth-config` green on thirteen declared fields, while
 * every send died on `535 "Authentication credentials invalid"` from smtp.resend.com. Nothing
 * in the repo could see it: DKIM/SPF/DMARC are public records, the config endpoint returns the
 * password as an undocumented hash, and no gate had ever asked the mailer to do its job.
 *
 * SO `--verify-to` IS REQUIRED. The write is not reported as done until a real message has
 * been accepted with the new credential. Reading the value back is not available as a check --
 * the API returns a 64-character hash by a construction it does not document, so a non-match
 * proves nothing about the key.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { envLocal } from './lib/env.mjs';

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const REF = 'qwusbxallkbzfladvgfx';

const key = envLocal('RESEND_API_KEY');
const token = envLocal('SUPABASE_ACCESS_TOKEN');
const toArg = process.argv.find((a) => a.startsWith('--verify-to='));
const to = toArg?.slice('--verify-to='.length).trim();

if (process.env.CI) {
  console.error(red('REFUSED: --apply under CI. Writing a credential is a keyboard act.'));
  process.exit(1);
}
if (!key) {
  console.error(red('REFUSED: no RESEND_API_KEY in the environment or .env.local.'));
  console.error('  It is the Resend API key; the SMTP username is the literal "resend".');
  process.exit(1);
}
if (!key.startsWith('re_')) {
  console.error(red('REFUSED: that does not look like a Resend API key (no re_ prefix).'));
  console.error('  The SMTP username is the literal string "resend"; the PASSWORD is the key.');
  process.exit(1);
}
if (!to) {
  console.error(red('REFUSED: --verify-to=<address> is required.'));
  console.error('  A 200 on the write is not a working mailer -- 535 lives one layer down.');
  process.exit(1);
}
if (!token) {
  console.error(red('REFUSED: no SUPABASE_ACCESS_TOKEN.'));
  process.exit(1);
}

// The declared block is the source of truth for the five non-secret fields, so this tool and
// `audit:auth-config` can never disagree about them -- and replaying them is MANDATORY, not
// tidiness. See the header.
const declared = JSON.parse(
  execFileSync(
    'python3',
    ['-c', 'import tomllib,sys,json;json.dump(tomllib.load(open(sys.argv[1],"rb")),sys.stdout)',
     join(import.meta.dirname, '..', 'supabase', 'config.toml')],
    { encoding: 'utf8' },
  ),
).remotes?.production?.auth?.email?.smtp;

if (!declared?.host) {
  console.error(red('REFUSED: [remotes.production.auth.email.smtp] declares no host.'));
  process.exit(1);
}

const body = {
  smtp_host: declared.host,
  smtp_port: String(declared.port),
  smtp_user: declared.user,
  smtp_admin_email: declared.admin_email,
  smtp_sender_name: declared.sender_name,
  smtp_pass: key,
};
console.log(`writing the whole SMTP block (${Object.keys(body).length} fields) to ${REF}:`);
for (const k of Object.keys(body)) {
  console.log(`  ${k} -> ${k === 'smtp_pass' ? '<withheld>' : JSON.stringify(body[k])}`);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(20_000),
});
if (!res.ok) {
  console.error(red(`FAIL: PATCH returned ${res.status}`));
  console.error(`  ${(await res.text()).slice(0, 300)}`);
  if (res.status === 403) {
    console.error('  Fine-grained tokens cannot write auth config; a LEGACY one can. This');
    console.error('  repo deliberately does not store an account-wide token, so pass one:');
    console.error('');
    console.error("    SUPABASE_ACCESS_TOKEN=\"$(command grep -m1 '^SUPABASE_ACCESS_TOKEN=' \\");
    console.error('      ~/repos/SpokeToWork/.env | cut -d= -f2- | tr -d \'"\\\'\' | tr -d \'[:space:]\')" \\');
    console.error('      pnpm smtp:pass --verify-to=you@example.com');
  }
  process.exit(1);
}
console.log(green('SMTP block written'));

// THE READ-BACK THAT WOULD HAVE CAUGHT THE OUTAGE. The password cannot be verified (the API
// returns an undocumented hash), but its five siblings can -- and it was those going null
// that turned the mailer off while every send still answered 200.
const after = await (
  await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  })
).json();
const lost = Object.keys(body).filter((k) => k !== 'smtp_pass' && after[k] !== body[k]);
if (lost.length) {
  console.error(red(`FAIL: ${lost.length} SMTP field(s) did not survive the write.`));
  for (const k of lost) console.error(`  ${k}: wanted ${JSON.stringify(body[k])}, got ${JSON.stringify(after[k])}`);
  process.exit(1);
}
if (!after.smtp_pass) {
  console.error(red('FAIL: smtp_pass reads back empty -- custom SMTP is OFF.'));
  process.exit(1);
}
console.log(green('  all five non-secret fields read back, and smtp_pass is set'));

// GoTrue reloads on a config change rather than restarting; the auth log prints
// "reloading api with new configuration" a second or two later. Sending before that would
// test the OLD credential and report the wrong answer.
console.log('  waiting 12s for GoTrue to reload its configuration...');
await sleep(12_000);

const url = envLocal('EXPO_PUBLIC_SUPABASE_URL');
const anon = envLocal('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const send = await fetch(`${url}/auth/v1/otp`, {
  method: 'POST',
  headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: to, create_user: true }),
  signal: AbortSignal.timeout(30_000),
});

if (!send.ok) {
  const body = await send.text();
  console.error(red(`FAIL: the credential was written and the mailer still refused (${send.status}).`));
  console.error(`  ${body.slice(0, 300)}`);
  console.error('');
  console.error('  Read the reason -- GoTrue reports the SMTP error verbatim in the auth log:');
  console.error(`    logs for ${REF}, source auth_logs, the "error" field`);
  console.error('  535 means Resend rejected the key. 550 usually means the sender address');
  console.error('  is not on a verified domain.');
  process.exit(1);
}

console.log(green(`ok: written AND a message was accepted for ${to}`));
console.log(yellow('  accepted is not delivered. Run `pnpm send:otp --to=... --twice` for'));
console.log(yellow('  the two-inside-an-hour assertion, then read the inbox.'));

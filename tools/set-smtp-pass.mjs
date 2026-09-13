/**
 * SET THE SMTP PASSWORD, AND PROVE IT BY SENDING.
 *
 * `check-auth-config.mjs --apply` deliberately WITHHOLDS `smtp_pass` -- it is declared as
 * `env(...)`, and a feature whose secret is missing is withheld entirely rather than
 * half-applied. This is the other half: the one command that writes it, kept separate because
 * it is the only auth-config write that carries a credential.
 *
 * IT REFUSES TO READ THE KEY FROM A FILE, and that is the whole design. `envLocal()` is not
 * used here: `RESEND_API_KEY` must come from `process.env` and nowhere else. A Resend key is a
 * bearer token for sending as this domain; `~/.claude` archives every file edit outside
 * gitleaks, and a 2026-09-07 sweep found live Resend, Cloudflare and Supabase values in it. A
 * secret that never touches a file is the only one that cannot end up there.
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
import { setTimeout as sleep } from 'node:timers/promises';
import { envLocal } from './lib/env.mjs';

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const REF = 'qwusbxallkbzfladvgfx';

// process.env ONLY. Not envLocal -- see the header.
const key = process.env.RESEND_API_KEY;
const token = envLocal('SUPABASE_ACCESS_TOKEN');
const toArg = process.argv.find((a) => a.startsWith('--verify-to='));
const to = toArg?.slice('--verify-to='.length).trim();

if (process.env.CI) {
  console.error(red('REFUSED: --apply under CI. Writing a credential is a keyboard act.'));
  process.exit(1);
}
if (!key) {
  console.error(red('REFUSED: RESEND_API_KEY is not in the environment.'));
  console.error('  Deliberately NOT read from .env.local. Pass it for one command:');
  console.error('    RESEND_API_KEY=re_... pnpm smtp:pass --verify-to=you@example.com');
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

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ smtp_pass: key }),
  signal: AbortSignal.timeout(20_000),
});
if (!res.ok) {
  console.error(red(`FAIL: PATCH returned ${res.status}`));
  console.error(`  ${(await res.text()).slice(0, 300)}`);
  if (res.status === 403) {
    console.error('  Fine-grained tokens cannot write auth config. A LEGACY token can --');
    console.error('  see the auth-config section of CLAUDE.md.');
  }
  process.exit(1);
}
console.log(green('smtp_pass written'));

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

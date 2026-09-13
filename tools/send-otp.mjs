/**
 * SEND A REAL SIGN-IN CODE, THROUGH THE PATH #18 SHIPS ON.
 *
 * The whole sending-domain arc -- Resend, the four DNS records, DKIM/SPF/DMARC, custom SMTP,
 * the declared auth config -- exists to make one sentence true: a host can ask for a code and
 * get one. Nothing verified so far proves that. `audit:mail` reads DNS, `audit:auth-config`
 * reads settings, and both are green over a mailer that has never sent a message.
 *
 * THE ASSERTION IS TWO CODES INSIDE ONE HOUR. Supabase's built-in mailer is capped at 2/hour
 * PROJECT-WIDE, which is why #18 needed a sending domain at all. One successful send does not
 * distinguish "custom SMTP works" from "the built-in mailer had a slot left". Two does -- and
 * `--twice` waits out the per-address throttle between them rather than tripping it.
 *
 * A 200 IS NOT A DELIVERY, and this file will not pretend otherwise. GoTrue answers 200 the
 * moment it hands the message to SMTP; a wrong password, a refused relay or a DKIM failure at
 * the far end all land after that. So this reports exactly two things -- the request was
 * ACCEPTED, and the rate limiter did not refuse the second one -- and prints, every run, that
 * the remaining half is a human reading an inbox. Same shape as lane H printing that push is
 * uncovered.
 *
 * IT IS NOT A GATE AND MUST NEVER ENTER `run-checks.sh`. It sends mail to a real person and
 * mints an `auth.users` row. That is the standing of `pnpm smoke:live`, one step stronger:
 * lane H writes to a database, this writes to somebody's inbox.
 *
 * NO RECIPIENT IS BUILT IN. `--to` is required and unguessed -- a default address here would
 * be a tool that mails a stranger when somebody runs it to see what it does.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { envLocal } from './lib/env.mjs';

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const url = envLocal('EXPO_PUBLIC_SUPABASE_URL');
const key = envLocal('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

const toArg = process.argv.find((a) => a.startsWith('--to='));
const to = toArg?.slice('--to='.length).trim();
const twice = process.argv.includes('--twice');

if (process.env.CI) {
  console.error(red('REFUSED: this sends real mail. Not in CI.'));
  process.exit(1);
}
if (!to) {
  console.error(red('REFUSED: --to=<address> is required.'));
  console.error('  There is deliberately no default recipient.');
  process.exit(1);
}
if (!url || !key) {
  console.log(yellow('SKIPPED: no EXPO_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY.'));
  console.log(yellow('  Nothing was sent and nothing was measured.'));
  process.exit(0);
}

/**
 * The per-address throttle is `smtp_max_frequency` (declared `max_frequency = "60s"`), and a
 * second send inside it answers 429 -- which is the CONFIGURED behaviour, not a failure of the
 * mailer. Separating the two is the point: 429 on the second send means the throttle worked,
 * 429 on the first means something else is wrong.
 */
async function send(label) {
  const at = new Date();
  const res = await fetch(`${url}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: to, create_user: true }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  console.log(`  ${label}: HTTP ${res.status} at ${at.toISOString()}`);
  if (!res.ok) console.log(`    ${body.slice(0, 300)}`);
  return { ok: res.ok, status: res.status, at, body };
}

console.log(`sending a sign-in code to ${to} via ${new URL(url).host}`);

let first = await send('send 1');

/**
 * ONE RETRY, AND ONLY FOR THE THROTTLE THE TOOL ITSELF TRIPS. `smtp:pass --verify-to=` sends
 * a message to prove the credential, so running this straight afterwards always lands inside
 * the 60s per-address window -- a failure that says nothing about the mailer and that the
 * operator can only fix by holding a stopwatch. GoTrue names the remaining seconds, so wait
 * exactly that and go again. It is NOT a general retry: a second 429, or any other status,
 * still fails. Retrying a real rate limit would just launder it into a slower one.
 */
if (first.status === 429) {
  const wait = Number(/after (\d+) seconds/.exec(first.body)?.[1]);
  if (Number.isFinite(wait) && wait > 0 && wait <= 60) {
    console.log(`  per-address throttle: waiting ${wait + 3}s and sending once more`);
    await sleep((wait + 3) * 1000);
    first = await send('send 1 (retry)');
  }
}

if (!first.ok) {
  console.error(red(`FAIL: the first send was refused (${first.status}).`));
  if (first.status === 429) {
    // `over_email_send_rate_limit` with "after N seconds" IS smtp_max_frequency (declared
    // `max_frequency = "60s"`), counted per ADDRESS. The first draft of this branch said the
    // opposite -- that a 429 here could not be the throttle -- and printed that over a
    // message naming 51 seconds. A diagnostic that contradicts the error beside it is worse
    // than none, because it sends the reader to check rate_limit_email_sent for nothing.
    const wait = /after (\d+) seconds/.exec(first.body)?.[1];
    console.error(`  This is the per-address throttle, not a project cap${wait ? `: wait ${wait}s` : ''}.`);
    console.error('  Something sent to this address inside the last 60 seconds -- very likely');
    console.error('  `pnpm smtp:pass --verify-to=`, which sends one to prove the credential.');
  }
  process.exit(1);
}

if (!twice) {
  console.log(green('ok: one send accepted'));
  console.log(yellow('  ACCEPTED IS NOT DELIVERED. Read the inbox to finish this check.'));
  console.log(yellow('  Run with --twice for the assertion that actually closes #18.'));
  process.exit(0);
}

// 65s, not 60: the throttle is evaluated against the server's clock, not ours.
console.log('  waiting 65s for the per-address throttle (max_frequency = 60s)...');
await sleep(65_000);

const second = await send('send 2');
const gapMin = (second.at - first.at) / 60_000;

if (!second.ok) {
  console.error(red(`FAIL: the second send was refused (${second.status}).`));
  console.error(`  ${gapMin.toFixed(1)} minutes after the first, so this is inside the hour.`);
  if (second.status === 429) {
    console.error('  429 here is the 2/hour built-in cap OR the per-address throttle.');
    console.error('  If custom SMTP were in use, neither should refuse a second send at 65s.');
  }
  process.exit(1);
}

console.log(green(`ok: TWO sends accepted ${gapMin.toFixed(1)} minutes apart`));
console.log(green('  the built-in 2/hour project cap is not what is carrying this mail'));
console.log('');
console.log(yellow('  STILL UNPROVEN HERE, and only an inbox can settle it:'));
console.log(yellow('   - that either message ARRIVED. 200 is acceptance, not delivery.'));
console.log(yellow('   - that `Authentication-Results` reads dkim=pass'));
console.log(yellow('     d=runit.scripthammer.com -- which is the gate on raising'));
console.log(yellow('     _dmarc to p=reject. `pnpm audit:mail` prints that todo.'));
console.log(yellow('   - that the code is 6 digits and expires in 10 minutes.'));

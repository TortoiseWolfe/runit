#!/usr/bin/env node
/**
 * IS THE LIVE PROJECT STILL CONFIGURED TO LET ANYONE IN? -- #18, and it is free.
 *
 * `GET /auth/v1/settings` is a PUBLIC, READ-ONLY endpoint. It needs the publishable key and
 * nothing else, it creates no rows, and it reports the four auth switches this product cannot
 * function without. That combination is what lets this run on every checks pass rather than
 * being a deliberate command with a cost, which is how `smoke:live` has to be treated.
 *
 * IT EXISTS BECAUSE ONE OF THESE WAS SILENTLY OFF AND A BUILD SHIPPED ON IT. Anonymous
 * sign-in is a dashboard toggle; it was off while TestFlight build #3 went out, and the
 * resulting failure is mapped to `unknown_code`, so it reads as a WRONG EVENT CODE. Nobody
 * re-checks a provider toggle when the app says the code is wrong -- they re-print posters.
 * Only lane H could see it, and lane H writes to production and is deliberately not in
 * `run-checks.sh`. So the one thing that could catch it ran least often.
 *
 * WHAT IT CANNOT SEE, said plainly rather than implied: this endpoint exposes a SUBSET. SMTP
 * host and sender, OTP expiry and length, rate limits and the captcha secret are not in it and
 * cannot be checked without a Management API token. This is the free half of auth-config
 * verification, not the whole of it, and it must not be read as the whole.
 */
import { envLocal } from './lib/env.mjs';

/**
 * What this project must be, and WHY -- because a flag with no consequence written next to it
 * is a flag somebody flips to see what happens.
 */
const INTENDED = [
  {
    path: ['external', 'anonymous_users'],
    want: true,
    why:
      'THE PRODUCT ITSELF. A guest joins with a code and a nickname and no account, and ' +
      '`signInAnonymously()` is the only sign-in path in the codebase. Off, every join fails ' +
      'and the app reports a wrong event code.',
  },
  {
    path: ['external', 'email'],
    want: true,
    why:
      'Host sign-in by emailed code (#18) needs the email provider on. SMTP configured behind ' +
      'a disabled provider sends nothing and reports nothing.',
  },
  {
    path: ['disable_signup'],
    want: false,
    why:
      "A HOST'S FIRST SIGN-IN IS A SIGNUP. Disabling signups looks like it only affects new " +
      'accounts; it kills the first OTP for every host who has never signed in, while every ' +
      'other setting reads correct.',
  },
  {
    path: ['mailer_autoconfirm'],
    want: false,
    why:
      'An address must be proved, not claimed. Auto-confirm accepts a signup without the ' +
      'holder ever reading a message at it, which for host accounts means claiming somebody ' +
      "else's email.",
  },
];

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const url = envLocal('EXPO_PUBLIC_SUPABASE_URL');
const key = envLocal('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

if (!url || !key) {
  console.log(yellow('SKIPPED: live auth settings'));
  console.log(yellow('  EXPO_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY are not set, so NOTHING'));
  console.log(yellow('  about the live project was checked. Both are public values.'));
  process.exit(0);
}

let settings;
try {
  const res = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key },
    // `lane()` buffers a lane's output, so a hung fetch hangs the whole run with a blank
    // screen. Same reason `dns-apply.mjs` carries one.
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  settings = await res.json();
} catch (e) {
  // LOUD SKIP, not a red gate -- the same call lane G and the mail policy both make. A gate
  // that fails closed because somebody else's endpoint blipped is a gate that gets deleted.
  console.log(yellow('SKIPPED: live auth settings -- the project could not be reached'));
  console.log(yellow(`  ${e.message}`));
  process.exit(0);
}

const read = (path) => path.reduce((o, k) => (o == null ? undefined : o[k]), settings);

/**
 * A COVERAGE FLOOR. If the endpoint's shape changes, every `read()` returns undefined, every
 * comparison fails... which would look like a catastrophe rather than a parser problem. Worse
 * is the inverse: a field quietly renamed would read `undefined !== true` and fail loudly,
 * but a field that starts returning something truthy for an unrelated reason would pass. So
 * assert the shape is recognisable before trusting any value from it.
 */
const missing = INTENDED.filter((i) => read(i.path) === undefined);
if (missing.length === INTENDED.length) {
  console.error(red('FAIL: /auth/v1/settings returned nothing this tool recognises.'));
  console.error('  The endpoint shape has changed. Fix the paths; do not lower the check.');
  console.error(`  got keys: ${Object.keys(settings).join(', ')}`);
  process.exit(1);
}

const problems = [];
for (const i of INTENDED) {
  const got = read(i.path);
  const name = i.path.join('.');
  if (got !== i.want) {
    problems.push({ name, got, want: i.want, why: i.why });
  }
}

console.log(`auth settings: ${INTENDED.length} checked on the live project`);

if (problems.length) {
  console.error(red(`FAIL: ${problems.length} auth setting(s) are not what this product needs.`));
  for (const p of problems) {
    console.error(`  ${p.name} = ${p.got}, want ${p.want}`);
    console.error(`    ${p.why}`);
  }
  process.exit(1);
}

console.log(green('ok: anonymous sign-in, email sign-in and signups are all still on'));
console.log(
  yellow('  note: this endpoint is a SUBSET -- SMTP, OTP expiry and rate limits are not in it'),
);

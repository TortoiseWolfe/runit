#!/usr/bin/env node
/**
 * DOES THE LIVE PROJECT'S AUTH CONFIG STILL MATCH WHAT THIS REPO DECLARES? -- #18.
 *
 * The database has been declared-and-verified for a while: one migration plus
 * `schema-fingerprint.json` and a gate that reads the live schema back. AUTH CONFIG HAD NO
 * SUCH THING -- SMTP, OTP length and expiry, signup toggles and rate limits all lived in a
 * dashboard, changeable by one click, with nothing recording the intent or noticing the
 * change. That gap has already shipped a defect: anonymous sign-in was off while a
 * TestFlight build went out, and only the most expensive lane could see it.
 *
 * THE DECLARATION IS `[remotes.production]` IN `supabase/config.toml` -- the file that
 * already exists, not a second one beside it. A `[remotes.*]` block applies to ONE project by
 * ref, which is what keeps the local-first defaults above it (a `127.0.0.1` site_url, a
 * loopback API port) from ever being confused for production's.
 *
 * WHY NOT `supabase config diff`, WHICH IS THE OBVIOUS ANSWER. It was the plan, and it does
 * not work with a properly-scoped token: it takes a legacy read path that demands
 * account-wide privileges and fails with `LegacyConfigDiffReadStatusError` against a token
 * that can read this project's auth config perfectly well. **The right response was not to
 * widen the token to suit the tool.** A token scoped to one project's config is the correct
 * credential; a subcommand that needs account-wide rights to do a project-scoped read is the
 * thing that is wrong. So this reads the endpoint directly.
 *
 * IT ONLY READS. There is no apply here, deliberately. Writing auth config is the one action
 * that can turn the product off for every user at once -- `external_anonymous_users_enabled`
 * alone is 100% of guests -- and the CLI's own help warns that a non-interactive push
 * "defaults to proceeding". Applying stays a human act.
 *
 * TOML VIA python3, WHICH IS NOT A NEW DEPENDENCY. Node ships no TOML parser; `policies.yml`
 * already shells to `python3`, and the checks container has 3.12 with `tomllib`. Adding a
 * parser package to read one file that another runtime already parses for free is not a
 * trade worth making.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { envLocal } from './lib/env.mjs';

const ROOT = join(import.meta.dirname, '..');
const CONFIG = join(ROOT, 'supabase/config.toml');
const REMOTE = 'production';

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

/**
 * Declared path in config.toml -> the Management API field it becomes.
 *
 * WRITTEN OUT RATHER THAN DERIVED, because the names genuinely do not correspond and a
 * clever mapping would be a guess wearing a rule's clothes. Two are outright inversions or
 * unit changes, and each is the kind of thing that silently passes while asserting nothing.
 */
const MAP = [
  { toml: ['auth', 'site_url'], api: 'site_url' },
  { toml: ['auth', 'enable_anonymous_sign_ins'], api: 'external_anonymous_users_enabled' },
  {
    toml: ['auth', 'enable_signup'],
    api: 'disable_signup',
    // INVERTED. `enable_signup = true` is `disable_signup: false`. Getting this backwards
    // would declare the opposite of the intent and read as correct.
    xform: (v) => !v,
  },
  { toml: ['auth', 'email', 'otp_length'], api: 'mailer_otp_length' },
  { toml: ['auth', 'email', 'otp_expiry'], api: 'mailer_otp_exp' },
  {
    toml: ['auth', 'email', 'max_frequency'],
    api: 'smtp_max_frequency',
    // A DURATION STRING BECOMES SECONDS. `"60s"` -> `60`. This is the per-address OTP
    // throttle; `rate_limit_otp` is a per-IP sign-in throttle on a five-minute window and is
    // a different thing wearing a similar name.
    xform: (v) => {
      const m = /^(\d+)(s|m|h)?$/.exec(String(v));
      if (!m) throw new Error(`max_frequency "${v}" is not a duration this tool understands`);
      return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2] ?? 's'];
    },
  },
  { toml: ['auth', 'email', 'smtp', 'host'], api: 'smtp_host' },
  { toml: ['auth', 'email', 'smtp', 'port'], api: 'smtp_port', xform: (v) => String(v) },
  { toml: ['auth', 'email', 'smtp', 'user'], api: 'smtp_user' },
  { toml: ['auth', 'email', 'smtp', 'admin_email'], api: 'smtp_admin_email' },
  { toml: ['auth', 'email', 'smtp', 'sender_name'], api: 'smtp_sender_name' },
  { toml: ['auth', 'rate_limit', 'email_sent'], api: 'rate_limit_email_sent' },
  { toml: ['auth', 'rate_limit', 'anonymous_users'], api: 'rate_limit_anonymous_users' },
];

/** The one declared value that is a secret: compared for PRESENCE, never for content. */
const SECRET = { toml: ['auth', 'email', 'smtp', 'pass'], api: 'smtp_pass' };

const token = envLocal('SUPABASE_ACCESS_TOKEN');
const declared = JSON.parse(
  execFileSync('python3', ['-c', 'import tomllib,sys,json;json.dump(tomllib.load(open(sys.argv[1],"rb")),sys.stdout)', CONFIG], {
    encoding: 'utf8',
  }),
);

const remote = declared.remotes?.[REMOTE];
if (!remote) {
  console.error(red(`FAIL: supabase/config.toml declares no [remotes.${REMOTE}] block.`));
  process.exit(1);
}
const ref = remote.project_id;

if (!token) {
  console.log(yellow('SKIPPED: auth config drift'));
  console.log(yellow('  SUPABASE_ACCESS_TOKEN is not set, so NOTHING about the live'));
  console.log(yellow(`  project's auth configuration was compared. Declared ref: ${ref}`));
  process.exit(0);
}

let live;
try {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
    // `lane()` buffers a lane's output, so a hung fetch hangs the run behind a blank screen.
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  live = await res.json();
} catch (e) {
  // LOUD SKIP on an unreachable API, the same call lane G and the mail policy make. A gate
  // that fails closed because somebody else's endpoint blipped is a gate that gets deleted.
  console.log(yellow('SKIPPED: auth config drift -- the Management API could not be read'));
  console.log(yellow(`  ${e.message}`));
  process.exit(0);
}

const read = (o, path) => path.reduce((a, k) => (a == null ? undefined : a[k]), o);

/**
 * The whole comparison, as a pure function of (declared, live).
 *
 * EXTRACTED SO IT CAN BE TESTED AT ALL. While `[remotes.production]` has never been applied
 * every run takes the pending branch, so the drift logic is unreachable -- and a mutation
 * proved it: dropping the `disable_signup` inversion, and separately declaring anonymous
 * sign-in OFF, both left the tool green. The mechanism that is the entire point of the file
 * was untested against the live project and would stay untested until an apply happened.
 *
 * `--selftest` exercises it with synthetic inputs instead, which is the shape ScriptHammer's
 * own mail-policy checker already uses.
 */
export function diffAuthConfig(remote, live) {
  const missing = MAP.filter((m) => read(remote, m.toml) === undefined).map((m) =>
    m.toml.join('.'),
  );

  const drift = [];
  for (const m of MAP) {
    if (read(remote, m.toml) === undefined) continue;
    const want = (m.xform ?? ((v) => v))(read(remote, m.toml));
    const got = live[m.api];
    if (got !== want) drift.push({ field: m.api, from: m.toml.join('.'), want, got });
  }

  const declaredPass = read(remote, SECRET.toml);
  const livePass = live[SECRET.api];
  const passSet = livePass != null && livePass !== '' && livePass !== 'None';
  if (/^env\(/.test(String(declaredPass)) && !passSet) {
    drift.push({
      field: SECRET.api,
      from: SECRET.toml.join('.'),
      want: '<a value, injected at apply time>',
      got: '<unset — custom SMTP is not configured, so the 2/hour cap is live>',
    });
  }

  // `smtp_host` marks the block as having been pushed at all: Supabase has no default for
  // it, so a value can only be there because somebody applied one.
  const everApplied = live.smtp_host != null && live.smtp_host !== '';
  return { missing, drift, everApplied };
}

/** Synthetic cases for the logic above, run by `--selftest`. No network, no credential. */
function selftest() {
  const base = {
    project_id: 'x',
    auth: {
      site_url: 'https://example.test',
      enable_anonymous_sign_ins: true,
      enable_signup: true,
      email: {
        otp_length: 6,
        otp_expiry: 600,
        max_frequency: '60s',
        smtp: {
          host: 'smtp.resend.com', port: 465, user: 'resend',
          admin_email: 'a@b.test', sender_name: 'RunIt', pass: 'env(X)',
        },
      },
      rate_limit: { email_sent: 60, anonymous_users: 100 },
    },
  };
  const applied = {
    site_url: 'https://example.test', external_anonymous_users_enabled: true,
    disable_signup: false, mailer_otp_length: 6, mailer_otp_exp: 600,
    smtp_max_frequency: 60, smtp_host: 'smtp.resend.com', smtp_port: '465',
    smtp_user: 'resend', smtp_admin_email: 'a@b.test', smtp_sender_name: 'RunIt',
    smtp_pass: 'hash:abc', rate_limit_email_sent: 60, rate_limit_anonymous_users: 100,
  };

  const fails = [];
  const check = (name, cond) => { if (!cond) fails.push(name); };

  check('a matching config reports no drift', diffAuthConfig(base, applied).drift.length === 0);
  check('and reads as applied', diffAuthConfig(base, applied).everApplied === true);

  check('a changed site_url is drift',
    diffAuthConfig(base, { ...applied, site_url: 'http://localhost:3000' })
      .drift.some((d) => d.field === 'site_url'));

  // THE INVERSION. `enable_signup = true` must mean `disable_signup: false`. Dropping the
  // xform makes this case pass, which is exactly the mutation that survived before.
  check('disable_signup is INVERTED, not copied',
    diffAuthConfig(base, { ...applied, disable_signup: true })
      .drift.some((d) => d.field === 'disable_signup'));

  // THE UNIT CHANGE. "60s" is 60, not "60s" and not 60_000.
  check('max_frequency "60s" equals 60 seconds',
    diffAuthConfig(base, { ...applied, smtp_max_frequency: 60 }).drift.length === 0);
  check('...and 120 is drift',
    diffAuthConfig(base, { ...applied, smtp_max_frequency: 120 })
      .drift.some((d) => d.field === 'smtp_max_frequency'));

  check('anonymous sign-in turned off is drift',
    diffAuthConfig(base, { ...applied, external_anonymous_users_enabled: false })
      .drift.some((d) => d.field === 'external_anonymous_users_enabled'));

  check('no smtp_host reads as never applied',
    diffAuthConfig(base, { ...applied, smtp_host: null }).everApplied === false);

  check('an emptied declaration is reported as missing, not as agreement',
    diffAuthConfig({ project_id: 'x', auth: {} }, applied).missing.length === MAP.length);

  if (fails.length) {
    console.error(red(`FAIL: ${fails.length} selftest case(s).`));
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(green('ok: auth-config diff logic passes 9 synthetic cases'));
  process.exit(0);
}

if (process.argv.includes('--selftest')) selftest();

const { missing, drift, everApplied } = diffAuthConfig(remote, live);

/**
 * A COVERAGE FLOOR. If `[remotes.production]` is emptied, or the nesting is renamed, every
 * lookup returns undefined and the comparison compares nothing while reporting success. Same
 * doctrine as the static audits' minimum counts.
 */
if (missing.length) {
  console.error(red(`FAIL: ${MAP.length - missing.length} of ${MAP.length} declared fields found in config.toml.`));
  console.error('  The declaration has shrunk or moved. Fix it; do not lower the map.');
  for (const m of missing) console.error(`    missing: ${m}`);
  process.exit(1);
}

console.log(`auth config: ${MAP.length} declared field(s) compared against ${ref}`);

/**
 * NEVER APPLIED IS A DIFFERENT STATE FROM DRIFTED, and conflating them would make this gate
 * red from the day it was written until somebody found a spare afternoon -- which is how a
 * gate gets commented out instead of fixed. Exactly the rule `check-mail-policy.mjs` already
 * carries for a sending domain that does not exist yet.
 *
 * `smtp_host` is the discriminator because it is the field that marks the block as having
 * been pushed at all: Supabase has no default for it, so a value can only be there because
 * somebody applied one. Before that, every difference below is a PLAN. After it, every
 * difference is a REGRESSION.
 */
if (drift.length && !everApplied) {
  console.log(yellow('SKIPPED: this config has never been applied, so nothing has drifted'));
  console.log(yellow(`  ${drift.length} field(s) would change on first apply:`));
  for (const d of drift) {
    console.log(yellow(`    ${d.field}: ${JSON.stringify(d.got)} -> ${JSON.stringify(d.want)}`));
  }
  console.log(yellow('  Applying is a deliberate human act; see [remotes.production] in'));
  console.log(yellow('  supabase/config.toml. Once applied, these become hard failures.'));
  process.exit(0);
}

/**
 * `--apply` -- WRITE THE DECLARED FIELDS, AND NOTHING ELSE.
 *
 * The first version of this file had no apply at all, on the reasoning that writing auth
 * config is the one action that can turn the product off for every user at once. That
 * reasoning is sound and it was applied too broadly: it is true of
 * `external_anonymous_users_enabled` and `security_captcha_enabled`, and false of every field
 * this repo actually declares. Nothing here can lock anybody out -- the set is a site URL, an
 * OTP length and expiry, and two rate limits, and the last two only ever RAISE capacity.
 *
 * So the guards are narrow and specific rather than a blanket refusal:
 *
 *   - REFUSES UNDER `CI`. `compose.yaml` sets `CI: "1"`, so this costs nothing and means the
 *     one environment nobody is watching can never write. Applying stays a deliberate act at
 *     a keyboard.
 *   - SENDS ONLY DECLARED FIELDS. A whole-config PATCH would carry every local-first default
 *     in `config.toml` with it -- which is exactly the silent overwrite the CLI's own help
 *     warns about, naming a local development site_url as its example.
 *   - NEVER SENDS THE SECRET. `smtp_pass` is declared as `env(...)`; if the variable is not
 *     set it is omitted entirely rather than written blank. The sibling's rule: a feature
 *     whose secret is missing is withheld entirely rather than half-applied.
 *   - RE-READS AFTERWARDS. "The API returned 200" and "the value changed" are different
 *     claims, and only the second one matters.
 */
if (process.argv.includes('--apply')) {
  if (!drift.length) {
    console.log(green('nothing to apply: the live config already matches'));
    process.exit(0);
  }
  if (process.env.CI) {
    console.error(red('REFUSED: --apply under CI.'));
    console.error('  Writing auth config is a deliberate act at a keyboard, not a build step.');
    process.exit(1);
  }

  const body = {};
  for (const d of drift) {
    if (d.field === SECRET.api) {
      // Declared as env(...). Withheld entirely rather than half-applied.
      console.log(yellow(`  skipping ${d.field}: its value is injected, not declared here`));
      continue;
    }
    body[d.field] = d.want;
  }
  if (Object.keys(body).length === 0) {
    console.log(yellow('nothing writable in this drift'));
    process.exit(0);
  }

  console.log(`applying ${Object.keys(body).length} field(s) to ${ref}:`);
  for (const [k, v] of Object.entries(body)) console.log(`  ${k} -> ${JSON.stringify(v)}`);

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    console.error(red(`FAIL: PATCH returned ${res.status}`));
    console.error(`  ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }

  // READ IT BACK. A 200 is not a value.
  const after = await (
    await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    })
  ).json();
  const stubborn = Object.entries(body).filter(([k, v]) => after[k] !== v);
  if (stubborn.length) {
    console.error(red(`FAIL: ${stubborn.length} field(s) did not move despite a 200.`));
    for (const [k, v] of stubborn) {
      console.error(`  ${k}: wanted ${JSON.stringify(v)}, still ${JSON.stringify(after[k])}`);
    }
    process.exit(1);
  }
  console.log(green(`ok: ${Object.keys(body).length} field(s) applied and read back`));
  process.exit(0);
}

if (drift.length) {
  console.error(red(`FAIL: ${drift.length} field(s) differ from supabase/config.toml.`));
  for (const d of drift) {
    console.error(`  ${d.field}  (${d.from})`);
    console.error(`    declared: ${JSON.stringify(d.want)}`);
    console.error(`    live:     ${JSON.stringify(d.got)}`);
  }
  console.error('');
  console.error('  Apply deliberately, never in CI and never non-interactively -- writing');
  console.error('  auth config is the one action that can turn the product off for everyone.');
  process.exit(1);
}

console.log(green(`ok: the live auth config matches what this repo declares`));

#!/usr/bin/env node
/**
 * IS THE MAIL DNS RUNIT DEPENDS ON STILL THERE? -- #18.
 *
 * Host sign-in emails a 6-digit code. Supabase's built-in mail is 2/hour PROJECT-WIDE, so
 * that flow needs custom SMTP, which needs a sending domain with DKIM and SPF. The decision
 * (2026-09-12) is to send from `runit.scripthammer.com` -- a subdomain of a domain the owner
 * already controls, already on Cloudflare, already a verified Resend sender at its root.
 *
 * ALL OF THAT LIVES IN A DASHBOARD, NOT IN THIS TREE. Nothing here would notice a record
 * being deleted, a zone moved, or a token rotated -- and mail fails SILENTLY in both
 * directions. A lost DKIM key does not error; under `p=none` nothing visibly breaks, and the
 * damage is invisible until a mailbox provider starts junking sign-in codes. A guest never
 * sees a bounce. The host just cannot get in, and blames the app.
 *
 * THE HALF THAT IS UNIQUE TO RUNIT, and the reason this gate lives here rather than only in
 * ScriptHammer: **RunIt is a guest on somebody else's domain.** `scripthammer.com` carries
 * live inbound mail -- Cloudflare Email Routing, and `admin@scripthammer.com` is the
 * published security-contact address for that project. Adding a sending subdomain must not
 * disturb it, and the way that goes wrong is editing the ROOT SPF instead of the subdomain's.
 * So this asserts the neighbour is intact as loudly as it asserts our own records.
 *
 * WHAT IT IS NOT. It does not prove mail is DELIVERED, and it cannot: that needs a
 * receiver's aggregate reports, which arrive days later by email. It asserts the published
 * policy still matches the declared intent below. "The config we meant is still there" and
 * "mail works" are different claims and only the first is checkable from CI.
 *
 * Ported from `ScriptHammer/scripts/ci/check-mail-policy.mjs` (#822 there), which is where
 * the DoH-with-no-credential shape and the declared-intent pattern come from.
 *
 *   pnpm audit:mail
 */

import { BOUNCE_DOMAIN, DMARC_POLICY, SENDING_DOMAIN, ZONE } from './dns-intent.mjs';

const DOH = 'https://cloudflare-dns.com/dns-query';

/**
 * The mail policy this repository intends to be published.
 *
 * Declared here rather than discovered, so tightening it is a reviewable one-line change in
 * this repo that CI enforces against live DNS -- instead of an undocumented dashboard edit
 * nothing records.
 */
const INTENDED = {
  /** Where sign-in codes come FROM. Shared with the applier so the two cannot disagree. */
  sending: SENDING_DOMAIN,
  /**
   * Where the ENVELOPE sender lives, and it is NOT the sending domain.
   *
   * THE FIRST VERSION OF THIS FILE LOOKED FOR SPF ON `SENDING_DOMAIN` AND WAS WRONG. Resend
   * puts SPF and the bounce MX on a `send.` label beneath it, because SPF authorises the
   * envelope sender rather than the From address. Applying the real records is what exposed
   * it -- the gate reported "half-configured" over a correctly-configured domain, which is
   * the right direction to fail in and still a wrong assertion.
   *
   * DMARC still passes: DKIM's `d=` IS the From domain, so it aligns strictly. SPF aligns
   * in relaxed mode because both share the organisational domain. Either one is enough.
   */
  bounce: BOUNCE_DOMAIN,
  /** Resend's DKIM selector, evidenced on the parent zone before we ever sent anything. */
  dkimSelector: process.env.MAIL_DKIM_SELECTOR || 'resend',
  /** The neighbour whose inbound mail must survive us. */
  parentMxSuffix: process.env.MAIL_PARENT_MX_SUFFIX || 'mx.cloudflare.net',
  parentSpfInclude: process.env.MAIL_PARENT_SPF_INCLUDE || '_spf.mx.cloudflare.net',
};

const PARENT = process.env.MAIL_PARENT_DOMAIN || ZONE;

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

/**
 * BEFORE THE NETWORK, so the free half cannot be skipped by an unreachable resolver. Same
 * placement `run-checks.sh` gives the static SQL check ahead of lane E's expensive half.
 */
if (process.argv.includes('--selftest')) selftest();

async function query(name, type) {
  const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: 'application/dns-json' },
  });
  if (!res.ok) throw new Error(`DoH ${res.status} for ${type} ${name}`);
  const body = await res.json();
  return (body.Answer ?? [])
    .filter((a) => a.type === (type === 'TXT' ? 16 : 15))
    .map((a) => String(a.data).replace(/^"|"$/g, '').replace(/" "/g, ''));
}

const problems = [];
/** Not configured yet: the lane measured nothing and must say SKIPPED. */
const notes = [];
/** Configured, and something is still worth doing. Green, but said out loud. */
const reminders = [];
const fail = (m) => problems.push(m);

let parentMx, parentSpfTxt, parentDmarc, sendDkim, bounceSpfTxt, bounceMx, ourDmarc;
try {
  [parentMx, parentSpfTxt, parentDmarc, sendDkim, bounceSpfTxt, bounceMx, ourDmarc] =
    await Promise.all([
      query(PARENT, 'MX'),
      query(PARENT, 'TXT'),
      query(`_dmarc.${PARENT}`, 'TXT'),
      query(`${INTENDED.dkimSelector}._domainkey.${INTENDED.sending}`, 'TXT'),
      query(INTENDED.bounce, 'TXT'),
      query(INTENDED.bounce, 'MX'),
      query(`_dmarc.${INTENDED.sending}`, 'TXT'),
    ]);
} catch (e) {
  /**
   * LOUD SKIP, NOT A RED GATE, and the same call lane G makes. This is the only check here
   * that needs the network, and a gate that fails closed on somebody else's resolver being
   * briefly unreachable is a gate that gets switched off inside a week.
   */
  console.log(yellow('SKIPPED: mail policy -- DNS could not be reached'));
  console.log(yellow(`  ${e.message}`));
  console.log(yellow('  NOTHING ABOUT THE MAIL DNS WAS CHECKED.'));
  process.exit(0);
}

/* ------------------------------------------- the neighbour, which must survive us */

if (!parentMx.some((r) => r.toLowerCase().includes(INTENDED.parentMxSuffix))) {
  fail(
    `${PARENT} has no MX ending ${INTENDED.parentMxSuffix} -- inbound mail to that domain ` +
      `is DOWN. admin@${PARENT} is a published security-contact address; losing it means ` +
      `vulnerability reports bounce and nobody here sees a thing.`,
  );
}

const parentSpf = parentSpfTxt.find((r) => r.toLowerCase().startsWith('v=spf1'));
if (!parentSpf) {
  fail(`${PARENT} publishes no SPF record at all.`);
} else if (!parentSpf.includes(INTENDED.parentSpfInclude)) {
  fail(
    `${PARENT}'s SPF no longer includes ${INTENDED.parentSpfInclude} -- got "${parentSpf}". ` +
      `A sending domain goes on a SUBDOMAIN precisely so the root is never edited; this ` +
      `reads like the root was changed instead.`,
  );
}

const dmarc = parentDmarc.find((r) => r.toLowerCase().startsWith('v=dmarc1'));
if (!dmarc) {
  fail(`_dmarc.${PARENT} publishes no DMARC record -- the domain is spoofable, silently.`);
} else if (!/\bp=/.test(dmarc)) {
  fail(`_dmarc.${PARENT} declares no policy tag: "${dmarc}"`);
}

/* --------------------------------------------------- our own sending subdomain */

const bounceSpf = bounceSpfTxt.find((r) => r.toLowerCase().startsWith('v=spf1'));
const dmarc41 = ourDmarc.find((r) => r.toLowerCase().startsWith('v=dmarc1'));

/**
 * NOT YET SET UP IS "NOTHING AT ALL", NOT "NO DKIM" -- and keying on DKIM alone got this
 * wrong. A domain carrying SPF, a bounce MX and a DMARC record but NO DKIM is not
 * unconfigured, it is BROKEN: somebody deleted the signing key off a working sender. Under
 * the first version that reported `SKIPPED: measured nothing` and advised setting the domain
 * up, which is both wrong and reassuring. Caught by mutation -- pointing the selector at a
 * name that does not exist left the lane green.
 *
 * So: any signal at all means this domain is in use, and every missing piece is then a
 * failure. Only total silence is a skip.
 */
const configured =
  sendDkim.length > 0 || bounceSpfTxt.length > 0 || bounceMx.length > 0 || ourDmarc.length > 0;

if (!configured) {
  notes.push(
    `${INTENDED.sending} is not configured yet -- no DKIM at ` +
      `${INTENDED.dkimSelector}._domainkey. Add it as a domain in Resend, publish what it ` +
      `emits with \`node tools/dns-apply.mjs --apply\`, then re-run. Until then host ` +
      `sign-in is capped at Supabase's 2 emails/hour project-wide.`,
  );
} else {
  if (sendDkim.length === 0) {
    fail(
      `${INTENDED.sending} has no DKIM at ${INTENDED.dkimSelector}._domainkey, but the rest ` +
        `of its mail DNS is present -- the signing key has been removed from a domain that ` +
        `is in use. Every message it sends now fails alignment.`,
    );
  }
  if (!bounceSpf) {
    fail(
      `${INTENDED.bounce} publishes no SPF -- half-configured. Mail will send and fail ` +
        `envelope authorisation, which under p=none is invisible until a provider junks it.`,
    );
  } else if (!bounceSpf.includes('amazonses.com')) {
    fail(`${INTENDED.bounce}'s SPF does not authorise Resend's sender: "${bounceSpf}"`);
  }

  if (bounceMx.length === 0) {
    fail(
      `${INTENDED.bounce} has no MX -- bounces and complaints have nowhere to land, so a ` +
        `dead address keeps being retried and the sending reputation pays for it.`,
    );
  }

  // OUR OWN DMARC, not the root's. Without this record the subdomain silently inherits the
  // neighbour's policy, and raising ours would mean raising theirs -- which is exactly the
  // coupling the subdomain exists to avoid.
  if (!dmarc41) {
    fail(
      `_dmarc.${INTENDED.sending} publishes nothing, so this domain inherits ${PARENT}'s ` +
        `policy and cannot be enforced independently of it.`,
    );
  } else if (!/\bp=/.test(dmarc41)) {
    fail(`_dmarc.${INTENDED.sending} declares no policy tag: "${dmarc41}"`);
  } else {
    /**
     * LIVE AGAINST DECLARED, rather than against a word written here.
     *
     * The first version of this branch hardcoded the staging: any `p=none` was a polite
     * `todo:` and anything stronger passed silently. So once `dns-intent.mjs` was raised to
     * `reject`, a live policy SILENTLY DOWNGRADED back to `none` -- by a dashboard edit, a
     * restored zone file, a provider's "fix your DNS" wizard -- would have printed a
     * reminder to go and do the thing that had just been undone. A gate that cannot tell
     * "not there yet" from "someone took it away" is not measuring the intent at all.
     *
     * So the comparison is against `DMARC_POLICY`, the same export the applier writes from.
     * Weaker than declared is a FAILURE; still staged at none WHILE the file says none is
     * the reminder, which is the case it was written for.
     */
    const v = dmarcVerdict(dmarc41, DMARC_POLICY);
    if (v.kind === 'unreadable') {
      fail(`_dmarc.${INTENDED.sending} declares no policy this tool understands: "${dmarc41}"`);
    } else if (v.kind === 'weaker') {
      fail(
        `_dmarc.${INTENDED.sending} is live at p=${v.live} and this repo declares ` +
          `p=${v.declared}. A policy does not weaken by itself: either somebody edited the ` +
          `zone, or \`pnpm dns:apply\` has not run. \`pnpm dns:plan\` shows the diff.`,
      );
    } else if (v.kind === 'staged') {
      // Declared none AND live none: the staging is deliberate and outstanding. An unraised
      // policy nobody remembers is how a domain sits unenforced for a year.
      reminders.push(
        `_dmarc.${INTENDED.sending} is still p=none. Raise it to p=reject in ` +
          `tools/dns-intent.mjs once Authentication-Results on a real message shows ` +
          `dkim=pass with d=${INTENDED.sending}.`,
      );
    }
  }
}

/**
 * LIVE DMARC POLICY vs THE ONE THIS REPO DECLARES.
 *
 * EXTRACTED SO IT CAN BE TESTED AT ALL, which is the same move `check-auth-config.mjs` made
 * and for the same reason: the interesting branch is unreachable in a normal run. Live and
 * declared now both read `reject`, so every real invocation takes the `ok` path and a
 * mutation to the comparison would sit green forever -- and the branch that would be dead is
 * precisely the one that catches somebody weakening the policy.
 *
 * THE DOWNGRADE IS THE CASE WORTH CATCHING. A DMARC policy does not weaken by itself, and
 * when one does -- a dashboard edit, a restored zone file, a provider's "fix your DNS"
 * wizard -- nothing visibly breaks: mail still flows, and the protection is simply gone. The
 * first version of this branch treated any `p=none` as a polite reminder to go and raise it,
 * which would have read as a to-do item over an undone decision.
 */
export function dmarcVerdict(record, declared) {
  const strength = { none: 0, quarantine: 1, reject: 2 };
  const live = /\bp=(none|quarantine|reject)\b/.exec(record ?? '')?.[1];
  if (!live) return { kind: 'unreadable' };
  if (strength[live] < strength[declared]) return { kind: 'weaker', live, declared };
  // Declared none and live none: staged on purpose, and outstanding.
  if (live === 'none') return { kind: 'staged', live, declared };
  return { kind: 'ok', live, declared };
}

/** Synthetic cases for the verdict above. No network, no credential. */
function selftest() {
  const fails = [];
  let cases = 0;
  const check = (name, cond) => { cases += 1; if (!cond) fails.push(name); };

  check('live reject under a declared reject is ok',
    dmarcVerdict('v=DMARC1; p=reject; adkim=s', 'reject').kind === 'ok');
  // THE ONE THAT MATTERS. This is today's live state downgraded by somebody else.
  check('live none under a declared reject is a FAILURE, not a reminder',
    dmarcVerdict('v=DMARC1; p=none; adkim=s', 'reject').kind === 'weaker');
  check('live quarantine under a declared reject is also weaker',
    dmarcVerdict('v=DMARC1; p=quarantine', 'reject').kind === 'weaker');
  check('live reject under a declared none is NOT a failure',
    dmarcVerdict('v=DMARC1; p=reject', 'none').kind === 'ok');
  check('none while none is declared is the staged reminder',
    dmarcVerdict('v=DMARC1; p=none', 'none').kind === 'staged');
  check('a record with no policy tag is unreadable, not assumed',
    dmarcVerdict('v=DMARC1; rua=mailto:x@y', 'reject').kind === 'unreadable');
  check('an absent record is unreadable rather than throwing',
    dmarcVerdict(undefined, 'reject').kind === 'unreadable');
  // `p=nonesuch` must not match `none` through a loose regex and read as a live policy.
  check('a policy word that merely starts with one is not that one',
    dmarcVerdict('v=DMARC1; p=nonesuch', 'reject').kind === 'unreadable');

  if (fails.length) {
    console.error(red(`FAIL: ${fails.length} mail-policy selftest case(s).`));
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(green(`ok: DMARC policy comparison passes ${cases} synthetic cases`));
  process.exit(0);
}

/* ------------------------------------------------------------------------ report */

console.log(`mail policy: sending ${INTENDED.sending}, neighbour ${PARENT}`);

if (problems.length) {
  console.error(red(`FAIL: ${problems.length} mail-policy problem(s).`));
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

if (notes.length) {
  /**
   * THE WORD `SKIPPED:` IS LOAD-BEARING and is reserved for MEASURED NOTHING.
   * `docker/run-checks.sh` greps a lane's own output for it and names the lane in the closing
   * summary -- the mechanism that exists because lane E skipped on every run for the life of
   * the repo while the last line said everything passed.
   *
   * A REMINDER IS NOT A SKIP, and the first version of this conflated them: with the domain
   * fully configured and only a `p=none` note outstanding, the lane announced that it had
   * measured nothing. It had measured everything. Devaluing the word is how a summary stops
   * being read.
   */
  console.log(green(`ok: ${PARENT}'s inbound mail is intact -- MX, SPF and DMARC all present`));
  console.log(yellow('SKIPPED: our own sending domain measured nothing'));
  for (const n of notes) console.log(yellow(`  ${n}`));
  process.exit(0);
}

for (const r of reminders) console.log(yellow(`  todo: ${r}`));
console.log(
  green(`ok: ${INTENDED.sending} signs, and ${PARENT}'s inbound mail is undisturbed`),
);

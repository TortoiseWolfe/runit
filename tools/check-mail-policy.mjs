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

const DOH = 'https://cloudflare-dns.com/dns-query';

/**
 * The mail policy this repository intends to be published.
 *
 * Declared here rather than discovered, so tightening it is a reviewable one-line change in
 * this repo that CI enforces against live DNS -- instead of an undocumented dashboard edit
 * nothing records.
 */
const INTENDED = {
  /** Where sign-in codes come FROM. Its own Resend domain, its own sending reputation. */
  sending: process.env.MAIL_SENDING_DOMAIN || 'runit.scripthammer.com',
  /** Resend's DKIM selector, evidenced on the parent zone already. */
  dkimSelector: process.env.MAIL_DKIM_SELECTOR || 'resend',
  /** The neighbour whose inbound mail must survive us. */
  parentMxSuffix: process.env.MAIL_PARENT_MX_SUFFIX || 'mx.cloudflare.net',
  parentSpfInclude: process.env.MAIL_PARENT_SPF_INCLUDE || '_spf.mx.cloudflare.net',
};

/** The parent is the sending domain minus its first label -- `a.b.com` -> `b.com`. */
const PARENT = process.env.MAIL_PARENT_DOMAIN || INTENDED.sending.split('.').slice(1).join('.');

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

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
const notes = [];
const fail = (m) => problems.push(m);

let parentMx, parentSpfTxt, parentDmarc, sendDkim, sendSpfTxt;
try {
  [parentMx, parentSpfTxt, parentDmarc, sendDkim, sendSpfTxt] = await Promise.all([
    query(PARENT, 'MX'),
    query(PARENT, 'TXT'),
    query(`_dmarc.${PARENT}`, 'TXT'),
    query(`${INTENDED.dkimSelector}._domainkey.${INTENDED.sending}`, 'TXT'),
    query(INTENDED.sending, 'TXT'),
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

const sendSpf = sendSpfTxt.find((r) => r.toLowerCase().startsWith('v=spf1'));
const configured = sendDkim.length > 0 || Boolean(sendSpf);

if (!configured) {
  /**
   * NOT YET SET UP is a different state from BROKEN, and conflating them is how a gate
   * earns a reputation for crying wolf before the thing it guards even exists. An
   * unconfigured subdomain skips with instructions; a half-configured one fails.
   */
  notes.push(
    `${INTENDED.sending} is not configured yet -- no DKIM and no SPF. Add it as a domain in ` +
      `Resend, publish the records it emits on that SUBDOMAIN ONLY, then re-run. Until then ` +
      `host sign-in is capped at Supabase's 2 emails/hour project-wide.`,
  );
} else {
  if (sendDkim.length === 0) {
    fail(
      `${INTENDED.sending} has SPF but NO DKIM at ${INTENDED.dkimSelector}._domainkey -- ` +
        `half-configured. Mail will send and fail alignment, which under p=none is invisible.`,
    );
  }
  if (!sendSpf) {
    fail(`${INTENDED.sending} has DKIM but no SPF record -- half-configured.`);
  }
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
   * THE WORD `SKIPPED:` IS LOAD-BEARING. `docker/run-checks.sh` greps a lane's own output
   * for it and names the lane in the closing summary -- the mechanism that exists because
   * lane E skipped on every run for the life of the repo while the last line said everything
   * passed. Half of this gate RAN (the neighbour) and half MEASURED NOTHING (our sending
   * domain), and a run that printed only green would be claiming the second half.
   */
  console.log(green(`ok: ${PARENT}'s inbound mail is intact -- MX, SPF and DMARC all present`));
  console.log(yellow('SKIPPED: our own sending domain measured nothing'));
  for (const n of notes) console.log(yellow(`  ${n}`));
  process.exit(0);
}

console.log(
  green(`ok: ${INTENDED.sending} signs, and ${PARENT}'s inbound mail is undisturbed`),
);

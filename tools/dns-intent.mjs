/**
 * THE DNS RUNIT NEEDS, DECLARED RATHER THAN CLICKED -- #18.
 *
 * These records were read out of Resend's own "Add domain" panel on 2026-09-12 and put here
 * instead of into a dashboard, because a record that exists only in somebody's browser
 * history cannot be reviewed, diffed, rebuilt, or explained. `tools/dns-apply.mjs` writes
 * them; `tools/check-mail-policy.mjs` verifies them over public DNS with no credential.
 *
 * RESEND'S "AUTO CONFIGURE" WAS DECLINED DELIBERATELY. It offers to write these itself over
 * an OAuth grant, which would have meant a third party holding DNS-write on a zone carrying
 * ScriptHammer's live inbound mail -- its MX, its root SPF, its DMARC, and
 * `admin@scripthammer.com`, which is a published security-contact address. A standing
 * privilege over all of that, granted to save a copy-paste, and never revoked.
 *
 * NAMES ARE FQDNs HERE AND WERE ZONE-RELATIVE IN THE PANEL. Resend shows `send.runit`; the
 * Cloudflare API wants `send.runit.scripthammer.com`. Passing the relative form creates
 * `send.runit.scripthammer.com.scripthammer.com`, the domain never verifies, and nothing
 * says why. Written out in full for that reason, and `assertFqdn` below refuses the short
 * form rather than trusting whoever edits this next.
 */

/** The zone these live in. RunIt is a TENANT here -- see ACCOUNTS.md. */
export const ZONE = 'scripthammer.com';

/** What the From address is a subdomain of. Moving this is next year's one-line change. */
export const SENDING_DOMAIN = `runit.${ZONE}`;

/**
 * Where Resend hands bounces back, and where its SPF lives.
 *
 * A SEPARATE LABEL BELOW the sending domain, which is Resend's own convention and is why the
 * MX below does not collide with the root's Cloudflare Email Routing MX: different name,
 * different record. That separation is the entire reason a subdomain was chosen.
 */
export const BOUNCE_DOMAIN = `send.${SENDING_DOMAIN}`;

export const RECORDS = [
  {
    kind: 'dkim',
    type: 'TXT',
    name: `resend._domainkey.${SENDING_DOMAIN}`,
    // Bare `p=` with no `v=DKIM1; k=rsa;` is what Resend issues, and it is valid: RFC 6376
    // makes `v=` recommended-with-a-default and `k=` default to rsa. Published verbatim --
    // a DKIM key is not a string to tidy up.
    content:
      'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC+jfy0Q9cvVVTVZ5URdPQS5/6VUCxdPsC/WivwVRUOvkNefwaAdEFfE/tigFrVuTtAILOrxPirhcBPwxCs8PSn1cXs4Oayx0dXA4DKP5LYnW7EteL9bqhrZImsA3q82GR+fyzUXCMyNVVfyMWO0jUcLRe1qHntVc2z5vesIdDY7wIDAQAB',
    why: 'signs our mail as runit.scripthammer.com, which is what aligns it with the From address',
  },
  {
    kind: 'bounce-mx',
    type: 'MX',
    name: BOUNCE_DOMAIN,
    content: 'feedback-smtp.us-east-1.amazonses.com',
    priority: 10,
    why: 'bounce and complaint feedback. NOT inbound mail, and not on the root -- the zone’s own MX is untouched',
  },
  {
    kind: 'spf',
    type: 'TXT',
    name: BOUNCE_DOMAIN,
    content: 'v=spf1 include:amazonses.com ~all',
    why: 'authorises the envelope sender. On the bounce label, so the root SPF is never edited',
  },
  {
    /**
     * OUR OWN DMARC, AND IT STARTS AT `none` ON PURPOSE.
     *
     * Without this record the subdomain inherits `_dmarc.scripthammer.com`, which is `p=none`
     * and cannot be raised until ScriptHammer's own #368 is fixed (its replies leave through a
     * personal Gmail, unaligned). Publishing our own DECOUPLES the two: we can enforce
     * without waiting on a neighbour, and our failures stop landing in their reports.
     *
     * `p=none` TODAY, `p=reject` AFTER THE FIRST REAL SEND IS READ BACK. The plan for this
     * work said reject immediately, on the reasoning that our mail is 100% Resend and
     * therefore aligned. That reasoning is sound and it is still an ASSERTION -- no mail has
     * been sent from this domain yet, so nothing has observed the alignment it depends on.
     * DMARC is designed to be monitored and then enforced, and the cost of being wrong at
     * `reject` is that the very first sign-in code is refused outright rather than junked.
     * Raising it is a one-word diff in this file once `Authentication-Results` on a real
     * message says `dkim=pass` with `d=runit.scripthammer.com`.
     *
     * `adkim=s`: strict DKIM alignment. Our DKIM `d=` IS the From domain, so strict costs
     * nothing and refuses a class of lookalike the relaxed default would admit.
     */
    kind: 'dmarc',
    type: 'TXT',
    name: `_dmarc.${SENDING_DOMAIN}`,
    content: `v=DMARC1; p=none; adkim=s; aspf=r; rua=mailto:admin@${ZONE}`,
    why: 'our own policy, independent of the root’s. Staged: none now, reject once alignment is observed',
  },
];

/** Refuses a zone-relative name, which is the one mistake that fails silently. */
export function assertFqdn(name) {
  if (!name.endsWith(`.${ZONE}`) && name !== ZONE) {
    throw new Error(
      `"${name}" is not inside ${ZONE}. Cloudflare would append the zone and create ` +
        `"${name}.${ZONE}" -- the domain then never verifies and nothing says why.`,
    );
  }
  return name;
}

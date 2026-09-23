#!/usr/bin/env node
/**
 * Pull ONE customer screenshot out of storage, into a gitignored directory.
 *
 * `pnpm feedback:shot <report-id>`
 *
 * WHY THIS EXISTS RATHER THAN A COMMITTED FILE. `app-feedback-to-issues.mjs` used to commit
 * the bytes into `design/feedback/`, on the sibling TestFlight tool's rule that a signed URL
 * decays into a description of a picture nobody can see. That rule is right, and the premise
 * under it was wrong: this repository has been PUBLIC since the day it was created, while
 * `CLAUDE.md` asserted it was private.
 *
 * A screenshot of this product is other people's photographs -- a guest reporting that her
 * photo never appeared screenshots the album, which is a room full of people under their own
 * nicknames. Publishing that hourly and irreversibly is a different act from showing it to a
 * maintainer.
 *
 * THE DECAY ARGUMENT DOES NOT APPLY HERE, which is what makes the trade free: this channel
 * has a durable reference. `feedback.screenshot_path` names an object in a bucket that does
 * not expire, so the picture is reachable for as long as the row is -- by path, with the
 * service role, rather than through a link that goes stale.
 *
 * @module tools/feedback-shot
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { envLocal } from './lib/env.mjs';

const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const OFF = '\u001b[0m';

const OUT_DIR = '.feedback-shots';

const id = process.argv[2];
if (!id) {
  console.error(`usage: pnpm feedback:shot <report-id>`);
  console.error(`  The id is in the issue body, in the line that sent you here.`);
  process.exit(1);
}

const url = envLocal('EXPO_PUBLIC_SUPABASE_URL');
const key = envLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) {
  console.error(`${YELLOW}SKIPPED${OFF}: no EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.`);
  console.error(`  The bucket is private, so reading one object needs the service role.`);
  console.error(`  Put them in .env.local, or pass them in front of this one command.`);
  process.exit(1);
}

/*
 * The id reaches a URL, so it is checked before it gets there -- the same doctrine as the
 * path guard below, one argument earlier. A uuid or nothing.
 */
if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
  console.error(`${RED}FAIL${OFF}: that is not a report id: ${JSON.stringify(id).slice(0, 80)}`);
  process.exit(1);
}

const rowRes = await fetch(
  `${url}/rest/v1/feedback?select=id,screenshot_path&id=eq.${id}`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!rowRes.ok) {
  console.error(`${RED}FAIL${OFF}: could not read the report (${rowRes.status}).`);
  console.error(`  ${(await rowRes.text()).slice(0, 200)}`);
  process.exit(1);
}
const [row] = await rowRes.json();

if (!row) {
  console.error(`${RED}FAIL${OFF}: no report with id ${id}.`);
  console.error(`  It may have been swept, or the id may be from a different project.`);
  process.exit(1);
}
if (!row.screenshot_path) {
  console.log(`${YELLOW}nothing to fetch${OFF}: that report carries no screenshot.`);
  process.exit(0);
}

/*
 * REFUSE ANYTHING THAT IS NOT TWO UUIDS AND A KNOWN EXTENSION, before it reaches a URL. This
 * guard MOVED here from the filer rather than being deleted: it belongs wherever a
 * client-written string is interpolated into a service-role request, and that is now here.
 *
 * The fetch below carries the SERVICE ROLE, which reads every folder in every bucket whatever
 * RLS tells a client. Unchecked, `../event-photos/<event>/<photo>.jpg` would pull down a
 * guest's private photograph. The database refuses to store such a path in two places -- a
 * CHECK on the shape and `feedback_guard` comparing the prefix to the reporter's own identity
 * -- and this is here anyway, because rows written before those guards existed are still in
 * the table, and because the thing on the other side of this interpolation is somebody else's
 * photographs.
 */
if (!/^[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.(jpg|png|webp)$/.test(row.screenshot_path)) {
  console.error(`${RED}FAIL${OFF}: stored path is not {uuid}/{uuid}.ext, refusing to fetch it.`);
  console.error(`  report: ${id}`);
  process.exit(1);
}

const objRes = await fetch(`${url}/storage/v1/object/feedback/${row.screenshot_path}`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!objRes.ok) {
  console.error(`${RED}FAIL${OFF}: the row names an object storage would not give us (${objRes.status}).`);
  console.error(`  The row and the bytes are separate things; the upload may have failed.`);
  process.exit(1);
}
const bytes = Buffer.from(await objRes.arrayBuffer());

/*
 * SNIFF, DO NOT TRUST -- the sibling tool's rule, and it survives the move. A rewritten or
 * intercepted URL can answer 200 with an HTML error page, and saving that as a .jpg produces
 * evidence that is not evidence.
 */
const isPng = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const isJpg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
const isWebp =
  bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
  bytes.subarray(8, 12).toString('ascii') === 'WEBP';
if (!isPng && !isJpg && !isWebp) {
  console.error(`${RED}FAIL${OFF}: storage answered 200 with something that is not an image.`);
  console.error(`  first bytes: ${bytes.subarray(0, 16).toString('hex')}`);
  process.exit(1);
}

const ext = isPng ? 'png' : isWebp ? 'webp' : 'jpg';
mkdirSync(OUT_DIR, { recursive: true });
const out = `${OUT_DIR}/${id}.${ext}`;
writeFileSync(out, bytes);

console.log(`${GREEN}ok${OFF}: ${out}  (${(bytes.length / 1024).toFixed(0)} KB)`);
console.log(`${YELLOW}Do not commit it.${OFF} ${OUT_DIR}/ is gitignored, and this repository is public.`);

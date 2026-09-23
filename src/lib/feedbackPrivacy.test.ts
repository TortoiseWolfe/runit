/**
 * The customer feedback channel must not PUBLISH what it collects.
 *
 * This repository is public -- created public on 2026-09-03, public today -- and a screenshot
 * of this product is other people's photographs. The report this channel most wants is "my
 * photo never appeared", and the evidence for it is a picture of the ALBUM: a room full of
 * guests under their own nicknames who have never heard of us.
 *
 * For two days an hourly Action committed those pictures to `design/feedback/` with
 * `contents: write`. Not through carelessness -- through a rule that is right ("a signed URL
 * decays into a description of a picture nobody can see") resting on a premise that was
 * false. `CLAUDE.md` asserted the repository was private.
 *
 * WHY A TEST AND NOT A NOTE. Every part of the fix is one edit from being undone, and every
 * one of those edits looks like an improvement while you make it: restoring the commit step
 * reads as fixing a broken link, and `contents: write` reads as unblocking a job. None of
 * them fails anything else, and the damage is irreversible the moment the cron fires --
 * committed bytes are world-readable before anybody reviews the commit.
 *
 * Mutation-checked: each assertion below dies to the edit it names, and to nothing else.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const WORKFLOW = '.github/workflows/feedback.yml';
const FILER = 'tools/app-feedback-to-issues.mjs';

describe('the customer feedback channel does not publish the picture', () => {
  /**
   * The permission is what made the publication possible, and it is the cheapest thing to
   * restore by accident -- a failing write is an obvious-looking permissions problem.
   */
  it('files issues without write access to the repository contents', () => {
    const yml = read(WORKFLOW);
    const block = yml.slice(yml.indexOf('permissions:'), yml.indexOf('jobs:'));
    expect(block).toMatch(/contents:\s*read/);
    expect(block).not.toMatch(/contents:\s*write/);
  });

  /**
   * The filer runs unattended every hour. A `PUT .../contents/...` is the GitHub API call
   * that writes a file into the repository, and there is no legitimate reason for this tool
   * to make one.
   */
  it('never writes a file into the repository', () => {
    const src = read(FILER);
    expect(src).not.toMatch(/\/contents\//);
    expect(src).not.toMatch(/design\/feedback\/app-/);
  });

  /**
   * THE PATH IS NOT THE PICTURE, BUT PRINTING IT IS ITS OWN DISCLOSURE. It is
   * `{auth_user_id}/{uuid}.ext`, so a public issue carrying it links every report from one
   * device to one pseudonymous identity -- against this channel's own promise that nothing
   * identifying travels. The row id is enough; `feedback:shot` looks the rest up.
   */
  it('puts the report id in the issue, never the storage path', () => {
    const src = read(FILER);
    const body = src.slice(src.indexOf('function issueBody'), src.indexOf('/* -'));
    expect(body).toMatch(/feedback:shot/);
    expect(body).not.toMatch(/screenshot_path\s*\}/);
    expect(body).not.toMatch(/\$\{row\.screenshot_path\}/);
  });

  /**
   * The guard MOVED rather than died -- it belongs wherever a client-written string is
   * interpolated into a service-role URL. Deleting it would let a row written before the
   * database guards existed pull down `../event-photos/<event>/<photo>.jpg`: a guest's
   * private photograph, fetched with a role that reads every bucket.
   */
  it('still refuses a storage path that is not two uuids and a known extension', () => {
    const shot = read('tools/feedback-shot.mjs');
    expect(shot).toMatch(/\{36\}\\\/\[0-9a-fA-F-\]\{36\}\\\.\(jpg\|png\|webp\)/);
  });

  /** A fetched picture landing somewhere git tracks would undo all of the above at once. */
  it('keeps the fetched pictures out of git', () => {
    expect(read('.gitignore')).toMatch(/^\.feedback-shots\/$/m);
    expect(read('tools/feedback-shot.mjs')).toMatch(/OUT_DIR = '\.feedback-shots'/);
  });
});

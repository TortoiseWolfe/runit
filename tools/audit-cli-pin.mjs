#!/usr/bin/env node
/**
 * ONE SUPABASE CLI VERSION, DECLARED BY THE REPO AND OBEYED BY EVERYTHING.
 *
 * This is the same rule `.nvmrc` already enforces for Node, applied to the other tool that
 * can write to production. It exists because the rule was being broken: `policies.yml`
 * hardcoded `supabase@2.116.0` in four places while `npx supabase` on a developer machine
 * resolved to **2.117.0**, and nothing said a word. CLAUDE.md describes that exact failure
 * one tool over:
 *
 *   "The first arrangement let the Playwright base image choose: checks ran on v22.18.0
 *    while development ran on v24.13.0, and nothing said a word."
 *
 * It mattered more than a version number usually does, because the two versions DIFFER IN
 * CAPABILITY: `supabase config diff` -- the command a drift gate needs -- does not exist
 * before 2.117.0. A plan written against the local CLI would have been undeliverable in CI,
 * and the only symptom would have been a command not found.
 *
 * WHY A FILE AND NOT A devDependency, which is Supabase's own documented install. pnpm 10
 * blocks post-install scripts for packages not named in `onlyBuiltDependencies`, and this
 * repo relies on that -- CLAUDE.md: "pnpm blocks the post-install download that would heal a
 * mismatch". So a `supabase` devDependency would install a wrapper whose binary never
 * downloads, and opting it in would pull ~40MB into the checks container, which does not use
 * the CLI at all. A version file costs nothing and is what `.nvmrc` already does here.
 *
 * STATIC AND CREDENTIAL-FREE, so it runs in the normal sequence. It does not execute the CLI
 * -- that would cost a download on every checks run to learn something a file already says.
 * It asserts that nothing hardcodes a version behind the file's back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const VERSION_FILE = join(ROOT, 'supabase/.cli-version');

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

const declared = readFileSync(VERSION_FILE, 'utf8').trim();

if (!/^\d+\.\d+\.\d+$/.test(declared)) {
  console.error(red(`FAIL: supabase/.cli-version holds "${declared}", which is not an exact version.`));
  console.error('  A range is not a pin. See the Playwright note in CLAUDE.md.');
  process.exit(1);
}

/**
 * Every file that may legitimately name the CLI, and the coverage floor with it. A matcher
 * that stops matching reports no problems having read nothing -- the doctrine lanes A, A2 and
 * E all carry.
 */
const SCANNED = ['.github/workflows/policies.yml', 'package.json', 'docs/lane-e.md'];
const MIN_MENTIONS = 2;

const problems = [];
let mentions = 0;

for (const rel of SCANNED) {
  let text;
  try {
    text = readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    problems.push(`${rel} is named here but does not exist -- fix the list, do not drop the check`);
    continue;
  }
  // `supabase@X.Y.Z` anywhere is a hardcoded pin competing with the file.
  for (const m of text.matchAll(/supabase@(\d+\.\d+\.\d+)/g)) {
    mentions += 1;
    if (m[1] !== declared) {
      problems.push(
        `${rel} hardcodes supabase@${m[1]} while supabase/.cli-version says ${declared}. ` +
          `Read the file instead of repeating the number.`,
      );
    }
  }
  // ...and the good shape: reading the file.
  if (/\.cli-version/.test(text)) mentions += 1;
}

console.log(`audited ${SCANNED.length} files for a Supabase CLI version; declared ${declared}`);

if (mentions < MIN_MENTIONS) {
  console.error(red(`FAIL: only ${mentions} CLI-version reference(s) found, expected ${MIN_MENTIONS}.`));
  console.error('  Nothing appears to consume supabase/.cli-version any more, so this check');
  console.error('  is measuring nothing. Fix the wiring, or lower MIN_MENTIONS deliberately.');
  process.exit(1);
}

if (problems.length) {
  console.error(red(`FAIL: ${problems.length} CLI pin problem(s).`));
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(green(`ok: one CLI version (${declared}), and nothing hardcodes another`));

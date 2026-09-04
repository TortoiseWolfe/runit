#!/usr/bin/env node
/**
 * LANE A3 -- the pricing ladder may not advertise what nothing enforces.
 *
 * WHY THIS EXISTS. `src/domain/tiers.ts` opens by promising that "the paywall can
 * never advertise a limit the code does not enforce", and for a while it did exactly
 * that. `featureLines` was transcribed verbatim from the design canvas, so the copy
 * arrived complete while the enforcement arrived feature by feature. A grep found
 * EIGHT TierFeatures keys with no call site outside that file -- customBranding,
 * venueBranding, zipExport, requestCaps, multiDjQueues, folderTemplates,
 * bulkQrPrinting, prioritySupport -- two of them sold on the featured $79 tier.
 *
 * It was harmless only because the purchase path was cut from v1. It would have
 * become mis-selling on the day in-app purchase shipped, which is the day nobody
 * would have been re-reading this file.
 *
 * WHAT IT CHECKS. One rule, and it is about capability rather than prose: if a tier
 * grants a feature (`true`), something outside tiers.ts must READ that feature. A
 * flag nothing reads grants nothing. Prose is not checked -- a regex over marketing
 * copy would be a heuristic wearing a measurement's clothes, and the enforcement
 * question is the one that actually decides whether a buyer got what they paid for.
 *
 * Flags that are `false` everywhere are FINE and deliberately allowed: that is a
 * build target sitting in the type, granted to nobody, advertised by nobody.
 *
 * Exits non-zero on any violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TIERS = join(ROOT, 'src/domain/tiers.ts');
const SRC = join(ROOT, 'src');
const CODE = new Set(['.ts', '.tsx']);

const tiersSrc = readFileSync(TIERS, 'utf8');

/** The keys of the TierFeatures interface, in declaration order. */
const iface = /export interface TierFeatures \{([\s\S]*?)\n\}/.exec(tiersSrc);
if (!iface) {
  console.error('FAIL: could not find `export interface TierFeatures` in tiers.ts.');
  process.exit(1);
}
const flags = [...iface[1].matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);

/** Every flag any tier grants. `false` everywhere means granted to nobody. */
const granted = flags.filter((f) => new RegExp(`\\b${f}: true\\b`).test(tiersSrc));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (CODE.has(extname(full))) yield full;
  }
}

/**
 * A READ, not a mention. `checkFeature(x, 'zipExport')` counts; the tiers file that
 * declares it does not, and neither does a denial string keyed by the same name --
 * copy for a refusal that never fires is part of the problem, not evidence against it.
 */
const readers = new Map(flags.map((f) => [f, []]));
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (rel === 'src/domain/tiers.ts' || rel === 'src/domain/denials.ts') continue;
  if (rel.includes('.test.')) continue;
  const code = readFileSync(file, 'utf8');
  for (const f of flags) {
    // Count CALLS, not files. `.test()` here reported photoModeration as one
    // enforcement site when there are five, which is the kind of number a gate
    // must not get wrong -- the whole point is that someone believes its output.
    // `[^)]*` was WRONG here and under-counted badly: the commonest call in this
    // codebase is `checkFeature(this.computeEntitlements(), 'x')`, whose argument
    // contains its own `)`. It found 2 of photoModeration's 5 call sites. A gate
    // that under-counts can fail a feature that IS enforced, so it is bounded and
    // lazy instead of paren-avoiding.
    const calls = code.match(new RegExp(`checkFeature\\([\\s\\S]{0,160}?['"]${f}['"]`, 'g'));
    if (calls) for (let i = 0; i < calls.length; i++) readers.get(f).push(rel);
  }
}

const orphans = granted.filter((f) => readers.get(f).length === 0);

console.log(
  `audited ${flags.length} tier features; ${granted.length} granted by at least one tier`,
);

if (orphans.length > 0) {
  console.error(`\n\x1b[31mFAIL: ${orphans.length} advertised feature(s) that nothing enforces\x1b[0m\n`);
  for (const f of orphans) {
    console.error(`  ${f} — granted in tiers.ts, but no checkFeature() call reads it.`);
  }
  console.error(
    `\n  A tier that grants a flag nothing reads is selling nothing. Either build the\n` +
      `  enforcement, or set the flag false on every tier until you do and take the line\n` +
      `  out of featureLines. The flag may stay in TierFeatures as the build target.\n`,
  );
  process.exit(1);
}

for (const f of granted) {
  const sites = readers.get(f);
  const files = [...new Set(sites)].length;
  console.log(`  ${f} — ${sites.length} call(s) across ${files} file(s)`);
}
console.log('\n\x1b[32mevery granted feature is enforced somewhere.\x1b[0m');

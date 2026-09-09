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

/**
 * SQL ENFORCEMENT COUNTS TOO, and for a granted flag it counts for more.
 *
 * The rule above looks for a `checkFeature` call anywhere under `src/`, which a call in
 * `MemoryRepository` satisfies -- and MemoryRepository does not ship. Issue #21 is exactly
 * that: three of four granted flags were "enforced" only in the adapter nobody runs in
 * production, and this gate reported green over it.
 *
 * The real enforcement for `hostRoles` now lives in `invite_host`, which reads
 * `tier_limits` in Postgres. No `checkFeature` call can represent that, so the gate has to
 * learn to see it: a flag's snake_case name appearing in the migration is enforcement by
 * the only party a second client cannot route around.
 *
 * THIS NOW CLOSES #21, and it took two different kinds of fix. `pinnedAnnouncements`
 * got real enforcement -- a trigger on `broadcasts` that folds a pin the tier cannot
 * carry, on INSERT or UPDATE. `pushNotifications` got the other treatment -- the one the
 * failure text below recommends: every tier grants it `false` now and the "+ push" came
 * out of the $79 tier's featureLines, while the FLAG STAYS as the build target. Push does
 * not exist (`expo-notifications` is not a dependency) and you cannot gate a capability
 * nothing has, so removing the PROMISE was the only honest option left once building it
 * was out of scope (#27).
 *
 * It was deleted outright first. That made it the only one of nine unenforced flags
 * handled differently, and it silently dropped push out of the ladder-monotonicity test
 * that had been covering it. The remedy this file prints is the remedy this file means.
 *
 * The report says WHERE each flag is enforced rather than just that it is, because
 * "enforced" spread across a shipping adapter and a migration is the distinction that
 * hid the original gap.
 */
const MIGRATION = join(ROOT, 'supabase/migrations/00000000000000_schema.sql');
const sql = readFileSync(MIGRATION, 'utf8');
const snake = (f) => f.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const inSql = new Map(flags.map((f) => [f, new RegExp(`\\b${snake(f)}\\b`).test(sql)]));

/** A reader that ships, i.e. not the in-memory fixture adapter. */
const shipping = (f) => readers.get(f).some((rel) => !rel.startsWith('src/data/memory/'));

const orphans = granted.filter((f) => readers.get(f).length === 0 && !inSql.get(f));

console.log(
  `audited ${flags.length} tier features; ${granted.length} granted by at least one tier`,
);

if (orphans.length > 0) {
  console.error(`\n\x1b[31mFAIL: ${orphans.length} advertised feature(s) that nothing enforces\x1b[0m\n`);
  for (const f of orphans) {
    console.error(
      `  ${f} — granted in tiers.ts, but nothing reads it: no checkFeature() call and
` +
        `    no mention of \`${snake(f)}\` in the migration.`,
    );
  }
  console.error(
    `\n  A tier that grants a flag nothing reads is selling nothing. Either build the\n` +
      `  enforcement, or set the flag false on every tier until you do and take the line\n` +
      `  out of featureLines. The flag may stay in TierFeatures as the build target.\n`,
  );
  process.exit(1);
}

let clientOnly = 0;
for (const f of granted) {
  const sites = readers.get(f);
  const files = [...new Set(sites)].length;
  // WHERE, not just how many. A count alone is what let three flags look enforced while
  // living entirely in the adapter that does not ship.
  const where = [
    inSql.get(f) ? 'SQL' : null,
    shipping(f) ? 'shipping adapter' : null,
    sites.length ? `${sites.length} call(s) across ${files} file(s)` : null,
  ].filter(Boolean);
  const weak = !inSql.get(f) && !shipping(f);
  if (weak) clientOnly += 1;
  console.log(`  ${f} — ${where.join(' · ')}${weak ? '   <- in-memory adapter ONLY (#21)' : ''}`);
}
console.log('\n\x1b[32mevery granted feature is enforced somewhere.\x1b[0m');
if (clientOnly > 0) {
  // Deliberately not a failure. Making it one today would fail the build on two flags
  // that predate this check, which is how a gate gets switched off. It is reported every
  // run instead, so the number cannot quietly grow.
  console.log(
    `\x1b[33m  ${clientOnly} of them only in the adapter that does not ship. See issue #21.\x1b[0m`,
  );
}

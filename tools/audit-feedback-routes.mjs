#!/usr/bin/env node
/**
 * CAN THE PERSON ON THIS SCREEN TELL US IT IS BROKEN?
 *
 * WHY THIS EXISTS. A host had no way to report a problem from any of the five console
 * segments -- the person who BUYS this product, with the worst path in the app to saying it
 * was broken: `role-switch` (which mutates her identity), a tab, a scroll, a tap, and switch
 * back. `/signin` had none either, so a host whose emailed code never arrived was silent.
 * None of that was caught by anything, and it could not have been: before this file, the
 * string `open-feedback` appeared in `tests/` in exactly ONE spec, and nothing anywhere
 * asserted the presence OR the absence of a route on any other screen. The gap was not
 * merely untested -- no gate would have noticed it either way.
 *
 * IT IS A REACHABILITY CHECK, NOT A GEOMETRY ONE, and the split is the same one
 * `audit-touch-targets.mjs` makes. That lane asks whether a control DECLARES a reachable
 * target rather than resolving `StyleSheet.create` through spreads; this asks whether a
 * route RENDERS the control, and resolves imports exactly ONE level to answer it. A route
 * file in this repo is three lines -- an import and a default export -- so one level is the
 * whole answer for every route that exists today. It is stated rather than assumed: a screen
 * that moved its ReportLink behind a second component would be reported as missing, which is
 * a loud wrong answer and the right direction to be wrong in.
 *
 * FOUR RULES, and each catches something the others cannot:
 *
 *   1. COVERAGE  -- every route renders one, or is in EXCEPTIONS with a written reason.
 *   2. DENY      -- Chat must NOT. That absence is a decision (the chat footer was tried and
 *                   reverted; it displaced the line telling a guest why there is no compose
 *                   box) and it was pinned by exactly one assertion in one spec. A rule
 *                   states it once, for good.
 *   3. ONE OF IT -- `testID="open-feedback"` may appear in ReportLink.tsx and nowhere else.
 *                   `JoinScreen` hand-rolled the whole control for months: same copy, same
 *                   testID, same label -- and its copy had no `paddingVertical`, so its
 *                   whole touch target was a `hitSlop` that react-native-web DROPS.
 *   4. THE DOOR  -- `web/i/index.html` carries `id="report"`. It is the one surface every
 *                   new arrival passes through and where a cohort of forty demonstrably
 *                   stopped, and every other control in this app is INSIDE the app.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const APP = join(ROOT, 'src/app');
const SRC = join(ROOT, 'src');
const BRIDGE = join(ROOT, 'web/i/index.html');
const CONTROL = join(ROOT, 'src/components/ui/ReportLink/ReportLink.tsx');

/** Falling below this means the matcher stopped matching, which passes having measured
 *  nothing. Raise it as routes are added. Same doctrine as lanes A and A2. */
const COVERAGE_FLOOR = 15;

/**
 * Routes that deliberately carry no way to report, each with the reason.
 *
 * AN EXCEPTION IS A DECISION, NOT A TODO. Anything here was argued; if you are adding one
 * to make a red board green, that is the wrong direction and the entry will outlive you.
 */
const EXCEPTIONS = {
  'index.tsx': 'a redirect gate with no UI at all -- it renders nothing a person can see',
  'i/index.tsx': 'redirect only',
  'i/[code].tsx': 'redirect only -- it hands the code to /join, which has one',
  '_layout.tsx': 'the root layout: providers and a Stack, no screen of its own',
  '(guest)/_layout.tsx': 'the tab bar. Photos and Music carry it; Chat must not (see DENY)',
  'create.tsx':
    'reachable only from /join, which carries one on the screen you just came from. ' +
    'A second control one tap later is noise, not reach.',
  '(guest)/blocked.tsx':
    'a moderation outcome. A report control here reads as an appeal route, which it is ' +
    'not -- the sheet goes to the people who build this, not to the host who blocked you.',
};

/** Routes that must NOT carry one. The absence is the decision. */
const DENY = {
  '(guest)/chat.tsx':
    'Tried and reverted: it displaced "Announcements only · hosts post here", the line ' +
    'that tells a guest why there is no compose box, and guest-chat.spec.ts went red. ' +
    'A control that has to take something\'s place is in the wrong place.',
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (extname(p) === '.tsx') out.push(p);
  }
  return out;
}

const RENDERS = /<ReportLink\b/;

/** Resolve a `@/...` specifier to a file on disk, or null. */
function resolveAlias(spec) {
  if (!spec.startsWith('@/')) return null;
  const base = join(SRC, spec.slice(2));
  for (const c of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Does this file, or the ONE screen it renders, put the control on screen?
 *
 * IT FOLLOWS RENDERS, NOT IMPORTS, and the first version of this file followed imports.
 * That version passed its own mutation test: deleting `<HostConsoleFooter />` from the host
 * layout left the `import` line behind, and the gate called five routes covered while the
 * host had no control at all -- the exact defect it was written to catch, surviving the
 * check written to catch it. An import is a fact about a module graph; rendering is a fact
 * about a screen, and only the second one is what a person can tap.
 *
 * ONE LEVEL DEEP, deliberately. A route file here is three lines -- one import, one default
 * export -- so one level is the complete answer for every route that exists. Recursing the
 * graph would find a ReportLink three components down and call the route covered, which is
 * true of the source and false of the screen. A screen that hides its control behind a
 * second component is reported missing: a loud wrong answer, which is the direction to be
 * wrong in.
 */
function covers(file) {
  const src = readFileSync(file, 'utf8');
  if (RENDERS.test(src)) return true;

  // Named imports that this file actually RENDERS, or re-exports as its own default --
  // `export default ChatScreen` is how every route in this repo is written.
  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+'(@\/[^']+)'/g)) {
    const names = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop().trim());
    const target = resolveAlias(m[2]);
    if (!target) continue;
    const used = names.some(
      (n) =>
        n &&
        (new RegExp(`<${n}\\b`).test(src) || new RegExp(`export default ${n}\\b`).test(src)),
    );
    if (used && RENDERS.test(readFileSync(target, 'utf8'))) return true;
  }
  return false;
}

const problems = [];
const files = walk(APP);
let audited = 0;

/** Layout coverage, keyed by the directory it governs. A host segment is covered by
 *  `host/_layout.tsx` rendering the footer, which is the whole point of one mount. */
const layoutCovers = new Map();
for (const f of files) {
  if (!f.endsWith('_layout.tsx')) continue;
  layoutCovers.set(dirname(f), covers(f));
}

/** Every layout at or above this file's directory. */
function inheritsCover(file) {
  let dir = dirname(file);
  while (dir.startsWith(APP)) {
    if (layoutCovers.get(dir)) return true;
    dir = dirname(dir);
  }
  return false;
}

for (const file of files) {
  const rel = relative(APP, file);
  audited++;
  const has = covers(file) || inheritsCover(file);

  if (rel in DENY) {
    if (has) {
      problems.push(
        `${relative(ROOT, file)}  MUST NOT carry a way to report, and now does.\n` +
          `    ${DENY[rel]}`,
      );
    }
    continue;
  }

  if (rel in EXCEPTIONS) {
    if (has) {
      problems.push(
        `${relative(ROOT, file)}  is listed in EXCEPTIONS but DOES carry one.\n` +
          `    Delete the exception -- an exception that is not true is worse than none.`,
      );
    }
    continue;
  }

  if (!has) {
    problems.push(
      `${relative(ROOT, file)}  has no way for the person on it to tell us it is broken.\n` +
        `    Render <ReportLink /> (inset={20} if the parent supplies no horizontal padding),\n` +
        `    or add it to EXCEPTIONS with a reason somebody can disagree with.`,
    );
  }
}

// RULE 3. One implementation.
const owners = [];
for (const file of walk(SRC)) {
  if (!/testID=["']open-feedback["']/.test(readFileSync(file, 'utf8'))) continue;
  owners.push(relative(ROOT, file));
}
const expected = relative(ROOT, CONTROL);
if (owners.length !== 1 || owners[0] !== expected) {
  problems.push(
    `the report control has ${owners.length} implementation(s): ${owners.join(', ') || '(none)'}\n` +
      `    Exactly one, in ${expected}. A hand-rolled copy is how the join screen ended up\n` +
      `    with a hitSlop-only target that react-native-web throws away.`,
  );
}

// RULE 4. The door.
if (!existsSync(BRIDGE)) {
  problems.push('web/i/index.html is missing -- the bridge page is where the funnel stops.');
} else if (!/id="report"/.test(readFileSync(BRIDGE, 'utf8'))) {
  problems.push(
    `web/i/index.html carries no id="report".\n` +
      `    Every other control in this app is INSIDE it, and a person who cannot install,\n` +
      `    cannot open it or cannot get past the door never reaches one.`,
  );
}

console.log(`audited ${audited} routes across ${files.length} files in src/app`);

if (audited < COVERAGE_FLOOR) {
  console.error(
    `\nFAIL: coverage floor. Expected at least ${COVERAGE_FLOOR} routes, found ${audited}.\n` +
      `If routes really were removed, lower COVERAGE_FLOOR deliberately. If not, this\n` +
      `matcher has stopped matching and is passing having measured almost nothing.`,
  );
  process.exit(1);
}

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log('ok: every route can report, Chat deliberately cannot, and there is one control');

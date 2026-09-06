#!/usr/bin/env node
/**
 * LANE A2 -- static touch-target declaration audit.
 *
 * WHY THIS IS STATIC, AND WHY THAT IS NOT A COMPROMISE.
 *
 * No other lane in this repo can see a touch target.
 *   - Lane B (web export + Playwright) runs through react-native-web, which
 *     DROPS `hitSlop` entirely. A probe measured `role-switch` at 73x14 despite
 *     `hitSlop={8}` sitting on that line. A DOM check would keep reporting
 *     failure after a correct fix.
 *   - Lane C (Android emulator) reads `uiautomator dump`, which reports
 *     accessibility-tree bounds, not touch rectangles. Also blind.
 * So static is not the cheap option here; it is the only option.
 *
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * It does NOT attempt to compute rendered geometry. Resolving `StyleSheet.create`
 * entries through spreads, conditionals and array-composed styles would be a
 * heuristic wearing a measurement's clothes -- and a gate that manufactures false
 * confidence is worse than no gate. What it checks instead is what a source file
 * can honestly answer: does every interactive element DECLARE a reachable target,
 * either by carrying an explicit `hitSlop`, or by naming a style whose own
 * definition clears the minimum, or by being listed as a reviewed exception.
 *
 * THE STANDARD IS AA, NOT AAA.
 *
 * WCAG 2.2 SC 2.5.8 "Target Size (Minimum)" is Level AA at 24x24 CSS px.
 * SC 2.5.5 "Target Size (Enhanced)" is 44x44 and is Level AAA -- it is also
 * Apple's HIG number, which is why 44 gets quoted as though it were the bar.
 * The workspace standard (see ~/repos/CLAUDE.md) is WCAG AA, so 24 is the pass
 * mark and 44 is the aspiration. An audit run at the wrong level reports two
 * dozen false failures and gets switched off, which is how a gate dies.
 *
 * Exits non-zero on any violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

/** WCAG 2.2 SC 2.5.8, Level AA. Not 44 -- see the header. */
const MIN_AA = 24;

/**
 * Minimum number of interactive elements we expect to find. Same doctrine as
 * audit-native-styles.mjs: a gate whose selector stops matching passes having
 * measured nothing, so falling below the floor is itself a failure.
 */
/*
 * Set at the exact current count, not below it. It sat at 20 while the app carried 44
 * interactive elements -- which meant more than half of them could have been deleted
 * with this gate still reporting success, and a floor that loose measures nothing.
 * A real reduction should fail here and be lowered on purpose; that is the point.
 */
const COVERAGE_FLOOR = 51;

/** Opens an interactive element. Pressable covers this repo; Touchable* is here
 *  so the check keeps working if someone reaches for the older API. */
const INTERACTIVE = /<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b/;

/**
 * Reviewed exceptions. Every entry needs a reason, and the reason has to be a
 * property of the control rather than an inconvenience of fixing it.
 */
const EXCEPTIONS = [
  {
    file: 'src/components/ui/GuestTabBar/GuestTabBar.tsx',
    why:
      'Tab items are 126x55 from paddingVertical 6 + icon 26 + gap 4 + label 13. ' +
      'Comfortably over the minimum, but the height is assembled from layout.ts ' +
      'constants rather than declared as one number, so no static rule can read it. ' +
      'Toast.tsx derives its own position from tabBar.contentHeight, so this ' +
      'geometry is load-bearing elsewhere and must not be "fixed" casually.',
  },
];

/**
 * A MODAL BACKDROP IS THE LARGEST TARGET IN THE APP, and no static rule can read its size.
 *
 * `flex: 1` resolves against the modal root at runtime, so there is no number in the
 * source. Two files were exempted for exactly this shape, and the second entry left an
 * instruction: "a third means the tool should learn the pattern -- a Pressable whose only
 * style is `flex: 1` directly inside a <Modal> -- rather than this list growing one sheet
 * at a time." The photo viewer (#38) was the third. So the pattern is a rule now.
 *
 * IT MATCHES ON THE STYLE AND THE ENCLOSING <Modal>, NEVER ON THE NAME. The same entry
 * warned why: "matching on the NAME 'backdrop' would not do -- a name is not a
 * measurement." A `flex: 1` Pressable outside a Modal is still flagged, which is right;
 * that one really could be any size.
 */
function isModalBackdrop(code, styleNames) {
  if (!/<Modal\b/.test(code)) return false;
  return styleNames.some((n) => {
    const m = new RegExp(`\\b${n}\\s*:\\s*\\{([^}]*)\\}`).exec(code);
    if (!m) return false;
    const body = m[1];
    // `flex: 1` and nothing that constrains it to a corner of the screen.
    return /\bflex\s*:\s*1\b/.test(body) && !/\b(width|height|maxHeight|maxWidth)\s*:/.test(body);
  });
}

/**
 * Yield `[name, body]` for every `name: { ... }` entry, matching braces so a
 * multi-line body is read whole. A regex bounded to one line misses `shutter`
 * and `voteButton` here -- which is exactly how the first draft of this tool
 * produced fifteen false failures and would have been switched off.
 */
function* styleEntries(code) {
  const opener = /(\w+)\s*:\s*\{/g;
  let m;
  while ((m = opener.exec(code)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
    }
    if (depth === 0) yield [m[1], code.slice(m.index + m[0].length, i - 1)];
  }
}

/** Replace comment bodies with spaces, keeping every newline so line numbers hold. */
function stripComments(src) {
  const blanked = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return blanked
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (['.ts', '.tsx'].includes(extname(p))) out.push(p);
  }
  return out;
}

/**
 * Collect style entries that declare a reachable box on their own.
 *
 * Reads literal `height`/`minHeight`, or `paddingVertical` around a line box. A
 * computed or spread value is simply not counted as evidence -- the check then
 * falls through to requiring hitSlop, which errs toward asking for an explicit
 * declaration rather than toward silently passing.
 */
function reachableStyleNames(code) {
  const names = new Set();
  for (const [name, body] of styleEntries(code)) {
    const num = (prop) => {
      const hit = new RegExp(`\\b${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)`).exec(body);
      return hit ? Number(hit[1]) : null;
    };
    const height = num('height') ?? num('minHeight');
    const padV = num('paddingVertical');
    const fontSize = num('fontSize');

    // An explicit height settles it.
    if (height !== null && height >= MIN_AA) {
      names.add(name);
      continue;
    }
    // Otherwise: vertical padding around a line box. RN gives unstyled text a
    // line box of roughly fontSize * 1.16; 14 is this design's body size and the
    // conservative default when a row's text is styled elsewhere.
    if (padV !== null && padV * 2 + (fontSize ?? 14) * 1.16 >= MIN_AA) {
      names.add(name);
    }
  }
  return names;
}

const problems = [];
let audited = 0;
const files = walk(SRC);

for (const file of files) {
  const rel = relative(ROOT, file);
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const codeLines = stripComments(raw).split('\n');
  const code = codeLines.join('\n');

  const excused = EXCEPTIONS.find((e) => e.file === rel);
  const reachable = reachableStyleNames(code);

  codeLines.forEach((line, i) => {
    if (!INTERACTIVE.test(line)) return;
    audited++;
    if (excused) return;

    // Read the element's own props: from this tag to the end of its opening tag,
    // capped so an unclosed tag cannot swallow the rest of the file.
    // Neutralise `=>` before looking for the end of the opening tag. An arrow in
    // `onPress={() => ...}` contains a '>', and taking that as the tag close cuts
    // the scan off before `style=` -- the other half of the first draft's fifteen
    // false failures.
    const rest = codeLines.slice(i, i + 40).join('\n');
    const scan = rest.replace(/=>/g, '==');
    const close = scan.indexOf('>');
    const props = close === -1 ? rest : rest.slice(0, close + 1);

    if (/\bhitSlop\s*=/.test(props)) return;

    // The learned pattern: a full-bleed backdrop inside a <Modal>.
    const named = [...props.matchAll(/\b(?:s|styles)\.(\w+)\b/g)].map((m) => m[1]);
    if (named.length > 0 && isModalBackdrop(code, named)) return;

    const usesReachableStyle = [...reachable].some((n) =>
      new RegExp(`\\bs\\.${n}\\b|\\bstyles\\.${n}\\b`).test(props),
    );
    if (usesReachableStyle) return;

    problems.push(
      `${rel}:${i + 1}  interactive element declares no target of at least ${MIN_AA}pt ` +
        `(WCAG 2.2 SC 2.5.8, Level AA).\n` +
        `    ${lines[i].trim()}\n` +
        `    Fix by giving it a style with an explicit height/minHeight >= ${MIN_AA}, or enough\n` +
        `    paddingVertical to get there, or an explicit hitSlop. Prefer hitSlop only where the\n` +
        `    control has no interactive NEIGHBOUR: React Native's own docs note that slop "never\n` +
        `    extends past the parent view bounds and the Z-index of sibling views always takes\n` +
        `    precedence if a touch hits two overlapping views" -- so slop between flush siblings\n` +
        `    buys ambiguity, not safety. If the target is genuinely fine and merely unreadable\n` +
        `    from source, add a reviewed entry to EXCEPTIONS with a reason.`,
    );
  });
}

console.log(`audited ${audited} interactive elements across ${files.length} files`);

if (audited < COVERAGE_FLOOR) {
  console.error(
    `\nFAIL: coverage floor. Expected at least ${COVERAGE_FLOOR} interactive elements, found ${audited}.\n` +
      `If this is a real reduction, lower COVERAGE_FLOOR deliberately. If it is not,\n` +
      `the matcher has stopped matching and this audit is proving nothing.`,
  );
  process.exit(1);
}

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}

console.log(`ok: every interactive element declares a target of at least ${MIN_AA}pt (WCAG AA)`);

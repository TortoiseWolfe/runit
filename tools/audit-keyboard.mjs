#!/usr/bin/env node
/**
 * LANE A3 -- static keyboard-handling declaration audit.
 *
 * WHY STATIC IS THE ONLY OPTION HERE, NOT THE CHEAP ONE.
 *
 * No lane that runs in CI can see a soft keyboard.
 *   - Lane B (web export + Playwright) is STRUCTURALLY blind, not merely
 *     approximate. react-native-web's KeyboardAvoidingView destructures
 *     `behavior` and `keyboardVerticalOffset` away and renders a plain
 *     `<View {...rest}/>`; and its View filters props through an allowlist that
 *     does not contain `keyboardShouldPersistTaps`, `submitBehavior` or
 *     `automaticallyAdjustKeyboardInsets`, so none of them reaches the DOM. A
 *     Playwright assertion therefore passes IDENTICALLY on a correct fix and on
 *     no fix at all. Chromium has no soft keyboard to raise in the first place.
 *   - Lane C (Android emulator) sees Android only, needs a human at an
 *     emulator, and cannot run inside docker/run-checks.sh. Its AVD also
 *     shipped `hw.keyboard = no`, so for a long time it was not accepting
 *     keystrokes at all.
 *   - iOS has no lane in this environment at all. See FIDELITY deviation 2.
 *
 * WHAT IT CHECKS, AND WHAT IT REFUSES TO.
 *
 * It does NOT try to prove that a KeyboardAvoidingView actually WRAPS a given
 * TextInput. JoinScreen's KAV wraps <Screen>, which lives in another file, so
 * proving ancestry would mean resolving JSX across component boundaries -- a
 * heuristic wearing a parser's clothes, and a gate that manufactures false
 * confidence is worse than no gate. Same doctrine as audit-touch-targets.mjs
 * refusing to resolve StyleSheet.create through spreads.
 *
 * Rules 1 and 2 are FILE-scoped: they prove a decision was made in that file,
 * not that it was the right one. Rules 3 and 4 are ELEMENT-scoped and are the
 * stronger half, because each guards against an inherited DEFAULT -- and a
 * default is invisible in code review precisely because there is nothing on
 * screen to review.
 *
 * Exits non-zero on any violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

/**
 * Minimum elements we expect to find. Same doctrine as the other two audits: a
 * gate whose selector stops matching passes having measured nothing, so falling
 * below the floor is itself a failure.
 */
const TEXTINPUT_FLOOR = 5;
const SCROLLVIEW_FLOOR = 3;

/**
 * A JSX ELEMENT opener, not a type argument.
 *
 * `useRef<TextInput>(null)` contains the literal `<TextInput`, and a naive matcher
 * counts it as a fourth field on the join screen -- inflating the coverage figure
 * with something that is not a control, and pointing rule 4's 40-line prop window at
 * a variable declaration. The `<` of a real element is preceded by start-of-line,
 * whitespace, or a bracket; the `<` of a type argument is preceded by an identifier.
 */
const opener = (tag) => new RegExp(`(^|[\\s({\\[])<${tag}\\b`);
const TEXT_INPUT = opener('TextInput');
const SCROLL_VIEW = opener('ScrollView');

/**
 * A screen declares SOME keyboard strategy if it USES one of these.
 *
 * Deliberately not `/\bKeyboardAvoidingView\b/`: that is satisfied by the import
 * line alone, so deleting the element while leaving the import would pass. Caught by
 * mutation-testing this tool -- removing the KAV from JoinScreen kept it green.
 */
const STRATEGY = [opener('KeyboardAvoidingView'), /\bautomaticallyAdjustKeyboardInsets\b/];



/**
 * Reviewed exceptions. Every entry needs a reason, and the reason has to be a
 * property of the control rather than an inconvenience of fixing it.
 *
 * Empty today. The first case that will need one is a TextInput inside a
 * <Modal> (src/features/moderation/ReportSheet.tsx would be the one, if it ever
 * gains the note field its docblock deliberately omits): a Modal has its own
 * window and its own keyboard behaviour, so the file-level rule would be
 * measuring the wrong thing.
 */
const EXCEPTIONS = [];

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
 * The element's own props: from this tag to the end of its opening tag, capped
 * so an unclosed tag cannot swallow the rest of the file.
 *
 * `=>` is neutralised to `==` first. An arrow in `onSubmitEditing={() => ...}`
 * contains a '>', and taking that as the tag close cuts the scan off before the
 * props that matter -- the same trap that produced fifteen false failures in
 * audit-touch-targets.mjs.
 */
function openingTag(codeLines, i) {
  const rest = codeLines.slice(i, i + 40).join('\n');
  const scan = rest.replace(/=>/g, '==');
  const close = scan.indexOf('>');
  return close === -1 ? rest : rest.slice(0, close + 1);
}

const problems = [];
let inputs = 0;
let scrolls = 0;
const files = walk(SRC);

for (const file of files) {
  const rel = relative(ROOT, file);
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const codeLines = stripComments(raw).split('\n');
  const code = codeLines.join('\n');

  const hasInput = TEXT_INPUT.test(code);
  if (!hasInput) continue;

  const excused = EXCEPTIONS.find((e) => e.file === rel);

  // RULE 2 -- file-scoped. A screen with a text field has to say how it intends
  // to keep that field above the keyboard. This proves a decision was recorded,
  // not that the decision was correct; the decision itself is Lane C's and the
  // device's to judge.
  if (!excused && !STRATEGY.some((r) => r.test(code))) {
    problems.push(
      `${rel}  contains a <TextInput> but names no keyboard strategy.\n` +
        `    Add a <KeyboardAvoidingView> (when content is pinned to the visible bottom AND\n` +
        `    the KAV can be the outermost element, so keyboardVerticalOffset stays 0), or\n` +
        `    automaticallyAdjustKeyboardInsets on the ScrollView (when the screen is a plain\n` +
        `    scrolling document with chrome above it). NEVER both on one subtree -- iOS then\n` +
        `    compensates twice and pushes content off the top. See design/FIDELITY.md note Q.`,
    );
  }

  codeLines.forEach((line, i) => {
    if (SCROLL_VIEW.test(line)) {
      scrolls++;
      const props = openingTag(codeLines, i);
      // RULE 3 -- element-scoped, and the strongest rule in this tool.
      if (!excused && !/\bkeyboardShouldPersistTaps\s*=/.test(props)) {
        problems.push(
          `${rel}:${i + 1}  <ScrollView> in a file with a <TextInput> does not declare ` +
            `keyboardShouldPersistTaps.\n` +
            `    ${line.trim()}\n` +
            `    React Native's default is 'never': with the keyboard up, the FIRST tap on any\n` +
            `    button inside this ScrollView is swallowed to dismiss the keyboard and never\n` +
            `    reaches the button. That is a two-tap Send, and it is invisible in review\n` +
            `    because there is nothing on screen to review -- the bug is the default.\n` +
            `    "handled" is almost always the answer: background taps still dismiss.`,
        );
      }
    }

    if (!TEXT_INPUT.test(line)) return;
    inputs++;
    if (excused) return;

    const props = openingTag(codeLines, i);
    if (/\bmultiline\b/.test(props)) return; // Return must insert a newline there.

    // RULE 4 -- element-scoped. RN 0.73 renamed blurOnSubmit -> submitBehavior,
    // and the inherited default ('blurAndSubmit') drops the keyboard on every
    // submit. That is right for a final field and wrong for a composer or a
    // field that chains to the next one. The tool cannot tell which this is; it
    // only insists the choice be WRITTEN DOWN instead of inherited.
    if (/\bonSubmitEditing\s*=/.test(props) && !/\bsubmitBehavior\s*=/.test(props)) {
      problems.push(
        `${rel}:${i + 1}  <TextInput> wires onSubmitEditing but does not declare submitBehavior.\n` +
          `    ${line.trim()}\n` +
          `    "submit" keeps the keyboard up (right for a composer, and for a field that\n` +
          `    moves focus to the next one -- the default flickers the keyboard down and back).\n` +
          `    "blurAndSubmit" closes it (right for the last field of a form). Say which.`,
      );
    }
  });
}

console.log(`audited ${inputs} text inputs and ${scrolls} scroll views across ${files.length} files`);

// RULE 1 -- the coverage floors. Reported alongside the rule failures rather
// than short-circuiting them: a floor breach and a real violation have different
// fixes, and hiding the second behind the first costs a whole run to discover.
if (inputs < TEXTINPUT_FLOOR) {
  problems.push(
    `coverage floor: expected at least ${TEXTINPUT_FLOOR} <TextInput>, found ${inputs}.\n` +
      `    If this is a real reduction, lower TEXTINPUT_FLOOR deliberately. If it is not,\n` +
      `    the matcher has stopped matching and this audit is proving nothing.`,
  );
}
if (scrolls < SCROLLVIEW_FLOOR) {
  problems.push(
    `coverage floor: expected at least ${SCROLLVIEW_FLOOR} <ScrollView> in files that also\n` +
      `    hold a <TextInput>, found ${scrolls}. Same doctrine as above.`,
  );
}

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}

console.log('ok: every text field declares a keyboard strategy and a return-key contract');

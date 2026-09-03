#!/usr/bin/env node
/**
 * LANE A -- static native-style audit.
 *
 * The failure this exists to catch: React Native's colour parser accepts hex,
 * named colours, rgb/rgba, hsl/hsla and hwb, and NOTHING else. Feed it
 * `oklch(...)` -- which is what every colour in the design canvas is -- and it
 * returns null, which renders as transparent. No error, no warning, no crash.
 *
 * It is invisible on the web too: react-native-web hands the string to the
 * browser, which parses oklch perfectly. So a web screenshot harness goes GREEN
 * while the device is broken. Only this check sees it.
 *
 * Exits non-zero on any violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const normalizeRaw = require('@react-native/normalize-colors');
const normalizeColor = normalizeRaw.default ?? normalizeRaw;

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

/** Minimum number of colour literals we expect to audit. A gate whose selector
 *  stops matching passes having measured nothing -- so falling below the floor
 *  is itself a failure. Raise this as the app grows. */
const COVERAGE_FLOOR = 40;

const COLOR_LITERAL =
  /(['"`])(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^)'"`]*\))\1/g;

const FORBIDDEN = [
  [/\bvar\(--/, 'CSS custom property -- RN cannot resolve var(); import a token from @/theme'],
  [/\bdisplay:\s*['"]grid['"]/, "display:'grid' -- RN has no grid; use flex rows/columns"],
  [/\btextOverflow\b/, 'textOverflow -- use <Text numberOfLines> instead'],
  [/\bwhiteSpace\b/, 'whiteSpace -- not a React Native style prop'],
  [/\bcursor:\s*['"]pointer['"]/, "cursor:'pointer' -- web-only; use Pressable"],
  [/\belevation:\s*\d/, 'elevation -- cannot express the design shadows; use boxShadow (New Arch)'],
];

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

const problems = [];
let audited = 0;
const files = walk(SRC);

for (const file of files) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  // Blank out comments before scanning, preserving line numbering. The token
  // table and oklch.ts deliberately quote oklch() in their docs to record
  // provenance -- documenting the hazard is the point, not an instance of it.
  const codeLines = stripComments(src).split('\n');

  lines.forEach((line, i) => {
    const code = codeLines[i] ?? '';

    for (const [re, why] of FORBIDDEN) {
      if (re.test(code)) problems.push(`${rel}:${i + 1}  ${why}\n    ${line.trim()}`);
    }

    for (const m of code.matchAll(COLOR_LITERAL)) {
      const value = m[2];
      audited++;
      if (normalizeColor(value) === null || normalizeColor(value) === undefined) {
        problems.push(
          `${rel}:${i + 1}  React Native cannot parse "${value}" -- it will render TRANSPARENT.\n` +
            `    ${line.trim()}`,
        );
      }
    }
  });
}

console.log(`audited ${audited} colour literals across ${files.length} files`);

if (audited < COVERAGE_FLOOR) {
  console.error(
    `\nFAIL: coverage floor. Expected at least ${COVERAGE_FLOOR} colour literals, found ${audited}.\n` +
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

console.log('ok: every colour literal parses under @react-native/normalize-colors');

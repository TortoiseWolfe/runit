#!/usr/bin/env node
/**
 * THE PRODUCT IS CALLED RunIt, AND EIGHT PLACES SPELLED IT `Runit` -- #57.
 *
 * WHY A GATE AND NOT JUST A FIX. The eight were not a typo made once. They accumulated,
 * because `Runit` is what the repository is called, what the bundle id ends in, what the
 * scheme is, what the Pages project is -- so the lowercase-i spelling is CORRECT nearly
 * everywhere it appears and wrong only in the handful of strings a person reads. Fixing
 * them without a gate leaves the next sentence somebody writes free to get it wrong the
 * same way, and the sites are scattered across four languages: JSON permission strings,
 * a TSX toast, a Deno edge function and two Postgres function bodies.
 *
 * WHAT IT CHECKS, and it is deliberately one narrow thing: the exact word `Runit`, with a
 * capital R, INSIDE A QUOTED STRING, in the files that ship user-visible copy. Not prose,
 * not comments, not identifiers.
 *
 * THE PATTERN DOES MOST OF THE EXEMPTING BY ITSELF, which is what keeps this a measurement
 * rather than an allowlist that rots:
 *
 *   \bRunit\b   `\b` needs a NON-word character after the final `t`, so every TypeScript
 *               identifier is out for free -- RunitEvent, RunitRepository, RunitClient,
 *               createRunitClient. There are ~100 of those and not one is listed below.
 *
 *   capital R   every lowercase identifier is out for free: `runit-app.pages.dev`,
 *               `com.turtlewolfe.runit`, `runit://join`, the expo slug, `project_id`,
 *               the package name, the `runit-ics` / `runit-photos` / `runit-saves` cache
 *               directories, and the `runit:<table>` realtime channel.
 *
 * Comments are stripped before matching (`//`, `--`, and `/* *\/` blocks) because this
 * repo's comments discuss the product by name constantly and correctly. Then only text
 * inside quotes is considered, because a bare word in stripped-out prose is not a string
 * anybody reads at runtime.
 *
 * ONE LITERAL EXEMPTION, and it is a machine field rather than copy:
 *
 *   PRODID:-//Runit//Event Companion//EN   RFC 5545 calls this the identifier of the
 *   PRODUCT THAT CREATED the calendar object. No calendar app surfaces it. #57 lists it as
 *   arguably user-facing; it is not, and changing it would alter a string that has already
 *   shipped in every .ics this app has ever produced.
 *
 * IT CARRIES A COVERAGE FLOOR, the same doctrine as `audit-native-styles.mjs` and
 * `audit-touch-targets.mjs`: if the walk stops finding files, or the quote matcher stops
 * finding strings, this exits non-zero rather than printing a green line having measured
 * nothing. A casing gate that silently scans zero strings is worse than no gate, because
 * somebody will believe it.
 *
 * WHAT IT CANNOT SEE. `/ios` and `/android` are gitignored prebuild output, so the plist
 * this produces is not checked here -- `src/lib/appConfig.test.ts` reads `app.json`, which
 * is the only committed source of those permission strings. And nothing here proves the
 * DEPLOYED database matches the migration: `schema-fingerprint.sql` hashes functions as
 * `proname(identity_arguments)`, the signature and not the body, so a corrected string that
 * was never deployed is invisible to every gate in this repo. That one is checked by hand
 * against the live project and recorded in the commit.
 *
 * Exits non-zero on any violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** The correct spelling, and the one this exists to keep. */
const BRAND = 'RunIt';

/** Where user-visible copy lives. Not `design/`, not `docs/`, not this file's siblings. */
const ROOTS = ['src', 'supabase/functions', 'supabase/migrations'];
const FILES = ['app.json'];
const EXT = new Set(['.ts', '.tsx', '.sql', '.json']);

/**
 * The one string that is a machine identifier rather than copy. Matched as the whole
 * PRODID line so that a second `Runit` appearing on it would still be caught.
 */
const EXEMPT = [{ text: 'PRODID:-//Runit//Event Companion//EN', why: 'RFC 5545 product id' }];

const WRONG = /\bRunit\b/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXT.has(extname(full))) yield full;
  }
}

/**
 * A SCANNER, NOT A REGEX, AND THE FIRST DRAFT PROVED WHY.
 *
 * It stripped comments first, with a regex for "two slashes to end of line", and then matched
 * quoted spans. That ate the one string this file exempts:
 *
 *     'PRODID:-//Runit//Event Companion//EN'
 *
 * The `//` inside the literal read as the start of a comment, so the rest of the line
 * vanished and the exemption matched nothing. The exemption floor below is what caught it;
 * without that floor the gate would have reported a clean repo while silently skipping
 * every line containing a URL, a path or a protocol -- which in a file about invitation
 * links is most of the interesting ones.
 *
 * So strings and comments are decided in ONE pass, in order, the way a parser would: a `//`
 * or `--` only begins a comment when we are not already inside a string, and a quote only
 * begins a string when we are not already inside a comment.
 *
 * Returns `{ text, line }` for every string literal. Escapes are honoured so `\'` does not
 * end a literal early. Template interpolation is not parsed -- a `${...}` is left in the
 * text, which is right for this check: what matters is the words around it.
 */
function stringsIn(code, { sql, json }) {
  const out = [];
  let line = 1;
  let block = false; // inside /* ... */
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '\n') {
      line += 1;
      continue;
    }
    if (block) {
      if (c === '*' && code[i + 1] === '/') {
        block = false;
        i += 1;
      }
      continue;
    }
    if (!json) {
      if (c === '/' && code[i + 1] === '*') {
        block = true;
        i += 1;
        continue;
      }
      if (c === '/' && code[i + 1] === '/') {
        while (i < code.length && code[i] !== '\n') i += 1;
        i -= 1; // let the newline be counted by the top of the loop
        continue;
      }
      if (sql && c === '-' && code[i + 1] === '-') {
        while (i < code.length && code[i] !== '\n') i += 1;
        i -= 1;
        continue;
      }
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      const startLine = line;
      let text = '';
      i += 1;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\') {
          text += code[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (code[i] === '\n') line += 1;
        text += code[i];
        i += 1;
      }
      out.push({ text, line: startLine });
    }
  }
  return out;
}

const targets = [
  ...FILES.map((f) => join(ROOT, f)),
  ...ROOTS.flatMap((r) => [...walk(join(ROOT, r))]),
];

let scannedFiles = 0;
let scannedStrings = 0;
let exempted = 0;
const bad = [];

for (const file of targets) {
  const rel = relative(ROOT, file);
  if (rel.includes('.test.')) continue;
  scannedFiles += 1;
  // JSON has no comments at all, and a `--` inside one of its sentences is just a dash.
  const found = stringsIn(readFileSync(file, 'utf8'), {
    sql: rel.endsWith('.sql'),
    json: rel.endsWith('.json'),
  });

  for (const { text, line } of found) {
    scannedStrings += 1;
    WRONG.lastIndex = 0;
    if (!WRONG.test(text)) continue;
    if (EXEMPT.some((e) => text.includes(e.text))) {
      exempted += 1;
      continue;
    }
    bad.push({ rel, line, text: text.length > 88 ? `${text.slice(0, 88)}…` : text });
  }
}

console.log(`audited ${scannedStrings} quoted strings across ${scannedFiles} files`);

/**
 * THE FLOOR, and both numbers came from a REAL RUN: 112 files, 2928 strings. They are not
 * arithmetic and the first draft of this file proved why that matters -- it guessed 120 and
 * 2500, and the guess failed a clean repo on its first execution.
 *
 * Set a little under the measurement so ordinary churn does not red the normal path, and
 * far enough under nothing that a broken walk cannot slip through: a matcher that stops
 * matching reports zero violations and is indistinguishable from a clean repo. If a real
 * reduction lands, lower these deliberately, from a run.
 */
const MIN_FILES = 105;
const MIN_STRINGS = 2700;
if (scannedFiles < MIN_FILES || scannedStrings < MIN_STRINGS) {
  console.error(
    `\x1b[31mcoverage floor: expected >= ${MIN_FILES} files and >= ${MIN_STRINGS} strings, ` +
      `scanned ${scannedFiles} and ${scannedStrings}. The walk or the quote matcher stopped ` +
      `matching -- this run measured almost nothing.\x1b[0m`,
  );
  process.exit(1);
}

if (exempted !== EXEMPT.length) {
  // The exemption is itself a claim about the repo. If PRODID moves or is reworded, the
  // exemption stops describing anything and must be revisited rather than left as decor.
  console.error(
    `\x1b[31mexpected ${EXEMPT.length} exempted string(s), matched ${exempted}. ` +
      `An exemption in tools/audit-brand-casing.mjs no longer matches anything.\x1b[0m`,
  );
  process.exit(1);
}

if (bad.length) {
  console.error(`\n\x1b[31m${bad.length} user-visible string(s) spell it "Runit", not "${BRAND}":\x1b[0m`);
  for (const b of bad) console.error(`  ${b.rel}:${b.line}  ${b.text}`);
  console.error(
    `\nThe lowercase identifiers are fine and are not matched: the Pages host, the bundle id, ` +
      `the scheme, the slug and the cache directories all stay as they are.`,
  );
  process.exit(1);
}

console.log(
  `\x1b[32mevery user-visible string spells it ${BRAND}\x1b[0m` +
    ` — ${exempted} machine identifier exempted (${EXEMPT[0].why})`,
);

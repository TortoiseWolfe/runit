#!/usr/bin/env node
/**
 * THE GATE THAT NEEDS NO CREDENTIALS.
 *
 *   pnpm audit:sql
 *
 * `supabase/verify-policies.sql` is one enormous `do $$ ... end $$;` block, and Postgres
 * rejects a DECLARE block that names the same variable twice -- 42601, at COMPILE time,
 * before a single assertion runs. That happened: `aed8fb1` added `pho uuid` to a DECLARE
 * that already had one, and lane E stopped compiling entirely. Every run after it either
 * skipped for want of a database URL or reported an unparseable error, and
 * `EXPECTED_ASSERTIONS` went on climbing to 143 describing a file that measured nothing.
 *
 * WHY THIS IS STATIC AND LANE E IS NOT. Running lane E needs a database password, so it
 * skips in CI and skips for anybody who does not have one -- which is nearly everybody,
 * which is why the breakage survived. This check needs nothing. It cannot tell you whether
 * a policy is correct, and it is not trying to: it tells you the file will still COMPILE,
 * which is the cheap half of the question and the half that went unasked.
 *
 * IT IS NOT A HEURISTIC. It applies the same rule Postgres does -- one name per DECLARE
 * block -- rather than guessing at PL/pgSQL semantics it cannot see. A file it passes can
 * still fail for a hundred other reasons; a file it fails cannot possibly run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FILES = ['supabase/verify-policies.sql'];

/**
 * A DECLARE block runs from `declare` to the matching `begin` at the same nesting. Only
 * the OUTERMOST one is checked: PL/pgSQL deliberately allows an inner block to shadow an
 * outer name, and flagging that would be inventing a rule Postgres does not have.
 */
const declareBlock = (sql) => {
  const start = /^\s*declare\s*$/im.exec(sql);
  if (!start) return null;
  const from = start.index + start[0].length;
  const end = /^\s*begin\s*$/im.exec(sql.slice(from));
  if (!end) return null;
  return { text: sql.slice(from, from + end.index), offset: from };
};

/** `name type := expr;` — the name is the first identifier of each `;`-separated part. */
const declarations = (block) => {
  const found = [];
  let line = 1;
  for (const raw of block.split('\n')) {
    // Strip comments before splitting: `-- gb uuid; pho uuid;` is prose, not code.
    const code = raw.replace(/--.*$/, '');
    for (const part of code.split(';')) {
      const m = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(part);
      if (m) found.push({ name: m[1].toLowerCase(), line });
    }
    line += 1;
  }
  return found;
};

let bad = 0;
let total = 0;

for (const rel of FILES) {
  const sql = readFileSync(join(ROOT, rel), 'utf8');
  const block = declareBlock(sql);
  if (!block) {
    console.error(`\x1b[31mFAIL: ${rel} has no outer declare ... begin block.\x1b[0m`);
    console.error('  Either the file changed shape or this audit stopped matching it.');
    console.error('  A matcher that matches nothing passes having measured nothing.');
    process.exit(1);
  }
  // The line the DECLARE block starts on, so reported numbers match the editor.
  const base = sql.slice(0, block.offset).split('\n').length;

  const seen = new Map();
  for (const d of declarations(block.text)) {
    total += 1;
    const at = base + d.line - 1;
    if (seen.has(d.name)) {
      bad += 1;
      console.error(`\x1b[31mFAIL: ${rel}:${at} declares "${d.name}" again\x1b[0m`);
      console.error(`  already declared at ${rel}:${seen.get(d.name)}`);
      console.error('  Postgres rejects this at COMPILE time with 42601, so NOT ONE');
      console.error('  assertion in this file would run — and lane E skips without a');
      console.error('  database URL, so the board would stay green while measuring nothing.');
    } else {
      seen.set(d.name, at);
    }
  }
}

/**
 * A COVERAGE FLOOR, same doctrine as lanes A, A2 and E. If the matcher stops matching --
 * the file is reformatted onto one line, the declarations move -- this reports zero
 * duplicates over zero declarations and looks exactly like a pass.
 */
const EXPECTED_DECLARATIONS = 40;
if (total < EXPECTED_DECLARATIONS) {
  console.error(
    `\x1b[31mFAIL: only ${total} declarations found, and at least ${EXPECTED_DECLARATIONS} were expected.\x1b[0m`,
  );
  console.error('  This audit stopped matching the file rather than the file getting smaller.');
  process.exit(1);
}

if (bad) {
  console.error(`\x1b[31m${bad} duplicate declaration(s).\x1b[0m`);
  process.exit(1);
}

console.log(`\x1b[32mok: ${total} declarations, no duplicates\x1b[0m`);

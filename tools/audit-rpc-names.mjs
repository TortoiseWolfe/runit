#!/usr/bin/env node
/**
 * DOES EVERY `.rpc()` CALL NAME ARGUMENTS THE FUNCTION ACTUALLY HAS? -- issue #20.
 *
 * POSTGREST RESOLVES RPC OVERLOADS BY ARGUMENT NAME, not by position and not by arity. So
 * `p_titel` is not a typo that lands somewhere harmless -- it is a runtime 404 against a
 * function that exists, with a message about no matching function in the schema cache. The
 * call is well-typed, the function is deployed, and the feature is simply dead.
 *
 * NOTHING IN CI COULD SEE THAT. `database.types.ts` is HAND-WRITTEN, so TypeScript checks the
 * call against whatever a human last typed there rather than against the database.
 * `FakeClient` records what was sent and never evaluates it, so every unit test passes.
 * Lane B boots `MemoryRepository`, which has no RPCs at all. Only lane H could catch it --
 * and lane H writes to production on every run, is deliberately NOT in `run-checks.sh`, and
 * needs credentials CI does not have.
 *
 * So this exists: the same question, asked of two files that are both in the repository.
 * Credential-free, no network, no database. It runs on every push.
 *
 * IT IS A NAME CHECK AND NOTHING MORE, deliberately. It does not check types, defaults,
 * nullability or argument order, because the migration is the only description of those and
 * comparing a TypeScript expression to a Postgres type would be a heuristic wearing a
 * measurement's clothes -- the same reasoning that keeps `audit-touch-targets.mjs` from
 * resolving `StyleSheet.create`. Names are exact, textual, and are the thing PostgREST
 * actually dispatches on.
 *
 * WHAT IT WOULD HAVE CAUGHT, from this repo's own history: a function body deployed by hand
 * that dropped arguments the client still sends. The schema fingerprint cannot -- it hashes
 * a function as `proname(identity_arguments)`, which is the SIGNATURE, so a body can be
 * replaced wholesale under a green board.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CLIENT = join(ROOT, 'src/data/supabase/SupabaseRepository.ts');
const MIGRATION = join(ROOT, 'supabase/migrations/00000000000000_schema.sql');

/**
 * A FLOOR, in the same doctrine as lanes A, A2 and E. A matcher that stops matching reports
 * zero problems over zero call sites and looks identical to a clean run. Set from a real
 * run; raise it when call sites are added.
 */
const MIN_CALLS = 20;

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

const client = readFileSync(CLIENT, 'utf8');
const migration = readFileSync(MIGRATION, 'utf8');

/* ------------------------------------------------------- what the migration declares */

/**
 * Parameter names per function, from `create or replace function public.NAME(...)`.
 *
 * Takes the LAST declaration of a name, because the file may redefine one and the last
 * write is what the database ends up holding -- the same rule Postgres itself applies.
 */
const declared = new Map();
const fnRe = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns/gi;
for (let m; (m = fnRe.exec(migration)) !== null; ) {
  const [, name, args] = m;
  const params = [...args.matchAll(/(?:^|,)\s*(p_\w+)/g)].map((a) => a[1]);
  declared.set(name, new Set(params));
}

/* ---------------------------------------------------------- what the client actually sends */

/**
 * `.rpc('name', { p_a: ..., p_b: ... })` and `.rpc('name')`.
 *
 * The argument object is matched non-greedily to the first `}` that is followed by `)`, which
 * is what keeps a nested object literal inside an argument from ending the match early. Keys
 * are then taken only at the top level of that slice -- `p_` prefixed and at a line start or
 * after a brace or comma, so a `p_x` appearing inside a string or a nested value is not
 * counted as an argument name.
 */
const calls = [];
const rpcRe = /\.rpc\(\s*'(\w+)'\s*(?:,\s*(\{[\s\S]*?\})\s*)?\)/g;
for (let m; (m = rpcRe.exec(client)) !== null; ) {
  const [, name, objRaw] = m;
  const line = client.slice(0, m.index).split('\n').length;
  const keys = objRaw ? [...objRaw.matchAll(/(?:[{,]\s*)(p_\w+)\s*:/g)].map((k) => k[1]) : [];
  calls.push({ name, keys, line });
}

/* ------------------------------------------------------------------------------ compare */

const problems = [];
for (const { name, keys, line } of calls) {
  const params = declared.get(name);
  if (!params) {
    problems.push(
      `${CLIENT.replace(ROOT + '/', '')}:${line}  .rpc('${name}') names a function the ` +
        `migration does not declare`,
    );
    continue;
  }
  for (const k of keys) {
    if (!params.has(k)) {
      problems.push(
        `${CLIENT.replace(ROOT + '/', '')}:${line}  ${name}(${k}) -- not a parameter of ` +
          `public.${name}(${[...params].join(', ')})`,
      );
    }
  }
}

console.log(
  `audited ${calls.length} .rpc() call sites against ${declared.size} declared functions`,
);

if (calls.length < MIN_CALLS) {
  console.error(
    red(`FAIL: only ${calls.length} call sites found and ${MIN_CALLS} were expected.`),
  );
  console.error('  The matcher has stopped matching, which reports no problems having');
  console.error('  measured nothing. Fix the pattern, or lower MIN_CALLS deliberately if');
  console.error('  call sites were genuinely removed.');
  process.exit(1);
}

if (problems.length) {
  console.error(red(`FAIL: ${problems.length} rpc argument name(s) do not exist.`));
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  console.error('  PostgREST resolves overloads BY ARGUMENT NAME, so each of these is a');
  console.error('  runtime 404 against a function that exists -- not a type error, and not');
  console.error('  something any other check here can see.');
  process.exit(1);
}

console.log(green('ok: every rpc argument name exists on the function it is sent to'));

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * A value from the environment, falling back to `.env.local`.
 *
 * EXTRACTED FROM `smoke-live.mjs` RATHER THAN COPIED. It was a local function there, and the
 * second tool needing it is the moment a private helper becomes a shared one -- the same
 * reasoning `whenAndWhere` and `dns-intent.mjs` already follow. Two copies agreeing is luck.
 *
 * `.env.local` is gitignored and is where this repo keeps the project URL and the publishable
 * key. Reading it is NOT a secret-handling shortcut: both of those values are public by
 * construction -- the publishable key is compiled into every shipped bundle. Anything that is
 * actually secret goes nowhere near a file.
 */
export function envLocal(key) {
  if (process.env[key]) return process.env[key];
  try {
    const t = readFileSync(join(ROOT, '.env.local'), 'utf8');
    return (t.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? '').trim();
  } catch {
    return '';
  }
}

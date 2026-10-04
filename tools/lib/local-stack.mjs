import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * FIND A RUNNING LOCAL STACK, rather than making somebody paste a port. Shared by
 * `verify-policies.mjs` and `schema-fingerprint.mjs` (#106: the second still assumed 54322).
 *
 * The container name is `supabase_db_<project_id>`, and `docker port` reports what the
 * daemon actually published -- which is the only honest answer. `supabase start` prints a
 * DB_URL in its final JSON, but only on the run that STARTS the stack: come back tomorrow to
 * an already-running one, or use `db reset`, and there is no such line anywhere.
 *
 * It is a LOCAL convenience and cannot become a remote one: the URL it builds is hardcoded
 * to 127.0.0.1 with the fixed local password, so the worst case is a connection refused.
 * Inside the checks container there is no docker CLI, so this finds nothing and the lane
 * skips loudly exactly as before -- the board's behaviour is unchanged on purpose.
 */
export function localStackUrl() {
  let project = 'runit';
  try {
    const toml = readFileSync(join(import.meta.dirname, '..', '..', 'supabase', 'config.toml'), 'utf8');
    // The FIRST project_id is the local one; a `[remotes.*]` block declares another below it.
    const m = toml.match(/^project_id\s*=\s*"([^"]+)"/m);
    if (m) project = m[1];
  } catch {
    /* fall back to the directory's own name */
  }
  try {
    const out = execFileSync('docker', ['port', `supabase_db_${project}`, '5432/tcp'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const port = out.split('\n')[0].trim().split(':').pop();
    if (!/^\d+$/.test(port)) return null;
    return {
      url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
      port,
      project,
    };
  } catch {
    return null;
  }
}

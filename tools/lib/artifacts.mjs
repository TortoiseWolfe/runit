/**
 * What a standalone lane leaves behind when it fails.
 *
 * THE JOURNEYS ALREADY HAVE THIS AND THE LANES DID NOT. `playwright.config.ts` sets
 * `trace: 'retain-on-failure'` and `screenshot: 'only-on-failure'`, so a failed journey
 * leaves a time-travelling DOM recording. A failed lane left one truncated line of text --
 * which is why building lane H took six throwaway probe scripts, each re-deriving the state
 * the browser had been holding a moment earlier.
 *
 * EVERY CAPTURE IS INDIVIDUALLY GUARDED. These run inside a failure handler, and if the
 * browser is the thing that died then `page.screenshot()` throws -- a handler that throws
 * replaces the real error with its own, which is strictly worse than no artifact.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** `test-results/<name>/`, created. A sibling of the journeys' own subtree. */
export function laneDir(name) {
  const dir = join(ROOT, 'test-results', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A screenshot and the DOM, each guarded. Returns the page URL, or null. */
export async function capture(page, dir, prefix) {
  if (!page) return null;
  await page.screenshot({ path: join(dir, `${prefix}.png`), fullPage: true }).catch(() => {});
  await page
    .content()
    .then((html) => writeFileSync(join(dir, `${prefix}.html`), html))
    .catch(() => {});
  try {
    return page.url();
  } catch {
    return null;
  }
}

/**
 * `failure.txt` -- the whole error, not its first line.
 *
 * Playwright puts the actionability reason ("not visible", "intercepts pointer events",
 * "waiting for getByTestId(...)") in the call log BELOW the timeout line. Truncating that
 * turned two diagnosable failures into guesses while lane H was being built.
 */
export function writeReport(dir, { url, error, console: logs = [], extra = {} }) {
  const lines = [
    `when:  ${new Date().toISOString()}`,
    `url:   ${url ?? 'unavailable'}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    '',
    '--- error ---',
    String(error),
    '',
    `--- page console (${logs.length}) ---`,
    ...logs,
  ];
  try {
    writeFileSync(join(dir, 'failure.txt'), `${lines.join('\n')}\n`);
  } catch {
    /* a report we cannot write must not replace the failure it describes */
  }
}

/**
 * The one number both search paths clamp to, in a module that imports NOTHING.
 *
 * Same reasoning as `captureConstants.ts`, which states the hazard outright: `./capture`
 * from inside `capture.web.ts` can resolve back to itself. Metro picks `.web.ts` first on
 * web, so `musicSearch.web.ts` importing a VALUE from `./musicSearch` is a cycle with
 * itself. Types are fine -- `import type` is erased -- but a constant is not.
 */

/**
 * Below this a search is noise: two characters match thousands of songs, so the list is
 * worse than no list. It also holds the request rate down without a quota to reason about.
 */
export const MIN_QUERY = 2;

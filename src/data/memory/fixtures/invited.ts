import type { Seed } from '../MemoryRepository';
import { emptySeed } from './empty';
import { weddingSeed } from './wedding';

/**
 * Arrived from a link or a QR, and has not joined anything.
 *
 * THE THIRD WORLD. Against Supabase there are three states before a guest is in a
 * room, and the harness could build two of them:
 *
 *   | | `event.current` | `preview` | fixture |
 *   |---|---|---|---|
 *   | cold open, no code | null | null | `emptySeed` |
 *   | **arrived from a link** | null | the event | **this** |
 *   | joined | the event | -- | `weddingSeed` |
 *
 * Without the middle row the preview path is dead in every journey: `weddingSeed`
 * already has `event.current`, so the invitation renders from that and `lookUp` could
 * be deleted with the suite still green. That is the same shape as the bug that
 * shipped three inert controls -- not "a button is broken" but "no test can reach the
 * state where the button is broken".
 *
 * It borrows the wedding's event rather than inventing one, so the codes, the name and
 * the date a test asserts here are the same constants it asserts everywhere else.
 */
export const invitedSeed: Seed = {
  ...emptySeed,
  preview: weddingSeed.preview,
};

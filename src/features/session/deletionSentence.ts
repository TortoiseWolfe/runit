import type { DeletionImpact } from '@/data/types';

/**
 * WHAT DELETING THIS ACCOUNT WOULD DESTROY, in one sentence -- #19.
 *
 * ITS OWN MODULE, with no React and no router in it, so it can be tested without mounting
 * anything. That is not only convenience: the copy IS the feature here. The sheet's whole
 * job is to make an irreversible act legible before it happens, and a test that had to
 * render a modal to read one sentence would be testing the modal.
 *
 * EVERY CLAUSE IS DROPPED WHEN ITS NUMBER IS ZERO. "0 photos by 0 guests" reads as a
 * template that failed rather than as a fact, and a host who reads it learns nothing about
 * what she is about to lose.
 */
export function deletionSentence(i: DeletionImpact): string {
  if (i.eventsDeleted === 0 && i.eventsKept === 0) {
    // A REAL AND COMMON STATE -- a host who signed in on a new phone before opening
    // anything -- and it deserves a sentence rather than a blank space above a red button.
    return 'You have no events, so this removes your sign-in and nothing else.';
  }

  const parts: string[] = [];

  if (i.eventsDeleted > 0) {
    parts.push(`${i.eventsDeleted} ${i.eventsDeleted === 1 ? 'event' : 'events'} deleted`);
  }

  if (i.photos > 0) {
    // "41 photos by 12 guests". The attribution can be absent -- `uploaded_by_guest_id` is
    // `on delete set null`, so a guest who left leaves photographs behind with nobody to
    // name -- and the photographs still go.
    const by = i.guests > 0 ? ` by ${i.guests} ${i.guests === 1 ? 'guest' : 'guests'}` : '';
    parts.push(`${i.photos} ${i.photos === 1 ? 'photo' : 'photos'}${by}`);
  }

  if (i.eventsKept > 0) {
    // THE HALF THAT STOPS A PANIC. An event with somebody else's seat on it survives, and a
    // host who cannot see that distinction has no way to tell "my party goes" from "my
    // party stays with its other hosts".
    parts.push(
      i.eventsKept === 1
        ? '1 event stays with its other hosts'
        : `${i.eventsKept} events stay with their other hosts`,
    );
  }

  return `${parts.join(' · ')}.`;
}

/**
 * WHICH OF THE THREE THINGS THE SHEET IS DOING -- and extracted for the reason
 * `diffAuthConfig` and `dmarcVerdict` were: the interesting branches are UNREACHABLE in the
 * lane that renders the screen.
 *
 * `MemoryRepository.deletionImpact()` resolves instantly and never throws, so lane B always
 * takes the `ready` path. Measured rather than assumed: deleting the counting branch
 * outright left all eight journeys green. A branch no test can reach is a branch that rots,
 * and this one decides whether an irreversible button is on screen.
 *
 * THE RULE IS THAT A CONFIRM BUTTON NEEDS A NUMBER. While the count is in flight there is a
 * sentence and no control -- never a disabled one, which is what `empty-world.spec.ts`'
 * `[aria-disabled="true"]` gate exists to prevent. And if the count could not be read at all
 * there is still no button: offering to destroy an unknown quantity of somebody else's
 * photographs is the exact failure the counting was added to prevent.
 */
export function deleteSheetState(input: {
  counting: boolean;
  /** Any counted impact. Shared by the account sheet and the per-event one (#73). */
  counts: object | null;
}): 'counting' | 'unknown' | 'ready' {
  if (input.counting) return 'counting';
  if (input.counts === null) return 'unknown';
  return 'ready';
}

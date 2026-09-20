import type { EventDeletionImpact } from '@/data/types';

/**
 * WHAT DELETING THIS ONE PARTY WOULD DESTROY, in one sentence -- #73.
 *
 * Its own module with no React in it, for the reason the account version has one: the copy
 * IS the feature, and a test that had to render a modal to read a sentence would be testing
 * the modal.
 *
 * THE CO-HOST CLAUSE IS WHAT MAKES THIS DIFFERENT from the account sentence. Deleting an
 * ACCOUNT keeps a party somebody else holds a seat at; deleting THIS party takes it from
 * them, because she picked it by name. People who have been building a run of show all week
 * find out by opening the app.
 */
export function eventDeletionSentence(i: EventDeletionImpact): string {
  const parts: string[] = [];

  if (i.photos > 0) {
    // The attribution can be absent: `uploaded_by_guest_id` is `on delete set null`, so a
    // guest who left leaves photographs with nobody to name, and they still go.
    const by = i.guests > 0 ? ` by ${i.guests} ${i.guests === 1 ? 'guest' : 'guests'}` : '';
    parts.push(`${i.photos} ${i.photos === 1 ? 'photo' : 'photos'}${by}`);
  }

  if (i.coHosts > 0) {
    parts.push(
      i.coHosts === 1 ? '1 co-host loses their seat' : `${i.coHosts} co-hosts lose their seats`,
    );
  }

  // NOT AN EMPTY STRING. A party nobody came to is the commonest thing a host deletes --
  // it is the test event she made to see how the app works -- and it deserves a sentence
  // rather than a blank space above a red button.
  if (parts.length === 0) return 'Nobody has added anything to it yet.';

  return `${parts.join(' · ')}. Everything goes.`;
}

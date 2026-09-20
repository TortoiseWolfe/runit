import { deleteSheetState, deletionSentence as sentence } from './deletionSentence';

/**
 * THE COPY IS THE FEATURE HERE, so it is what is tested.
 *
 * The sheet's job is to make an irreversible act legible before it happens, and the whole
 * of that job is one sentence built from four numbers. A clause that reads "0 photos by 0
 * guests" is a template that failed rather than a fact, and a host who reads it learns
 * nothing about what she is about to destroy.
 */
describe('what the deletion sheet tells you it will destroy', () => {
  it('names the events, the photographs and WHOSE they are', () => {
    expect(sentence({ eventsDeleted: 2, eventsKept: 0, photos: 41, guests: 12 })).toBe(
      '2 events deleted · 41 photos by 12 guests.',
    );
  });

  it('says what survives, which is the difference between her party and somebody else\'s', () => {
    expect(sentence({ eventsDeleted: 1, eventsKept: 1, photos: 3, guests: 1 })).toBe(
      '1 event deleted · 3 photos by 1 guest · 1 event stays with its other hosts.',
    );
  });

  it('drops a clause whose number is zero rather than printing it', () => {
    // A brand new host: one event, nobody has arrived, nothing has been taken.
    expect(sentence({ eventsDeleted: 1, eventsKept: 0, photos: 0, guests: 0 })).toBe(
      '1 event deleted.',
    );
  });

  it('counts photographs even when nobody is left to attribute them to', () => {
    // A guest can leave; `photos.uploaded_by_guest_id` is `on delete set null`. The
    // photographs are still there and still going.
    expect(sentence({ eventsDeleted: 1, eventsKept: 0, photos: 9, guests: 0 })).toBe(
      '1 event deleted · 9 photos.',
    );
  });

  it('tells somebody with nothing that they are deleting nothing but their sign-in', () => {
    // NOT an empty string and not a bare full stop. This is a real and common state -- a
    // host who signed in on a new phone before opening an event -- and it deserves a
    // sentence rather than a blank space above a red button.
    expect(sentence({ eventsDeleted: 0, eventsKept: 0, photos: 0, guests: 0 })).toBe(
      'You have no events, so this removes your sign-in and nothing else.',
    );
  });

  it('keeps a kept-only estate honest: nothing of hers dies', () => {
    expect(sentence({ eventsDeleted: 0, eventsKept: 2, photos: 0, guests: 0 })).toBe(
      '2 events stay with their other hosts.',
    );
  });
});

describe('what the sheet is doing, which lane B cannot see', () => {
  const impact = { eventsDeleted: 1, eventsKept: 0, photos: 0, guests: 0 };

  it('shows no confirm button while it is still counting', () => {
    // A control offered before the number arrives is a control pressed before the number
    // is read. There is a sentence there instead, never a disabled button -- that is the
    // `[aria-disabled="true"]` gate `empty-world.spec.ts` holds across every screen.
    expect(deleteSheetState({ counting: true, counts: null })).toBe('counting');
  });

  it('still counts as counting if a stale answer is in hand', () => {
    // Reopening the sheet clears the old counts, but a race that left one behind must not
    // let a previous estate's numbers stand in for this one's.
    expect(deleteSheetState({ counting: true, counts: impact })).toBe('counting');
  });

  it('offers NO button at all when the count could not be read', () => {
    // The safety-critical branch, and the one no journey can reach: offering to destroy an
    // unknown quantity of somebody else's photographs is what the counting exists to stop.
    expect(deleteSheetState({ counting: false, counts: null })).toBe('unknown');
  });

  it('is ready only once there is a number to show beside the button', () => {
    expect(deleteSheetState({ counting: false, counts: impact })).toBe('ready');
  });
});

import { eventDeletionSentence } from './eventDeletionSentence';

describe('what the event-deletion sheet says it will destroy', () => {
  it('names the photographs and whose they are', () => {
    expect(eventDeletionSentence({ photos: 41, guests: 12, coHosts: 0 })).toBe(
      '41 photos by 12 guests. Everything goes.',
    );
  });

  it('names the people who lose their seat, which the account sheet never has to', () => {
    // Deleting an ACCOUNT keeps a party somebody else sits at. Deleting THIS party takes it
    // from them, and they find out by opening the app.
    expect(eventDeletionSentence({ photos: 0, guests: 0, coHosts: 2 })).toBe(
      '2 co-hosts lose their seats. Everything goes.',
    );
  });

  it('says one co-host in the singular, because most parties have one', () => {
    expect(eventDeletionSentence({ photos: 3, guests: 1, coHosts: 1 })).toBe(
      '3 photos by 1 guest · 1 co-host loses their seat. Everything goes.',
    );
  });

  it('counts photographs nobody is left to be credited for', () => {
    expect(eventDeletionSentence({ photos: 9, guests: 0, coHosts: 0 })).toBe(
      '9 photos. Everything goes.',
    );
  });

  it('has a sentence for the empty party, which is the commonest one deleted', () => {
    // The test event she made to see how the app works. A blank space above a red button
    // is not a confirmation.
    expect(eventDeletionSentence({ photos: 0, guests: 0, coHosts: 0 })).toBe(
      'Nobody has added anything to it yet.',
    );
  });
});

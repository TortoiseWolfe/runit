import { MemoryRepository } from './MemoryRepository';
import { weddingSeed } from './fixtures/wedding';
import { housePartySeed } from './fixtures/houseParty';
import { flakyTransfer } from './fixtures/flakyTransfer';
import { EntitlementError, JoinError, ScheduleError } from '../repository';

const FIXED = '2026-10-17T20:00:00.000Z';
const make = () => MemoryRepository.create(weddingSeed, { now: () => FIXED });
const makeFree = () => MemoryRepository.create(housePartySeed, { now: () => FIXED });

describe('the seed is the canvas seed', () => {
  it('carries exactly what state = {...} declares', () => {
    const r = make();
    expect(r.event.current.get()).toMatchObject({ code: 'SR1017', guestCount: 172, tier: 'event' });
    expect(r.chat.feed.get()).toHaveLength(3);
    expect(r.schedule.items.get()).toHaveLength(6);
    expect(r.photos.pending.get()).toHaveLength(3);
    expect(r.photos.folders.get().map((f) => f.photoCount)).toEqual([38, 112, 97]);
    expect(r.music.queue.get()).toHaveLength(6);
    expect(r.music.nowPlaying.get()).toMatchObject({ title: 'September' });
  });

  it('keeps "invited" and "here" as separate numbers, as the canvas does', async () => {
    // The canvas hardcodes "Send to 180 guests" while its pill reads "172 here".
    // Collapsing them would make a host think 8 people missed the announcement.
    const r = make();
    expect(r.event.current.get()).toMatchObject({ invitedCount: 180, guestCount: 172 });
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    expect(r.event.current.get()).toMatchObject({ invitedCount: 180, guestCount: 173 });
  });

  it('puts the run-of-show cursor on Dinner + toasts', () => {
    const r = make();
    const now = r.schedule.items.get().find((s) => s.id === r.event.current.get()?.nowScheduleItemId);
    expect(now?.title).toBe('Dinner + toasts');
  });
});

describe('music queue', () => {
  it('ranks by votes desc and excludes played and declined', async () => {
    const r = make();
    expect(r.music.queue.get().map((q) => q.title)).toEqual([
      'Dancing Queen', 'Mr. Brightside', 'Levitating', 'Yeah!', 'Sweet Caroline', 'Espresso',
    ]);
    await r.music.markPlayed('req_1');
    await r.music.decline('req_6');
    expect(r.music.queue.get().map((q) => q.title)).toEqual([
      'Mr. Brightside', 'Levitating', 'Yeah!', 'Sweet Caroline',
    ]);
  });

  it('adjusts a vote by exactly one and is idempotent', async () => {
    const r = make();
    const votes = () => r.music.queue.get().find((q) => q.id === 'req_2')!.voteCount;
    expect(votes()).toBe(37);
    await r.music.setVote('req_2', true);
    expect(votes()).toBe(38);
    // The canvas's toggle is not idempotent; a double-fire drifts the count.
    await r.music.setVote('req_2', true);
    expect(votes()).toBe(38);
    await r.music.setVote('req_2', false);
    expect(votes()).toBe(37);
  });

  it('gives an arriving guest no requests and no votes, because they have done nothing', () => {
    const r = make();
    // The canvas seeds `mine: true` on Yeah!. Honouring that meant a guest who had
    // just typed their nickname was told "Your request is #4 in the queue" for a
    // song by Usher. Both states are reachable by acting; neither is seeded.
    expect(r.music.myVotes.get().size).toBe(0);
    expect(r.music.queue.get().some((q) => q.requestedByGuestId === 'gst_me')).toBe(false);
  });

  it('and both states arrive the moment the guest acts', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await r.music.setVote('req_4', true);
    expect(r.music.myVotes.get().has('req_4')).toBe(true);
    await r.music.request({ title: 'Dreams', artist: 'Fleetwood Mac' });
    expect(r.music.queue.get().some((q) => q.requestedByGuestId === 'gst_me')).toBe(true);
  });

  it('lets one guest hold several requests', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await r.music.request({ title: 'Song A', artist: 'X' });
    await r.music.request({ title: 'Song B', artist: 'Y' });
    const mine = r.music.queue.get().filter((q) => q.requestedByName === 'Ada');
    expect(mine).toHaveLength(2);
  });

  it('moves pending -> accepted -> played, and playNext promotes the top accepted', async () => {
    const r = make();
    await r.music.accept('req_2');
    expect(r.music.accepted.get().map((a) => a.title)).toEqual(['Dancing Queen', 'Mr. Brightside']);
    await r.music.playNext();
    expect(r.music.nowPlaying.get()).toMatchObject({ title: 'Dancing Queen', fromRequestId: 'req_1' });
    expect(r.music.queue.get().find((q) => q.id === 'req_1')).toBeUndefined();
  });
});

describe('photos', () => {
  it('approving increments that folder, by id and not by name', async () => {
    const r = make();
    await r.photos.approve('pho_1');
    const reception = r.photos.folders.get().find((f) => f.id === 'fld_reception');
    expect(reception?.photoCount).toBe(98);
    expect(r.photos.folders.get().find((f) => f.id === 'fld_ceremony')?.photoCount).toBe(112);
    expect(r.photos.pending.get()).toHaveLength(2);
  });

  it('hiding removes it from review without incrementing, and keeps the record', async () => {
    const r = make();
    await r.photos.hide('pho_2');
    expect(r.photos.pending.get()).toHaveLength(2);
    expect(r.photos.folders.get().find((f) => f.id === 'fld_reception')?.photoCount).toBe(97);
  });

  it('uploads file into the active folder and derive the canvas hue', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await r.photos.upload({ localUri: 'file:///tmp/test.jpg' });
    const newest = r.photos.pending.get()[0]!;
    expect(newest.folderId).toBe('fld_reception');
    expect(newest.uploadedByName).toBe('Ada');
    expect(newest.hue).toBe((4 * 67) % 360); // canvas: (nextPending * 67) % 360
    expect(newest.status).toBe('pending');
  });

  it('auto-approves on the free tier, which has no moderation', async () => {
    const r = makeFree();
    await r.photos.upload({ localUri: 'file:///tmp/test.jpg' });
    expect(r.photos.pending.get()).toHaveLength(0); // no approval queue at all
    expect(r.photos.approved.get()).toHaveLength(1);
    expect(r.photos.folders.get()[0]?.photoCount).toBe(99); // counted immediately
  });

  it('keeps the bytes: the uploaded URI is stored, and storagePath stays null', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await r.photos.upload({ localUri: 'file:///cache/runit-photos/1.jpg' });
    const newest = r.photos.pending.get()[0]!;
    // The device path and the remote key are different fields on purpose. A
    // Supabase adapter fills storagePath with a bucket key; conflating the two
    // means a local file:// would be handed to a signed-URL resolver.
    expect(newest.localUri).toBe('file:///cache/runit-photos/1.jpg');
    expect(newest.storagePath).toBeNull();
    // Seeded rows have no bytes and never will -- the hue tile is permanent.
    expect(r.photos.approved.get().every((p) => p.localUri === null)).toBe(true);
  });

  it('publishes entitlements so the UI can ask before opening a camera', async () => {
    const r = makeFree(); // 98 of 100 photos
    const before = r.entitlements.get();
    expect(before.usage.photosStored).toBe(98);
    await r.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    // Recomputed and republished, or an advisory check reads a stale count and
    // waves through an upload the write method is about to refuse.
    expect(r.entitlements.get().usage.photosStored).toBe(99);
  });

  it('a failed transfer lands in the guest\'s own view, never in the host queue', async () => {
    const r = MemoryRepository.create(weddingSeed, {
      now: () => FIXED,
      transfer: flakyTransfer({ failAttempts: [1], message: 'Upload failed. Check your connection.' }),
    });
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await r.photos.upload({ localUri: 'file:///tmp/a.jpg' });

    const mine = r.photos.mine.get();
    expect(mine).toHaveLength(1);
    expect(mine[0]!.status).toBe('failed');
    expect(mine[0]!.failureReason).toBe('Upload failed. Check your connection.');
    expect(mine[0]!.progress).toBeNull();

    // The host must not see it. A photo with no delivered bytes is not work
    // anyone can moderate, and it would inflate the console badge.
    expect(r.photos.pending.get()).toHaveLength(3); // the three seeded, unchanged
    expect(r.photos.approved.get().some((p) => p.uploadedByName === 'Ada')).toBe(false);
  });

  it('a failure does not throw, because a flaky network is not a billing problem', async () => {
    const r = MemoryRepository.create(weddingSeed, {
      now: () => FIXED,
      transfer: flakyTransfer({ failAttempts: [1] }),
    });
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    // upload() is reached through useGuardedAction, which routes a throw to the
    // PAYWALL. Throwing here would show a guest an upgrade prompt for a dropped
    // connection.
    // It RESOLVES, and it resolves with the outcome rather than void -- a caller
    // that cannot tell delivered from failed announces success over a failure,
    // which is precisely what the toast used to do.
    await expect(r.photos.upload({ localUri: 'file:///tmp/a.jpg' })).resolves.toBe('failed');
  });

  it('reports which resting state an upload reached, so a caller cannot guess', async () => {
    const paid = make();
    await paid.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    // Event tier moderates, so a delivered photo waits for a host.
    expect(await paid.photos.upload({ localUri: 'file:///tmp/a.jpg' })).toBe('pending');

    // The free tier has no approval queue; announcing "awaiting host approval"
    // there promises a review that will never happen.
    const free = makeFree();
    expect(await free.photos.upload({ localUri: 'file:///tmp/a.jpg' })).toBe('approved');
  });

  it('retry re-attempts and delivers, clearing the failure', async () => {
    const r = MemoryRepository.create(weddingSeed, {
      now: () => FIXED,
      transfer: flakyTransfer({ failAttempts: [1] }), // first attempt only
    });
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await r.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    const failed = r.photos.mine.get()[0]!;

    await r.photos.retry(failed.id);

    expect(r.photos.mine.get()).toHaveLength(0); // no longer in flight or failed
    const queued = r.photos.pending.get();
    expect(queued).toHaveLength(4);
    expect(queued.some((p) => p.id === failed.id && p.failureReason === null)).toBe(true);
  });

  it('retry is a no-op on anything not failed, so a double-tap cannot double-send', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await r.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    const delivered = r.photos.pending.get()[0]!;
    const before = r.photos.pending.get().length;
    await r.photos.retry(delivered.id);   // already pending
    await r.photos.retry('pho_does_not_exist');
    expect(r.photos.pending.get()).toHaveLength(before);
    expect(r.photos.mine.get()).toHaveLength(0);
  });

  it('reports progress while in flight, and clears it once settled', async () => {
    const seen: (number | null)[] = [];
    const r = MemoryRepository.create(weddingSeed, {
      now: () => FIXED,
      transfer: flakyTransfer({ steps: [0.25, 0.75] }),
    });
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    r.photos.mine.subscribe((rows) => { if (rows[0]) seen.push(rows[0].progress); });
    await r.photos.upload({ localUri: 'file:///tmp/a.jpg' });

    expect(seen).toEqual([0, 0.25, 0.75]);
    // Null, not zero. Zero means "transferring, nothing moved yet"; a settled
    // photo is not transferring at all.
    expect(r.photos.pending.get()[0]!.progress).toBeNull();
  });

  it('an in-flight upload holds a tier slot, and a failed one gives it back', async () => {
    const r = MemoryRepository.create(housePartySeed, {
      now: () => FIXED,
      transfer: flakyTransfer({ failAttempts: [1] }),
    });
    expect(r.entitlements.get().usage.photosStored).toBe(98);
    await r.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    // Failed: the bytes never landed, so the slot is released. Holding it would
    // let a flaky connection permanently consume a guest's allowance.
    expect(r.entitlements.get().usage.photosStored).toBe(98);
  });

  it('stops at the free tier photo cap rather than failing after the capture', async () => {
    const r = makeFree(); // 98 of 100
    await r.photos.upload({ localUri: 'file:///tmp/test.jpg' }); // 99
    await r.photos.upload({ localUri: 'file:///tmp/test.jpg' }); // 100
    await expect(r.photos.upload({ localUri: 'file:///tmp/test.jpg' })).rejects.toBeInstanceOf(EntitlementError);
  });
});

describe('schedule', () => {
  it('starting an item moves the cursor and announces it in the exact canvas words', async () => {
    const r = make();
    await r.schedule.start('sch_5');
    expect(r.event.current.get()?.nowScheduleItemId).toBe('sch_5');
    const last = r.chat.feed.get().at(-1)!;
    expect(last.body).toBe('First dance, then open floor is starting · Barn');
    expect(last.kind).toBe('schedule_started');
  });

  // The wedding seed sits on sch_4, so sch_1..sch_3 are already past. Those rows
  // are the current row's nearest neighbours in the host console, which is what
  // makes a backwards tap a thumb slip rather than an exotic case.
  it('refuses to walk the cursor backwards on a plain start', async () => {
    const r = make();
    await expect(r.schedule.start('sch_2')).rejects.toBeInstanceOf(ScheduleError);
    await r.schedule.start('sch_2').catch((e: ScheduleError) => {
      expect(e.reason).toBe('would_rewind');
      expect(e.itemId).toBe('sch_2');
    });
    expect.hasAssertions();
  });

  it('changes nothing at all when it refuses -- no cursor move, no broadcast', async () => {
    const r = make();
    const cursor = r.event.current.get()?.nowScheduleItemId;
    const feedLength = r.chat.feed.get().length;
    await r.schedule.start('sch_1').catch(() => {});
    expect(r.event.current.get()?.nowScheduleItemId).toBe(cursor);
    expect(r.chat.feed.get()).toHaveLength(feedLength);
    // and the item it refused to start did not get a new startedAt
    expect(r.schedule.items.get().find((s) => s.id === 'sch_1')?.startedAt).toBe(
      weddingSeed.schedule[0]!.startedAt,
    );
  });

  it('rewinds when the host says so explicitly', async () => {
    const r = make();
    await r.schedule.start('sch_2', { rewind: true });
    expect(r.event.current.get()?.nowScheduleItemId).toBe('sch_2');
    expect(r.chat.feed.get().at(-1)!.body).toBe('Ceremony is starting · Lawn');
  });

  it('never blocks going forwards, which is the whole point of the board', async () => {
    const r = make();
    await r.schedule.start('sch_5');
    await r.schedule.start('sch_6');
    expect(r.event.current.get()?.nowScheduleItemId).toBe('sch_6');
  });

  it('starting the item already running is not a rewind', async () => {
    const r = make();
    await r.schedule.start('sch_4');
    expect(r.event.current.get()?.nowScheduleItemId).toBe('sch_4');
  });
});

describe('chat', () => {
  // THE TEST THAT WAS MISSING, and the reason the bug survived.
  //
  // Every other test here injects `now: () => FIXED` where FIXED is
  // 2026-10-17T20:00Z -- which was AFTER the old hardcoded seed date, i.e. the one
  // arrangement in which ordering happens to be correct. Using the REAL clock is
  // the whole point: it is what a host actually has.
  it('puts a newly sent broadcast last in the feed, using the real clock', async () => {
    const r = MemoryRepository.create(weddingSeed); // no `now` injection, deliberately
    const before = r.chat.feed.get();
    await r.session.becomeHost('hst_riley');
    await r.chat.send({ body: 'Cake is cut', pinned: false, push: false });

    const after = r.chat.feed.get();
    expect(after).toHaveLength(before.length + 1);
    // Newest last. If the seed were dated in the future this would be index 0,
    // and the guest would read tonight's announcement above this afternoon's.
    expect(after.at(-1)!.body).toBe('Cake is cut');
  });

  it('starting a run-of-show item announces it last too, not first', async () => {
    const r = MemoryRepository.create(weddingSeed); // real clock again
    await r.session.becomeHost('hst_riley');
    await r.schedule.start('sch_5');
    expect(r.chat.feed.get().at(-1)!.kind).toBe('schedule_started');
  });

  it('keeps the pin flag on a tier that has pinning', async () => {
    const r = make();
    await r.chat.send({ body: 'Cake in ten', pinned: true, push: true });
    // The canvas drops it (pin:false in the same setState) so pinning is inert.
    expect(r.chat.feed.get()[0]).toMatchObject({ body: 'Cake in ten', pinned: true });
  });

  it('degrades pinning on a tier without it rather than refusing to post', async () => {
    const r = make();
    await r.event.setTier('house_party');
    await r.chat.send({ body: 'Pizza is here', pinned: true, push: true });
    const posted = r.chat.feed.get().find((b) => b.body === 'Pizza is here');
    expect(posted).toBeDefined();
    expect(posted?.pinned).toBe(false);
  });

  it('un-pins an announcement that has stopped being true', async () => {
    const r = make();
    await r.chat.send({ body: 'Cake in ten', pinned: true, push: true });
    const b = r.chat.feed.get().find((x) => x.body === 'Cake in ten')!;
    expect(b.pinned).toBe(true);

    await r.chat.setPinned(b.id, false);
    expect(r.chat.feed.get().find((x) => x.id === b.id)?.pinned).toBe(false);
  });

  it('still gates PINNING on the plan', async () => {
    const r = make();
    await r.chat.send({ body: 'Cake in ten', pinned: false, push: true });
    const b = r.chat.feed.get().find((x) => x.body === 'Cake in ten')!;
    await r.event.setTier('house_party');

    await expect(r.chat.setPinned(b.id, true)).rejects.toBeInstanceOf(EntitlementError);
    expect(r.chat.feed.get().find((x) => x.id === b.id)?.pinned).toBe(false);
  });

  /**
   * THE ASYMMETRY, and it is the whole subtlety of #26.
   *
   * Gating BOTH directions on `pinnedAnnouncements` reads as consistent and re-creates
   * the exact dead end this method exists to remove: a host who pins on a paid tier and
   * then downgrades is left with a notice nothing can take down. `setTier` makes that
   * reachable in one line here, and a real plan change makes it reachable in production.
   *
   * The server has the same shape -- `fold_pin_to_plan` acts only `if new.pinned` -- so
   * a symmetric client gate would also put the adapter out of step with Postgres.
   */
  it('never refuses UN-pinning, even on a tier that could not have pinned', async () => {
    const r = make();
    await r.chat.send({ body: 'Cake in ten', pinned: true, push: true });
    const b = r.chat.feed.get().find((x) => x.body === 'Cake in ten')!;
    expect(b.pinned).toBe(true);

    await r.event.setTier('house_party'); // the downgrade
    await expect(r.chat.setPinned(b.id, false)).resolves.toBeUndefined();
    expect(r.chat.feed.get().find((x) => x.id === b.id)?.pinned).toBe(false);
  });

  it('ignores an empty draft', async () => {
    const r = make();
    await r.chat.send({ body: '   ', pinned: false, push: false });
    expect(r.chat.feed.get()).toHaveLength(3);
  });
});

describe('joining', () => {
  /**
   * Parity with the Supabase adapter on the one behaviour Lane B cannot feel.
   *
   * There is no auth here, so both methods look identical from inside this file. The
   * point is that they EXIST separately: the e2e suite runs this adapter, and if the two
   * were one method it would prove the wrong thing about the one that ships.
   */
  it('closeEvent leaves the event without pretending to be a sign-out', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    expect(r.session.current.get()).toMatchObject({ kind: 'guest' });
    await r.session.closeEvent();
    expect(r.session.current.get()).toEqual({ kind: 'anonymous' });
  });

  it('rejects a code that matches no event', async () => {
    const r = make();
    await expect(r.session.joinAsGuest({ code: 'NOPE', nickname: 'Ada' })).rejects.toThrow(JoinError);
  });

  it('accepts the seeded code case-insensitively and counts the guest', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: ' sr1017 ', nickname: 'Ada' });
    expect(r.session.current.get()).toMatchObject({ kind: 'guest', nickname: 'Ada' });
    expect(r.event.current.get()?.guestCount).toBe(173);
  });

  it('refuses once the plan is full', async () => {
    const r = make();
    await r.event.setTier('house_party'); // caps at 10, and 172 are already in
    await expect(r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' })).rejects.toThrow(/full/);
  });
});

describe('entitlements are enforced in the repository, not the button', () => {
  it('blocks a folder past the cap and names the upgrade', async () => {
    const r = make();
    await r.event.setTier('party'); // 3 folders, 3 already exist
    await expect(r.photos.addFolder({ name: 'Dancing' })).rejects.toBeInstanceOf(EntitlementError);
    await r.photos.addFolder({ name: 'Dancing' }).catch((e: EntitlementError) => {
      expect(e.denial).toMatchObject({ kind: 'limit', limit: 'folders', upgradeTo: 'event' });
    });
  });

  // The three tests that stood here asserted the free tier was REFUSED accept,
  // decline, markPlayed and playNext. That gate is gone: it meant a house party
  // could gather requests and act on none of them, and because playNext is the
  // only writer of nowPlaying, the Now Playing bar never moved. The replacement
  // is the opposite assertion, in `the free tier runs a whole party` below.

  // upload() reads photoModeration to decide pending-vs-approved, so the queue
  // it creates has to be gated by the same feature or a free tier moderates a
  // queue it was never sold.
  it('blocks photo moderation on the free tier', async () => {
    const r = make();
    await r.event.setTier('house_party');
    await expect(r.photos.approve('pho_1')).rejects.toBeInstanceOf(EntitlementError);
    await expect(r.photos.hide('pho_1')).rejects.toBeInstanceOf(EntitlementError);
  });

  // RE-POINTED, not deleted, when the djQueue gate was removed. This is the only
  // test that exercises `denial.upgradeTo` -- the paywall's "which tier lifts
  // this?" path -- and deleting it along with the gate would have silently taken
  // that coverage with it. photoModeration is still free-gated, so the assertion
  // survives intact on a feature that still discriminates.
  it('names the tier that lifts a refused feature, so the paywall can highlight it', async () => {
    const r = make();
    await r.event.setTier('house_party');
    await r.photos.approve('pho_1').catch((e: EntitlementError) => {
      expect(e.denial.kind).toBe('feature');
      expect(e.denial).toMatchObject({ feature: 'photoModeration' });
      expect(e.denial.upgradeTo).toBeTruthy();
    });
    expect.hasAssertions();
  });

  // THE POINT OF UNGATING THE QUEUE. Not "accept no longer throws" -- that is the
  // mechanism. This asserts the OUTCOME a host in a living room actually sees: a
  // request goes in and the Now Playing bar moves. Against the free-tier fixture,
  // which starts with `nowPlaying: null`, so a pass cannot come from seed data.
  it('the free tier runs a whole party: request, vote, accept, play', async () => {
    const r = makeFree();
    expect(r.music.nowPlaying.get()).toBeNull();

    await r.music.request({ title: 'Blue Monday', artist: 'New Order' });
    const mine = r.music.queue.get().find((q) => q.title === 'Blue Monday');
    expect(mine).toBeDefined();

    await r.music.setVote(mine!.id, true);
    await r.music.accept(mine!.id);
    expect(r.music.accepted.get().map((a) => a.title)).toContain('Blue Monday');

    await r.music.playNext();
    expect(r.music.nowPlaying.get()).toMatchObject({
      title: 'Blue Monday',
      artist: 'New Order',
    });
  });

  it('the free tier can decline and mark played too, not just the happy path', async () => {
    const r = makeFree();
    await r.music.decline('reqh_1');
    expect(r.music.queue.get().some((q) => q.id === 'reqh_1')).toBe(false);
    await r.music.markPlayed('reqh_2');
    expect(r.music.queue.get().some((q) => q.id === 'reqh_2')).toBe(false);
  });

  it('blocks a non-host role below the tier that offers roles', async () => {
    const r = make();
    await r.event.setTier('party');
    await expect(r.hosts.invite({ displayName: 'Sam', role: 'dj' })).rejects.toBeInstanceOf(EntitlementError);
  });

  it('allows what the Event tier actually includes', async () => {
    const r = make();
    await r.photos.addFolder({ name: 'Dancing' });
    await r.hosts.invite({ displayName: 'Sam', role: 'dj' });
    expect(r.photos.folders.get()).toHaveLength(4);
    expect(r.hosts.all.get()).toHaveLength(4);
  });
});

describe('observables', () => {
  it('notifies subscribers on write and stops after unsubscribe', async () => {
    const r = make();
    const seen: number[] = [];
    const off = r.photos.folders.subscribe((f) => seen.push(f.length));
    await r.photos.addFolder({ name: 'A' });
    off();
    await r.photos.addFolder({ name: 'B' });
    expect(seen).toEqual([4]);
  });
});

/* ----------------------------------------------- moderation (Guideline 1.2) */

describe('blocking someone', () => {
  it('takes their songs out of every queue at once, not screen by screen', async () => {
    // The property that matters is the FILTER'S PLACEMENT. If it lived in the screens,
    // this test would pass for whichever screen was written first and silently fail for
    // the next one. Asserting all three lists from one block is what pins it to the seam.
    const r = make();
    expect(r.music.queue.get().some((s) => s.requestedByName === 'Priya')).toBe(true);
    expect(r.music.accepted.get().some((s) => s.requestedByName === 'Priya')).toBe(true);

    await r.moderation.block('gst_priya');

    expect(r.music.queue.get().some((s) => s.requestedByName === 'Priya')).toBe(false);
    expect(r.music.incoming.get().some((s) => s.requestedByName === 'Priya')).toBe(false);
    expect(r.music.accepted.get().some((s) => s.requestedByName === 'Priya')).toBe(false);
  });

  it('leaves the HOST console untouched, because a block cannot hide evidence', async () => {
    // Priya has a pending photo in the seed. Blocking her must not remove it from the
    // approvals queue: moderation is the host's job and a guest cannot veto it.
    const r = make();
    const before = r.photos.pending.get().length;
    await r.moderation.block('gst_priya');
    expect(r.photos.pending.get()).toHaveLength(before);
    expect(r.photos.pending.get().some((p) => p.uploadedByName === 'Priya')).toBe(true);
  });

  it('hides their APPROVED photos from the album, matching on identity not name', async () => {
    // BY ID, DELIBERATELY. The seed also carries `phoa_1`, an approved row whose
    // uploadedByName is likewise 'Priya' but whose uploadedByGuestId is null -- a
    // fixture with no owner. Filtering on the NAME would take that row too, which is
    // wrong twice over: it is not hers to hide, and two guests may share a nickname.
    // A block is against a person, and only an id names one.
    const r = make();
    await r.photos.approve('pho_1'); // Priya's, and genuinely attributed to her
    expect(r.photos.approved.get().some((p) => p.id === 'pho_1')).toBe(true);

    await r.moderation.block('gst_priya');

    expect(r.photos.approved.get().some((p) => p.id === 'pho_1')).toBe(false);
    // The ownerless row is untouched: nothing links it to the person just blocked.
    expect(r.photos.approved.get().some((p) => p.id === 'phoa_1')).toBe(true);
  });

  it('is idempotent, and unblock puts them back', async () => {
    const r = make();
    await r.moderation.block('gst_priya');
    await r.moderation.block('gst_priya');
    expect(r.moderation.blocked.get()).toHaveLength(1);
    expect(r.moderation.blocked.get()[0]).toMatchObject({ nickname: 'Priya' });

    await r.moderation.unblock('gst_priya');
    expect(r.moderation.blocked.get()).toHaveLength(0);
    expect(r.music.queue.get().some((s) => s.requestedByName === 'Priya')).toBe(true);
  });

  it('names the person, because a list of ids cannot be unblocked by a human', async () => {
    const r = make();
    await r.moderation.block('gst_lou');
    expect(r.moderation.blocked.get()[0]!.nickname).toBe('Grandpa Lou');
  });

  it('refuses to block yourself', async () => {
    const r = make();
    await expect(r.moderation.block('gst_me')).rejects.toThrow(/yourself/);
  });
});

describe('reporting something', () => {
  it('describes the subject for the host, rather than handing over an id', async () => {
    const r = make();
    await r.moderation.report({ subject: { kind: 'song_request', requestId: 'req_1' }, reason: 'hate' });
    expect(r.moderation.reports.get()[0]).toMatchObject({
      subjectLabel: 'Dancing Queen -- ABBA',
      reason: 'hate',
    });
  });

  it('labels a photo by who took it, which is the only thing a host can act on', async () => {
    const r = make();
    await r.moderation.report({ subject: { kind: 'photo', photoId: 'pho_2' }, reason: 'nudity' });
    expect(r.moderation.reports.get()[0]!.subjectLabel).toBe('Photo from Tom');
  });

  it('treats a second report of the same thing as a no-op, not an error', async () => {
    // Matching file_report()'s ON CONFLICT DO NOTHING. A double tap is not a failure,
    // and raising would make the button look broken to the person using it correctly.
    const r = make();
    const subject = { kind: 'photo', photoId: 'pho_1' } as const;
    await r.moderation.report({ subject, reason: 'spam' });
    await expect(r.moderation.report({ subject, reason: 'nudity' })).resolves.toBeUndefined();
    expect(r.moderation.reports.get()).toHaveLength(1);
    // And the FIRST reason survives -- a re-report must not rewrite the original.
    expect(r.moderation.reports.get()[0]!.reason).toBe('spam');
  });

  it('remembers what you already reported, so a screen can stop offering the button', async () => {
    const r = make();
    expect(r.moderation.myReports.get().has('photo:pho_1')).toBe(false);
    await r.moderation.report({ subject: { kind: 'photo', photoId: 'pho_1' }, reason: 'spam' });
    expect(r.moderation.myReports.get().has('photo:pho_1')).toBe(true);
  });

  it('refuses a subject that is not in this event', async () => {
    // The local stand-in for file_report()'s subject_not_in_event. Same failure, same
    // moment, so a screen written against either adapter handles it the same way.
    const r = make();
    await expect(
      r.moderation.report({ subject: { kind: 'photo', photoId: 'pho_nope' }, reason: 'spam' }),
    ).rejects.toThrow(/no such subject/);
  });

  it('refuses to report yourself', async () => {
    const r = make();
    await expect(
      r.moderation.report({ subject: { kind: 'guest', guestId: 'gst_me' }, reason: 'spam' }),
    ).rejects.toThrow(/yourself/);
  });

  it('drops off the queue once resolved, but the row survives as the audit trail', async () => {
    const r = make();
    await r.moderation.report({ subject: { kind: 'photo', photoId: 'pho_1' }, reason: 'nudity' });
    const id = r.moderation.reports.get()[0]!.id;

    await r.moderation.resolve(id, 'removed');

    expect(r.moderation.reports.get()).toHaveLength(0);
    // Still reported, from the reporter's point of view -- the button stays off.
    expect(r.moderation.myReports.get().has('photo:pho_1')).toBe(true);
  });

  it('orders the queue oldest first, because a queue is a backlog', async () => {
    let t = 0;
    const r = MemoryRepository.create(weddingSeed, { now: () => `2026-10-17T20:0${t++}:00.000Z` });
    await r.moderation.report({ subject: { kind: 'photo', photoId: 'pho_1' }, reason: 'spam' });
    await r.moderation.report({ subject: { kind: 'photo', photoId: 'pho_2' }, reason: 'spam' });
    expect(r.moderation.reports.get().map((x) => x.subjectLabel)).toEqual([
      'Photo from Priya',
      'Photo from Tom',
    ]);
  });
});

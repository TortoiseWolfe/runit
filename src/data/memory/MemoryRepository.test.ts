import { FIXTURE_EMAIL_CODE, MemoryRepository } from './MemoryRepository';
import { weddingSeed } from './fixtures/wedding';
import { housePartySeed } from './fixtures/houseParty';
import { flakyTransfer } from './fixtures/flakyTransfer';
import { EntitlementError, JoinError, ScheduleError } from '../repository';

const FIXED = '2026-10-17T20:00:00.000Z';
const make = (opts: Parameters<typeof MemoryRepository.create>[1] = {}) =>
  MemoryRepository.create(weddingSeed, { now: () => FIXED, ...opts });
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
    await r.chat.send({ body: 'Cake is cut', pinned: false });

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
    await r.chat.send({ body: 'Cake in ten', pinned: true });
    // The canvas drops it (pin:false in the same setState) so pinning is inert.
    expect(r.chat.feed.get()[0]).toMatchObject({ body: 'Cake in ten', pinned: true });
  });

  /**
   * IT USED TO DEGRADE, AND NOW IT SIMPLY WORKS (#70). This asserted that a free-tier pin
   * came out unpinned -- the announcement went out, it just did not stick, because refusing
   * to POST over a pin would have been hostile. That fold was correct and invisible, which
   * is exactly what made the composer's Pin pill say "Pinned ✓" over an unpinned notice.
   *
   * Pinning is free now, so the assertion inverts rather than disappearing: the thing worth
   * pinning to a test is that a free-tier host's pin STICKS.
   */
  it('pins on the free tier, because pinning is not something anyone buys', async () => {
    const r = make();
    await r.event.setTier('house_party');
    await r.chat.send({ body: 'Pizza is here', pinned: true });
    const posted = r.chat.feed.get().find((b) => b.body === 'Pizza is here');
    expect(posted).toBeDefined();
    expect(posted?.pinned).toBe(true);
  });

  it('un-pins an announcement that has stopped being true', async () => {
    const r = make();
    await r.chat.send({ body: 'Cake in ten', pinned: true });
    const b = r.chat.feed.get().find((x) => x.body === 'Cake in ten')!;
    expect(b.pinned).toBe(true);

    await r.chat.setPinned(b.id, false);
    expect(r.chat.feed.get().find((x) => x.id === b.id)?.pinned).toBe(false);
  });

  /**
   * THE GATE IS GONE, and its absence is what is asserted (#70). This refused to put a pin
   * UP on a tier that had not bought one -- silently against Supabase, where
   * `SupabaseRepository.setPinned` never had a client check at all and the server's
   * `fold_pin_to_plan` returned the row unpinned through realtime with no toast. Two
   * controls that lied, #70 · 2 and 3 of 5.
   */
  it('lets a free-tier host pin an announcement she already sent', async () => {
    const r = make();
    await r.chat.send({ body: 'Cake in ten', pinned: false });
    const b = r.chat.feed.get().find((x) => x.body === 'Cake in ten')!;
    await r.event.setTier('house_party');

    await expect(r.chat.setPinned(b.id, true)).resolves.toBeUndefined();
    expect(r.chat.feed.get().find((x) => x.id === b.id)?.pinned).toBe(true);
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
    await r.chat.send({ body: 'Cake in ten', pinned: true });
    const b = r.chat.feed.get().find((x) => x.body === 'Cake in ten')!;
    expect(b.pinned).toBe(true);

    await r.event.setTier('house_party'); // the downgrade
    await expect(r.chat.setPinned(b.id, false)).resolves.toBeUndefined();
    expect(r.chat.feed.get().find((x) => x.id === b.id)?.pinned).toBe(false);
  });

  it('accepts a push token and resolves, because 208 journeys run through here', async () => {
    // A REAL NO-OP THAT RESOLVES, never a throw. The app registers on open, so a throw
    // in this adapter would redden the whole Playwright suite for a reason unrelated to
    // whatever is under test.
    const r = make();
    await expect(r.session.setPushToken('ExponentPushToken[xxx]')).resolves.toBeUndefined();
    await expect(r.session.setPushToken(null)).resolves.toBeUndefined();
  });

  it('ignores an empty draft', async () => {
    const r = make();
    await r.chat.send({ body: '   ', pinned: false });
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

  /**
   * NEITHER APPROVE NOR HIDE IS GATED ANY MORE, and this test asserted the opposite twice.
   *
   * It first asserted BOTH threw. #65 split them: `hide` throwing is what made Guideline
   * 1.2 unsatisfiable, because `create_event` mints `house_party`, so a REPORTED photo
   * could not be taken down on any event the app can create -- "Removed" closed the report
   * while the photo stayed in the album. The reasoning kept for `approve` was that
   * moderation is "a feature somebody pays for, and `approve` is meaningless without it
   * because nothing is ever pending".
   *
   * That second half was circular. Nothing was ever pending BECAUSE the tier decided, and
   * the tier decided because it was sold that way. Approval is a safety setting the host
   * turns on for her own party now, so a free-tier host has a queue and the old gate could
   * only ever refuse the one person it was built for.
   */
  it('does NOT gate approving a photo, on any tier', async () => {
    const r = make();
    await r.event.setTier('house_party');
    // The wedding fixture has approval ON, so `pho_1` is pending and this is a real
    // approval rather than a no-op that any implementation would satisfy.
    expect(r.photos.pending.get().some((p) => p.id === 'pho_1')).toBe(true);
    await expect(r.photos.approve('pho_1')).resolves.toBeUndefined();
    expect(r.photos.approved.get().some((p) => p.id === 'pho_1')).toBe(true);
  });

  it('does NOT gate taking a photo down, on any tier (#65)', async () => {
    const r = make();
    await r.event.setTier('house_party');
    await expect(r.photos.hide('pho_1')).resolves.toBeUndefined();
    // It leaves the album, which is the whole remedy: `approved` is what a guest sees.
    expect(r.photos.approved.get().some((p) => p.id === 'pho_1')).toBe(false);
  });

  /**
   * RE-POINTED THREE TIMES NOW, and never deleted, because it is the only test that
   * exercises `denial.upgradeTo` -- the paywall's "which tier lifts this?" path. It began on
   * the djQueue gate, moved to `photoModeration` when that was removed, moved to
   * `pinnedAnnouncements` yesterday, and moves again today because pinning became free.
   *
   * THAT PATTERN IS ITSELF WORTH READING. Three features have left the ladder in two days,
   * each because it turned out to be a safety setting, an event's own choice, or a thing
   * nobody should pay for. `audit:tiers` is down to 10 features and 2 granted. If the fourth
   * re-point ever has nowhere to go, `upgradeTo` has no reachable caller and the paywall
   * path should go with it rather than being kept alive by a test.
   *
   * IT IS A **LIMIT** DENIAL NOW, NOT A FEATURE ONE, and that is a finding rather than a
   * convenience. `hostRoles` is the last feature gated in this adapter, and its denial is
   * UNREACHABLE: `invite` checks the seat cap first, and every fixture is already at its
   * cap -- the wedding holds 3 hosts and `party` allows 2, `housePartySeed` holds 1 and
   * `house_party` allows 1, and a created event mints its founder into the only seat. So
   * there is no world here in which a role refusal fires before a seat refusal.
   *
   * What this test is actually for is `upgradeTo` -- the paywall's "which tier lifts this?"
   * path -- and that is carried by limit denials too. So it moves to the one denial that
   * IS reachable, and says why rather than quietly changing what it proves.
   */
  it('names the tier that lifts a refused denial, so the paywall can highlight it', async () => {
    const r = make();
    await r.event.setTier('house_party');
    await r.hosts.invite({ displayName: 'Dee', role: 'host', roleLabel: 'Host' }).catch(
      (e: EntitlementError) => {
        expect(e.denial.kind).toBe('limit');
        expect(e.denial).toMatchObject({ limit: 'hosts' });
        expect(e.denial.upgradeTo).toBeTruthy();
      },
    );
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

/* ------------------------------------------------------------------- invitees */

describe('the guest list', () => {
  it('moves the number the composer addresses, which is the whole point of #25', async () => {
    // "Send to N guests" reads `event.invitedCount`, and until now nothing in the app
    // could set N. The number moving is the claim; the list rendering is not.
    const r = make();
    const before = r.event.current.get()!.invitedCount;
    await r.invitees.add({ email: 'sam@example.test', displayName: 'Sam' });
    expect(r.event.current.get()!.invitedCount).toBe(before + 1);
    expect(r.invitees.all.get()).toHaveLength(1);
  });

  it('takes them back off again', async () => {
    const r = make();
    const before = r.event.current.get()!.invitedCount;
    await r.invitees.add({ email: 'sam@example.test' });
    const [added] = r.invitees.all.get();
    await r.invitees.remove(added!.id);
    expect(r.event.current.get()!.invitedCount).toBe(before);
    expect(r.invitees.all.get()).toHaveLength(0);
  });

  it('refuses the same address in another case, because that is one person', async () => {
    // Mirrors the `invitees_event_email` unique index, which is case-insensitive on
    // purpose. This adapter is what the whole e2e suite runs, so a rejection nobody can
    // reach here is a rejection nobody ever tests.
    const r = make();
    await r.invitees.add({ email: 'Sam@Example.test' });
    await expect(r.invitees.add({ email: 'sam@example.test' })).rejects.toThrow(/already on the list/);
    expect(r.invitees.all.get()).toHaveLength(1);
  });

  it('never marks anyone as invited, because nothing sends', async () => {
    // `invitedAt` separates "on the list" from "was emailed". Nothing in the product
    // writes it, deliberately -- whether Runit emails strangers is not an implementation
    // detail.
    const r = make();
    await r.invitees.add({ email: 'sam@example.test' });
    expect(r.invitees.all.get()[0]!.invitedAt).toBeNull();
    expect(r.invitees.all.get()[0]!.joinedGuestId).toBeNull();
  });

  /**
   * IT REFUSES NOW RATHER THAN SILENTLY IGNORING, and that is a deliberate change of
   * behaviour, not a test bent to fit an implementation.
   *
   * This used to `return` on a blank address and assert only that no row appeared. Since
   * #60 the schema holds `invitees_reachable` -- `check (email is not null or phone is not
   * null)` -- so the SERVER refuses it with 23514. An adapter that swallows what the
   * backend rejects is exactly the drift this file exists to prevent: Lane B would go green
   * over a path that throws in production.
   *
   * The old assertion survives inside the new one. No row, no movement in the count, AND
   * the caller is told.
   */
  it('refuses a contact with no way to reach them, and adds nothing', async () => {
    const r = make();
    const before = r.event.current.get()!.invitedCount;
    await expect(r.invitees.add({ email: '   ' })).rejects.toThrow(/email or a phone/i);
    expect(r.invitees.all.get()).toHaveLength(0);
    expect(r.event.current.get()!.invitedCount).toBe(before);
  });

  it('takes a phone with no email, which is what an address book actually holds', async () => {
    const r = make();
    await r.invitees.add({ phone: '(555) 010-1234', displayName: 'Aunt Sam' });
    const [row] = r.invitees.all.get();
    expect(row!.phone).toBe('(555) 010-1234');
    expect(row!.email).toBeNull();
  });

  it('folds one person saved three ways into one row', async () => {
    // The `invitees_event_phone` index folds through `phone_key`; this mirrors it. An
    // address book holds one relative as all three of these across a decade of phones.
    const r = make();
    await r.invitees.add({ phone: '555-010-1234' });
    const { added, skipped } = await r.invitees.addMany([
      { phone: '(555) 010-1234' },
      { phone: '+1 555 010 1234' },
      { phone: '555-010-9999' },
    ]);
    expect(added).toBe(1);
    expect(skipped).toBe(2);
    expect(r.invitees.all.get()).toHaveLength(2);
  });

  it('addMany skips duplicates instead of failing the batch', async () => {
    // Importing an address book twice is ORDINARY. Throwing on the first repeat would make
    // a forty-person import an exercise in finding which name you already had.
    const r = make();
    const people = [{ email: 'a@x.test' }, { email: 'b@x.test' }];
    expect(await r.invitees.addMany(people)).toEqual({ added: 2, skipped: 0 });
    expect(await r.invitees.addMany(people)).toEqual({ added: 0, skipped: 2 });
    expect(r.invitees.all.get()).toHaveLength(2);
  });

  /*
   * SEND STAMPS ONLY WHAT THE OS CONFIRMED (iOS's composer answering `sent`). No lane here runs
   * that composer, so these hand one in -- the same seam `transfer` gives the upload path.
   */
  const composing = (outcome: 'sent' | 'unconfirmed' | 'cancelled' | 'unavailable') => {
    const seen: { bcc: readonly string[] }[] = [];
    return {
      seen,
      composer: async (m: { bcc: readonly string[]; subject: string; body: string }) => {
        seen.push(m);
        return outcome;
      },
    };
  };

  it('send stamps only who was asked for, and keeps the FIRST time', async () => {
    const c = composing('sent');
    const r = make({ composer: c.composer });
    await r.invitees.addMany([{ email: 'a@x.test' }, { email: 'b@x.test' }]);
    const [first, second] = r.invitees.all.get();

    await r.invitees.send([first!.id]);
    const afterFirst = r.invitees.all.get();
    expect(afterFirst[0]!.invitedAt).not.toBeNull();
    // The one NOT asked for stays unsent -- otherwise "send to the unsent" would be a lie
    // the second time a host used it.
    expect(afterFirst.find((i) => i.id === second!.id)!.invitedAt).toBeNull();

    // Idempotent: re-sending keeps the original stamp, because the honest answer to "when
    // was this person invited" is the first time.
    const stamp = afterFirst[0]!.invitedAt;
    await r.invitees.send([first!.id, second!.id]);
    expect(r.invitees.all.get()[0]!.invitedAt).toBe(stamp);
    expect(r.invitees.all.get().every((i) => i.invitedAt !== null)).toBe(true);
  });

  it('hands the composer every address, in BCC, and nothing else', async () => {
    const c = composing('sent');
    const r = make({ composer: c.composer });
    await r.invitees.addMany([{ email: 'A@x.test' }, { email: 'b@x.test' }]);
    await r.invitees.send(r.invitees.all.get().map((i) => i.id));
    expect(c.seen[0]!.bcc).toEqual(['a@x.test', 'b@x.test']);
  });

  it('stamps NOBODY when the composer opened but could not say it was sent', async () => {
    // Android's composer and every browser. A date beside an email nobody may have sent is
    // the lie `invitedAt`'s docblock forbids.
    const r = make({ composer: composing('unconfirmed').composer });
    await r.invitees.addMany([{ email: 'a@x.test' }]);
    const res = await r.invitees.send(r.invitees.all.get().map((i) => i.id));
    expect(res).toEqual({ outcome: 'unconfirmed', emailed: 1, phoneOnly: 0 });
    expect(r.invitees.all.get()[0]!.invitedAt).toBeNull();
  });

  it('never marks a phone-only guest invited, even when the email confirms', async () => {
    // She was not in that email. Stamping her would make "send to the unsent" skip her forever.
    const r = make({ composer: composing('sent').composer });
    await r.invitees.addMany([{ email: 'a@x.test' }, { phone: '+15555550100' }]);
    const res = await r.invitees.send(r.invitees.all.get().map((i) => i.id));
    expect(res).toEqual({ outcome: 'sent', emailed: 1, phoneOnly: 1 });
    const phone = r.invitees.all.get().find((i) => i.phone);
    expect(phone!.invitedAt).toBeNull();
  });

  it('opens nothing for a list of phone numbers, and says so', async () => {
    const c = composing('sent');
    const r = make({ composer: c.composer });
    await r.invitees.addMany([{ phone: '+15555550100' }, { phone: '+15555550101' }]);
    const res = await r.invitees.send(r.invitees.all.get().map((i) => i.id));
    expect(res).toEqual({ outcome: 'no-emails', emailed: 0, phoneOnly: 2 });
    // No group text, and no empty composer either.
    expect(c.seen).toHaveLength(0);
  });
});

describe('a founder holds no guest seat (#37)', () => {
  const NEW_EVENT = {
    name: "Ruth's 40th",
    venue: 'The garden',
    startsAt: FIXED,
    timezone: 'America/New_York',
    doorsLabel: 'Doors 7:00 PM',
    hostName: 'Ruth',
  };

  it('leaves her without one, exactly as create_event does', async () => {
    const r = make();
    const seated = r.session.current.get();
    await r.event.create(NEW_EVENT);
    await r.session.becomeGuest();

    // THE FIXTURE IS THE POINT. This carried the seeded guest id straight through a
    // create, which made a founder indistinguishable from someone who had joined -- so
    // the state where `becomeGuest` had nothing to switch to could not be reached in any
    // test, and the console's one exit was green here while it raised against Postgres.
    const now = r.session.current.get();
    expect(now).toMatchObject({ kind: 'guest', nickname: 'Ruth' });
    expect(now).not.toMatchObject({ guestId: weddingSeed.myGuestId });
    // Not a tautology via `seated`: the wedding seed opens anonymous, so this pins that
    // the id she ends up with is minted rather than inherited from the seed.
    expect(seated).toMatchObject({ kind: 'anonymous' });
  });

  it('and her seat is not a guest arriving', async () => {
    const r = make();
    await r.event.create(NEW_EVENT);
    expect(r.event.current.get()).toMatchObject({ guestCount: 0 });

    await r.session.becomeGuest();

    // Parity with `public.guest_seats()`, which excludes anyone holding a host seat at
    // this event from BOTH the headcount and `tier_limits.max_guests`. If this fixture
    // incremented, Lane B would go green on a number the backend does not agree with --
    // and the number is printed on the join screen.
    expect(r.event.current.get()).toMatchObject({ guestCount: 0 });
  });

  it('a real guest arriving after her still counts as one', async () => {
    const r = make();
    const { code } = await r.event.create(NEW_EVENT);
    await r.session.becomeGuest();
    await r.session.joinAsGuest({ code, nickname: 'Ada' });

    // The rule is "staff are not guests", not "the first arrival is free".
    expect(r.event.current.get()).toMatchObject({ guestCount: 1 });
  });
});

describe('marking an announcement read (#24)', () => {
  const NEW_EVENT = {
    name: "Ruth's 40th", venue: 'The garden', startsAt: FIXED,
    timezone: 'America/New_York', doorsLabel: 'Doors 7:00 PM', hostName: 'Ruth',
  };
  const first = (r: ReturnType<typeof make>) => r.chat.feed.get()[0]!;

  it('moves the number, and moves it once', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    const b = first(r);
    const before = b.seenCount;

    await r.chat.markRead([b.id]);
    expect(first(r).seenCount).toBe(before + 1);

    // The caller is a scroll handler and re-sends whatever is on screen on every frame.
    // This is where "seen by 172" becomes "seen by 400".
    await r.chat.markRead([b.id]);
    await r.chat.markRead([b.id]);
    expect(first(r).seenCount).toBe(before + 1);
  });

  it('does not count the host who wrote it', async () => {
    const r = make();
    await r.event.create(NEW_EVENT);
    await r.chat.send({ body: 'Cake at nine.', pinned: false });
    // She takes a seat to look at her own feed (#37); a seat held by a host of the event
    // is excluded from `fold_seen_count`, so the fixture must exclude it too or Lane B
    // goes green on a number the backend does not agree with.
    await r.session.becomeGuest();

    const b = first(r);
    await r.chat.markRead([b.id]);
    expect(first(r).seenCount).toBe(0);
  });

  it('has nothing to record before there is a seat at all', async () => {
    const r = make();
    await r.event.create(NEW_EVENT);
    await r.chat.send({ body: 'Cake at nine.', pinned: false });

    // A founder holds no guest row until she asks for one. Not a guard against a caller's
    // mistake -- `ChatScreen` is reachable from the console.
    await expect(r.chat.markRead([first(r).id])).resolves.toBeUndefined();
    expect(first(r).seenCount).toBe(0);
  });
});

/**
 * TAKING AN ANNOUNCEMENT BACK -- #68. The feed is the one surface a host cannot correct by
 * sending something else: a wrong address stays above the correction for anyone who
 * scrolls, and `fan_out_push` has already delivered it.
 */
describe('removing an announcement (#68)', () => {
  const NEW_EVENT = {
    name: "Ruth's 40th", venue: 'The garden', startsAt: FIXED,
    timezone: 'America/New_York', doorsLabel: 'Doors 7:00 PM', hostName: 'Ruth',
  };

  it('takes it out of the feed and leaves the others where they were', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    const before = r.chat.feed.get();
    expect(before.length).toBeGreaterThan(2);

    await r.chat.remove(before[1]!.id);

    const after = r.chat.feed.get();
    // Count AND order AND identity. A filter that removed the wrong row, or that removed
    // one and reordered the rest, passes a length check alone.
    expect(after.map((b) => b.id)).toEqual(
      before.filter((b) => b.id !== before[1]!.id).map((b) => b.id),
    );
  });

  /**
   * THE READ MARK IS DELETED WITH THE ROW AND NO TEST HERE CAN SEE IT. The first draft of
   * this block asserted it and passed against an adapter with the line deleted -- because
   * `MemoryRepository.id()` never reuses an id, so a stale mark has no observable effect
   * through any public surface. The line stays (it mirrors the cascade, and dead state that
   * names nothing is the shape this issue exists to remove) and the claim does not.
   *
   * What IS observable is the ordering, which a removal has to preserve:
   */
  it('leaves the pinned-first ordering intact when the pinned one is the one removed', async () => {
    const r = make();
    await r.event.create(NEW_EVENT);
    await r.chat.send({ body: 'Cake at nine.', pinned: false });
    await r.chat.send({ body: 'Park on the north side.', pinned: true });
    // Pinned first, then oldest-to-newest -- so the pin is at the top and its removal has
    // to re-sort rather than leave a hole where the head was.
    expect(r.chat.feed.get().map((b) => b.body)).toEqual([
      'Park on the north side.', 'Cake at nine.',
    ]);

    await r.chat.remove(r.chat.feed.get()[0]!.id);
    expect(r.chat.feed.get().map((b) => b.body)).toEqual(['Cake at nine.']);
  });

  it('removing one the host never read is not an error either', async () => {
    const r = make();
    await r.event.create(NEW_EVENT);
    await r.chat.send({ body: 'Cake at nine.', pinned: false });
    const only = r.chat.feed.get()[0]!;

    await expect(r.chat.remove(only.id)).resolves.toBeUndefined();
    expect(r.chat.feed.get()).toEqual([]);
  });
});

describe('changing your own name (#43)', () => {
  const nameOn = (r: ReturnType<typeof make>, title: string) =>
    r.music.queue.get().find((q) => q.title === title)?.requestedByName;

  it('rewrites the name on what you already sent, not just the session', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await r.music.request({ title: 'Blue Monday', artist: 'New Order' });
    expect(nameOn(r, 'Blue Monday')).toBe('Ada');

    await r.session.setNickname('Wren');

    // `requestedByName` is denormalised so a deleted guest does not blank the history.
    // A rename that moved only the session would leave the old name in front of the room.
    expect(nameOn(r, 'Blue Monday')).toBe('Wren');
    expect(r.session.current.get()).toMatchObject({ kind: 'guest', nickname: 'Wren' });
  });

  it('leaves everybody else alone', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await r.session.setNickname('Wren');

    // Scoped by guest id, not by name. The seed's other requesters are the control.
    expect(nameOn(r, 'Dancing Queen')).toBe('Priya');
  });

  it('returns what was STORED, trimmed and capped', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });

    expect(await r.session.setNickname('  Wren  ')).toBe('Wren');
    // 40 is the cap `set_nickname` applies server-side. A screen that echoed its input
    // would show a name the room is not seeing.
    const long = 'W'.repeat(60);
    expect(await r.session.setNickname(long)).toBe('W'.repeat(40));
  });

  it('refuses an empty name rather than storing one', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await expect(r.session.setNickname('   ')).rejects.toThrow(/cannot be empty/);
    expect(r.session.current.get()).toMatchObject({ nickname: 'Ada' });
  });

  it('is not something a host can do, because she holds no guest row', async () => {
    const r = make();
    await r.event.create({
      name: "Ruth's 40th", venue: 'The garden', startsAt: FIXED,
      timezone: 'America/New_York', doorsLabel: 'Doors 7:00 PM', hostName: 'Ruth',
    });
    // Mirrors `set_nickname`'s 42501: `my_guest_id` is null for her until she takes a seat.
    await expect(r.session.setNickname('Ruthie')).rejects.toThrow(/Not joined as a guest/);
  });
});

/**
 * PHOTO APPROVAL, ON A FREE EVENT THIS APP CAN ACTUALLY CREATE.
 *
 * Written against `create()` rather than the wedding fixture, deliberately. `weddingSeed`
 * sits on the Event tier with moderation already on, six schedule rows and a full album --
 * richer than anything the product can build -- and four separate defects have now hidden
 * behind it. The state this feature is about is the state a host reaches on her first
 * night, so the test starts where she does.
 */
describe('a host turns photo approval on for her own party', () => {
  const created = async () => {
    const r = make();
    await r.event.create({
      name: "Ruth's 40th", venue: 'The garden', startsAt: FIXED,
      timezone: 'America/New_York', doorsLabel: 'Doors 7:00 PM', hostName: 'Ruth',
    });
    return r;
  };

  /**
   * ON, AND THE TIER IS STILL THE FREE ONE -- which is the pair that matters. This
   * assertion read `photoModeration: false` until the default flipped, and the half of it
   * that was never about the boolean is `tier: 'house_party'`: approval is not something a
   * host buys, and `create_event` mints no other tier. Keeping both in one object is what
   * stops a future tier gate reappearing under a passing test.
   */
  it('starts ON, on the only tier create_event mints', async () => {
    const r = await created();
    expect(r.event.current.get()).toMatchObject({ tier: 'house_party', photoModeration: true });
  });

  it('lets a photo straight into the album once she turns approval off', async () => {
    const r = await created();
    // Off is now the deliberate act. The claim is unchanged and still worth holding: with
    // the gate down, a guest's photo is in the album immediately rather than waiting for
    // a host who is not coming.
    await r.event.setPhotoModeration(false);
    // The founder takes a guest seat on demand (#37) -- she has no `guests` row from
    // `create_event`, which is the same route the role switch drives on screen.
    await r.session.becomeGuest();
    await expect(r.photos.upload({ localUri: 'file:///tmp/a.jpg' })).resolves.toBe('approved');
  });

  /**
   * THE ASSERTION THE WHOLE CHANGE EXISTS FOR. `house_party` -- and it is not upgraded
   * anywhere in here, which is the point: the tier is untouched and the behaviour changes.
   * Before this, a free-tier host could not reach `'pending'` by any route at all.
   */
  it('makes the next photo wait once she turns it on, with no change of tier', async () => {
    const r = await created();
    // Off and on again, so this still exercises the SWITCH rather than the default. With
    // the default now on, asserting straight from `created()` would pass on a setter wired
    // to nothing.
    await r.event.setPhotoModeration(false);
    await r.event.setPhotoModeration(true);
    expect(r.event.current.get()).toMatchObject({ tier: 'house_party', photoModeration: true });

    // The founder takes a guest seat on demand (#37) -- she has no `guests` row from
    // `create_event`, which is the same route the role switch drives on screen.
    await r.session.becomeGuest();
    await expect(r.photos.upload({ localUri: 'file:///tmp/a.jpg' })).resolves.toBe('pending');

    // In the host's queue and NOT in the album -- both halves, because a photo that simply
    // vanished would satisfy the first one alone.
    expect(r.photos.pending.get()).toHaveLength(1);
    expect(r.photos.approved.get()).toHaveLength(0);
  });

  /**
   * IT APPLIES AT UPLOAD, NOT RETROSPECTIVELY. `set_photo_status` is a `before insert`
   * trigger, so a host changing her mind mid-party governs the next photo and leaves the
   * album alone. The helper copy in `EventDetailsPanel` promises exactly this, and a
   * promise on a screen that no test holds is how the album came to contradict itself.
   */
  it('leaves photos already in the album alone when she turns it on', async () => {
    const r = await created();
    // Start with the gate down so there is something already in the album to leave alone.
    await r.event.setPhotoModeration(false);
    // The founder takes a guest seat on demand (#37) -- she has no `guests` row from
    // `create_event`, which is the same route the role switch drives on screen.
    await r.session.becomeGuest();
    await r.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    expect(r.photos.approved.get()).toHaveLength(1);

    await r.event.setPhotoModeration(true);
    expect(r.photos.approved.get()).toHaveLength(1);
    expect(r.photos.pending.get()).toHaveLength(0);

    await r.photos.upload({ localUri: 'file:///tmp/b.jpg' });
    expect(r.photos.approved.get()).toHaveLength(1);
    expect(r.photos.pending.get()).toHaveLength(1);
  });

  it('and a free-tier host can then approve what is waiting', async () => {
    const r = await created();
    // The founder takes a guest seat on demand (#37) -- she has no `guests` row from
    // `create_event`, which is the same route the role switch drives on screen.
    await r.session.becomeGuest();
    await r.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    await r.photos.approve(r.photos.pending.get()[0]!.id);
    expect(r.photos.approved.get()).toHaveLength(1);
    expect(r.photos.pending.get()).toHaveLength(0);
  });
});

describe('host sign-in by emailed code (#18)', () => {
  /**
   * THE MODE IS THE ONLY THING WORTH ASSERTING HERE, because it is the only part of this
   * design that a screen can observe and the only part that can be wrong in a way that
   * destroys something. Against Supabase, 'attach' calls `updateUser` and KEEPS
   * `auth.uid()`; 'sign_in' calls `signInWithOtp` and mints a new one. A host who is
   * still holding the anonymous identity her event is bound to, sent down the second
   * path, keeps her event in the database and loses every route to it but the recovery
   * key -- with no error raised anywhere.
   */
  it('an anonymous identity ATTACHES the address rather than signing in fresh', async () => {
    const r = make();
    expect(r.session.current.get()).toEqual({ kind: 'anonymous' });
    await expect(r.session.requestEmailCode('ada@example.com')).resolves.toBe('attach');
  });

  it('an identity that is already somebody SIGNS IN', async () => {
    const r = make();
    await r.session.joinAsGuest({ code: 'SR1017', nickname: 'Ada' });
    await expect(r.session.requestEmailCode('ada@example.com')).resolves.toBe('sign_in');
  });

  it('refuses an empty address by its own reason, never as a network failure', async () => {
    const r = make();
    // `needs_an_email`, not `session_unavailable` -- the sign-in twin of #66's rule that a
    // bad name must not surface as "that code doesn't match an event".
    await expect(r.session.requestEmailCode('   ')).rejects.toThrow(JoinError);
    await expect(r.session.requestEmailCode('   ')).rejects.toThrow(/email address/i);
  });

  it('refuses a wrong code, and says the codes expire', async () => {
    const r = make();
    const mode = await r.session.requestEmailCode('ada@example.com');
    await expect(
      r.session.submitEmailCode({ email: 'ada@example.com', code: '000000', mode }),
    ).rejects.toThrow(/10 minutes/);
  });

  /**
   * The field stays editable between the two steps, so this is reachable by typing rather
   * than by a bug -- and GoTrue refuses it, so the fixture must too. A fixture kinder than
   * the backend is the failure this adapter exists to avoid.
   */
  it('refuses a correct code presented against a different address', async () => {
    const r = make();
    const mode = await r.session.requestEmailCode('ada@example.com');
    await expect(
      r.session.submitEmailCode({ email: 'grace@example.com', code: FIXTURE_EMAIL_CODE, mode }),
    ).rejects.toThrow(JoinError);
  });

  it('accepts the fixture code', async () => {
    const r = make();
    const mode = await r.session.requestEmailCode('ada@example.com');
    await expect(
      r.session.submitEmailCode({ email: 'ada@example.com', code: FIXTURE_EMAIL_CODE, mode }),
    ).resolves.toBeUndefined();
  });

  /**
   * SIGNING IN IS NOT A WAY TO BECOME A HOST, and the fixture must not imply otherwise.
   * `create_event` is what mints a host seat; proving which identity you are does not.
   * Were this to promote the session, every journey would render a host console for
   * somebody the backend would refuse.
   */
  it('does not hand out a host seat', async () => {
    const r = make();
    const mode = await r.session.requestEmailCode('ada@example.com');
    await r.session.submitEmailCode({ email: 'ada@example.com', code: FIXTURE_EMAIL_CODE, mode });
    expect(r.session.current.get()).toEqual({ kind: 'anonymous' });
    // NOT `holdsHostSeat`, which this fixture starts TRUE on purpose so the seeded world
    // can reach the console -- its own docblock says it answers "could you claim a seat",
    // not "did you arrive as staff". Asserting it here would pin the fixture's scaffolding
    // and pass whatever sign-in did.
  });
});

describe('the sign-in mode is not decoration (#18)', () => {
  /**
   * THE MUTATION THAT SURVIVED. Sixteen journeys stayed green while the screen hardcoded
   * `'sign_in'` -- the call that mints a new `auth.uid()` and leaves a host's event
   * reachable only by its recovery key. Nothing observed the mode, so nothing could.
   *
   * `verifyOtp` really does reject a correct code under the wrong `type`, so the fixture
   * refusing it is not invention; it is the fixture stopping being kinder than the backend.
   */
  it('refuses a correct code presented under the other mode', async () => {
    const r = make();
    const mode = await r.session.requestEmailCode('ada@example.com');
    expect(mode).toBe('attach');
    const wrong = 'sign_in' as typeof mode;
    await expect(
      r.session.submitEmailCode({ email: 'ada@example.com', code: FIXTURE_EMAIL_CODE, mode: wrong }),
    ).rejects.toThrow(JoinError);
  });
});

describe('deleting an account, and what the fixture can honestly say about it (#19)', () => {
  it('shows no account until somebody signs in, because nearly everyone here is a guest', async () => {
    const r = make();
    // The join screen's fine print promises "no account, no phone number". An address on a
    // guest's identity would make that read as false to exactly the people it is for.
    expect(r.session.account.get()).toBeNull();
  });

  it('carries the address a code was verified against, on either branch', async () => {
    const r = make();
    const mode = await r.session.requestEmailCode('ruth@example.com');
    await r.session.submitEmailCode({ email: 'ruth@example.com', code: FIXTURE_EMAIL_CODE, mode });
    expect(r.session.account.get()).toBe('ruth@example.com');
  });

  it('counts a staffed event as KEPT rather than as destroyed', async () => {
    // The wedding has a bride, a planner and a DJ. It is not hers alone to delete, and a
    // sheet that said otherwise would be telling her she is about to destroy a party that
    // will still be running tomorrow.
    const r = make();
    const impact = await r.session.deletionImpact();
    expect(impact.eventsKept).toBe(1);
    expect(impact.eventsDeleted).toBe(0);
    // And nothing is counted as destroyed, because nothing is.
    expect(impact.photos).toBe(0);
  });

  it('counts an event she holds alone as dying, with the photographs in it', async () => {
    const r = makeFree();
    // A guest arrives and adds a photograph, because the number that matters is the one
    // this host did not take. The free fixture ships an empty album, so asserting against
    // it as seeded would assert against zero and pass on a count that never ran.
    await r.session.joinAsGuest({ code: 'HP0842', nickname: 'Ada' });
    // TWO photographs from ONE guest, and the second one is the whole test. With a single
    // upload the distinct-people count and the row count are both 1, so a version that
    // counted rows would pass -- measured, it did. The numbers have to be able to disagree
    // before an assertion about which one is used means anything.
    await r.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    await r.photos.upload({ localUri: 'file:///tmp/b.jpg' });

    const impact = await r.session.deletionImpact();
    expect(impact.eventsDeleted).toBe(1);
    expect(impact.eventsKept).toBe(0);
    expect(impact.photos).toBe(2);
    // DISTINCT PEOPLE, never rows: "2 photos by 1 guest" is the sentence, and a row count
    // would say two people where there is one.
    expect(impact.guests).toBe(1);
  });

  it('empties the world, because after a deletion there is nothing left to be in', async () => {
    const r = makeFree();
    await r.session.requestEmailCode('ruth@example.com');
    await r.session.submitEmailCode({
      email: 'ruth@example.com',
      code: FIXTURE_EMAIL_CODE,
      mode: 'attach',
    });
    expect(r.session.account.get()).toBe('ruth@example.com');

    await r.session.deleteAccount();

    expect(r.event.current.get()).toBeNull();
    expect(r.event.mine.get()).toEqual([]);
    expect(r.session.account.get()).toBeNull();
    // Back where `?empty=1` starts: an identity with nothing, which is what a person who
    // has just deleted their account is.
    expect(r.session.current.get()).toEqual({ kind: 'anonymous' });
  });
});

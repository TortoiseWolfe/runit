import { MemoryRepository } from './MemoryRepository';
import { weddingSeed } from './fixtures/wedding';
import { housePartySeed } from './fixtures/houseParty';
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

  it('seeds the demo guest as owner of Yeah!, matching `mine: true`', () => {
    const r = make();
    expect(r.music.myVotes.get().has('req_4')).toBe(true);
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

  it('ignores an empty draft', async () => {
    const r = make();
    await r.chat.send({ body: '   ', pinned: false, push: false });
    expect(r.chat.feed.get()).toHaveLength(3);
  });
});

describe('joining', () => {
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

  it('blocks DJ accept/decline on the free tier', async () => {
    const r = make();
    await r.event.setTier('house_party');
    await expect(r.music.accept('req_2')).rejects.toBeInstanceOf(EntitlementError);
  });

  // markPlayed and playNext were ungated until an audit noticed that markPlayed
  // is a strictly stronger decline -- it moves a request out of Incoming with
  // no tier behind it, so the whole djQueue gate was one method call wide.
  it('blocks every DJ-queue write on the free tier, not just accept/decline', async () => {
    const r = make();
    await r.event.setTier('house_party');
    await expect(r.music.decline('req_2')).rejects.toBeInstanceOf(EntitlementError);
    await expect(r.music.markPlayed('req_2')).rejects.toBeInstanceOf(EntitlementError);
    await expect(r.music.playNext()).rejects.toBeInstanceOf(EntitlementError);
  });

  it('leaves the queue untouched when a free tier is refused a DJ write', async () => {
    const r = make();
    await r.event.setTier('house_party');
    const before = r.music.queue.get().map((q) => `${q.id}:${q.status}`);
    await r.music.markPlayed('req_2').catch(() => {});
    await r.music.playNext().catch(() => {});
    expect(r.music.queue.get().map((q) => `${q.id}:${q.status}`)).toEqual(before);
  });

  // upload() reads photoModeration to decide pending-vs-approved, so the queue
  // it creates has to be gated by the same feature or a free tier moderates a
  // queue it was never sold.
  it('blocks photo moderation on the free tier', async () => {
    const r = make();
    await r.event.setTier('house_party');
    await expect(r.photos.approve('pho_1')).rejects.toBeInstanceOf(EntitlementError);
    await expect(r.photos.hide('pho_1')).rejects.toBeInstanceOf(EntitlementError);
  });

  it('names the tier that lifts a refused DJ write, so the paywall can highlight it', async () => {
    const r = make();
    await r.event.setTier('house_party');
    await r.music.markPlayed('req_2').catch((e: EntitlementError) => {
      expect(e.denial.kind).toBe('feature');
      expect(e.denial).toMatchObject({ feature: 'djQueue' });
      expect(e.denial.upgradeTo).toBeTruthy();
    });
    expect.hasAssertions();
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

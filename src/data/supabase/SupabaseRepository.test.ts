import { FakeClient, pgError, refusedLoudly, refusedSilently } from './fixtures/fakeClient';
import { SupabaseRepository } from './SupabaseRepository';
import type { RunitClient } from './client';
import { JoinError, ScheduleError } from '../repository';

/**
 * Scoped to WHAT DIFFERS from MemoryRepository, because that is the only place a test
 * of this adapter can learn something the in-memory suite does not already know: auth,
 * the shapes an RLS refusal takes, the ordering the photo upload is forced into, and
 * channel lifecycle. The derivations were ported line by line and are covered there.
 *
 * What this cannot prove is stated in fixtures/fakeClient.ts and is not small: no
 * column name is checked, no filter is evaluated, no policy admits anything, and
 * nothing is delivered over a real channel. Lane E and two devices cover that.
 */

const FIXED = '2026-10-17T20:00:00.000Z';
const EVENT = 'e0000000-0000-0000-0000-000000000001';
const FOLDER = 'f0000000-0000-0000-0000-000000000001';
const GUEST = 'g0000000-0000-0000-0000-000000000001';

const eventRow = (over: Record<string, unknown> = {}) => ({
  id: EVENT, code: 'TEST01', name: 'Party', venue: 'Barn', starts_at: FIXED,
  timezone: 'America/New_York', doors_label: '', tier: 'event',
  active_folder_id: FOLDER, now_schedule_item_id: null,
  guest_count: 3, invited_count: 10, created_at: FIXED, ...over,
});

/** A client seeded so joinAsGuest can complete, which every write test needs first. */
function ready(extra: (c: FakeClient) => void = () => {}) {
  const c = new FakeClient();
  c.seed('events', [eventRow()]).seed('hosts', []).seed('song_votes', []);
  c.on((op) => (op.kind === 'rpc' && op.table === 'join_event' ? { data: GUEST, error: null } : undefined));
  extra(c);
  return c;
}

const join = async (c: FakeClient) => {
  const repo = SupabaseRepository.create(c as unknown as RunitClient, { now: () => FIXED });
  await repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' });
  return repo;
};

beforeEach(() => {
  // upload() reads the local bytes before anything reaches the network.
  global.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })) as never;
});

/* ------------------------------------------------------------------------ auth */

describe('joining', () => {
  it('signs in anonymously only when there is no session', async () => {
    const c = ready();
    await join(c);
    expect(c.signInCalls).toBe(1);

    const withSession = ready();
    withSession.session = { user: { id: 'already-here' } };
    await join(withSession);
    // A second sign-in would mint a NEW anonymous user, and join_event is idempotent
    // on (event_id, auth_user_id) -- so it would take a second seat against the cap
    // rather than returning the guest to their own.
    expect(withSession.signInCalls).toBe(0);
  });

  it('sends the code and nickname under the parameter names the function declares', async () => {
    const c = ready();
    await join(c);
    expect(c.find('rpc', 'join_event')[0]!.payload).toEqual({ p_code: 'test01', p_nickname: 'Ada' });
  });

  it('turns P0002 into a JoinError a screen can render', async () => {
    const c = new FakeClient();
    c.on((op) => (op.kind === 'rpc' && op.table === 'join_event' ? pgError('P0002', 'unknown_code') : undefined));
    const repo = SupabaseRepository.create(c as unknown as RunitClient, { now: () => FIXED });
    await expect(repo.session.joinAsGuest({ code: 'NOPE', nickname: 'Ada' })).rejects.toBeInstanceOf(JoinError);
  });
});

/* -------------------------------------------------- the two shapes of a refusal */

describe('a write that row-level security refuses', () => {
  it('THROWS on the silent shape -- zero rows and no error', async () => {
    // The dangerous one, and the reason assertWrote exists. Proven against the real
    // database in lane E: a guest's UPDATE on events affects 0 rows and raises nothing.
    const c = ready((f) => f.on((op) => (op.kind === 'update' && op.table === 'events' ? refusedSilently() : undefined)));
    const repo = await join(c);
    await expect(repo.event.setActiveFolder(FOLDER)).rejects.toThrow(/affected no rows/);
  });

  it('THROWS on the loud shape too', async () => {
    const c = ready((f) => f.on((op) => (op.kind === 'update' && op.table === 'photos' ? refusedLoudly() : undefined)));
    const repo = await join(c);
    await expect(repo.photos.approve('p1')).rejects.toMatchObject({ code: '42501' });
  });

  it('sends exactly one column to events, because the grant covers exactly one', async () => {
    // `revoke update on events` + `grant update (active_folder_id)` means naming any
    // other key -- even one whose value is unchanged -- fails the whole statement.
    const c = ready();
    const repo = await join(c);
    await repo.event.setActiveFolder(FOLDER);
    expect(c.find('update', 'events')[0]!.payload).toEqual({ active_folder_id: FOLDER });
  });

  it('refuses to lose a vote silently', async () => {
    // song_votes is NOT published to realtime, so nothing ever arrives to correct a
    // local set that has drifted from the table.
    const c = ready();
    const repo = await join(c);
    await repo.music.setVote('r1', true);
    c.on((op) => (op.kind === 'delete' && op.table === 'song_votes' ? refusedSilently() : undefined));
    await expect(repo.music.setVote('r1', false)).rejects.toThrow(/affected no rows/);
    // And the local set still agrees with the table, which is the actual property.
    expect(repo.music.myVotes.get().has('r1')).toBe(true);
  });

  it('treats a duplicate vote as success, because the composite key is the idempotency', async () => {
    const c = ready((f) => f.on((op) => (op.kind === 'insert' && op.table === 'song_votes' ? pgError('23505') : undefined)));
    const repo = await join(c);
    await expect(repo.music.setVote('r1', true)).resolves.toBeUndefined();
    expect(repo.music.myVotes.get().has('r1')).toBe(true);
  });
});

/* ------------------------------------------------------------- upload ordering */

describe('uploading a photo', () => {
  it('puts the bytes up BEFORE the row, because the row cannot be patched later', async () => {
    // photos_moderate is hosts-only and there is no other UPDATE policy, so a guest
    // cannot add storage_path afterwards. Reverse this order and the row is written
    // pointing at bytes that may never arrive.
    const c = ready();
    const repo = await join(c);
    await repo.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    const uploadAt = c.ops.findIndex((o) => o.kind === 'upload');
    const insertAt = c.ops.findIndex((o) => o.kind === 'insert' && o.table === 'photos');
    expect(uploadAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThan(uploadAt);
  });

  it('writes the row with the client-minted id and the matching storage path', async () => {
    const c = ready();
    const repo = await join(c);
    await repo.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    const row = c.find('insert', 'photos')[0]!.payload as Record<string, string>;
    const key = (c.find('upload', 'event-photos')[0]!.payload as { path: string }).path;
    // If these disagree by one character the bytes are permanently unreadable to
    // every client, because the storage SELECT policy joins storage_path to the key.
    expect(key).toBe(`${EVENT}/${row.id}.jpg`);
    expect(row.storage_path).toBe(key);
    expect(row.uploaded_by_guest_id).toBe(GUEST);
  });

  it('sends a real contentType, since the bucket rejects the default', async () => {
    const c = ready();
    const repo = await join(c);
    await repo.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    const opts = (c.find('upload', 'event-photos')[0]!.payload as { opts: { contentType: string } }).opts;
    expect(opts.contentType).toBe('image/jpeg');
  });

  it('writes NO ROW when the bytes fail, and reports failed rather than throwing', async () => {
    const c = ready();
    c.failNextUpload = 'Network unavailable';
    const repo = await join(c);
    // A transfer failure is a state the guest retries, not an exception -- a caller
    // that cannot tell delivered from failed announces success over a failure.
    await expect(repo.photos.upload({ localUri: 'file:///tmp/a.jpg' })).resolves.toBe('failed');
    expect(c.find('insert', 'photos')).toHaveLength(0);
    expect(repo.photos.mine.get()[0]).toMatchObject({ status: 'failed', progress: null });
  });

  it('lands approved rather than pending where the tier has no moderation queue', async () => {
    const c = ready();
    c.seed('events', [eventRow({ tier: 'house_party' })]);
    const repo = await join(c);
    await expect(repo.photos.upload({ localUri: 'file:///tmp/a.jpg' })).resolves.toBe('approved');
    expect((c.find('insert', 'photos')[0]!.payload as { status: string }).status).toBe('approved');
  });

  it('retries a failed photo without minting a second one', async () => {
    const c = ready();
    c.failNextUpload = 'Network unavailable';
    const repo = await join(c);
    await repo.photos.upload({ localUri: 'file:///tmp/a.jpg' });
    const id = repo.photos.mine.get()[0]!.id;
    await repo.photos.retry(id);
    expect(repo.photos.mine.get()).toHaveLength(0);
    expect((c.find('insert', 'photos')[0]!.payload as { id: string }).id).toBe(id);
  });
});

/* ---------------------------------------------------------- channel lifecycle */

describe('realtime lifecycle', () => {
  it('SUBSCRIBES BEFORE IT SELECTS, for every table', async () => {
    // Select-then-subscribe drops every change landing in the gap -- one network round
    // trip. Invisible when quiet; a photo that appears for some guests and not others
    // when a host hits Send while phones are opening.
    const c = ready();
    await join(c);
    for (const table of ['events', 'broadcasts', 'schedule_items', 'song_requests', 'now_playing', 'folders', 'photos']) {
      const sub = c.order.indexOf(`subscribe:runit:${table}`);
      // Deliberately the select AFTER the subscribe, not the first one. joinAsGuest
      // reads `events` by code before any channel exists -- that lookup is legitimate
      // and unrelated, and an indexOf here finds it and fails a passing property.
      const sel = c.order.findIndex((e, i) => i > sub && e === `select:${table}`);
      expect(sub).toBeGreaterThanOrEqual(0);
      expect(sel).toBeGreaterThan(sub);
    }
  });

  it('removes every channel on leave, so a rejoin does not stack subscriptions', async () => {
    const c = ready();
    const repo = await join(c);
    expect(c.channels.length).toBe(7);
    await repo.session.leave();
    expect(c.channels.every((ch) => ch.removed)).toBe(true);
    expect(c.signOutCalls).toBe(1);
  });

  it('clears event state on leave rather than leaving the last event on screen', async () => {
    const c = ready();
    const repo = await join(c);
    expect(repo.event.current.get()).not.toBeNull();
    await repo.session.leave();
    expect(repo.event.current.get()).toBeNull();
    expect(repo.session.current.get()).toEqual({ kind: 'anonymous' });
  });
});

/* ------------------------------------------------- writes with no server route */

describe('writes the schema has no route for', () => {
  it('refuse loudly rather than appearing to work', async () => {
    const c = ready();
    const repo = await join(c);
    // Both would otherwise be a silent no-op, which is the failure this adapter is
    // built to avoid. hosts has no INSERT policy; events.tier is outside the grant.
    await expect(repo.hosts.invite({ displayName: 'X', role: 'dj' })).rejects.toThrow(/no INSERT policy/);
    await expect(repo.event.setTier('venue')).rejects.toThrow(/column grant/);
  });
});

/* ---------------------------------------------------------------- rewind guard */

describe('the run-of-show guard', () => {
  it('turns P0001 into a ScheduleError carrying the item id', async () => {
    const c = ready((f) => f.on((op) =>
      op.kind === 'rpc' && op.table === 'start_schedule_item' ? pgError('P0001', 'would_rewind') : undefined));
    const repo = await join(c);
    await expect(repo.schedule.start('s1')).rejects.toBeInstanceOf(ScheduleError);
    await expect(repo.schedule.start('s1')).rejects.toMatchObject({ reason: 'would_rewind', itemId: 's1' });
  });

  it('passes rewind through when the host confirms', async () => {
    const c = ready();
    const repo = await join(c);
    await repo.schedule.start('s1', { rewind: true });
    expect(c.find('rpc', 'start_schedule_item')[0]!.payload).toEqual({ p_item: 's1', p_rewind: true });
  });
});

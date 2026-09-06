import {
  FakeClient, authApiError, authOffline, pgError, refusedLoudly, refusedSilently,
} from './fixtures/fakeClient';
import { SupabaseRepository } from './SupabaseRepository';
import type { RunitClient } from './client';
import { EntitlementError, JoinError, ScheduleError } from '../repository';

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

const build = (c: FakeClient) =>
  // `appState: false` everywhere except the bridge's own tests: the listener is
  // global, so leaving it on would have each of these tests racing the last one's.
  SupabaseRepository.create(c as unknown as RunitClient, { now: () => FIXED, appState: false });

const join = async (c: FakeClient) => {
  const repo = build(c);
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
    const repo = build(c);
    const rejects = expect(repo.session.joinAsGuest({ code: 'NOPE', nickname: 'Ada' })).rejects;
    await rejects.toBeInstanceOf(JoinError);
    // The REASON, not merely the class -- and the exact sentence tests/e2e/join.spec.ts
    // pins with toHaveText, which this adapter did not pin anywhere until now.
    await expect(
      repo.session.joinAsGuest({ code: 'NOPE', nickname: 'Ada' }),
    ).rejects.toMatchObject({ reason: 'unknown_code', message: "That code doesn't match an event." });
  });

  it('turns 54023 into event_full, the reason that had no producer until #22', async () => {
    const c = new FakeClient();
    c.on((op) => (op.kind === 'rpc' && op.table === 'join_event' ? pgError('54023', 'event_full') : undefined));
    const repo = build(c);

    // `event_full` sat in JoinReason for months as copy MemoryRepository alone could
    // reach: `join_event` counted nothing, so against Supabase an eleventh guest simply
    // walked in past a cap the pricing page advertised. #22 gave the function the count;
    // this is the other half -- the SQLSTATE arriving as the sentence a guest reads.
    // Lane E proves Postgres raises 54023 (`verify-policies.sql`, "the 11th guest is
    // refused"); nothing between there and the screen was pinned until now.
    await expect(
      repo.session.joinAsGuest({ code: 'FULL01', nickname: 'Bo' }),
    ).rejects.toMatchObject({ reason: 'event_full', message: 'This event is full.' });
  });

  /**
   * THE REGRESSION THESE EXIST FOR.
   *
   * Anonymous sign-in was disabled on the live project and build #3 could not admit a
   * single guest -- and every one of those failures rendered as "That code doesn't
   * match an event.", because line 496 mapped ANY auth error to `unknown_code`. The
   * reason and the message on that one line disagreed with each other.
   *
   * Every assertion here pins the REASON, because the reason is the thing that was
   * wrong. The branch could not be reached at all before: the fake's
   * signInAnonymously always succeeded.
   */
  it('reports a disabled provider as ours, and explicitly NOT as a bad code', async () => {
    const c = ready();
    c.failNextSignIn = authApiError('anonymous_provider_disabled', 422);
    const repo = build(c);

    await expect(
      repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' }),
    ).rejects.toMatchObject({ reason: 'session_unavailable' });

    // The negative is the actual regression test. A guest holding a correct code must
    // never be told to go and check it because our provider is switched off.
    c.failNextSignIn = authApiError('anonymous_provider_disabled', 422);
    await expect(
      repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' }),
    ).rejects.not.toThrow(/doesn't match an event/);
  });

  it('tells a rate-limited guest to wait rather than to retype', async () => {
    const c = ready();
    c.failNextSignIn = authApiError('over_request_rate_limit', 429);
    const repo = build(c);
    await expect(
      repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' }),
    ).rejects.toMatchObject({ reason: 'rate_limited' });
  });

  it('reads a dead socket off the NAME, because it carries no code at all', async () => {
    const c = ready();
    c.failNextSignIn = authOffline();
    const repo = build(c);
    // AuthRetryableFetchError is constructed with `undefined` for its code, so a
    // code-based branch would silently never match and this would read as
    // session_unavailable. This test is what holds the predicate to `name`.
    await expect(
      repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' }),
    ).rejects.toMatchObject({ reason: 'offline' });
  });

  it('reports 28000 from join_event as a lost session, not a bad code', async () => {
    // Built by hand rather than from ready(): the FIRST matching responder wins, and
    // ready() already answers join_event with a guest id.
    const c = new FakeClient();
    c.on((op) =>
      op.kind === 'rpc' && op.table === 'join_event' ? pgError('28000', 'not authenticated') : undefined,
    );
    const repo = build(c);
    await expect(
      repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' }),
    ).rejects.toMatchObject({ reason: 'session_unavailable' });
  });

  it('says why there was no session to reuse when the recovery also fails', async () => {
    const c = ready();
    const dead = { message: 'refresh_token_already_used' };
    c.sessionError = dead;
    c.failNextSignIn = authOffline();
    const repo = build(c);

    // dead session -> failed recovery, in that order, so a device log reads as the
    // sequence it actually was rather than as one unexplained failure.
    await expect(
      repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' }),
    ).rejects.toMatchObject({ reason: 'offline', cause: { cause: dead } });
  });

  it('is a bug, not a bad code, when the event cannot be read back after joining', async () => {
    // join_event returns a guest id -- so the code DID match -- and then events_read
    // returns nothing. That is a policy regression on our side, and it must not be
    // dressed up as a JoinError, because no caller can branch on "this is a bug".
    const c = ready();
    c.seed('events', []);
    const repo = build(c);
    const attempt = repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' });
    await expect(attempt).rejects.not.toBeInstanceOf(JoinError);
  });
});

describe('claiming a host seat', () => {
  const claim = (c: FakeClient, key = 'KEY') => {
    const repo = build(c);
    return repo.session.claimHost({ code: 'test01', key });
  };

  // 42501 is OVERLOADED in this schema -- start_schedule_item and play_next raise it
  // as `not_a_host`. Reading it as a bad key is sound only because this branch is
  // scoped to the claim_host call, and nothing asserted that until now.
  it('reads 42501 from claim_host as a wrong key', async () => {
    const c = ready();
    c.on((op) => (op.kind === 'rpc' && op.table === 'claim_host' ? refusedLoudly() : undefined));
    await expect(claim(c)).rejects.toMatchObject({ reason: 'bad_host_key' });
  });

  it('reports 28000 from claim_host as a lost session', async () => {
    const c = ready();
    c.on((op) =>
      op.kind === 'rpc' && op.table === 'claim_host' ? pgError('28000', 'not authenticated') : undefined,
    );
    await expect(claim(c)).rejects.toMatchObject({ reason: 'session_unavailable' });
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
    expect(c.channels.length).toBe(8);
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

  /**
   * THE ASSERTION THIS FILE MOST NEEDS.
   *
   * closeEvent() must NOT sign out. join_event is idempotent on
   * (event_id, auth_user_id), so keeping the session means a re-join returns the SAME
   * guests row. Sign out first and the new auth.uid() does not conflict -- it INSERTS:
   * the guest appears twice, their first identity is orphaned, a second seat burns
   * against the cap, and an abandoned anonymous user is left behind forever.
   *
   * No other lane can see this. MemoryRepository has no auth to sign out of, so the e2e
   * suite would show the correct behaviour while production doubled the row.
   */
  it('closeEvent keeps the identity, so a re-join lands on the SAME guest row', async () => {
    const c = ready();
    const repo = await join(c);
    const first = repo.session.current.get();

    await repo.session.closeEvent();
    expect(c.signOutCalls).toBe(0);

    await repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' });
    expect(repo.session.current.get()).toEqual(first);
    // One sign-in for the original join and none since: the second join reused the
    // session rather than minting a second anonymous user.
    expect(c.signInCalls).toBe(1);
  });

  it('still has a session after closeEvent, which is what makes the re-join idempotent', async () => {
    const c = ready();
    const repo = await join(c);
    await repo.session.closeEvent();
    // Pinned as an explicit property rather than left emergent, so a refactor that
    // reintroduces signOut() into this path fails here instead of silently doubling rows.
    const { data } = await c.auth.getSession();
    expect(data.session).not.toBeNull();
  });

  it('closeEvent removes every channel but does NOT disconnect the socket', async () => {
    // The asymmetry is the fix for a device report. connect() early-returns while
    // isDisconnecting(), so an immediate re-join -- leave, then re-enter with a host
    // key -- would subscribe against a socket that never opens. Leaving the socket up
    // means the re-join reuses it and cannot race. RealtimeClient still closes it on
    // its own once channels reach zero (disconnectOnEmptyChannelsAfterMs, which
    // client.ts inherits at 2 * HEARTBEAT_INTERVAL).
    const c = ready();
    const repo = await join(c);
    expect(c.channels.length).toBe(8);
    await repo.session.closeEvent();
    expect(c.channels.every((ch) => ch.removed)).toBe(true);
    expect(c.disconnectCalls).toBe(0);
  });
});

/* ------------------------------------------------- writes with no server route */

describe('writes the schema has no route for', () => {
  it('refuse loudly rather than appearing to work', async () => {
    const c = ready();
    const repo = await join(c);
    // `events.tier` is outside the column grant, so an update naming it fails with 42501
    // and one that did not name it would change nothing while returning success. It is
    // the last write here with no server-side route; `hosts.invite` used to be the other
    // and now goes through invite_host (#16).
    await expect(repo.event.setTier('venue')).rejects.toThrow(/column grant/);
  });
});

/* ------------------------------------------------------ inviting a co-host (#16) */

const INVITED = { host_id: 'h0000000-0000-0000-0000-000000000009', host_key: 'QRS4-TUV5-WXY6' };

describe('inviting a co-host', () => {
  it('sends the role and label under the p_ names the function declares', async () => {
    const c = ready((cl) =>
      cl.on((op) =>
        op.kind === 'rpc' && op.table === 'invite_host' ? { data: [INVITED], error: null } : undefined,
      ),
    );
    const repo = await join(c);
    await repo.hosts.invite({ displayName: 'DJ Marco', role: 'dj', roleLabel: 'DJ' });

    // PostgREST resolves overloads by argument NAME, so a typo here is not a type error,
    // it is a 404 at runtime against a function that exists.
    expect(c.find('rpc', 'invite_host')[0]!.payload).toEqual({
      p_event: EVENT,
      p_display_name: 'DJ Marco',
      p_role: 'dj',
      p_role_label: 'DJ',
    });
  });

  it('hands back the key, which exists nowhere else', async () => {
    const c = ready((cl) =>
      cl.on((op) =>
        op.kind === 'rpc' && op.table === 'invite_host' ? { data: [INVITED], error: null } : undefined,
      ),
    );
    const repo = await join(c);
    await expect(repo.hosts.invite({ displayName: 'DJ Marco', role: 'dj' })).resolves.toEqual({
      hostId: INVITED.host_id,
      hostKey: 'QRS4-TUV5-WXY6',
    });
  });

  it('sends an empty label rather than undefined, so the SQL default applies', async () => {
    const c = ready((cl) =>
      cl.on((op) =>
        op.kind === 'rpc' && op.table === 'invite_host' ? { data: [INVITED], error: null } : undefined,
      ),
    );
    const repo = await join(c);
    await repo.hosts.invite({ displayName: 'Jordan', role: 'planner' });
    // `undefined` would be omitted from the JSON body and PostgREST would fail to match
    // the four-argument overload. '' is what makes invite_host's own fallback fire.
    expect((c.find('rpc', 'invite_host')[0]!.payload as { p_role_label: string }).p_role_label).toBe('');
  });

  it('turns the cap refusal into an EntitlementError the toast can name', async () => {
    const c = ready((cl) =>
      cl.on((op) =>
        op.kind === 'rpc' && op.table === 'invite_host' ? pgError('54023', 'host_cap_reached') : undefined,
      ),
    );
    const repo = await join(c);
    // 54023 is the function's own cap refusal. Mapping it back through the domain is what
    // keeps Postgres and the app from disagreeing about what a host is told.
    await expect(repo.hosts.invite({ displayName: 'Third', role: 'host' })).rejects.toBeInstanceOf(
      EntitlementError,
    );
  });

  it('says who may invite rather than leaking a Postgres code', async () => {
    const c = ready((cl) =>
      cl.on((op) =>
        op.kind === 'rpc' && op.table === 'invite_host' ? pgError('42501', 'not_a_host') : undefined,
      ),
    );
    const repo = await join(c);
    await expect(repo.hosts.invite({ displayName: 'X', role: 'host' })).rejects.toThrow(
      /Only a host of this event can invite/,
    );
  });

  it('treats a missing row as a schema mismatch, not a silent success', async () => {
    // `returns table` gives an ARRAY; an empty one cannot happen on success. Reading
    // data?.[0] off it would hand the screen `undefined` as a co-host's only credential.
    const c = ready((cl) =>
      cl.on((op) =>
        op.kind === 'rpc' && op.table === 'invite_host' ? { data: [], error: null } : undefined,
      ),
    );
    const repo = await join(c);
    await expect(repo.hosts.invite({ displayName: 'X', role: 'host' })).rejects.toThrow(
      /schema mismatch/,
    );
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

/* ------------------------------------------------- moderation (Guideline 1.2) */

describe('reporting, against a real backend', () => {
  it('goes through the RPC, because `reports` has no INSERT policy at all', async () => {
    const c = ready();
    const repo = await join(c);
    await repo.moderation.report({
      subject: { kind: 'photo', photoId: 'p1' },
      reason: 'nudity',
      note: 'not ok',
    });
    expect(c.find('insert', 'reports')).toHaveLength(0);
    expect(c.find('rpc', 'file_report')).toHaveLength(1);
  });

  it('sends the parameter names the function declares, so a rename fails loudly here', async () => {
    // PostgREST matches RPC arguments BY NAME. A mismatch is not a type error and not a
    // 404 -- it is a function-not-found at runtime, three screens from the cause.
    const c = ready();
    const repo = await join(c);
    await repo.moderation.report({
      subject: { kind: 'song_request', requestId: 'r9' },
      reason: 'hate',
    });
    expect(c.find('rpc', 'file_report')[0]!.payload).toEqual({
      p_event_id: EVENT,
      p_kind: 'song_request',
      p_subject_id: 'r9',
      p_reason: 'hate',
      p_note: '',
    });
  });

  it('does NOT send reporter_name or subject_label, because the server derives them', async () => {
    // A client that supplies these can caption a complaint as somebody else. The whole
    // reason file_report exists is that an INSERT policy cannot check them.
    const c = ready();
    const repo = await join(c);
    await repo.moderation.report({ subject: { kind: 'guest', guestId: 'g9' }, reason: 'spam' });
    const payload = c.find('rpc', 'file_report')[0]!.payload as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('p_reporter_name');
    expect(Object.keys(payload)).not.toContain('p_subject_label');
  });

  it('treats a null return as success -- it means "already reported"', async () => {
    // ON CONFLICT DO NOTHING returns no row. Only an error is a failure.
    const c = ready((f) =>
      f.on((op) => (op.kind === 'rpc' && op.table === 'file_report' ? { data: null, error: null } : undefined)),
    );
    const repo = await join(c);
    await expect(
      repo.moderation.report({ subject: { kind: 'photo', photoId: 'p1' }, reason: 'spam' }),
    ).resolves.toBeUndefined();
  });
});

describe('resolving a report', () => {
  it('THROWS on the silent shape, because reports_host_resolve is hosts-only', async () => {
    // A guest resolving affects zero rows and raises nothing -- proven in lane E. This
    // is the same failure that assertWrote exists for on `events`.
    const c = ready((f) =>
      f.on((op) => (op.kind === 'update' && op.table === 'reports' ? refusedSilently() : undefined)),
    );
    const repo = await join(c);
    await expect(repo.moderation.resolve('rep1', 'removed')).rejects.toThrow(/affected no rows/);
  });

  it('never sends resolved_by_host_id, because it is not in the column grant', async () => {
    // `grant update (resolved_at, resolution)` -- naming any other key, even with an
    // unchanged value, fails the whole statement. The resolver is stamped by trigger
    // from auth.uid() so one host cannot sign another host's name to a decision.
    const c = ready();
    const repo = await join(c);
    await repo.moderation.resolve('rep1', 'dismissed');
    expect(c.find('update', 'reports')[0]!.payload).toEqual({
      resolved_at: FIXED,
      resolution: 'dismissed',
    });
  });
});

describe('un-pinning an announcement (#26)', () => {
  // `event.create` is the cheapest route to a HOST session -- the founder is the host
  // because she made it -- and setPinned is hosts-only in this adapter, matching `send`.
  const asHost = async (c: FakeClient) => {
    const repo = build(c);
    await repo.event.create(NEW_EVENT);
    return repo;
  };

  it('THROWS on the silent shape, because a guest UPDATE affects zero rows and raises nothing', async () => {
    // Not hypothetical and not inferred from the policy: lane E asserts exactly this
    // against the live database -- "a guest pinning affects 0 rows and raises nothing".
    // Without assertWrote the refusal reads as success and the pin springs back on the
    // next realtime frame, with nothing anywhere reporting a failure.
    const c = creatable();
    c.on((op) => (op.kind === 'update' && op.table === 'broadcasts' ? refusedSilently() : undefined));
    const repo = await asHost(c);
    await expect(repo.chat.setPinned('bc1', false)).rejects.toThrow(/affected no rows/);
  });

  it('sends exactly one column, because the grant covers exactly one', async () => {
    // `revoke update on broadcasts` + `grant update (pinned)`. Naming any other key --
    // even one whose value is unchanged -- fails the whole statement, which is what
    // stops a host silently rewriting the BODY of something guests have already read.
    const c = creatable();
    const repo = await asHost(c);
    await repo.chat.setPinned('bc1', false);

    const op = c.find('update', 'broadcasts')[0]!;
    expect(op.payload).toEqual({ pinned: false });
    expect(op.filters).toEqual([['id', 'bc1']]);
  });

  it('sends true as readily as false, and lets the SERVER fold it', async () => {
    // No client-side entitlement check on this path, deliberately. `fold_pin_to_plan`
    // folds a pin the tier cannot carry -- on INSERT **or UPDATE** -- so a free-tier
    // host's `true` returns as `false` through realtime rather than being refused. A
    // second copy of the rule here is a copy that drifts from the one in Postgres.
    const c = creatable();
    const repo = await asHost(c);
    await repo.chat.setPinned('bc1', true);
    expect(c.find('update', 'broadcasts')[0]!.payload).toEqual({ pinned: true });
  });
});

describe('opening a photo full size (#38)', () => {
  it('signs the FULL-SIZE key, not the thumbnail', async () => {
    // The whole economy of #10 rests on this split: tiles render 400px copies, and the
    // 1600px original is signed only when somebody chooses to look at one.
    const c = ready((f) =>
      f.seed('photos', [
        { id: 'ph1', event_id: EVENT, folder_id: FOLDER, uploaded_by_guest_id: GUEST,
          uploaded_by_name: 'Ada', status: 'approved', hue: 10,
          storage_path: 'e1/ph1.jpg', thumb_path: 'e1/ph1_t.jpg',
          created_at: FIXED },
      ]),
    );
    const repo = await join(c);
    const url = await repo.photos.fullUrl('ph1');

    const signed = c.find('sign', 'event-photos');
    const paths = signed.flatMap((op) => (op.payload as { paths: string[] }).paths);
    expect(paths).toContain('e1/ph1.jpg');
    expect(url).toContain('e1/ph1.jpg');
  });

  it('hands back nothing for a seeded row with no bytes anywhere', async () => {
    const c = ready((f) =>
      f.seed('photos', [
        { id: 'ph2', event_id: EVENT, folder_id: FOLDER, uploaded_by_guest_id: null,
          uploaded_by_name: 'Seed', status: 'approved', hue: 20,
          storage_path: null, thumb_path: null, created_at: FIXED },
      ]),
    );
    const repo = await join(c);
    // The hue tile is its permanent rendering, and a viewer opened on it shows that.
    expect(await repo.photos.fullUrl('ph2')).toBeNull();
  });
});

describe('holding a host seat (#29)', () => {
  /**
   * `RoleSwitch` was drawn for every guest, and against this adapter its only possible
   * outcome for them is a refusal -- `becomeHost` matches `hosts.auth_user_id = auth.uid()`,
   * so a role is not something a picker can grant. The screen now asks before drawing it.
   *
   * NOTE WHAT LANE B CANNOT SEE: all 208 journeys boot `MemoryRepository`, where this is
   * hard-coded true so the screenshot harness can reach the host artboards at all. So the
   * HIDING is provable only here.
   */
  it('is false for a plain guest, so the control is not drawn for them', async () => {
    const c = ready();
    c.on((op) => (op.kind === 'rpc' && op.table === 'is_host' ? { data: false, error: null } : undefined));
    const repo = await join(c);
    expect(repo.session.holdsHostSeat.get()).toBe(false);
  });

  it('is true once a seat is held, and SURVIVES switching to the guest view', async () => {
    // The whole reason this is not `session.current.kind`. A host looking at the guest
    // side reads `kind: 'guest'` and still holds her seat -- she must keep the way back.
    const c = creatable();
    const repo = build(c);
    await repo.event.create(NEW_EVENT);
    expect(repo.session.holdsHostSeat.get()).toBe(true);
    expect(repo.session.current.get().kind).toBe('host');
  });

  it('treats a failed is_host as NOT holding a seat', async () => {
    // The safe unknown hides a control rather than offering one that refuses.
    const c = ready();
    c.on((op) => (op.kind === 'rpc' && op.table === 'is_host' ? refusedLoudly() : undefined));
    const repo = await join(c);
    expect(repo.session.holdsHostSeat.get()).toBe(false);
  });

  it('drops the seat when the event closes, because it belonged to that event', async () => {
    const c = creatable();
    const repo = build(c);
    await repo.event.create(NEW_EVENT);
    await repo.session.closeEvent();
    expect(repo.session.holdsHostSeat.get()).toBe(false);
  });
});

describe('changing your own name (#43)', () => {
  const renameable = () => {
    const c = ready();
    c.on((op) =>
      op.kind === 'rpc' && op.table === 'set_nickname' ? { data: 'Wren', error: null } : undefined,
    );
    return c;
  };

  it('sends the event and the name under the p_ names the RPC expects', async () => {
    const c = renameable();
    const repo = await join(c);
    await repo.session.setNickname('  Wren  ');

    // PostgREST resolves overloads by ARGUMENT NAME, so a typo here is not a type error,
    // it is a 404 against a function that exists. Nothing else checks these.
    expect(c.find('rpc', 'set_nickname')[0]!.payload).toEqual({
      p_event: EVENT,
      p_nickname: '  Wren  ',
    });
  });

  it('takes the name the SERVER stored, not the one it sent', async () => {
    const c = renameable();
    const repo = await join(c);

    // The fake returns 'Wren' for an input of '  Wren  ', which is what `set_nickname`
    // does -- it trims, caps at 40, and returns the result. A client that echoed its own
    // input would put a name in the header that the room is not seeing.
    expect(await repo.session.setNickname('  Wren  ')).toBe('Wren');
    expect(repo.session.current.get()).toMatchObject({ kind: 'guest', nickname: 'Wren' });
  });

  it('refuses before the round trip when there is no guest row to rename', async () => {
    const c = creatable();
    const repo = build(c);
    await repo.event.create(NEW_EVENT);

    // A founder holds a host seat and no `guests` row. `set_nickname` raises 42501 for the
    // same case; this is the client half of that statement, not a substitute for it -- and
    // it means no request goes out to be refused.
    await expect(repo.session.setNickname('Ruthie')).rejects.toThrow(/Not joined as a guest/);
    expect(c.find('rpc', 'set_nickname')).toHaveLength(0);
  });

  it('re-reads the event, because no realtime frame is coming for guests', async () => {
    const c = renameable();
    const repo = await join(c);
    const before = c.find('select', 'hosts').length;
    await repo.session.setNickname('Wren');

    // `guests` is not in the realtime publication and has no SELECT policy, so nothing
    // pushes the change back. The denormalised copies on song_requests and photos DO
    // publish, but a rename whose effect is invisible until the next unrelated change
    // reads as a rename that failed.
    expect(c.find('select', 'hosts').length).toBeGreaterThan(before);
  });
});

describe('marking an announcement read (#24)', () => {
  const B1 = 'b0000000-0000-0000-0000-000000000001' as never;
  const B2 = 'b0000000-0000-0000-0000-000000000002' as never;

  /** A plain guest: joined, holds no host seat. */
  const asGuest = async () => {
    const c = ready();
    c.on((op) => (op.kind === 'rpc' && op.table === 'is_host' ? { data: false, error: null } : undefined));
    return { c, repo: await join(c) };
  };

  it('writes one row per announcement, carrying the reader', async () => {
    const { c, repo } = await asGuest();
    await repo.chat.markRead([B1, B2]);

    // ONE INSERT, NOT TWO. The caller is a scroll handler and a screenful arrives at
    // once; a request per bubble is what makes this feature expensive on a venue's wifi.
    const writes = c.find('insert', 'broadcast_reads');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.payload).toEqual([
      { broadcast_id: B1, guest_id: GUEST },
      { broadcast_id: B2, guest_id: GUEST },
    ]);
  });

  it('sends nothing the second time, because the sweep runs on every frame', async () => {
    const { c, repo } = await asGuest();
    await repo.chat.markRead([B1]);
    await repo.chat.markRead([B1, B2]);

    // The second call carries B1 again -- the screen re-sweeps whatever is on screen --
    // and only B2 should reach the wire. The database would absorb the rest as 23505,
    // which is precisely why this has to be asserted here rather than assumed there.
    const writes = c.find('insert', 'broadcast_reads');
    expect(writes).toHaveLength(2);
    expect(writes[1]!.payload).toEqual([{ broadcast_id: B2, guest_id: GUEST }]);
  });

  it('does not count a host reading her own announcement', async () => {
    const c = creatable();
    const repo = build(c);
    await repo.event.create(NEW_EVENT);
    await repo.session.becomeGuest();
    await repo.chat.markRead([B1]);

    // She has a guest seat now (#37), so `myGuestId` alone would let this through.
    // `fold_seen_count` excludes a seat held by a host of the event, so the row would be
    // stored and then not counted -- and "seen by 1" the moment its author looks at it is
    // a number the host would believe.
    expect(c.find('insert', 'broadcast_reads')).toHaveLength(0);
  });

  it('swallows a duplicate, which is the desired state arriving twice', async () => {
    const c = ready();
    c.on((op) => (op.kind === 'rpc' && op.table === 'is_host' ? { data: false, error: null } : undefined));
    c.on((op) => (op.kind === 'insert' && op.table === 'broadcast_reads' ? pgError('23505', 'duplicate key') : undefined));
    const repo = await join(c);

    // The composite primary key (broadcast_id, guest_id) already says a read exists at
    // most once. Same shape as song_votes and blocks.
    await expect(repo.chat.markRead([B1])).resolves.toBeUndefined();
  });

  it('forgets the mark when the write really fails, so the next sweep retries', async () => {
    const c = ready();
    c.on((op) => (op.kind === 'rpc' && op.table === 'is_host' ? { data: false, error: null } : undefined));
    let fail = true;
    c.on((op) => {
      if (op.kind !== 'insert' || op.table !== 'broadcast_reads') return undefined;
      if (!fail) return undefined;
      fail = false;
      return refusedLoudly();
    });
    const repo = await join(c);

    await expect(repo.chat.markRead([B1])).rejects.toBeDefined();
    // Without the un-mark, an announcement whose first write lost the network is "seen by
    // 0" for the rest of the night, and nothing anywhere retries it.
    await repo.chat.markRead([B1]);
    expect(c.find('insert', 'broadcast_reads')).toHaveLength(2);
  });
});

describe('registering for push (#27)', () => {
  const asHost = async (c: FakeClient) => {
    const repo = build(c);
    await repo.event.create(NEW_EVENT);
    return repo;
  };

  it('goes through the RPC, never through an UPDATE on guests', async () => {
    // NOT a stylistic preference. `guests` has no SELECT policy, and Postgres applies
    // SELECT policies to the rows an `UPDATE ... WHERE` must read to evaluate its WHERE.
    // PostgREST always emits a WHERE, so a direct update matches ZERO ROWS and raises
    // NOTHING -- on every device, forever (#36).
    const c = creatable();
    const repo = await asHost(c);
    await repo.session.setPushToken('ExponentPushToken[xxx]');

    expect(c.find('rpc', 'set_push_token')).toHaveLength(1);
    // The assertion that would have caught the original design.
    expect(c.find('update', 'guests')).toHaveLength(0);
  });

  it('sends the event id, because a token is scoped to one seat', async () => {
    // A person at two events has two guest rows. A token that was not scoped would let
    // revoking at one party silence the other.
    const c = creatable();
    const repo = await asHost(c);
    await repo.session.setPushToken('ExponentPushToken[xxx]');
    expect(c.find('rpc', 'set_push_token')[0]!.payload).toEqual({
      p_event: EVENT,
      p_token: 'ExponentPushToken[xxx]',
    });
  });

  it("sends '' rather than null to clear, because the RPC normalises it", async () => {
    // Postgres does not express argument nullability, so the generated type is `string`.
    // `set_push_token` turns '' into NULL with nullif(btrim(coalesce(...))). Casting to
    // sneak a null past the type would describe the schema wrongly to save a character.
    const c = creatable();
    const repo = await asHost(c);
    await repo.session.setPushToken(null);
    expect(c.find('rpc', 'set_push_token')[0]!.payload).toMatchObject({ p_token: '' });
  });

  it('does not throw when registration fails, because push is a courtesy', async () => {
    // The guest never asked for this call. A failed registration must not take down the
    // screen that made it -- the app is completely usable without notifications.
    const c = creatable();
    c.on((op) => (op.kind === 'rpc' && op.table === 'set_push_token' ? refusedLoudly() : undefined));
    const repo = await asHost(c);
    await expect(repo.session.setPushToken('ExponentPushToken[xxx]')).resolves.toBeUndefined();
  });

  it('does nothing at all when there is no event open', async () => {
    // Registration runs on open, and a host who has not opened an event yet is a real
    // state. There is nothing to scope a token to, so there is nothing to send.
    const c = ready();
    const repo = build(c);
    await repo.session.setPushToken('ExponentPushToken[xxx]');
    expect(c.find('rpc', 'set_push_token')).toHaveLength(0);
  });
});

describe('blocking, against a real backend', () => {
  it('re-reads the blocks after a write rather than patching a local set', async () => {
    // song_votes taught this lesson the hard way: a local set with no realtime feed
    // behind it drifts from the table and nothing ever corrects it. `guest_blocks` is
    // deliberately not published, so the reload IS the correction.
    const c = ready();
    const repo = await join(c);
    const before = c.find('select', 'guest_blocks').length;
    await repo.moderation.block('g9');
    expect(c.find('select', 'guest_blocks').length).toBeGreaterThan(before);
  });

  it('scopes the unblock to this guest, so one guest cannot clear another list', async () => {
    const c = ready();
    const repo = await join(c);
    await repo.moderation.unblock('g9');
    const op = c.find('delete', 'guest_blocks')[0]!;
    expect(op.filters).toEqual(
      expect.arrayContaining([
        ['blocker_guest_id', GUEST],
        ['blocked_guest_id', 'g9'],
      ]),
    );
  });

  it('drops the blocks on leave, so they do not follow you into the next event', async () => {
    const c = ready();
    const repo = await join(c);
    await repo.moderation.block('g9');
    await repo.session.leave();
    expect(repo.moderation.blocked.get()).toEqual([]);
  });
});


/* --------------------------------------------- realtime lifecycle: the quota bug */

/**
 * WHY THESE EXIST. Joining opens eight channels and nothing ever closed them:
 * `session.leave()` is the only teardown in the codebase and has zero production
 * call sites, and there was no AppState wiring at all. An installed app that had
 * joined once kept a socket heartbeating every 25s and a token ticker every 30s for
 * the life of the install -- roughly 104,000 frames a month per device, from a guest
 * doing nothing. The cost scaled with INSTALLS, not with use, which is why handing
 * out beta builds moved the meter.
 *
 * The asymmetry that makes it subtle: `removeChannel()` unsubscribes ONE channel and
 * leaves the socket open. Only `realtime.disconnect()` closes it, so closing all
 * eight is not the same as stopping.
 */
describe('realtime lifecycle', () => {
  const live = (c: FakeClient) => c.channels.filter((ch) => ch.subscribed && !ch.removed);
  const stillRegistered = (c: FakeClient) => c.channels.filter((ch) => !ch.removed);

  it('a join opens eight channels and leaves none orphaned', async () => {
    const c = ready();
    await join(c);
    expect(live(c)).toHaveLength(8);
    expect(stillRegistered(c)).toHaveLength(8);
  });

  it('one dead channel does not sink the join, and is still removed', async () => {
    // supabase-js rejoins a channel that is still registered on its own backoff --
    // 1s, 2s, 5s, then every 10s for the life of the process -- so the dead one must
    // still go. What CHANGED is that the other seven stay, and the join succeeds:
    // failing the whole join over one table left a host staring at zero guests with
    // Show QR and Share invite inert, because both are `disabled={!event}`.
    const c = ready();
    c.failSubscribeFor.add('runit:photos');
    const repo = build(c);

    await repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' });

    // The event loaded despite the failure. This is the assertion the device report bought.
    expect(repo.event.current.get()).not.toBeNull();
    // Seven live, and the eighth torn down rather than left rejoining forever.
    expect(live(c)).toHaveLength(7);
    expect(stillRegistered(c)).toHaveLength(7);
  });

  it('a second join does not stack another eight channels', async () => {
    // Each attempt used to add eight more forever-rejoining channels. The guard now
    // lives in startTables(), which stops before it starts -- because the assignments
    // there REPLACE the eight fields, and a replaced RealtimeTable takes its still
    // registered channel with it.
    //
    // The fake fails only the NEXT subscribe, so photos joins on the retry and eight is
    // the right answer. Sixteen would be the bug.
    const c = ready();
    c.failSubscribeFor.add('runit:photos');
    const repo = build(c);
    await repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' });
    await repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' });
    expect(live(c)).toHaveLength(8);
    expect(stillRegistered(c)).toHaveLength(8);
  });

  it('suspend closes every channel AND the socket, and stops the token ticker', async () => {
    const c = ready();
    const repo = build(c);
    await repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' });
    await repo.suspend();

    expect(live(c)).toHaveLength(0);
    // The assertion that actually matters. Without it this test passes on an adapter
    // that closes all eight channels and keeps heartbeating.
    expect(c.disconnectCalls).toBe(1);
    expect(c.autoRefreshCalls).toEqual(['stop']);
  });

  it('suspend KEEPS the rows, so resume does not flash an empty screen', async () => {
    const c = ready((f) => f.seed('broadcasts', [{
      id: 'b1', event_id: EVENT, author_host_id: null, author_name: 'DJ',
      author_role_label: 'Host', kind: 'announcement', body: 'Cake at nine',
      pinned: false, created_at: FIXED,
    }]));
    const repo = build(c);
    await repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' });
    const before = repo.chat.feed.get();
    expect(before).toHaveLength(1);

    await repo.suspend();
    // `stop()` clears rows because it ends a session; pausing must not.
    expect(repo.chat.feed.get()).toEqual(before);
  });

  it('resume re-subscribes and restarts the ticker', async () => {
    const c = ready();
    const repo = build(c);
    await repo.session.joinAsGuest({ code: 'test01', nickname: 'Ada' });
    await repo.suspend();
    await repo.resume();

    expect(live(c)).toHaveLength(8);
    expect(c.autoRefreshCalls).toEqual(['stop', 'start']);
  });

  it('resume before any join opens nothing', async () => {
    // Backgrounding on the join screen must not subscribe to an event that does not
    // exist yet -- there is no event id to filter on.
    const c = ready();
    const repo = build(c);
    await repo.resume();
    expect(c.channels).toHaveLength(0);
    expect(c.autoRefreshCalls).toEqual(['start']);
  });

  it('leave closes the socket, not merely the channels', async () => {
    const c = ready();
    const repo = await join(c);
    await repo.session.leave();
    expect(live(c)).toHaveLength(0);
    expect(c.disconnectCalls).toBe(1);
  });
});

describe('entitlements', () => {
  it('does not re-emit when nothing it derives from changed', async () => {
    // The one Signal in the adapter with no comparator. computeEntitlements() returns
    // a fresh literal every call, so the default Object.is never matched and every
    // realtime message on any of the eight tables re-rendered every consumer.
    const c = ready();
    const repo = await join(c);
    const before = repo.entitlements.get();

    const chat = c.channels.find((ch) => ch.name === 'runit:broadcasts');
    expect(chat).toBeDefined();
    chat!.emit({
      eventType: 'INSERT',
      new: {
        id: 'b2', event_id: EVENT, author_host_id: null, author_name: 'DJ',
        author_role_label: 'Host', kind: 'announcement', body: 'One more song',
        pinned: false, created_at: FIXED,
      },
    });

    // The chat feed moved; entitlements did not, and holds the SAME reference.
    expect(repo.chat.feed.get()).toHaveLength(1);
    expect(repo.entitlements.get()).toBe(before);
  });

  it('does re-emit when usage actually changes — the control', async () => {
    const c = ready();
    const repo = await join(c);
    const before = repo.entitlements.get();

    const photos = c.channels.find((ch) => ch.name === 'runit:photos');
    photos!.emit({
      eventType: 'INSERT',
      new: {
        id: 'p9', event_id: EVENT, folder_id: FOLDER, guest_id: GUEST,
        storage_path: 'x.jpg', status: 'pending', created_at: FIXED,
      },
    });

    expect(repo.entitlements.get()).not.toBe(before);
    expect(repo.entitlements.get().usage.photosStored).toBe(before.usage.photosStored + 1);
  });
});

/* -------------------------------------------------- creating an event (#13, #32) */

const CREATED = {
  event_id: EVENT,
  code: 'JT32SU',
  host_id: 'h0000000-0000-0000-0000-000000000001',
  host_key: 'DUBT-87MS-Q5UQ',
};

const hostRow = {
  id: CREATED.host_id, event_id: EVENT, display_name: 'Ruth',
  role: 'host', role_label: 'Host', auth_user_id: 'u1', created_at: FIXED,
};

/**
 * A client that can answer create_event and then read the event back.
 *
 * `first` is registered BEFORE the success responder because the first responder to
 * return a Result wins -- layering a refusal on afterwards would be silently ignored,
 * and the test would pass while asserting nothing.
 */
function creatable(first?: (op: { kind: string; table: string }) => unknown) {
  const c = new FakeClient();
  c.seed('events', [eventRow()]).seed('hosts', [hostRow]).seed('song_votes', []);
  if (first) c.on(first as never);
  c.on((op) =>
    op.kind === 'rpc' && op.table === 'create_event' ? { data: [CREATED], error: null } : undefined,
  );
  return c;
}

const NEW_EVENT = {
  name: "Ruth's 40th", venue: 'The garden', startsAt: FIXED,
  timezone: 'America/New_York', doorsLabel: 'Doors 7:00 PM', hostName: 'Ruth',
};

describe('creating an event', () => {
  it('sends every field the RPC takes, under the p_ names it expects', async () => {
    const c = creatable();
    await build(c).event.create(NEW_EVENT);

    // The argument NAMES are the contract with Postgres and nothing else checks them:
    // PostgREST resolves overloads by argument name, so a typo here is not a type
    // error, it is a 404 at runtime against a function that exists.
    expect(c.find('rpc', 'create_event')[0]!.payload).toEqual({
      p_name: "Ruth's 40th",
      p_starts_at: FIXED,
      p_timezone: 'America/New_York',
      p_venue: 'The garden',
      p_doors_label: 'Doors 7:00 PM',
      p_host_name: 'Ruth',
    });
  });

  it('returns the code and the key, which exist nowhere else', async () => {
    const made = await build(creatable()).event.create(NEW_EVENT);
    expect(made).toEqual({ code: 'JT32SU', hostKey: 'DUBT-87MS-Q5UQ' });
  });

  it('leaves the creator in a HOST session, so there is nothing to claim afterwards', async () => {
    const repo = build(creatable());
    await repo.event.create(NEW_EVENT);

    // The whole point of #13: she is the host because she made it. A guest session here
    // would send her to the join screen holding a code for her own party.
    expect(repo.session.current.get()).toMatchObject({
      kind: 'host', hostId: CREATED.host_id, displayName: 'Ruth',
    });
    expect(repo.event.current.get()).toMatchObject({ id: EVENT });
  });

  it('signs in first, because create_event is granted to authenticated and to nobody else', async () => {
    const c = creatable();
    await build(c).event.create(NEW_EVENT);
    expect(c.signInCalls).toBe(1);
  });

  it('names the limit rather than reporting a raw Postgres error', async () => {
    const c = creatable((op) =>
      op.kind === 'rpc' && op.table === 'create_event' ? pgError('54023', 'too_many_events') : undefined,
    );
    await expect(build(c).event.create(NEW_EVENT)).rejects.toThrow(/Ten is the limit/);
  });

  it('treats a missing row as a schema mismatch, not as a silent success', async () => {
    // `returns table` gives an ARRAY. An empty one cannot happen on success, so it means
    // the function signature moved -- and reading data?.[0] off it would hand the screen
    // `undefined` to show a host as her only way back into her own event.
    const c = creatable((op) =>
      op.kind === 'rpc' && op.table === 'create_event' ? { data: [], error: null } : undefined,
    );
    await expect(build(c).event.create(NEW_EVENT)).rejects.toThrow(/schema mismatch/);
  });
});

describe('a founder leaving her own console (#37)', () => {
  /** creatable(), plus the join_event the switch now makes. */
  const withSeat = (guest = 'g0000000-0000-0000-0000-0000000000aa') =>
    creatable((op) =>
      op.kind === 'rpc' && op.table === 'join_event' ? { data: guest, error: null } : undefined,
    );

  it('takes a guest seat, because create_event never gave her one', async () => {
    const c = withSeat();
    const repo = build(c);
    await repo.event.create(NEW_EVENT);
    await repo.session.becomeGuest();

    // THE BUG THIS REPLACES: `becomeGuest` opened with `requireGuest()`, which throws on
    // a null guest id -- and a founder's is always null. The console's only non-segment
    // control is this one, so she was stranded, and the catch-all told the host that the
    // host console belongs to the host.
    //
    // The code comes from the EVENT, not from create's return value: the two agree in
    // production and deliberately disagree in this fixture, so the assertion says which
    // one the adapter actually reads.
    expect(c.find('rpc', 'join_event')[0]!.payload).toEqual({
      p_code: 'TEST01',
      p_nickname: 'Ruth',
    });
  });

  it('carries her host name onto the floor rather than arriving nameless', async () => {
    const repo = build(withSeat());
    await repo.event.create(NEW_EVENT);
    await repo.session.becomeGuest();

    // A blank nickname would be the one identity in the room with no name on it, and
    // `join_event` upserts it -- so this is what her song request is signed with.
    expect(repo.session.current.get()).toEqual({
      kind: 'guest',
      guestId: 'g0000000-0000-0000-0000-0000000000aa',
      nickname: 'Ruth',
    });
  });

  it('does not mint a second seat for someone who already has one', async () => {
    // A CO-HOST, which is the other way into this control: she joined as a guest first,
    // then claimed a seat. She already has a guest row, so the switch must not join again.
    const c = ready((cl) => cl.seed('hosts', [hostRow]));
    const repo = await join(c);
    await repo.session.becomeHost(CREATED.host_id);
    await repo.session.becomeGuest();

    // `join_event` is idempotent on (event_id, auth_user_id), so a second call would be
    // harmless -- and a request per role switch, for a row that is already there. The
    // guard is `myGuestId === null`, and this is what proves it is the guard rather
    // than a comment.
    expect(c.find('rpc', 'join_event')).toHaveLength(1);
  });

  it('does not lose the host seat on the way to the guest side', async () => {
    const repo = build(withSeat());
    await repo.event.create(NEW_EVENT);
    await repo.session.becomeGuest();

    // `becomeGuest` calls `loadFetchOnce`, which re-derives this from `is_host`. On the
    // guest screen `RoleSwitch` is drawn only for someone holding a seat (#29), so a
    // transient failure there would leave her on the guest side with no way back -- #37
    // pointing the other way. Caught by the fixture, not by reasoning: the FakeClient's
    // default rpc reply is not `true`, and this test failed before the flag was pinned.
    expect(repo.session.holdsHostSeat.get()).toBe(true);
  });

  it('keeps her seat when she goes back and forth', async () => {
    const c = withSeat();
    const repo = build(c);
    await repo.event.create(NEW_EVENT);
    await repo.session.becomeGuest();
    await repo.session.becomeHost(CREATED.host_id);
    await repo.session.becomeGuest();

    // Two trips to the floor, one seat. A second join here would be the shape that
    // burns a seat against the cap every time a host looks at her own party.
    expect(c.find('rpc', 'join_event')).toHaveLength(1);
    expect(repo.session.current.get()).toMatchObject({ kind: 'guest', nickname: 'Ruth' });
  });
});

describe('rotating the host key', () => {
  it('asks for a new key for the open event and hands back the plaintext', async () => {
    const c = creatable((op) =>
      op.kind === 'rpc' && op.table === 'rotate_host_key' ? { data: 'SPP9-4PN8-YSGN', error: null } : undefined,
    );
    const repo = build(c);
    await repo.event.create(NEW_EVENT);

    await expect(repo.event.rotateHostKey()).resolves.toBe('SPP9-4PN8-YSGN');
    expect(c.find('rpc', 'rotate_host_key')[0]!.payload).toEqual({ p_event: EVENT });
  });

  it('reads 42501 as "not a host here" rather than letting it surface raw', async () => {
    const c = creatable((op) =>
      op.kind === 'rpc' && op.table === 'rotate_host_key' ? pgError('42501', 'not_a_host') : undefined,
    );
    const repo = build(c);
    await repo.event.create(NEW_EVENT);
    await expect(repo.event.rotateHostKey()).rejects.toThrow(/Only a host of this event/);
  });
});

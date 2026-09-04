import * as Crypto from 'expo-crypto';
import type { PostgrestError } from '@supabase/supabase-js';

import { supabase, type RunitClient } from './client';
import type { Row } from './database.types';
import {
  broadcastCache, folderCache, hostCache, photoCache, requestCache, scheduleCache,
  toBroadcast, toEvent, toFolder, toHost, toNowPlaying, toPhoto, toScheduleItem, toSongRequest,
} from './mappers';
import { RealtimeTable } from './RealtimeTable';
import { Signal, setEqual, shallowArrayEqual } from './signal';
import { UploadOverlay } from './UploadOverlay';
import {
  EntitlementError, JoinError, ScheduleError,
  type Observable, type RunitRepository, type UploadOutcome,
} from '../repository';
import type {
  Broadcast, Folder, FolderId, Host, HostRole, NowPlaying, Photo, PhotoId, RunitEvent,
  ScheduleItem, ScheduleItemId, Session, SongRequest, SongRequestId,
} from '../types';
import { checkFeature, checkLimit, type Entitlements } from '@/domain/entitlements';
import { TIERS } from '@/domain/tiers';

/**
 * The Supabase adapter.
 *
 * Every derivation below is ported from MemoryRepository.recompute() rather than
 * re-derived, INCLUDING ITS SORT TIEBREAKERS, because the two implementations are
 * meant to be indistinguishable from a screen's point of view. A different order
 * between adapters is a visible difference with no cause a reader could find.
 *
 * THREE STRUCTURAL DIFFERENCES from the in-memory adapter, all forced by RLS
 * rather than chosen:
 *
 * 1. **There is no event until you have joined one.** `events` has no policy that
 *    admits a non-member, so `event.current` is null before `joinAsGuest`. The
 *    in-memory adapter seeds an event, which is why the join screen can pre-fill a
 *    code and show "N already here". Against a real backend it cannot -- and the
 *    pre-filled code was always a stand-in for the QR scan anyway.
 *
 * 2. **An uploading photo has no database row.** `photos_moderate` is hosts-only
 *    and there is no other UPDATE policy, so a guest cannot patch `storage_path`
 *    in afterwards -- it has to be in the INSERT, which cannot happen until the
 *    bytes have landed. `uploading` and `failed` therefore live entirely in
 *    UploadOverlay, as genuinely synthetic rows.
 *
 * 3. **Some writes are refused rather than performed.** `hosts` has no INSERT
 *    policy and `events.tier` is not in the column grant, so `hosts.invite` and
 *    `event.setTier` THROW. They do not quietly succeed. A denied write affects
 *    zero rows and raises nothing, so a method that shrugged would be the exact
 *    silent failure this adapter is trying not to have.
 */

/** PostgREST surfaces the SQLSTATE in `code`. Discriminate on it, never on the message. */
const isPgError = (e: unknown): e is PostgrestError =>
  typeof e === 'object' && e !== null && 'code' in e;

const byVotesDesc = (a: SongRequest, b: SongRequest) =>
  b.voteCount - a.voteCount || a.createdAt.localeCompare(b.createdAt);
const byNewestFirst = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);

export class SupabaseRepository implements RunitRepository {
  private readonly db: RunitClient;

  private eventId: string | null = null;
  private myGuestId: string | null = null;

  private readonly overlay = new UploadOverlay();
  private votes = new Set<SongRequestId>();
  private hostRows: Host[] = [];

  /* Realtime-backed tables. Created on join, because every filter needs an event id. */
  private tEvents: RealtimeTable<'events'> | null = null;
  private tBroadcasts: RealtimeTable<'broadcasts'> | null = null;
  private tSchedule: RealtimeTable<'schedule_items'> | null = null;
  private tRequests: RealtimeTable<'song_requests'> | null = null;
  private tNowPlaying: RealtimeTable<'now_playing'> | null = null;
  private tFolders: RealtimeTable<'folders'> | null = null;
  private tPhotos: RealtimeTable<'photos'> | null = null;

  /* Row identity caches -- these are what let shallowArrayEqual ever return true. */
  private cBroadcasts = broadcastCache();
  private cSchedule = scheduleCache();
  private cRequests = requestCache();
  private cFolders = folderCache();
  private cPhotos = photoCache();
  private cHosts = hostCache();

  private readonly sigSession = new Signal<Session>({ kind: 'anonymous' });
  private readonly sigEvent = new Signal<RunitEvent | null>(null, (a, b) =>
    a === b ||
    (a !== null && b !== null &&
      a.id === b.id && a.code === b.code && a.name === b.name && a.venue === b.venue &&
      a.startsAt === b.startsAt && a.timezone === b.timezone && a.doorsLabel === b.doorsLabel &&
      a.tier === b.tier && a.activeFolderId === b.activeFolderId &&
      a.nowScheduleItemId === b.nowScheduleItemId && a.guestCount === b.guestCount &&
      a.invitedCount === b.invitedCount),
  );
  private readonly sigFeed = new Signal<Broadcast[]>([], shallowArrayEqual);
  private readonly sigSchedule = new Signal<ScheduleItem[]>([], shallowArrayEqual);
  private readonly sigQueue = new Signal<SongRequest[]>([], shallowArrayEqual);
  private readonly sigIncoming = new Signal<SongRequest[]>([], shallowArrayEqual);
  private readonly sigAccepted = new Signal<SongRequest[]>([], shallowArrayEqual);
  private readonly sigNowPlaying = new Signal<NowPlaying | null>(null, (a, b) =>
    a === b ||
    (a !== null && b !== null &&
      a.title === b.title && a.artist === b.artist &&
      a.fromRequestId === b.fromRequestId && a.startedAt === b.startedAt),
  );
  private readonly sigMyVotes = new Signal<ReadonlySet<SongRequestId>>(new Set(), setEqual);
  private readonly sigEntitlements: Signal<Entitlements>;
  private readonly sigFolders = new Signal<Folder[]>([], shallowArrayEqual);
  private readonly sigPending = new Signal<Photo[]>([], shallowArrayEqual);
  private readonly sigApproved = new Signal<Photo[]>([], shallowArrayEqual);
  private readonly sigMine = new Signal<Photo[]>([], shallowArrayEqual);
  private readonly sigHosts = new Signal<{ id: string; displayName: string; role: HostRole }[]>(
    [], shallowArrayEqual,
  );

  private constructor(db: RunitClient, private readonly now: () => string) {
    this.db = db;
    this.sigEntitlements = new Signal<Entitlements>(this.computeEntitlements());

    // The interface exposes Observables; the implementation holds Signals. Wiring
    // them here rather than in the field initialisers keeps each group's shape
    // readable above, and matches how MemoryRepository does it.
    this.session.current = this.sigSession;
    this.event.current = this.sigEvent;
    this.chat.feed = this.sigFeed;
    this.schedule.items = this.sigSchedule;
    this.music.queue = this.sigQueue;
    this.music.incoming = this.sigIncoming;
    this.music.accepted = this.sigAccepted;
    this.music.nowPlaying = this.sigNowPlaying;
    this.music.myVotes = this.sigMyVotes;
    this.entitlements = this.sigEntitlements;
    this.photos.folders = this.sigFolders;
    this.photos.pending = this.sigPending;
    this.photos.approved = this.sigApproved;
    this.photos.mine = this.sigMine;
    this.hosts.all = this.sigHosts;
  }

  /**
   * `now` is injectable for the same reason MemoryRepository.create takes one: every
   * ordering assertion in the suite depends on deterministic timestamps, and the
   * upload overlay stamps createdAt itself because an in-flight photo has no row for
   * the database to stamp. Without this seam those rows are untestable, and anyone
   * forking this as a template inherits that gap.
   */
  static create(
    db: RunitClient = supabase(),
    opts: { now?: () => string } = {},
  ): SupabaseRepository {
    // Synchronous on purpose: src/app/_layout.tsx builds this inside useMemo, and
    // the real work starts at joinAsGuest, which is the first moment there is an
    // event to subscribe to.
    return new SupabaseRepository(db, opts.now ?? (() => new Date().toISOString()));
  }

  /* ------------------------------------------------------------- derivations */

  private currentEvent(): RunitEvent | null {
    const rows = this.tEvents?.all() ?? [];
    return rows.length > 0 ? toEvent(rows[0]!) : null;
  }

  private computeEntitlements(): Entitlements {
    const ev = this.currentEvent();
    const tier = TIERS[ev?.tier ?? 'house_party'];
    const photoRows = this.tPhotos?.all() ?? [];
    return {
      tier,
      usage: {
        guests: ev?.guestCount ?? 0,
        hosts: this.hostRows.length,
        // Matches MemoryRepository: pending + uploading. In-flight uploads have no
        // row here, so the overlay's size is that half of the count.
        photosStored: photoRows.filter((p) => p.status === 'pending').length + this.overlay.size,
        folders: this.tFolders?.all().length ?? 0,
      },
    };
  }

  /**
   * The single fan-out, mirroring MemoryRepository.recompute() including every
   * sort tiebreaker. Signal.set keeps the previous reference when a derivation is
   * unchanged, so a photo insert does not re-render the music tab.
   */
  private recompute = (): void => {
    this.sigEntitlements.set(this.computeEntitlements());
    this.sigEvent.set(this.currentEvent());

    // Pinned first, then oldest-to-newest -- chat order, new messages at the bottom.
    this.sigFeed.set(
      this.cBroadcasts
        .reconcile((this.tBroadcasts?.all() ?? []).map(toBroadcast))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt)),
    );

    this.sigSchedule.set(
      this.cSchedule
        .reconcile((this.tSchedule?.all() ?? []).map(toScheduleItem))
        .sort((a, b) => a.position - b.position),
    );

    const requests = this.cRequests.reconcile((this.tRequests?.all() ?? []).map(toSongRequest));
    this.sigQueue.set(
      requests.filter((r) => r.status !== 'played' && r.status !== 'declined').sort(byVotesDesc),
    );
    this.sigIncoming.set(requests.filter((r) => r.status === 'pending').sort(byVotesDesc));
    this.sigAccepted.set(requests.filter((r) => r.status === 'accepted').sort(byVotesDesc));

    const np = this.tNowPlaying?.all() ?? [];
    this.sigNowPlaying.set(np.length > 0 ? toNowPlaying(np[0]!) : null);
    this.sigMyVotes.set(new Set(this.votes));

    this.sigFolders.set(
      this.cFolders
        .reconcile((this.tFolders?.all() ?? []).map(toFolder))
        .sort((a, b) => a.position - b.position),
    );

    const photos = this.cPhotos.reconcile((this.tPhotos?.all() ?? []).map(toPhoto));
    // `pending` ONLY -- an in-flight photo has no bytes for a host to judge, and
    // including it would inflate the console badge with work nobody can do.
    this.sigPending.set(photos.filter((p) => p.status === 'pending').sort(byNewestFirst));
    this.sigApproved.set(photos.filter((p) => p.status === 'approved').sort(byNewestFirst));
    // Entirely synthetic: an uploading or failed photo has no row (see the class
    // docblock, difference 2).
    this.sigMine.set(this.overlay.rows(this.myGuestId));

    this.sigHosts.set(
      this.cHosts
        .reconcile(this.hostRows)
        .map(({ id, displayName, role }) => ({ id, displayName, role })),
    );
  };

  /* ----------------------------------------------------------------- helpers */

  private requireEvent(): string {
    if (this.eventId === null) throw new Error('Not joined to an event yet.');
    return this.eventId;
  }

  private requireGuest(): string {
    if (this.myGuestId === null) throw new Error('Not joined as a guest yet.');
    return this.myGuestId;
  }

  /**
   * Assert a write actually wrote.
   *
   * An UPDATE or DELETE with no matching policy affects ZERO ROWS and raises
   * nothing -- the single most dangerous shape in this schema, because the call
   * looks like it worked. Every write that can be refused goes through here.
   */
  private static assertWrote(rows: unknown[] | null, what: string): void {
    if (!rows || rows.length === 0) {
      throw new Error(
        `${what} affected no rows. That usually means row-level security refused it ` +
          `silently -- check the policy for this table and the role you are signed in as.`,
      );
    }
  }

  private async loadFetchOnce(): Promise<void> {
    const eventId = this.requireEvent();
    // `hosts` and `song_votes` are NOT in the realtime publication. hosts because
    // it barely changes; song_votes deliberately, so sixty guests voting on six
    // songs costs six messages each rather than sixty (migration decision 3).
    const [hosts, votes] = await Promise.all([
      this.db.from('hosts').select('*').eq('event_id', eventId),
      this.db.from('song_votes').select('request_id').eq('guest_id', this.requireGuest()),
    ]);
    if (hosts.error) throw hosts.error;
    if (votes.error) throw votes.error;
    this.hostRows = (hosts.data as Row<'hosts'>[]).map(toHost);
    this.votes = new Set((votes.data as { request_id: string }[]).map((v) => v.request_id));
  }

  private async startTables(eventId: string): Promise<void> {
    const byEvent = { column: 'event_id', value: eventId };
    const on = this.recompute;
    this.tEvents = new RealtimeTable(this.db, 'events', (r) => r.id, { column: 'id', value: eventId }, on);
    this.tBroadcasts = new RealtimeTable(this.db, 'broadcasts', (r) => r.id, byEvent, on);
    this.tSchedule = new RealtimeTable(this.db, 'schedule_items', (r) => r.id, byEvent, on);
    this.tRequests = new RealtimeTable(this.db, 'song_requests', (r) => r.id, byEvent, on);
    // now_playing is keyed by event_id -- there is no id column and at most one row.
    this.tNowPlaying = new RealtimeTable(this.db, 'now_playing', (r) => r.event_id, byEvent, on);
    this.tFolders = new RealtimeTable(this.db, 'folders', (r) => r.id, byEvent, on);
    this.tPhotos = new RealtimeTable(this.db, 'photos', (r) => r.id, byEvent, on);

    await Promise.all([
      this.tEvents.start(), this.tBroadcasts.start(), this.tSchedule.start(),
      this.tRequests.start(), this.tNowPlaying.start(), this.tFolders.start(),
      this.tPhotos.start(),
    ]);
  }

  /* ----------------------------------------------------------------- session */

  session = {
    current: undefined as unknown as Observable<Session>,

    joinAsGuest: async ({ code, nickname }: { code: string; nickname: string }) => {
      // Anonymous auth gives every guest a real auth.users row and a JWT, so every
      // policy stays in the ordinary auth.uid() idiom. A Supabase anonymous session
      // carries the `authenticated` role, which is what the function grants admit.
      const { data: session } = await this.db.auth.getSession();
      if (!session.session) {
        const { error } = await this.db.auth.signInAnonymously();
        if (error) throw new JoinError('unknown_code', 'Could not start a session. Try again.');
      }

      const { data: guestId, error } = await this.db.rpc('join_event', {
        p_code: code,
        p_nickname: nickname,
      });
      if (error) {
        // P0002 is `unknown_code`, raised by the function itself. Discriminating on
        // the SQLSTATE rather than the message is what keeps this working if the
        // wording ever changes.
        if (isPgError(error) && error.code === 'P0002') {
          throw new JoinError('unknown_code', "That code doesn't match an event.");
        }
        throw error;
      }

      this.myGuestId = guestId as unknown as string;

      // Readable only now: events_read admits a member and nobody else, which is
      // also why the join screen cannot preview an event before joining.
      const { data: ev, error: evErr } = await this.db
        .from('events').select('*').eq('code', code.trim().toUpperCase()).maybeSingle();
      if (evErr) throw evErr;
      if (!ev) throw new JoinError('unknown_code', "That code doesn't match an event.");

      this.eventId = (ev as Row<'events'>).id;
      await this.startTables(this.eventId);
      await this.loadFetchOnce();
      this.sigSession.set({ kind: 'guest', guestId: this.myGuestId, nickname: nickname.trim() });
      this.recompute();
    },

    /**
     * The canvas shows host and guest side by side, but a host here is not a role
     * you can pick: `is_host` matches `hosts.auth_user_id = auth.uid()`. So this
     * becomes the host row bound to THIS signed-in user, and refuses if there is
     * none. `hostId` is validated rather than obeyed.
     */
    becomeHost: async (hostId: string) => {
      const eventId = this.requireEvent();
      const { data: isHost, error } = await this.db.rpc('is_host', { p_event: eventId });
      if (error) throw error;
      if (!isHost) {
        throw new Error(
          'This account is not a host of this event. Host identity comes from ' +
            'hosts.auth_user_id, not from a picker -- add a hosts row for this user first.',
        );
      }
      const mine = this.hostRows.find((h) => h.id === hostId) ?? this.hostRows[0];
      if (!mine) throw new Error('No host row found for this event.');
      this.sigSession.set({
        kind: 'host', hostId: mine.id, displayName: mine.displayName,
        role: mine.role, roleLabel: mine.roleLabel,
      });
    },

    becomeGuest: async () => {
      const guestId = this.requireGuest();
      const { data: nickname } = await this.db.rpc('my_guest_id', { p_event: this.requireEvent() });
      void nickname;
      const current = this.sigSession.get();
      this.sigSession.set({
        kind: 'guest',
        guestId,
        nickname: current.kind === 'guest' ? current.nickname : '',
      });
    },

    leave: async () => {
      await Promise.all([
        this.tEvents?.stop(), this.tBroadcasts?.stop(), this.tSchedule?.stop(),
        this.tRequests?.stop(), this.tNowPlaying?.stop(), this.tFolders?.stop(),
        this.tPhotos?.stop(),
      ]);
      this.tEvents = null;
      this.tBroadcasts = null;
      this.tSchedule = null;
      this.tRequests = null;
      this.tNowPlaying = null;
      this.tFolders = null;
      this.tPhotos = null;
      // Fresh caches too: a stale RowCache would hand back objects belonging to
      // the event that was just left, and shallowArrayEqual would then report the
      // new event's first load as "unchanged".
      this.cBroadcasts = broadcastCache();
      this.cSchedule = scheduleCache();
      this.cRequests = requestCache();
      this.cFolders = folderCache();
      this.cPhotos = photoCache();
      this.cHosts = hostCache();
      this.eventId = null;
      this.myGuestId = null;
      this.votes = new Set();
      this.hostRows = [];
      await this.db.auth.signOut();
      this.sigSession.set({ kind: 'anonymous' });
      this.recompute();
    },
  };

  /* ------------------------------------------------------------------- event */

  event = {
    current: undefined as unknown as Observable<RunitEvent | null>,

    setActiveFolder: async (id: FolderId) => {
      const eventId = this.requireEvent();
      // EXACTLY this column. `revoke update on events` plus
      // `grant update (active_folder_id)` means including any other key -- even one
      // whose value is unchanged -- fails the whole statement with 42501.
      const { data, error } = await this.db
        .from('events').update({ active_folder_id: id }).eq('id', eventId).select('id');
      if (error) throw error;
      SupabaseRepository.assertWrote(data, 'setActiveFolder');
    },

    // The parameter is declared even though it is ignored. A zero-arg version still
    // satisfies the interface -- TypeScript accepts a function that takes fewer
    // arguments -- but it makes the concrete class reject the very call the interface
    // promises, and it hides what a caller is meant to pass.
    setTier: async (_tier: RunitEvent['tier']) => {
      // Refused, loudly. `tier` is not in the column grant, so an update naming it
      // fails with 42501 -- and one that did not name it would change nothing while
      // returning success. Dev-only affordance with no server-side route.
      throw new Error(
        'setTier is not available against Supabase: events.tier is outside the ' +
          'column grant. Change the tier with a service-role update instead.',
      );
    },
  };

  /* -------------------------------------------------------------------- chat */

  chat = {
    feed: undefined as unknown as Observable<Broadcast[]>,

    send: async ({ body, pinned }: { body: string; pinned: boolean; push: boolean }) => {
      const eventId = this.requireEvent();
      const s = this.sigSession.get();
      if (s.kind !== 'host') throw new Error('Only a host can broadcast.');
      // author_name and author_role_label are denormalised and NOT NULL: the client
      // supplies them so a deleted host does not blank the history.
      const { data, error } = await this.db.from('broadcasts').insert({
        event_id: eventId,
        author_host_id: s.hostId,
        author_name: s.displayName,
        author_role_label: s.roleLabel,
        kind: 'announcement',
        body,
        // Pinning works only at INSERT. `broadcasts` has no UPDATE policy, so
        // nothing can ever un-pin -- worth knowing before a host tries.
        pinned,
      }).select('id');
      if (error) throw error;
      SupabaseRepository.assertWrote(data, 'chat.send');
    },
  };

  /* ---------------------------------------------------------------- schedule */

  schedule = {
    items: undefined as unknown as Observable<ScheduleItem[]>,

    start: async (id: ScheduleItemId, opts?: { rewind?: boolean }) => {
      const { error } = await this.db.rpc('start_schedule_item', {
        p_item: id,
        p_rewind: opts?.rewind ?? false,
      });
      if (error) {
        if (isPgError(error) && error.code === 'P0001') {
          const item = this.sigSchedule.get().find((s) => s.id === id);
          // The message is asserted by the e2e suite, so it is reproduced exactly
          // rather than paraphrased.
          throw new ScheduleError(
            'would_rewind',
            `${item?.title ?? 'That item'} already ran. Starting it again moves the run of show backwards for every guest.`,
            id,
          );
        }
        throw error;
      }
    },

    add: async ({ title, timeLabel, place }: { title: string; timeLabel: string | null; place: string }) => {
      const eventId = this.requireEvent();
      const next = Math.max(0, ...this.sigSchedule.get().map((s) => s.position)) + 1;
      const { data, error } = await this.db.from('schedule_items').insert({
        event_id: eventId, position: next, time_label: timeLabel, title, place,
      }).select('id');
      if (error) throw error;
      SupabaseRepository.assertWrote(data, 'schedule.add');
    },
  };

  /* ------------------------------------------------------------------- music */

  music = {
    queue: undefined as unknown as Observable<SongRequest[]>,
    incoming: undefined as unknown as Observable<SongRequest[]>,
    accepted: undefined as unknown as Observable<SongRequest[]>,
    nowPlaying: undefined as unknown as Observable<NowPlaying | null>,
    myVotes: undefined as unknown as Observable<ReadonlySet<SongRequestId>>,

    request: async ({ title, artist }: { title: string; artist: string }) => {
      const eventId = this.requireEvent();
      const s = this.sigSession.get();
      const { data, error } = await this.db.from('song_requests').insert({
        event_id: eventId,
        title,
        artist,
        // requests_insert requires this to be your OWN guest id; null or anyone
        // else's is refused with 42501.
        requested_by_guest_id: this.requireGuest(),
        requested_by_name: s.kind === 'guest' ? s.nickname : 'Guest',
      }).select('id');
      if (error) throw error;
      SupabaseRepository.assertWrote(data, 'music.request');
    },

    setVote: async (id: SongRequestId, on: boolean) => {
      const guestId = this.requireGuest();
      if (on) {
        const { error } = await this.db.from('song_votes').insert({ request_id: id, guest_id: guestId });
        // 23505 is the composite primary key doing its job: idempotency is enforced
        // by the key, not by application code, so a double-tap is success.
        if (error && !(isPgError(error) && error.code === '23505')) throw error;
        this.votes.add(id);
      } else {
        // `.select()` IS THE ASSERTION, not decoration. Without it PostgREST returns
        // no rows and a refused delete is indistinguishable from a successful one --
        // and this is the shape that matters most here, because song_votes is NOT
        // published to realtime. Nothing will ever arrive to correct a local set that
        // has drifted from the table, so the guest would see their vote toggle off,
        // the tally stay put, and the state come back on the next reload.
        const { data, error } = await this.db
          .from('song_votes').delete().eq('request_id', id).eq('guest_id', guestId)
          .select('request_id');
        if (error) throw error;
        // Deleting a vote that is not there is not a failure -- it is the unvote
        // equivalent of the 23505 above, and a double-tap must not throw. But zero
        // rows when we BELIEVED we had a vote means the delete was refused, and the
        // local set must not be updated to a state the table does not share.
        if ((data ?? []).length === 0 && this.votes.has(id)) {
          throw new Error(
            'Removing your vote affected no rows. That usually means row-level security ' +
              'refused it silently -- the local vote set has NOT been changed.',
          );
        }
        this.votes.delete(id);
      }
      // song_votes is not published, so nothing will tell us this happened. The
      // trigger-folded vote_count arrives via song_requests; the membership set is
      // ours to maintain -- which is exactly why the delete above has to be checked.
      this.recompute();
    },

    accept: (id: SongRequestId) => this.moderate(id, 'accepted'),
    decline: (id: SongRequestId) => this.moderate(id, 'declined'),
    markPlayed: async (id: SongRequestId) => {
      const gate = checkFeature(this.sigEntitlements.get(), 'djQueue');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      await this.moderate(id, 'played');
    },

    playNext: async () => {
      const gate = checkFeature(this.sigEntitlements.get(), 'djQueue');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      const { error } = await this.db.rpc('play_next', { p_event: this.requireEvent() });
      if (error) throw error;
    },
  };

  private async moderate(id: SongRequestId, status: string): Promise<void> {
    const gate = checkFeature(this.sigEntitlements.get(), 'djQueue');
    if (!gate.allowed) throw new EntitlementError(gate.denial);
    const { data, error } = await this.db
      .from('song_requests').update({ status }).eq('id', id).select('id');
    if (error) throw error;
    SupabaseRepository.assertWrote(data, `song request -> ${status}`);
  }

  entitlements = undefined as unknown as Observable<Entitlements>;

  /* ------------------------------------------------------------------ photos */

  photos = {
    folders: undefined as unknown as Observable<Folder[]>,
    pending: undefined as unknown as Observable<Photo[]>,
    approved: undefined as unknown as Observable<Photo[]>,
    mine: undefined as unknown as Observable<Photo[]>,

    upload: async ({ localUri }: { localUri: string }): Promise<UploadOutcome> => {
      const eventId = this.requireEvent();
      const guestId = this.requireGuest();
      const ent = this.sigEntitlements.get();

      const gate = checkLimit(ent, 'photos');
      if (!gate.allowed) throw new EntitlementError(gate.denial);

      const ev = this.sigEvent.get();
      const folderId = ev?.activeFolderId ?? '';
      if (!folderId) throw new Error('This event has no folder to upload into yet.');

      const s = this.sigSession.get();
      // The id is minted HERE, not by the database, because the storage key is
      // {event_id}/{photo_id}.jpg and the bytes go up before any row exists.
      // expo-crypto rather than globalThis.crypto: the container runs Node, the
      // phone runs Hermes, and testing one while shipping the other is exactly how
      // the timezone fix passed 144 tests and crashed on device.
      const id = Crypto.randomUUID();
      const path = `${eventId}/${id}.jpg`;

      this.overlay.begin(id, {
        localUri,
        folderId,
        hue: Math.floor(Math.random() * 360),
        createdAt: this.now(),
        uploadedByName: s.kind === 'guest' ? s.nickname : 'Guest',
      });
      this.recompute();

      const outcome = await this.runTransfer(id, path, localUri, folderId, eventId, guestId);
      this.recompute();
      return outcome;
    },

    retry: async (id: PhotoId) => {
      const t = this.overlay.get(id);
      // No-op unless it actually failed, so a double-tap cannot start two
      // transfers for one photo.
      if (!t || t.failureReason === null || this.overlay.isInFlight(id)) return;
      const eventId = this.requireEvent();
      this.overlay.setProgress(id, 0);
      this.recompute();
      await this.runTransfer(id, `${eventId}/${id}.jpg`, t.localUri, t.folderId, eventId, this.requireGuest());
      this.recompute();
    },

    approve: async (id: PhotoId) => {
      const gate = checkFeature(this.sigEntitlements.get(), 'photoModeration');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      const { data, error } = await this.db
        .from('photos').update({ status: 'approved' }).eq('id', id).select('id');
      if (error) throw error;
      SupabaseRepository.assertWrote(data, 'photos.approve');
    },

    hide: async (id: PhotoId) => {
      const gate = checkFeature(this.sigEntitlements.get(), 'photoModeration');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      // `hidden`, never a delete: hide is an audit trail, and there is no DELETE
      // policy on photos for anyone.
      const { data, error } = await this.db
        .from('photos').update({ status: 'hidden' }).eq('id', id).select('id');
      if (error) throw error;
      SupabaseRepository.assertWrote(data, 'photos.hide');
    },

    addFolder: async ({ name }: { name: string }) => {
      const eventId = this.requireEvent();
      const gate = checkLimit(this.sigEntitlements.get(), 'folders');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      const next = Math.max(-1, ...this.sigFolders.get().map((f) => f.position)) + 1;
      const { data, error } = await this.db
        .from('folders').insert({ event_id: eventId, name, position: next }).select('id');
      if (error) throw error;
      SupabaseRepository.assertWrote(data, 'photos.addFolder');
    },
  };

  /**
   * Bytes, then row. That order is forced: a guest cannot UPDATE their own photo
   * row, so `storage_path` has to be present in the INSERT, which means the INSERT
   * cannot happen until the bytes are there.
   *
   * A transfer failure is NOT thrown -- it is a state the guest can retry, and a
   * caller that cannot tell delivered from failed announces success over a failure.
   */
  private async runTransfer(
    id: PhotoId, path: string, localUri: string,
    folderId: string, eventId: string, guestId: string,
  ): Promise<UploadOutcome> {
    const t = this.overlay.get(id);
    if (!t) return 'failed';
    try {
      const res = await fetch(localUri);
      const bytes = await res.arrayBuffer();
      this.overlay.setProgress(id, 0.5);
      this.recompute();

      // contentType is required, not cosmetic: the bucket allows jpeg/png/webp
      // only and rejects the default application/octet-stream outright.
      const up = await this.db.storage.from('event-photos').upload(path, bytes, {
        contentType: 'image/jpeg',
      });
      if (up.error) throw up.error;

      const ent = this.sigEntitlements.get();
      // Free tiers have no moderation queue, so a photo there is already in the
      // album. Mirrors MemoryRepository, and the two delivered outcomes are
      // different promises to the guest.
      const status = ent.tier.features.photoModeration ? 'pending' : 'approved';

      const ins = await this.db.from('photos').insert({
        id, event_id: eventId, folder_id: folderId,
        uploaded_by_guest_id: guestId, uploaded_by_name: t.uploadedByName,
        status, hue: t.hue, storage_path: path,
      }).select('id');
      if (ins.error) throw ins.error;

      this.overlay.settle(id);
      return status as UploadOutcome;
    } catch (e) {
      this.overlay.fail(id, e instanceof Error ? e.message : 'Upload failed.');
      return 'failed';
    }
  }

  /* ------------------------------------------------------------------- hosts */

  hosts = {
    all: undefined as unknown as Observable<{ id: string; displayName: string; role: HostRole }[]>,
    invite: async (_input: { displayName: string; role: HostRole }) => {
      // Refused, loudly. `hosts` has no INSERT policy at all, so this would raise
      // 42501 anyway -- saying so here names the actual reason rather than leaving
      // a caller to read a Postgres error.
      throw new Error(
        'hosts.invite is not available against Supabase: public.hosts has no INSERT ' +
          'policy. Add a host with a service-role insert.',
      );
    },
  };
}

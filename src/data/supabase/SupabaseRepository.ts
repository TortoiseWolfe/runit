import * as Crypto from 'expo-crypto';
import type { PostgrestError } from '@supabase/supabase-js';

import { supabase, type RunitClient } from './client';
import type { Row } from './database.types';
import {
  broadcastCache, folderCache, hostCache, photoCache, requestCache, scheduleCache,
  toBroadcast, toEvent, toFolder, toHost, toNowPlaying, toPhoto, toPreview, toReport,
  toScheduleItem, toSongRequest,
} from './mappers';
import { attachAppStateBridge } from './appStateBridge';
import { RealtimeTable } from './RealtimeTable';
import { Signal, setEqual, shallowArrayEqual } from './signal';
import { UploadOverlay } from './UploadOverlay';
import {
  EntitlementError, JoinError, ScheduleError,
  type EventDetails, type EventPreview, type JoinReason, type NewEvent,
  type Observable, type RunitRepository, type UploadOutcome,
} from '../repository';
import type {
  BlockedGuest, Broadcast, Folder, FolderId, GuestId, Host, HostRole, NowPlaying, Photo,
  PhotoId, Report, ReportId, ReportReason, ReportResolution, ReportSubject, RunitEvent,
  ScheduleItem, ScheduleItemId, Session, SongRequest, SongRequestId,
} from '../types';
import { subjectKey } from '../types';
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

/**
 * A supabase-js AUTH error, told apart from a PostgREST one.
 *
 * The brand is checked here rather than imported, and the reason is a packaging
 * split worth knowing about before someone "fixes" this:
 *
 *   - At RUNTIME the vendor predicates are all present. `dist/index.cjs` -- which
 *     is what the `react-native` export condition resolves to, so it is what ships
 *     on device -- exports isAuthError, AuthApiError, AuthRetryableFetchError.
 *   - In the TYPES they are absent. `dist/index.d.cts` declares only the
 *     Postgrest/Storage/Functions names plus the AuthSession/AuthUser types.
 *
 * So `import { isAuthError } from '@supabase/supabase-js'` FAILS `tsc --noEmit`
 * while working perfectly at runtime. Do not add a `@ts-expect-error` to it: that
 * ships a silent dependency on an undeclared export. `__isAuthError` is an own
 * property set by the AuthError constructor and is exactly what auth-js's own
 * isAuthError tests, so testing it here is the same check without the import.
 *
 * fixtures/fakeClient.ts builds REAL AuthApiError instances, so if that brand ever
 * moves, the suite goes red rather than the device going quiet.
 */
const isAuthFailure = (e: unknown): e is { name: string; code?: string; status?: number } =>
  typeof e === 'object' && e !== null && '__isAuthError' in e;

/**
 * PostgREST surfaces the SQLSTATE in `code`. Discriminate on it, never on the message.
 *
 * The `!isAuthFailure` clause is not belt-and-braces. AuthError's constructor
 * assigns `this.code` UNCONDITIONALLY, so `'code' in e` is true even for an
 * AuthRetryableFetchError whose code is `undefined` -- every auth error already
 * satisfied the old predicate. Excluding the other family is also why this is not
 * `instanceof PostgrestError`: the test fixture returns plain object literals, and
 * PostgrestError carries no brand of its own.
 */
const isPgError = (e: unknown): e is PostgrestError =>
  typeof e === 'object' && e !== null && 'code' in e && !isAuthFailure(e);

/**
 * Which JoinError an auth failure deserves.
 *
 * Branches on the NAME for the offline case, not on `code`: a dead socket carries
 * no code at all -- AuthRetryableFetchError is constructed with `undefined` -- so
 * a code-based test would silently never match.
 *
 * `code` is checked before `status` because only the code strings ship inside the
 * installed package (auth-js/src/lib/error-codes.ts); the HTTP statuses are server
 * behaviour this repo cannot verify locally. `session_unavailable` is the
 * catch-all rather than an allowlist, so anonymous_provider_disabled,
 * provider_disabled, signup_disabled, captcha_failed, user_banned -- and whatever
 * the server adds next -- all land somewhere honest. None of them is the guest's
 * code, which is the whole point.
 */
const authJoinReason = (e: unknown): JoinReason =>
  isAuthFailure(e) && e.name === 'AuthRetryableFetchError' ? 'offline'
  : isAuthFailure(e) && (e.code === 'over_request_rate_limit' || e.status === 429) ? 'rate_limited'
  : 'session_unavailable';

const byVotesDesc = (a: SongRequest, b: SongRequest) =>
  b.voteCount - a.voteCount || a.createdAt.localeCompare(b.createdAt);
const byNewestFirst = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);
const byBlockedNewestFirst = (a: BlockedGuest, b: BlockedGuest) =>
  b.blockedAt.localeCompare(a.blockedAt);

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
  private tReports: RealtimeTable<'reports'> | null = null;

  /**
   * Blocks are FETCH-ONCE, not realtime, and the reason is that the only device that
   * can change them is this one -- `blocks_own` scopes every command to the blocker.
   * A subscription would deliver this device its own writes back. Refreshed explicitly
   * after block/unblock, the same way `votes` is maintained.
   */
  private blockRows: BlockedGuest[] = [];

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
  // A preview has no realtime channel behind it -- RLS would never deliver a change
  // on a row the caller is not a member of -- so this only ever moves when lookUp
  // runs. The comparator still earns its keep: looking the same code up twice must
  // not re-render the join screen underneath someone typing.
  private readonly sigPreview = new Signal<EventPreview | null>(null, (a, b) =>
    a === b ||
    (a !== null && b !== null &&
      a.id === b.id && a.code === b.code && a.name === b.name && a.venue === b.venue &&
      a.startsAt === b.startsAt && a.timezone === b.timezone && a.doorsLabel === b.doorsLabel),
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
  private readonly sigBlocked = new Signal<BlockedGuest[]>([], shallowArrayEqual);
  private readonly sigReports = new Signal<Report[]>([], shallowArrayEqual);
  private readonly sigMyReports = new Signal<ReadonlySet<string>>(new Set(), setEqual);

  private constructor(db: RunitClient, private readonly now: () => string) {
    this.db = db;
    // THE ONE SIGNAL IN THIS FILE THAT HAD NO COMPARATOR, and computeEntitlements()
    // returns a fresh literal on every call -- so the default Object.is never matched
    // and recompute() re-rendered every useEntitlements() consumer on every realtime
    // message from any of the eight tables. `tier` is a TIERS constant and compares
    // by reference; usage is four numbers.
    this.sigEntitlements = new Signal<Entitlements>(this.computeEntitlements(), (a, b) =>
      a === b ||
      (a.tier === b.tier &&
        a.usage.guests === b.usage.guests &&
        a.usage.hosts === b.usage.hosts &&
        a.usage.photosStored === b.usage.photosStored &&
        a.usage.folders === b.usage.folders));

    // The interface exposes Observables; the implementation holds Signals. Wiring
    // them here rather than in the field initialisers keeps each group's shape
    // readable above, and matches how MemoryRepository does it.
    this.session.current = this.sigSession;
    this.event.current = this.sigEvent;
    this.event.preview = this.sigPreview;
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
    this.moderation.blocked = this.sigBlocked;
    this.moderation.reports = this.sigReports;
    this.moderation.myReports = this.sigMyReports;
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
    /**
     * `appState: false` is for tests that assert suspend/resume directly -- the
     * bridge is global, and a test that installs one is asserting on the listener
     * rather than on the behaviour.
     */
    opts: { now?: () => string; appState?: boolean } = {},
  ): SupabaseRepository {
    // Synchronous on purpose: src/app/_layout.tsx builds this inside useMemo, and
    // the real work starts at joinAsGuest, which is the first moment there is an
    // event to subscribe to.
    const repo = new SupabaseRepository(db, opts.now ?? (() => new Date().toISOString()));
    // The adapter owns its own lifecycle. Doing this here rather than in
    // _layout.tsx keeps `react-native` out of the repository interface and leaves
    // MemoryRepository -- which has no socket and no token to refresh -- untouched.
    if (opts.appState !== false) attachAppStateBridge(repo);
    return repo;
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

    // THE BLOCK FILTER. Ported from MemoryRepository.recompute() line for line, and
    // applied in the same place for the same reason: every guest-facing list is derived
    // from an already-filtered array, so no screen can forget it. Blocks are enforced
    // HERE rather than in RLS -- see the note in the migration's MODERATION section on
    // why a per-viewer policy would break `folders.photo_count` and hide evidence from
    // the host console.
    const blocked = new Set(this.blockRows.map((b) => b.guestId));
    const requests = this.cRequests
      .reconcile((this.tRequests?.all() ?? []).map(toSongRequest))
      .filter((r) => r.requestedByGuestId === null || !blocked.has(r.requestedByGuestId));
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
    this.sigApproved.set(
      photos
        .filter(
          (p) =>
            p.status === 'approved' &&
            (p.uploadedByGuestId === null || !blocked.has(p.uploadedByGuestId)),
        )
        .sort(byNewestFirst),
    );
    // Entirely synthetic: an uploading or failed photo has no row (see the class
    // docblock, difference 2).
    this.sigMine.set(this.overlay.rows(this.myGuestId));

    this.sigHosts.set(
      this.cHosts
        .reconcile(this.hostRows)
        .map(({ id, displayName, role }) => ({ id, displayName, role })),
    );

    this.sigBlocked.set([...this.blockRows].sort(byBlockedNewestFirst));

    const reports = (this.tReports?.all() ?? []).map(toReport);
    // UNRESOLVED only, oldest first. A resolved report stays in the table as the audit
    // trail but leaves the queue, or the queue never empties.
    this.sigReports.set(
      reports
        .filter((r) => r.resolvedAt === null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
    // `reports_read` already scopes a guest to their own rows, so for a guest this is
    // every report they can see. For a HOST it would be the whole queue, which is why
    // it filters on reporterGuestId rather than trusting the policy to have done it:
    // a host is also a person who can report, and "have I reported this?" is their
    // question too.
    this.sigMyReports.set(
      new Set(
        reports
          .filter((r) => this.myGuestId !== null && r.reporterGuestId === this.myGuestId)
          .map((r) => subjectKey(r.subject)),
      ),
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
  /* -------------------------------------------------------------- moderation */

  moderation = {
    blocked: undefined as unknown as Observable<BlockedGuest[]>,
    reports: undefined as unknown as Observable<Report[]>,
    myReports: undefined as unknown as Observable<ReadonlySet<string>>,

    report: async ({
      subject,
      reason,
      note,
    }: {
      subject: ReportSubject;
      reason: ReportReason;
      note?: string;
    }) => {
      const eventId = this.requireEvent();
      const subjectId =
        subject.kind === 'photo'
          ? subject.photoId
          : subject.kind === 'song_request'
            ? subject.requestId
            : subject.guestId;

      // Through the RPC, never a direct insert -- `reports` has no INSERT policy at
      // all. file_report() derives reporter_name and subject_label from the real rows
      // and refuses a subject belonging to another event, neither of which a policy
      // could check. See the migration's MODERATION section.
      const { error } = await this.db.rpc('file_report', {
        p_event_id: eventId,
        p_kind: subject.kind,
        p_subject_id: subjectId,
        p_reason: reason,
        p_note: note ?? '',
      });
      // A NULL return is success: the guest had already reported this subject and
      // ON CONFLICT DO NOTHING wrote nothing. Only an error is a failure.
      if (error) throw error;
      this.recompute();
    },

    block: async (guestId: GuestId) => {
      const eventId = this.requireEvent();
      const { error } = await this.db.from('guest_blocks').insert({
        event_id: eventId,
        blocker_guest_id: this.requireGuest(),
        blocked_guest_id: guestId,
      });
      // 23505 IS THE IDEMPOTENCY, exactly as it is for song_votes: the primary key
      // (blocker_guest_id, blocked_guest_id) already says a block exists at most once,
      // so a duplicate is the desired state arriving twice, not a failure. Reaching for
      // upsert here would mean naming the constraint in a string that can drift from
      // the schema; the key is already doing the work.
      //
      // `blocked_name` is not sent -- the guest_blocks_stamp_name trigger fills it from
      // the real guest row, for the same reason file_report derives its labels.
      if (error && !(isPgError(error) && error.code === '23505')) throw error;
      // Re-read rather than patching a local set. song_votes taught this: a local set
      // with no realtime feed behind it drifts from the table and nothing corrects it.
      await this.loadBlocks();
      this.recompute();
    },

    unblock: async (guestId: GuestId) => {
      const { error } = await this.db
        .from('guest_blocks')
        .delete()
        .eq('blocker_guest_id', this.requireGuest())
        .eq('blocked_guest_id', guestId);
      if (error) throw error;
      await this.loadBlocks();
      this.recompute();
    },

    resolve: async (id: ReportId, resolution: ReportResolution) => {
      // `resolved_by_host_id` is NOT sent: it is not in the column grant, and the
      // reports_stamp_resolver trigger fills it from auth.uid(). An audit trail whose
      // signature the signer chooses is not an audit trail.
      const { data, error } = await this.db
        .from('reports')
        .update({ resolved_at: this.now(), resolution })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      // A guest reaching this affects ZERO ROWS AND RAISES NOTHING -- reports_host_resolve
      // is hosts-only. This is the exact silent-denial shape assertWrote exists for.
      SupabaseRepository.assertWrote(data, 'Resolving this report');
      this.recompute();
    },
  };

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
    // NO GUEST ROW IS A REAL STATE, and it took create_event to expose it. This read
    // `this.requireGuest()` inline, which threw 'Not joined as a guest yet.' -- fine
    // while every path here arrived through joinAsGuest, and wrong the moment a founder
    // did not. She made the event; she never joined it, and create_event deliberately
    // does not seat her (a brand-new party reading "1 already here" before anyone
    // arrives is worse than the gap it closes).
    //
    // A host with no guest row has no votes, so the empty set is the right answer rather
    // than a fallback. loadBlocks() immediately below already reasoned this way; this
    // half simply had no caller to force it.
    const guestId = this.myGuestId;
    const [hosts, votes] = await Promise.all([
      this.db.from('hosts').select('*').eq('event_id', eventId),
      guestId === null
        ? Promise.resolve({ data: [] as { request_id: string }[], error: null })
        : this.db.from('song_votes').select('request_id').eq('guest_id', guestId),
    ]);
    if (hosts.error) throw hosts.error;
    if (votes.error) throw votes.error;
    this.hostRows = (hosts.data as Row<'hosts'>[]).map(toHost);
    this.votes = new Set((votes.data as { request_id: string }[]).map((v) => v.request_id));
    await this.loadBlocks();
  }

  /**
   * Re-read this guest's blocks.
   *
   * A host has no `blocks_own` match, so this returns zero rows for them and the
   * filter below becomes a no-op -- which is exactly right: a guest's block must not
   * hide anything from the console.
   */
  private async loadBlocks(): Promise<void> {
    const guestId = this.myGuestId;
    if (guestId === null) {
      this.blockRows = [];
      return;
    }
    const { data, error } = await this.db
      .from('guest_blocks')
      .select('blocked_guest_id, blocked_name, created_at')
      .eq('blocker_guest_id', guestId);
    if (error) throw error;
    this.blockRows = (data ?? []).map((b) => ({
      guestId: b.blocked_guest_id,
      nickname: b.blocked_name,
      blockedAt: b.created_at,
    }));
  }

  private async startTables(eventId: string): Promise<void> {
    // IDEMPOTENT, because the assignments below REPLACE the eight fields and a replaced
    // RealtimeTable takes its channel with it -- still registered on the client, still
    // rejoining on supabase-js's own backoff, with nothing holding a reference. A second
    // call therefore used to leak eight channels.
    //
    // It was masked: the only way to reach a second call was a FAILED join, and the
    // failure path tore everything down before re-throwing. Once a partly-failed join
    // was allowed to succeed, two joins left fifteen live channels. Guarding here rather
    // than at the call sites, so the property holds for any future caller.
    await this.stopTables();

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
    // Published so the host console's open-report badge moves without a refresh, for
    // the same reason the photo approvals badge does. `guest_blocks` is deliberately
    // NOT published -- see the note on blockRows.
    this.tReports = new RealtimeTable(this.db, 'reports', (r) => r.id, byEvent, on);

    // ALL-OR-NOTHING, BECAUSE Promise.all IS NOT. It rejects on the first failure
    // while the other seven channels are already subscribed and stay registered on
    // the client -- and joinAsGuest turns that rejection into a toast, so the guest
    // taps Try again and adds another eight. allSettled lets every attempt finish so
    // the survivors can be removed before the failure is re-thrown.
    const results = await Promise.allSettled([
      this.tEvents.start(), this.tBroadcasts.start(), this.tSchedule.start(),
      this.tRequests.start(), this.tNowPlaying.start(), this.tFolders.start(),
      this.tPhotos.start(), this.tReports.start(),
    ]);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) {
      await this.stopTables();
      throw (failed as PromiseRejectedResult).reason;
    }
  }

  /**
   * Close all eight channels and forget them. Shared by `leave()` and by the
   * failure path above, so there is one list of tables rather than two that drift.
   */
  private async stopTables(): Promise<void> {
    await Promise.all([
      this.tEvents?.stop(), this.tBroadcasts?.stop(), this.tSchedule?.stop(),
      this.tRequests?.stop(), this.tNowPlaying?.stop(), this.tFolders?.stop(),
      this.tPhotos?.stop(), this.tReports?.stop(),
    ]);
    this.tEvents = null;
    this.tBroadcasts = null;
    this.tSchedule = null;
    this.tRequests = null;
    this.tNowPlaying = null;
    this.tFolders = null;
    this.tPhotos = null;
    this.tReports = null;
  }

  /**
   * Backgrounding: stop paying for a party nobody is looking at.
   *
   * Removing the channels is NOT enough on its own. `removeChannel()` unsubscribes
   * one channel but leaves the socket open, and the socket heartbeats every 25s
   * forever -- so an installed app that has joined once keeps talking to Supabase
   * with the phone in a pocket. Only `realtime.disconnect()` closes it. GoTrue's
   * refresh ticker is a separate 30s interval and needs its own stop.
   *
   * Rows are kept, not cleared: `RealtimeTable.start()` replaces them only after its
   * select returns, so the screen still has content on the first frame after resume.
   */
  async suspend(): Promise<void> {
    await Promise.all([
      this.tEvents?.pause(), this.tBroadcasts?.pause(), this.tSchedule?.pause(),
      this.tRequests?.pause(), this.tNowPlaying?.pause(), this.tFolders?.pause(),
      this.tPhotos?.pause(), this.tReports?.pause(),
    ]);
    await this.db.realtime.disconnect();
    await this.db.auth.stopAutoRefresh();
  }

  /** Foregrounding. `channel.subscribe()` reopens the socket by itself. */
  async resume(): Promise<void> {
    await this.db.auth.startAutoRefresh();
    if (!this.eventId) return;
    await Promise.all([
      this.tEvents?.start(), this.tBroadcasts?.start(), this.tSchedule?.start(),
      this.tRequests?.start(), this.tNowPlaying?.start(), this.tFolders?.start(),
      this.tPhotos?.start(), this.tReports?.start(),
    ]);
  }

  /**
   * Get a session, or make one. Every failure in here becomes a JoinError.
   *
   * The alternative is what shipped: ONE `unknown_code` for every possible auth
   * failure, telling a guest standing in a room that their code was wrong while
   * the real cause was anonymous sign-in being switched off in our dashboard.
   * None of that is theirs to fix, and it is what sent someone re-printing QR
   * posters.
   *
   * Anonymous auth gives every guest a real auth.users row and a JWT, so every
   * policy stays in the ordinary auth.uid() idiom. A Supabase anonymous session
   * carries the `authenticated` role, which is what the function grants admit.
   */
  private async ensureSession(): Promise<void> {
    let priorErr: unknown = null;
    try {
      // The error is READ, not dropped. It is non-null in essentially one shape --
      // a stored session whose access token expired and whose refresh then failed
      // -- and that shape has a silent, expensive consequence: we fall through,
      // signInAnonymously() SUCCEEDS, and mints a NEW auth.users row. join_event is
      // idempotent on (event_id, auth_user_id), so a returning guest takes a SECOND
      // seat under a fresh guests row and loses their votes, blocks, reports and
      // own-photo view. client.ts says persistence exists to prevent exactly that.
      //
      // It is not thrown on by itself, though: signInAnonymously() IS the recovery,
      // and throwing here would turn a routine token expiry into a hard join failure
      // for every returning guest. It is carried as a `cause` instead, so a device
      // log shows dead-session -> failed-recovery in order.
      const { data, error } = await this.db.auth.getSession();
      if (data.session) return;
      priorErr = error;
    } catch (e) {
      priorErr = e;
    }

    let signInErr: unknown = null;
    try {
      // signInAnonymously RETURNS auth errors but RE-THROWS anything else -- a
      // failing SecureStore write, say. `if (error)` alone does not cover that, and
      // the uncaught half escapes as a raw rejection that the screen renders as the
      // generic 'Could not join. Try again.'
      signInErr = (await this.db.auth.signInAnonymously()).error;
    } catch (e) {
      signInErr = e;
    }

    if (signInErr) {
      if (priorErr && signInErr instanceof Error && signInErr.cause === undefined) {
        signInErr.cause = priorErr;
      }
      throw new JoinError(authJoinReason(signInErr), { cause: signInErr });
    }
  }

  /* ----------------------------------------------------------------- session */

  session = {
    current: undefined as unknown as Observable<Session>,

    joinAsGuest: async ({ code, nickname }: { code: string; nickname: string }) => {
      await this.ensureSession();

      const { data: guestId, error } = await this.db.rpc('join_event', {
        p_code: code,
        p_nickname: nickname,
      });
      if (error) {
        // P0002 is `unknown_code`, raised by the function itself. Discriminating on
        // the SQLSTATE rather than the message is what keeps this working if the
        // wording ever changes.
        if (isPgError(error) && error.code === 'P0002') {
          throw new JoinError('unknown_code');
        }
        // 28000 is the function's own `not authenticated`, raised when auth.uid()
        // is null. We established a session moments ago, so reaching this means
        // PostgREST saw a JWT with no `sub` -- the session died mid-call, or the
        // request went out under the anon key. Untreated it fell through to the
        // generic 'Could not join. Try again.', which names nothing.
        if (isPgError(error) && error.code === '28000') {
          throw new JoinError('session_unavailable', { cause: error });
        }
        throw error;
      }

      this.myGuestId = guestId as unknown as string;

      // Readable only now: events_read admits a member and nobody else, which is
      // also why the join screen cannot preview an event before joining.
      const { data: ev, error: evErr } = await this.db
        .from('events').select('*').eq('code', code.trim().toUpperCase()).maybeSingle();
      if (evErr) throw evErr;
      // NOT `unknown_code`: join_event already returned a guest id, so the code DID
      // match. Reaching here means events_read refused a row to someone who is
      // definitionally a member -- a policy regression, or a select that went out
      // under a different auth.uid() than the join did. Both are ours, and `reason`
      // exists so a caller can branch; nobody can branch on "this is a bug". Same
      // idiom as assertWrote below. The guest sees the generic copy, which at least
      // does not blame their code.
      if (!ev) {
        throw new Error(
          `Joined the event but could not read it back. join_event returned a guest id, so the ` +
            `code is valid -- this is events_read refusing the follow-up select, which usually ` +
            `means the policy changed or this request went out under a different auth.uid().`,
        );
      }

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

    claimHost: async ({ code, key }: { code: string; key: string }) => {
      const { data: hostId, error } = await this.db.rpc('claim_host', {
        p_code: code,
        p_secret: key,
      });
      if (error) {
        if (isPgError(error) && error.code === 'P0002') {
          throw new JoinError('unknown_code');
        }
        // 42501 here is the function's own `bad_host_key`, not a policy denial -- the
        // function is SECURITY DEFINER, so RLS never refuses this call.
        //
        // 42501 is OVERLOADED across this schema -- start_schedule_item and play_next
        // both raise it as `not_a_host`. Reading it as a bad key is only sound because
        // this branch is scoped to the claim_host call. Keep it that way.
        if (isPgError(error) && error.code === '42501') {
          throw new JoinError('bad_host_key');
        }
        // As in joinAsGuest: the function's own `not authenticated`. claimHost is
        // callable on its own, not only after a join, so it needs its own branch.
        if (isPgError(error) && error.code === '28000') {
          throw new JoinError('session_unavailable', { cause: error });
        }
        throw error;
      }

      // The claim rebound hosts.auth_user_id, so `hosts` must be re-read before the
      // session can name the seat -- it was fetched once at join, when this user was
      // not a host of anything.
      await this.loadFetchOnce();
      const mine = this.hostRows.find((h) => h.id === (hostId as unknown as string));
      if (!mine) throw new Error('Claimed a host seat that is not readable. This is a bug.');
      this.sigSession.set({
        kind: 'host', hostId: mine.id, displayName: mine.displayName,
        role: mine.role, roleLabel: mine.roleLabel,
      });
      this.recompute();
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

    /**
     * Leave the EVENT, and stay exactly who you are.
     *
     * THE DISTINCTION THIS METHOD EXISTS TO MAKE. `leave()` below signs out, and for a
     * long time it was the only teardown -- which made "I want to go back to the join
     * screen" and "forget me" the same operation. They are not. `join_event` is
     * idempotent on `(event_id, auth_user_id)`, so keeping the anonymous session means a
     * re-join lands on the SAME `guests` row: same votes, same photo attribution, same
     * blocks. Signing out first mints a new `auth.uid()`, which does not conflict, which
     * INSERTS -- the person appears twice, their first identity is orphaned, a second
     * seat burns against the cap, and Supabase never collects the abandoned user.
     *
     * That last part is why this matters more than it looks: a visible button on a
     * signing-out leave would be one permanent auth.users row per tap.
     *
     * NO OTHER LANE CAN SEE THE DIFFERENCE. MemoryRepository has no auth to sign out of,
     * so the e2e suite -- which runs Memory -- would show "leave, re-join, same guest"
     * while production quietly doubled the row. The test that catches a regression here
     * is `join -> closeEvent -> join returns the same guestId`, plus the explicit
     * assertion that a session still exists afterwards.
     *
     * It sets the session anonymous because that is what the route guards read to mean
     * "not in an event". That is a different question from "do you hold a token", and
     * `leave()` used to answer both on one line. This answers only the first.
     */
    closeEvent: async () => {
      await this.stopTables();
      // Closing every channel does not close the socket IMMEDIATELY -- but it does
      // close it. RealtimeClient schedules a deferred disconnect once channels reach
      // zero, and `disconnectOnEmptyChannelsAfterMs` defaults to 2 * HEARTBEAT_INTERVAL;
      // client.ts passes only `eventsPerSecond`, so we inherit that default. The
      // explicit call makes it immediate rather than deferred, which is worth having
      // across a room of backgrounded phones.
      //
      // NO EXPLICIT disconnect() HERE, DELIBERATELY -- it was removed after a device
      // report, and removing it is the fix rather than a workaround.
      //
      // RealtimeClient.connect() early-returns while isDisconnecting()
      // (RealtimeClient.js:197) and disconnect() is async, so a re-join landing in that
      // window subscribes against a socket that never opens. Leaving and immediately
      // re-entering with a host key is exactly that flow, and on a real phone it
      // produced: zero guests, a broadcast the host had just sent and could not see,
      // and Show QR / Share invite inert because both are `disabled={!event}`.
      //
      // The socket still closes. RealtimeClient schedules a deferred disconnect once
      // channels reach zero, and `disconnectOnEmptyChannelsAfterMs` defaults to
      // 2 * HEARTBEAT_INTERVAL; client.ts passes only `eventsPerSecond`, so we inherit
      // it. stopTables() above takes the count to zero, which arms it. So this trades
      // an immediate disconnect for one ~50s later -- and buys back a re-join that
      // cannot race, because the socket it reuses is still open.
      //
      // The blast radius was fixed separately and matters more: RealtimeTable no longer
      // gates its snapshot on SUBSCRIBED, so a channel that fails now costs live updates
      // rather than all data. Both halves ship together. FIDELITY note R.
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
      // Blocks are per-event and per-guest. Carrying them across a leave would filter
      // the NEXT event's album against the last event's grudges.
      this.blockRows = [];
      this.sigSession.set({ kind: 'anonymous' });
      this.recompute();
    },

    /**
     * Leave the event AND forget who you are.
     *
     * Everything closeEvent() does, plus the sign-out. It has no caller today and does
     * not need one for the "let me back to the join screen" case -- see closeEvent's
     * header for why using this there would be actively wrong. It stays because a real
     * sign-out is a real thing, and it is the half of the split that account deletion
     * and host sign-in will need (docs/design-host-accounts.md).
     */
    leave: async () => {
      await this.session.closeEvent();
      // The socket goes NOW, unlike in closeEvent. Nobody re-joins after a sign-out, so
      // there is no re-subscribe to race -- and waiting ~50s for the deferred disconnect
      // would leave a heartbeat running for a session that has ended.
      await this.db.realtime.disconnect();
      await this.db.auth.signOut();
    },
  };

  /* ------------------------------------------------------------------- event */

  event = {
    current: undefined as unknown as Observable<RunitEvent | null>,
    preview: undefined as unknown as Observable<EventPreview | null>,

    lookUp: async (code: string) => {
      // A session first, because event_preview is granted to `authenticated` and to
      // nobody else. That is the point: `authenticated` is the role an ANONYMOUS
      // Supabase session carries, so every call sits behind the anonymous sign-in
      // rate limit -- which is the only thing bounding how fast codes can be guessed.
      // Granting this to `anon` would remove that bound entirely.
      //
      // The honest cost: opening an invitation link mints an auth.users row before
      // the person has joined anything. Bounded by firing on a link only, and
      // join_event is idempotent on (event_id, auth_user_id), so this session becomes
      // their seat rather than stranding one.
      await this.ensureSession();

      const { data, error } = await this.db.rpc('event_preview', { p_code: code });
      if (error) throw error;

      // Zero rows is the answer to a code that names nothing, not a failure -- so
      // NO assertWrote here. That helper exists because a denied WRITE is silent;
      // an empty read is just an empty read.
      const row = data?.[0];
      this.sigPreview.set(row ? toPreview(row) : null);
    },

    create: async (input: NewEvent) => {
      // A session first, for the same reason lookUp needs one: create_event is granted
      // to `authenticated`, which is the role an ANONYMOUS session already carries. The
      // seat it mints is bound to that auth.uid() -- which is precisely why it also
      // hands back a recovery key.
      await this.ensureSession();

      const { data, error } = await this.db.rpc('create_event', {
        p_name: input.name,
        p_starts_at: input.startsAt,
        p_timezone: input.timezone,
        p_venue: input.venue,
        p_doors_label: input.doorsLabel,
        p_host_name: input.hostName,
      });
      if (error) {
        // The function's own guards, discriminated on SQLSTATE rather than message so
        // the wording can change without breaking this.
        if (isPgError(error) && error.code === '22023') {
          throw new Error('An event needs a name and a time zone.');
        }
        if (isPgError(error) && error.code === '54023') {
          throw new Error('That is a lot of events. Ten is the limit on one device.');
        }
        if (isPgError(error) && error.code === '28000') {
          throw new JoinError('session_unavailable', { cause: error });
        }
        throw error;
      }

      const row = data?.[0];
      if (!row) {
        throw new Error(
          'create_event returned no row. It returns exactly one on success, so this is ' +
            'a schema mismatch rather than a refusal -- check the function signature.',
        );
      }

      // Now open it, exactly the way joinAsGuest opens the event it just joined. Without
      // this the host would hold a code for an event the app is not watching.
      this.eventId = row.event_id;
      await this.startTables(this.eventId);
      await this.loadFetchOnce();
      const mine = this.hostRows.find((h) => h.id === row.host_id);
      if (!mine) {
        throw new Error(
          'Created the event but could not read back its host row. hosts_read admits ' +
            'every member, so this is a policy regression rather than a refusal.',
        );
      }
      this.sigSession.set({
        kind: 'host', hostId: mine.id, displayName: mine.displayName,
        role: mine.role, roleLabel: mine.roleLabel,
      });
      this.recompute();

      return { code: row.code, hostKey: row.host_key };
    },

    rotateHostKey: async () => {
      const eventId = this.requireEvent();
      const { data, error } = await this.db.rpc('rotate_host_key', { p_event: eventId });
      if (error) {
        if (isPgError(error) && error.code === '42501') {
          throw new Error('Only a host of this event can issue a new key.');
        }
        throw error;
      }
      if (!data) throw new Error('rotate_host_key returned nothing, which it never does on success.');
      return data;
    },

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

    updateDetails: async (input: EventDetails) => {
      const eventId = this.requireEvent();
      // Every key here is in the column grant and no key outside it may appear:
      // `revoke update on events` plus a named grant means one stray column -- even
      // one whose value is unchanged -- fails the whole statement with 42501. That is
      // why `tier` gets its own refusal below instead of being folded in here.
      const { data, error } = await this.db
        .from('events')
        .update({
          name: input.name,
          venue: input.venue,
          starts_at: input.startsAt,
          timezone: input.timezone,
          doors_label: input.doorsLabel,
        })
        .eq('id', eventId)
        .select('id');
      if (error) throw error;
      // A non-host's update matches the policy on nothing, affects zero rows and
      // raises nothing at all. This is the only thing standing between that and a
      // toast saying the change was saved.
      SupabaseRepository.assertWrote(data, 'updateDetails');
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
    // Ungated, with accept, decline and moderate() below -- see the note in
    // MemoryRepository for what gating these cost the free tier.
    markPlayed: async (id: SongRequestId) => {
      await this.moderate(id, 'played');
    },

    playNext: async () => {
      const { error } = await this.db.rpc('play_next', { p_event: this.requireEvent() });
      if (error) throw error;
    },
  };

  private async moderate(id: SongRequestId, status: string): Promise<void> {
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

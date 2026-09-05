/**
 * The seam.
 *
 * Screens depend on this interface and never on an implementation. The
 * implementation is chosen exactly once, in src/app/_layout.tsx, and an ESLint
 * no-restricted-imports rule enforces that -- which is what makes "swap in
 * Supabase without touching the UI" a checked property rather than a promise.
 *
 * Reads are observables, not one-shot fetches, even though MemoryRepository
 * resolves them synchronously. The eventual backend is realtime (Supabase
 * Realtime), and retrofitting subscriptions into a request/response interface
 * is the migration that actually hurts.
 *
 * Writes are async and may reject with EntitlementError -- tier limits are
 * enforced HERE, not in a button's onPress, so a deep link, a retry or a future
 * web client cannot route around them.
 */
import type {
  BlockedGuest, Broadcast, Folder, FolderId, GuestId, HostRole, NowPlaying, Photo, PhotoId,
  Report, ReportId, ReportReason, ReportResolution, ReportSubject,
  RunitEvent, ScheduleItem, ScheduleItemId, Session, SongRequest, SongRequestId,
} from './types';
import type { EntitlementDenial, Entitlements } from '@/domain/entitlements';

export type Unsubscribe = () => void;

export interface Observable<T> {
  get(): T;
  subscribe(listener: (value: T) => void): Unsubscribe;
}

export class EntitlementError extends Error {
  constructor(readonly denial: EntitlementDenial) {
    super(`Blocked by plan: ${denial.kind}`);
    this.name = 'EntitlementError';
  }
}

/**
 * Why a join was refused.
 *
 * The test for adding an arm is: does it change what the person standing in the
 * room does next? Three answers exist beyond the original three, and
 * `rate_limited` is separate from `session_unavailable` because the retry advice
 * differs IN TRUTH VALUE -- waiting fixes a 429 and never fixes a disabled
 * provider. There is deliberately no `session_expired`: its remedy is identical
 * to `session_unavailable`, and an arm nobody branches on is decoration.
 *
 * `nickname_taken` was removed rather than left unused. `guests` is unique on
 * (event_id, auth_user_id) and NOTHING else, and join_event does
 * `on conflict (event_id, auth_user_id) do update set nickname` -- nicknames are
 * deliberately non-unique. The arm asserted a constraint the schema does not have.
 *
 * `event_full` is produced by MemoryRepository only, because join_event enforces
 * no tier cap. Keeping it is what makes that debt visible in the type rather than
 * only in a SQL comment (supabase/migrations/00000000000000_init.sql).
 */
export type JoinReason =
  | 'unknown_code'
  | 'event_full'
  | 'bad_host_key'
  | 'session_unavailable'
  | 'offline'
  | 'rate_limited';

/**
 * The one place a join failure's wording lives.
 *
 * A TABLE rather than a message at each throw site, for a reason specific to the
 * bug that prompted it: SupabaseRepository mapped EVERY signInAnonymously()
 * failure to `unknown_code` with the message 'Could not start a session', so the
 * reason and the message contradicted each other on one line -- and nobody
 * noticed, because `reason` is read nowhere in the app. Resolving copy from the
 * reason makes the reason load-bearing: it becomes the only input that selects
 * the sentence, so the two can no longer disagree. It also makes the two adapters
 * structurally incapable of drifting on wording, since no call site can override.
 *
 * The property every sentence holds: NEVER blame the guest's code for our
 * outage. They are standing in a room holding a phone; "that code doesn't match
 * an event" sends them off to find the host. That is exactly what happened when
 * anonymous sign-in was switched off and build #3 could not admit a soul.
 */
const JOIN_COPY: Record<JoinReason, string> = {
  // Pinned VERBATIM by tests/e2e/join.spec.ts. Not paraphrasable.
  unknown_code: "That code doesn't match an event.",
  bad_host_key: "That host key isn't right for this event.",
  // Pinned by MemoryRepository.test.ts (/full/).
  event_full: 'This event is full.',
  // Promises no retry: for a disabled provider a retry never works.
  session_unavailable: 'Sign-in is unavailable right now. Your code is fine — this is on us.',
  offline: "Can't reach the network. Check your connection and try again.",
  rate_limited: 'Too many people joining at once. Wait a moment and try again.',
};

export class JoinError extends Error {
  constructor(
    readonly reason: JoinReason,
    options?: { cause?: unknown },
  ) {
    super(JOIN_COPY[reason], options);
    this.name = 'JoinError';
  }
}

/**
 * Raised when `schedule.start` is asked to move the run-of-show cursor BACKWARDS
 * without being told to.
 *
 * The cursor is not private to the host: `nowScheduleItemId` drives every guest's
 * Now/Next card, so re-starting an item that already ran rewinds the evening for
 * everyone in the room and posts a second "<title> is starting" broadcast to all
 * of them. The six rows sit flush in the host console and the past ones are the
 * nearest neighbours of the current one, which makes that a plausible thumb slip
 * rather than a rare mistake.
 *
 * Going forwards -- the overwhelmingly common case -- is unaffected.
 */
export class ScheduleError extends Error {
  constructor(
    readonly reason: 'would_rewind',
    message: string,
    /** The item the caller asked for, so a confirming retry needs no re-lookup. */
    readonly itemId: string,
  ) {
    super(message);
    this.name = 'ScheduleError';
  }
}

/**
 * Where an upload came to rest.
 *
 * `upload()` returns this rather than resolving void, because a transfer failure
 * is NOT an exception here -- it is a state the guest can retry. A caller that
 * cannot tell delivered from failed will cheerfully announce success over a
 * failure, which is exactly what happened before this existed: the toast read
 * "Uploaded ... awaiting host approval" while the tile beneath it offered Retry.
 *
 * The two delivered cases are distinguished because they are different promises
 * to the guest: `pending` means a host still has to approve it, `approved` means
 * it is already in the album (the free tier has no moderation queue).
 */
export type UploadOutcome = 'pending' | 'approved' | 'failed';

export interface RunitRepository {
  session: {
    current: Observable<Session>;
    joinAsGuest(input: { code: string; nickname: string }): Promise<void>;
    /** Demo affordance: the canvas shows host and guest side by side. */
    becomeHost(hostId: string): Promise<void>;
    /**
     * Bind the current identity to a host seat by presenting its key.
     *
     * `becomeHost` cannot do this against a real backend: a host is whoever matches
     * `hosts.auth_user_id`, and Runit has no sign-in, so there is nothing for a person
     * to become. This is the missing half of `joinAsGuest` -- the same shape, one
     * credential heavier.
     *
     * Rejects with `JoinError('unknown_code')` for a code that matches no event and
     * `JoinError('bad_host_key')` for a wrong key. The two are distinct on purpose: the
     * event code is already discoverable through `joinAsGuest`, so collapsing them hides
     * nothing from an attacker and costs a real person the ability to tell which of the
     * two things they mistyped.
     */
    claimHost(input: { code: string; key: string }): Promise<void>;
    /** The other direction, without re-running the join validation. */
    becomeGuest(): Promise<void>;
    /**
     * Leave the EVENT and keep the identity.
     *
     * The distinction from `leave()` is load-bearing rather than stylistic. `join_event`
     * is idempotent on `(event_id, auth_user_id)`, so a re-join after this lands on the
     * SAME guest row -- votes, photo attribution and blocks intact. Signing out first
     * mints a new auth user, which does not conflict, which INSERTS a second row and
     * strands the first. This is the one a screen should call.
     */
    closeEvent(): Promise<void>;
    /** Leave the event AND forget who you are. Currently has no UI caller, deliberately. */
    leave(): Promise<void>;
  };

  event: {
    current: Observable<RunitEvent | null>;
    setActiveFolder(id: FolderId): Promise<void>;
    /** Dev-only, so the paywall is reachable while the demo sits on Event. */
    setTier(tier: RunitEvent['tier']): Promise<void>;
  };

  chat: {
    /** Pinned first, then oldest-to-newest, matching the canvas's feed order. */
    feed: Observable<Broadcast[]>;
    send(input: { body: string; pinned: boolean; push: boolean }): Promise<void>;
  };

  schedule: {
    items: Observable<ScheduleItem[]>;
    /**
     * Moves the cursor AND posts "<title> is starting · <place>".
     *
     * Throws `ScheduleError('would_rewind')` if `id` sits BEFORE the current item,
     * unless `opts.rewind` is true. Callers surface that as a confirmation rather
     * than swallowing it -- see `useScheduleActions`.
     */
    start(id: ScheduleItemId, opts?: { rewind?: boolean }): Promise<void>;
    add(input: { title: string; timeLabel: string | null; place: string }): Promise<void>;
  };

  music: {
    /** Live queue: not played, not declined, ranked by votes desc. */
    queue: Observable<SongRequest[]>;
    incoming: Observable<SongRequest[]>;
    accepted: Observable<SongRequest[]>;
    nowPlaying: Observable<NowPlaying | null>;
    /** Ids the CURRENT guest has voted for. Server-side per guest, not global. */
    myVotes: Observable<ReadonlySet<SongRequestId>>;
    request(input: { title: string; artist: string }): Promise<void>;
    setVote(id: SongRequestId, on: boolean): Promise<void>;
    accept(id: SongRequestId): Promise<void>;
    decline(id: SongRequestId): Promise<void>;
    markPlayed(id: SongRequestId): Promise<void>;
    playNext(): Promise<void>;
  };

  /**
   * The live tier + usage the write methods enforce against.
   *
   * Read-only, and deliberately so: this exists for ADVISORY checks -- "will this
   * be refused?" asked before doing expensive or irreversible work, like opening
   * a camera. Enforcement stays inside the write methods, because a check that
   * lives only in a caller is bypassed by the second caller. Exposing the same
   * numbers the repository already computes is what stops the UI growing its own
   * copy of the arithmetic and drifting from it.
   */
  entitlements: Observable<Entitlements>;

  photos: {
    folders: Observable<Folder[]>;
    /**
     * The host's moderation queue: `pending` ONLY.
     *
     * Deliberately excludes `uploading`. A photo still in transfer has no bytes
     * to look at, and putting it here gives the host live Approve/Hide buttons
     * over nothing -- it would also inflate the console badge, so the host is
     * told there is work waiting that they cannot do.
     */
    pending: Observable<Photo[]>;
    approved: Observable<Photo[]>;
    /**
     * The CURRENT GUEST's own in-flight and failed uploads.
     *
     * Separate from `pending` because the audiences are different: this is "your
     * photo is on its way / did not make it, here is a retry", which only the
     * uploader should see, and only for their own photos.
     */
    mine: Observable<Photo[]>;
    /**
     * Records a photo whose bytes already exist at `localUri`. Capture itself is
     * NOT here -- see src/lib/capture.ts for why a camera behind this interface
     * would make every future adapter carry one.
     */
    upload(input: { localUri: string }): Promise<UploadOutcome>;
    /**
     * Re-attempt a failed transfer. No-op unless the photo is `failed`, so a
     * double-tap cannot start two transfers for one photo.
     */
    retry(id: PhotoId): Promise<void>;
    approve(id: PhotoId): Promise<void>;
    hide(id: PhotoId): Promise<void>;
    addFolder(input: { name: string }): Promise<void>;
  };

  hosts: {
    all: Observable<{ id: string; displayName: string; role: HostRole }[]>;
    invite(input: { displayName: string; role: HostRole }): Promise<void>;
  };

  /**
   * App Review Guideline 1.2, the two halves that had no route.
   *
   * WHY BLOCKING LIVES HERE RATHER THAN IN EACH SCREEN. A block hides one guest's
   * content from one other guest, which touches `photos.approved`, `music.queue`,
   * `music.incoming` and `music.accepted` -- four observables on three screens. Applied
   * per screen it would be four copies of the same filter, and the fifth caller would
   * forget. Applied here it is one filter behind the seam, and the observables above
   * are ALREADY FILTERED by the time a screen sees them. That is the invariant: a
   * blocked guest's content does not reach the UI at all.
   *
   * The host is deliberately exempt. Moderation is the host's job, and a guest's block
   * cannot be allowed to hide evidence from the console -- so the filter applies to the
   * guest-facing observables, never to `photos.pending` or `moderation.reports`.
   */
  moderation: {
    /**
     * Everyone this guest has blocked, newest first. For the management list -- their
     * content is already gone from every observable above.
     */
    blocked: Observable<BlockedGuest[]>;
    /** The host queue: UNRESOLVED reports, oldest first, because a queue is a backlog. */
    reports: Observable<Report[]>;
    /**
     * Subject keys this guest has already reported, so a screen can say "Reported"
     * rather than re-offering the button. See `subjectKey`.
     */
    myReports: Observable<ReadonlySet<string>>;
    /**
     * File a report. Reporting the same subject twice is a NO-OP, not an error: a
     * double tap is not a failure, and the person tapping has nothing left to do.
     */
    report(input: { subject: ReportSubject; reason: ReportReason; note?: string }): Promise<void>;
    /** Hide this guest's content from the current guest. Idempotent. */
    block(guestId: GuestId): Promise<void>;
    unblock(guestId: GuestId): Promise<void>;
    /** Host only. Records WHAT was done, because "we responded" is the claim. */
    resolve(id: ReportId, resolution: ReportResolution): Promise<void>;
  };
}

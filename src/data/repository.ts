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
  Broadcast, Folder, FolderId, HostRole, NowPlaying, Photo, PhotoId,
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

export class JoinError extends Error {
  constructor(
    readonly reason: 'unknown_code' | 'event_full' | 'nickname_taken',
    message: string,
  ) {
    super(message);
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
    /** The other direction, without re-running the join validation. */
    becomeGuest(): Promise<void>;
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
}

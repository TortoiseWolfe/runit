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
import type { EntitlementDenial } from '@/domain/entitlements';

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

export interface RunitRepository {
  session: {
    current: Observable<Session>;
    joinAsGuest(input: { code: string; nickname: string }): Promise<void>;
    /** Dev/demo affordance: the canvas shows host and guest side by side. */
    becomeHost(hostId: string): Promise<void>;
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
    /** Moves the cursor AND posts "<title> is starting · <place>". */
    start(id: ScheduleItemId): Promise<void>;
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

  photos: {
    folders: Observable<Folder[]>;
    pending: Observable<Photo[]>;
    approved: Observable<Photo[]>;
    upload(input: { localUri: string | null }): Promise<void>;
    approve(id: PhotoId): Promise<void>;
    hide(id: PhotoId): Promise<void>;
    addFolder(input: { name: string }): Promise<void>;
  };

  hosts: {
    all: Observable<{ id: string; displayName: string; role: HostRole }[]>;
    invite(input: { displayName: string; role: HostRole }): Promise<void>;
  };
}

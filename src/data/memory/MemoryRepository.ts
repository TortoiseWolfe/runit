/**
 * In-memory RunitRepository.
 *
 * Ports the canvas's behaviour, not its shape. Where the canvas takes a
 * shortcut that a real backend cannot, this does the honest thing and the
 * difference is commented -- see design/FIDELITY.md for the full list.
 *
 * Entitlement checks live in the write methods, deliberately. A check that only
 * exists in a button's onPress is bypassed by the second caller.
 */
import type {
  Broadcast, Folder, FolderId, Host, HostRole, NowPlaying, Photo, PhotoId,
  RunitEvent, ScheduleItem, ScheduleItemId, Session, SongRequest, SongRequestId, TierId,
} from '../types';
import {
  EntitlementError, JoinError, ScheduleError, type UploadOutcome,
  type Observable, type RunitRepository, type Unsubscribe,
} from '../repository';
import { checkFeature, checkLimit, type Entitlements } from '@/domain/entitlements';
import { TIERS } from '@/domain/tiers';
import { hueForPhotoSeq } from '@/theme/oklch';

export interface Seed {
  event: RunitEvent;
  hosts: Host[];
  broadcasts: Broadcast[];
  schedule: ScheduleItem[];
  requests: SongRequest[];
  myGuestId: string;
  myVotes: SongRequestId[];
  nowPlaying: NowPlaying | null;
  folders: Folder[];
  pendingPhotos: Photo[];
  /** Optional: already-moderated photos, so the album grid has content. */
  approvedPhotos?: Photo[];
  nextPhotoSeq: number;
}

class Signal<T> implements Observable<T> {
  private listeners = new Set<(v: T) => void>();
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  set(v: T): void {
    this.value = v;
    for (const l of this.listeners) l(v);
  }
  subscribe(listener: (v: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/**
 * The highest number any id in the seed ends with.
 *
 * Generated ids share one counter, so `id('req')` can never collide with
 * `id('pho')`. What they CAN collide with is the seed, whose ids end in numbers
 * too -- and a counter starting at 0 mints `req_1` and `pho_1`, both already
 * taken by fixtures/wedding.ts. The damage was silent: two rows rendering the
 * same testID, duplicate React keys, and `patchRequest` matching by id patching
 * BOTH rows, so removing a vote from a newly requested song dragged a seeded
 * song's tally down with it (Dancing Queen 41 -> 40 while Dreams rose 1 -> 40).
 *
 * Walking the seed rather than hardcoding a floor keeps this correct for seeds
 * written later, including the `housePartySeed` fixture and any a fork adds.
 */
function highestSeedSeq(seed: Seed): number {
  let high = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && (key === 'id' || key.endsWith('Id'))) {
        const tail = /_(\d+)$/.exec(value);
        if (tail) high = Math.max(high, Number(tail[1] ?? 0));
      } else {
        walk(value);
      }
    }
  };
  walk(seed);
  return high;
}

/**
 * The in-memory host key. A FIXTURE VALUE and deliberately obvious as one -- the real
 * keys live as bcrypt hashes in Postgres and appear in no file here.
 */
export const DEMO_HOST_KEY = 'DEMO-HOST-KEY0';

const byVotesDesc = (a: SongRequest, b: SongRequest) =>
  b.voteCount - a.voteCount || a.createdAt.localeCompare(b.createdAt);

export class MemoryRepository implements RunitRepository {
  private ev: RunitEvent;
  private hostList: Host[];
  private broadcastList: Broadcast[];
  private scheduleList: ScheduleItem[];
  private requestList: SongRequest[];
  private folderList: Folder[];
  private photoList: Photo[];
  private votes: Set<SongRequestId>;
  private myGuestId: string;
  private nextPhotoSeq: number;
  private seq: number;
  /** Injectable so tests are deterministic. */
  private now: () => string;
  private hostKey: string;
  /**
   * How bytes get somewhere durable.
   *
   * THE DEFAULT IS INSTANT SUCCESS, AND THAT IS THE TRUTH RATHER THAN A STUB.
   * This adapter keeps everything in memory; the bytes are already on the device
   * and nothing is being sent anywhere, so there is no transfer to be slow. A
   * fabricated two-second progress bar over a local file would be theatre -- it
   * would show a guest work that is not happening.
   *
   * It is injectable because the states it drives are real for the adapter that
   * WILL send bytes, and they have to be buildable and testable before that
   * adapter exists. Tests and the `flakyTransfer` fixture inject one that
   * reports progress and fails, which is the only way `uploading` and `failed`
   * are reachable today.
   */
  private transfer: (photo: Photo, onProgress: (fraction: number) => void) => Promise<void>;

  private sigSession: Signal<Session>;
  private sigEvent: Signal<RunitEvent | null>;
  private sigFeed: Signal<Broadcast[]>;
  private sigSchedule: Signal<ScheduleItem[]>;
  private sigQueue: Signal<SongRequest[]>;
  private sigIncoming: Signal<SongRequest[]>;
  private sigAccepted: Signal<SongRequest[]>;
  private sigNowPlaying: Signal<NowPlaying | null>;
  private sigMyVotes: Signal<ReadonlySet<SongRequestId>>;
  private sigFolders: Signal<Folder[]>;
  private sigPending: Signal<Photo[]>;
  private sigMine: Signal<Photo[]>;
  private sigApproved: Signal<Photo[]>;
  private sigHosts: Signal<{ id: string; displayName: string; role: HostRole }[]>;
  private sigEntitlements: Signal<Entitlements>;

  /** Live tier + usage. Advisory reads only; enforcement is in the write methods. */
  entitlements: Observable<Entitlements> = undefined as unknown as Observable<Entitlements>;

  constructor(
    seed: Seed,
    opts: {
      now?: () => string;
      transfer?: (photo: Photo, onProgress: (fraction: number) => void) => Promise<void>;
      hostKey?: string;
    } = {},
  ) {
    this.now = opts.now ?? (() => new Date().toISOString());
    // A FIXTURE, not a secret. The real key exists only as a bcrypt hash in Postgres
    // and is never in this repo; this exists so the claim flow has both branches to
    // exercise without a network.
    this.hostKey = opts.hostKey ?? DEMO_HOST_KEY;
    this.transfer = opts.transfer ?? (async () => {});
    this.ev = { ...seed.event };
    this.hostList = [...seed.hosts];
    this.broadcastList = [...seed.broadcasts];
    this.scheduleList = [...seed.schedule];
    this.requestList = [...seed.requests];
    this.folderList = [...seed.folders];
    this.photoList = [...seed.pendingPhotos, ...(seed.approvedPhotos ?? [])];
    this.votes = new Set(seed.myVotes);
    this.myGuestId = seed.myGuestId;
    this.nextPhotoSeq = seed.nextPhotoSeq;
    // Start above every number the seed uses, so a minted id can never
    // collide with a seeded one. See highestSeedSeq.
    this.seq = highestSeedSeq(seed);

    this.sigSession = new Signal<Session>({ kind: 'anonymous' });
    this.sigEvent = new Signal<RunitEvent | null>(this.ev);
    this.sigFeed = new Signal<Broadcast[]>([]);
    this.sigSchedule = new Signal<ScheduleItem[]>([]);
    this.sigQueue = new Signal<SongRequest[]>([]);
    this.sigIncoming = new Signal<SongRequest[]>([]);
    this.sigAccepted = new Signal<SongRequest[]>([]);
    this.sigNowPlaying = new Signal<NowPlaying | null>(seed.nowPlaying);
    this.sigMyVotes = new Signal<ReadonlySet<SongRequestId>>(new Set(this.votes));
    this.sigFolders = new Signal<Folder[]>([]);
    this.sigPending = new Signal<Photo[]>([]);
    this.sigMine = new Signal<Photo[]>([]);
    this.sigApproved = new Signal<Photo[]>([]);
    this.sigHosts = new Signal<{ id: string; displayName: string; role: HostRole }[]>([]);
    this.sigEntitlements = new Signal<Entitlements>(this.computeEntitlements());
    // Class field initialisers (session = {...}, chat = {...}, ...) run BEFORE
    // this constructor body, so their `current`/`feed` slots are still empty at
    // that point. Wiring happens here, once every signal exists.
    this.wire();
    this.recompute();
  }

  private patchPhoto(id: PhotoId, patch: Partial<Photo>): void {
    this.photoList = this.photoList.map((p) => (p.id === id ? { ...p, ...patch } : p));
  }

  /**
   * Run one transfer attempt and land the photo in its next resting state.
   *
   * Never throws. A failed upload is a state the guest can see and act on, not
   * an exception the caller has to catch -- and `upload()` is already reached
   * through `useGuardedAction`, which would route a throw to the PAYWALL. A
   * flaky network is not a billing problem.
   */
  private async runTransfer(id: PhotoId): Promise<UploadOutcome> {
    const photo = this.photoList.find((p) => p.id === id);
    if (!photo) return 'failed';

    try {
      await this.transfer(photo, (fraction) => {
        // Ignore progress for a photo that has already settled -- a late
        // callback from an abandoned attempt must not resurrect a spinner.
        const live = this.photoList.find((p) => p.id === id);
        if (!live || live.status !== 'uploading') return;
        this.patchPhoto(id, { progress: Math.min(1, Math.max(0, fraction)) });
        this.recompute();
      });
    } catch (err) {
      this.patchPhoto(id, {
        status: 'failed',
        progress: null,
        failureReason: err instanceof Error ? err.message : 'Upload failed',
      });
      this.recompute();
      return 'failed';
    }

    // Success. The free tier has no approval queue, so uploads land approved;
    // paid tiers wait for a host. This is the one behavioural fork the tier copy
    // implies but never states outright.
    const moderated = checkFeature(this.computeEntitlements(), 'photoModeration').allowed;
    this.patchPhoto(id, {
      status: moderated ? 'pending' : 'approved',
      progress: null,
      failureReason: null,
    });
    if (!moderated) this.bumpFolder(photo.folderId, 1);
    this.recompute();
    return moderated ? 'pending' : 'approved';
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  private computeEntitlements(): Entitlements {
    return {
      tier: TIERS[this.ev.tier],
      usage: {
        guests: this.ev.guestCount,
        hosts: this.hostList.length,
        // folder.photoCount already counts APPROVED photos, so adding the
        // approved rows again would double-count them: a free-tier upload
        // would consume two of its 100 slots.
        photosStored:
          this.folderList.reduce((a, f) => a + f.photoCount, 0) +
          this.photoList.filter((p) => p.status === 'pending' || p.status === 'uploading').length,
        folders: this.folderList.length,
      },
    };
  }

  private recompute(): void {
    // Published on every recompute, so an advisory check can never be reading
    // a tier or a usage count the write methods have already moved past.
    this.sigEntitlements.set(this.computeEntitlements());
    this.sigEvent.set({ ...this.ev });
    // Pinned first, then oldest-to-newest -- the canvas renders its feed in
    // insertion order with new messages at the bottom, chat-style.
    this.sigFeed.set(
      [...this.broadcastList].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt),
      ),
    );
    this.sigSchedule.set([...this.scheduleList].sort((a, b) => a.position - b.position));

    const live = this.requestList.filter((r) => r.status !== 'played' && r.status !== 'declined');
    this.sigQueue.set(live.sort(byVotesDesc));
    this.sigIncoming.set(this.requestList.filter((r) => r.status === 'pending').sort(byVotesDesc));
    this.sigAccepted.set(this.requestList.filter((r) => r.status === 'accepted').sort(byVotesDesc));
    this.sigMyVotes.set(new Set(this.votes));

    this.sigFolders.set([...this.folderList].sort((a, b) => a.position - b.position));
    // `pending` ONLY -- an in-flight photo has no bytes for a host to judge, and
    // including it would inflate the console badge with work nobody can do.
    this.sigPending.set(
      this.photoList
        .filter((p) => p.status === 'pending')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
    // The uploader's own view of their transfers. Scoped to this guest: nobody
    // else's failed upload is any of their business.
    this.sigMine.set(
      this.photoList
        .filter(
          (p) =>
            (p.status === 'uploading' || p.status === 'failed') &&
            p.uploadedByGuestId === this.myGuestId,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
    this.sigApproved.set(
      this.photoList
        .filter((p) => p.status === 'approved')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
    this.sigHosts.set(this.hostList.map(({ id, displayName, role }) => ({ id, displayName, role })));
  }

  private patchRequest(id: SongRequestId, patch: Partial<SongRequest>): void {
    this.requestList = this.requestList.map((r) => (r.id === id ? { ...r, ...patch } : r));
  }

  // ---------------------------------------------------------------- session

  session = {
    current: undefined as unknown as Observable<Session>,
    joinAsGuest: async ({ code, nickname }: { code: string; nickname: string }) => {
      // The canvas sets joined:true unconditionally -- it never validates the
      // code and never checks capacity. Both are real failure modes.
      if (code.trim().toUpperCase() !== this.ev.code) {
        throw new JoinError('unknown_code', "That code doesn't match an event.");
      }
      const seat = checkLimit(this.computeEntitlements(), 'guests');
      if (!seat.allowed) throw new JoinError('event_full', 'This event is full.');

      this.ev = { ...this.ev, guestCount: this.ev.guestCount + 1 };
      this.sigSession.set({
        kind: 'guest',
        guestId: this.myGuestId,
        nickname: nickname.trim() || 'you',
      });
      this.recompute();
    },
    becomeHost: async (hostId: string) => {
      const h = this.hostList.find((x) => x.id === hostId);
      if (!h) throw new Error(`no such host: ${hostId}`);
      this.sigSession.set({
        kind: 'host', hostId: h.id, displayName: h.displayName, role: h.role, roleLabel: h.roleLabel,
      });
    },
    /**
     * The in-memory analogue of the real claim. There is no bcrypt and no auth user
     * here -- the key IS the whole check -- but the SHAPE has to match, because this
     * is what the e2e suite drives and a flow that only exists against Supabase is a
     * flow nothing can test.
     *
     * `hostKey` is injectable so a test can exercise both branches; the default is a
     * fixture value, not a secret.
     */
    claimHost: async ({ code, key }: { code: string; key: string }) => {
      if (code.trim().toUpperCase() !== this.ev.code) {
        throw new JoinError('unknown_code', "That code doesn't match an event.");
      }
      const canonical = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (canonical(key) !== canonical(this.hostKey)) {
        throw new JoinError('bad_host_key', "That host key isn't right for this event.");
      }
      const h = this.hostList[0];
      if (!h) throw new Error('This event has no host seat to claim.');
      this.sigSession.set({
        kind: 'host', hostId: h.id, displayName: h.displayName, role: h.role, roleLabel: h.roleLabel,
      });
    },

    becomeGuest: async () => {
      const s = this.sigSession.get();
      this.sigSession.set({
        kind: 'guest',
        guestId: this.myGuestId,
        nickname: s.kind === 'guest' ? s.nickname : 'you',
      });
    },
    leave: async () => {
      this.sigSession.set({ kind: 'anonymous' });
    },
  };

  // ------------------------------------------------------------------ event

  event = {
    current: undefined as unknown as Observable<RunitEvent | null>,
    setActiveFolder: async (id: FolderId) => {
      this.ev = { ...this.ev, activeFolderId: id };
      this.recompute();
    },
    setTier: async (tier: TierId) => {
      this.ev = { ...this.ev, tier };
      this.recompute();
    },
  };

  // ------------------------------------------------------------------- chat

  chat = {
    feed: undefined as unknown as Observable<Broadcast[]>,
    send: async ({ body, pinned, push }: { body: string; pinned: boolean; push: boolean }) => {
      const text = body.trim();
      if (!text) return;
      const s = this.sigSession.get();
      const host =
        s.kind === 'host'
          ? this.hostList.find((h) => h.id === s.hostId)
          : this.hostList[0];
      if (!host) throw new Error('no host to author the broadcast');

      // Degrade rather than reject. Refusing to post an announcement because
      // the plan cannot PIN it would be hostile; the toggle was already locked
      // in the UI, so this is defence in depth.
      const e = this.computeEntitlements();
      const canPin = pinned && checkFeature(e, 'pinnedAnnouncements').allowed;
      const canPush = push && checkFeature(e, 'pushNotifications').allowed;

      this.broadcastList = [
        ...this.broadcastList,
        {
          id: this.id('bc'),
          authorHostId: host.id,
          authorName: host.displayName,
          authorRoleLabel: host.roleLabel,
          kind: 'announcement',
          // The canvas DROPS the pin flag here (pin:false in the same
          // setState), so pinning does nothing. Fixed.
          pinned: canPin,
          body: text,
          seenCount: 0,
          createdAt: this.now(),
        },
      ];
      void canPush; // push fan-out belongs to the backend adapter
      this.recompute();
    },
  };

  // --------------------------------------------------------------- schedule

  schedule = {
    items: undefined as unknown as Observable<ScheduleItem[]>,
    start: async (id: ScheduleItemId, opts: { rewind?: boolean } = {}) => {
      const target = this.scheduleList.findIndex((s) => s.id === id);
      if (target === -1) return;
      const item = this.scheduleList[target]!;

      // Refuse to walk the cursor backwards by accident. nowScheduleItemId is not
      // host-private state -- it drives every guest's Now/Next card -- so a slip
      // onto a past row rewinds the evening for the whole room and posts a second
      // "is starting" broadcast to all of them. The past rows are the current
      // row's immediate neighbours in a flush list, so this is a thumb slip, not
      // an exotic case. Forwards is untouched; only backwards asks twice.
      const current = this.scheduleList.findIndex((s) => s.id === this.ev.nowScheduleItemId);
      if (!opts.rewind && current !== -1 && target < current) {
        throw new ScheduleError(
          'would_rewind',
          `${item.title} already ran. Starting it again moves the run of show backwards for every guest.`,
          id,
        );
      }

      const at = this.now();
      this.scheduleList = this.scheduleList.map((s) =>
        s.id === id ? { ...s, startedAt: at } : s,
      );
      this.ev = { ...this.ev, nowScheduleItemId: id };
      const host = this.hostList[0];
      if (host) {
        this.broadcastList = [
          ...this.broadcastList,
          {
            id: this.id('bc'),
            authorHostId: host.id,
            authorName: host.displayName,
            authorRoleLabel: host.roleLabel,
            kind: 'schedule_started',
            body: `${item.title} is starting · ${item.place}`,
            pinned: false,
            seenCount: 0,
            createdAt: at,
          },
        ];
      }
      this.recompute();
    },
    add: async ({ title, timeLabel, place }: { title: string; timeLabel: string | null; place: string }) => {
      const position = Math.max(0, ...this.scheduleList.map((s) => s.position)) + 1;
      this.scheduleList = [
        ...this.scheduleList,
        { id: this.id('sch'), position, timeLabel, title, place, startedAt: null },
      ];
      this.recompute();
    },
  };

  // ------------------------------------------------------------------ music

  music = {
    queue: undefined as unknown as Observable<SongRequest[]>,
    incoming: undefined as unknown as Observable<SongRequest[]>,
    accepted: undefined as unknown as Observable<SongRequest[]>,
    nowPlaying: undefined as unknown as Observable<NowPlaying | null>,
    myVotes: undefined as unknown as Observable<ReadonlySet<SongRequestId>>,

    request: async ({ title, artist }: { title: string; artist: string }) => {
      const s = this.sigSession.get();
      const id = this.id('req');
      this.requestList = [
        ...this.requestList,
        {
          id,
          title,
          artist: artist || 'Unknown artist',
          requestedByGuestId: s.kind === 'guest' ? s.guestId : null,
          requestedByName: s.kind === 'guest' ? s.nickname : 'you',
          status: 'pending',
          voteCount: 1,
          createdAt: this.now(),
        },
      ];
      // The canvas wipes `mine` off every other row, so a guest may only ever
      // have one request. Ownership here is by id, so they can have several.
      this.votes.add(id);
      this.recompute();
    },

    setVote: async (id: SongRequestId, on: boolean) => {
      const had = this.votes.has(id);
      if (had === on) return; // idempotent, unlike the canvas's toggle
      if (on) this.votes.add(id);
      else this.votes.delete(id);
      const r = this.requestList.find((x) => x.id === id);
      if (r) this.patchRequest(id, { voteCount: Math.max(0, r.voteCount + (on ? 1 : -1)) });
      this.recompute();
    },

    accept: async (id: SongRequestId) => {
      const e = this.computeEntitlements();
      const gate = checkFeature(e, 'djQueue');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      this.patchRequest(id, { status: 'accepted' });
      this.recompute();
    },

    decline: async (id: SongRequestId) => {
      const e = this.computeEntitlements();
      const gate = checkFeature(e, 'djQueue');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      this.patchRequest(id, { status: 'declined' });
      this.recompute();
    },

    markPlayed: async (id: SongRequestId) => {
      // Gated identically to accept/decline: all three are the DJ console, and
      // an ungated markPlayed is a strictly stronger decline -- it moves a
      // request out of Incoming without the tier that sells the queue.
      const e = this.computeEntitlements();
      const gate = checkFeature(e, 'djQueue');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      this.patchRequest(id, { status: 'played' });
      this.recompute();
    },

    playNext: async () => {
      const e = this.computeEntitlements();
      const gate = checkFeature(e, 'djQueue');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      const next = this.sigAccepted.get()[0];
      if (!next) return;
      this.patchRequest(next.id, { status: 'played' });
      this.sigNowPlaying.set({
        title: next.title,
        artist: next.artist,
        fromRequestId: next.id,
        startedAt: this.now(),
      });
      this.recompute();
    },
  };

  // ----------------------------------------------------------------- photos

  photos = {
    folders: undefined as unknown as Observable<Folder[]>,
    pending: undefined as unknown as Observable<Photo[]>,
    approved: undefined as unknown as Observable<Photo[]>,
    mine: undefined as unknown as Observable<Photo[]>,

    upload: async ({ localUri }: { localUri: string }) => {
      const e = this.computeEntitlements();
      const cap = checkLimit(e, 'photos');
      if (!cap.allowed) throw new EntitlementError(cap.denial);

      const s = this.sigSession.get();
      const seq = this.nextPhotoSeq;
      this.nextPhotoSeq += 1;
      const folderId = this.ev.activeFolderId;
      const id = this.id('pho');

      // The row is created as `uploading` and only becomes visible to the host
      // once its bytes have actually moved. It counts against the tier cap from
      // this moment, deliberately: otherwise a guest could start a hundred
      // transfers and blow past a cap that is only checked at the start of each.
      this.photoList = [
        {
          id,
          folderId,
          uploadedByGuestId: s.kind === 'guest' ? s.guestId : null,
          uploadedByName: s.kind === 'guest' ? s.nickname : 'you',
          status: 'uploading',
          hue: hueForPhotoSeq(seq),
          localUri,
          progress: 0,
          failureReason: null,
          // Stays null until an adapter puts the bytes somewhere remote.
          storagePath: null,
          createdAt: this.now(),
        },
        ...this.photoList,
      ];
      this.recompute();

      return await this.runTransfer(id);
    },

    retry: async (id: PhotoId) => {
      const photo = this.photoList.find((p) => p.id === id);
      // Guarded so a double-tap cannot start two transfers for one photo, and
      // so retrying something already delivered cannot un-deliver it.
      if (!photo || photo.status !== 'failed') return;
      this.patchPhoto(id, { status: 'uploading', progress: 0, failureReason: null });
      this.recompute();
      await this.runTransfer(id);
    },

    approve: async (id: PhotoId) => {
      // upload() already reads this feature to decide whether a photo lands
      // pending or approved; the queue it creates has to be gated by the same
      // one, or a free tier can moderate a queue it is not sold.
      const e = this.computeEntitlements();
      const gate = checkFeature(e, 'photoModeration');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      const p = this.photoList.find((x) => x.id === id);
      if (!p || p.status === 'approved') return;
      this.photoList = this.photoList.map((x) =>
        x.id === id ? { ...x, status: 'approved' as const } : x,
      );
      // The canvas matches the folder BY NAME, so two folders with the same
      // name both increment. Matched by id here.
      this.bumpFolder(p.folderId, 1);
      this.recompute();
    },

    hide: async (id: PhotoId) => {
      // The canvas deletes the row outright, losing it. "Hide" and "delete
      // forever" are different, and moderation needs an audit trail.
      const e = this.computeEntitlements();
      const gate = checkFeature(e, 'photoModeration');
      if (!gate.allowed) throw new EntitlementError(gate.denial);
      this.photoList = this.photoList.map((x) =>
        x.id === id ? { ...x, status: 'hidden' as const } : x,
      );
      this.recompute();
    },

    addFolder: async ({ name }: { name: string }) => {
      const e = this.computeEntitlements();
      const cap = checkLimit(e, 'folders');
      if (!cap.allowed) throw new EntitlementError(cap.denial);
      const position = Math.max(0, ...this.folderList.map((f) => f.position)) + 1;
      this.folderList = [
        ...this.folderList,
        { id: this.id('fld'), name: name.trim() || `Folder ${position}`, position, photoCount: 0 },
      ];
      this.recompute();
    },
  };

  // ------------------------------------------------------------------ hosts

  hosts = {
    all: undefined as unknown as Observable<{ id: string; displayName: string; role: HostRole }[]>,
    invite: async ({ displayName, role }: { displayName: string; role: HostRole }) => {
      const e = this.computeEntitlements();
      const seat = checkLimit(e, 'hosts');
      if (!seat.allowed) throw new EntitlementError(seat.denial);
      if (role !== 'host') {
        const roles = checkFeature(e, 'hostRoles');
        if (!roles.allowed) throw new EntitlementError(roles.denial);
      }
      this.hostList = [
        ...this.hostList,
        { id: this.id('hst'), displayName, role, roleLabel: displayName },
      ];
      this.recompute();
    },
  };

  private bumpFolder(id: FolderId, by: number): void {
    this.folderList = this.folderList.map((f) =>
      f.id === id ? { ...f, photoCount: Math.max(0, f.photoCount + by) } : f,
    );
  }

  /** Attach the signals to the public groups. See the note in the constructor. */
  private wire(): void {
    this.session.current = this.sigSession;
    this.event.current = this.sigEvent;
    this.chat.feed = this.sigFeed;
    this.schedule.items = this.sigSchedule;
    this.music.queue = this.sigQueue;
    this.music.incoming = this.sigIncoming;
    this.music.accepted = this.sigAccepted;
    this.music.nowPlaying = this.sigNowPlaying;
    this.music.myVotes = this.sigMyVotes;
    this.photos.folders = this.sigFolders;
    this.photos.pending = this.sigPending;
    this.photos.approved = this.sigApproved;
    this.photos.mine = this.sigMine;
    this.entitlements = this.sigEntitlements;
    this.hosts.all = this.sigHosts;
  }

  static create(
    seed: Seed,
    opts: {
      now?: () => string;
      transfer?: (photo: Photo, onProgress: (fraction: number) => void) => Promise<void>;
      /** Fixture value, not a secret -- the real key lives as a bcrypt hash in Postgres. */
      hostKey?: string;
    } = {},
  ): MemoryRepository {
    return new MemoryRepository(seed, opts);
  }
}

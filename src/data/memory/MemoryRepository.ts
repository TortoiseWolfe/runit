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
import * as Crypto from 'expo-crypto';

import type {
  GuestList, GuestListId,
  BlockedGuest, Broadcast, BroadcastId, Folder, FolderId, GuestId, Host, HostRole,
  Invitee, InviteeId, NowPlaying, Photo, PhotoId,
  Report, ReportId, ReportReason, ReportResolution, ReportSubject,
  RunitEvent, ScheduleItem, ScheduleItemId, Session, SongRequest, SongRequestId, TierId,
} from '../types';
import { subjectKey } from '../types';
import {
  EntitlementError, JoinError, ScheduleError, type UploadOutcome,
  type ConnectionState, type EventDetails, type EventPreview, type NewEvent, type NewHost,
  type Observable, type RunitRepository, type Unsubscribe,
  HostedEvent,
} from '../repository';
import { checkFeature, checkLimit, type Entitlements } from '@/domain/entitlements';
import { TIERS } from '@/domain/tiers';
import { songKey } from '@/domain/songKey';
import { phoneKey } from '@/domain/phoneKey';
import { hueForPhotoSeq } from '@/theme/oklch';

export interface Seed {
  /**
   * NULL IS A REAL WORLD, and this type used to forbid it.
   *
   * `nowPlaying` and `approvedPhotos` beside it were already nullable, so absence was
   * modelled per field -- and someone decided the event always exists. Against Supabase
   * it usually does not: `events_read` admits members only, so `event.current` is null
   * until joinAsGuest returns. SupabaseRepository even starts its signal at null and
   * says so in a comment.
   *
   * The consequence was not academic. Every e2e journey booted a seeded event, so
   * `disabled={!event}` on the calendar pill, Show QR and Share invite was the dead half
   * of a boolean the suite could only ever evaluate one way -- and join.spec.ts CLICKS
   * that pill and passes. Three separate device reports found what one fixture would
   * have.
   */
  event: RunitEvent | null;
  /**
   * What `event.lookUp(code)` can find WITHOUT a join.
   *
   * A third world, and the suite could not previously reach it. Against Supabase
   * there are three states, not two: no event and no code (`emptySeed`); no event
   * but a code from a link, which resolves to an invitation (this); and joined
   * (`weddingSeed`). Leaving this out is what kept the whole preview path dead in
   * every test -- the same shape as the bug that shipped three inert controls off
   * one `disabled={!event}`.
   *
   * The seeded fixtures derive it from their own event, so a preview and a join can
   * never disagree about the same code.
   */
  preview: EventPreview | null;
  /**
   * The events this identity is staff at (#17). Optional, and empty is the honest
   * default: most worlds here are a GUEST's, and a guest hosts nothing.
   *
   * WHAT MEMORY CAN AND CANNOT MODEL, said out loud rather than implied. It can model the
   * LIST and the SWITCH -- which is what the screens do. It cannot model the CONTENT of
   * the event switched into: a `HostedEvent` carries seven fields and a `RunitEvent` has
   * twelve, and this fixture holds one event's broadcasts, songs and photos. So `open()`
   * moves to an event whose collections are empty, and that is a true statement about
   * this adapter rather than a pretend party. Same honesty as `invitedSeed`, which proves
   * the invitation SCREEN and says it cannot prove the join that follows.
   */
  hosted?: HostedEvent[];
  hosts: Host[];
  /** Optional so existing fixtures need no edit; an absent list is an empty one. */
  invitees?: Invitee[];
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
 * The code and key alphabet, matching `mint_token` in the migration.
 *
 * No 0/O and no 1/I/L: a guest types the code off a place card in a dim room and a host
 * reads the key off a note. Kept in step with the SQL by hand, which is a small drift
 * risk -- the failure mode is a fixture minting a character production would not, which
 * the shape assertions in tests/e2e/create-event.spec.ts catch.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** The largest multiple of 31 that fits in a byte. See the rejection note below. */
const BYTE_LIMIT = 256 - (256 % ALPHABET.length);

/**
 * A CSPRNG, not `Math.random()`, and the same rejection sampling as `mint_token`.
 *
 * TO BE CLEAR ABOUT WHAT THIS IS: nothing here is a real credential. This adapter holds
 * its whole world in one process on one device, and the "key" it mints is compared
 * against its own field -- there is no attacker, no network and no shared state. Using
 * Math.random() would not have been exploitable.
 *
 * It is written this way anyway for two reasons. The parity one: this fixture exists to
 * behave like the adapter that ships, and a fake with weaker properties than production
 * is how a harness goes green on a broken app. And the copy-paste one: `Math.random()`
 * two lines from a value named `key` is a pattern somebody will lift into a place where
 * it does matter -- which is exactly what happened in the migration, where the same
 * shape WAS reachable by anyone who could sign in anonymously.
 *
 * expo-crypto rather than globalThis.crypto for the reason `SupabaseRepository.upload`
 * already gives: the container runs Node and the phone runs Hermes, and testing one
 * while shipping the other is how the timezone fix passed 144 tests and died on device.
 */
const mintFromAlphabet = (len: number): string => {
  let out = '';
  while (out.length < len) {
    const bytes = Crypto.getRandomBytes(Math.max(len * 2, 16));
    for (const b of bytes) {
      if (out.length >= len) break;
      // 256 is not a multiple of 31, so a bare modulo would make the first eight
      // characters ~3% likelier than the rest. Discard the tail instead of folding it.
      if (b >= BYTE_LIMIT) continue;
      out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
};

/** What a seat is called when nobody named it. Mirrors invite_host's own fallback. */
const DEFAULT_ROLE_LABEL: Record<HostRole, string> = {
  host: 'Host',
  dj: 'DJ',
  planner: 'Planner',
};

/** XV24HJ78DBAB -> XV24-HJ78-DBAB. Presentation only; claimHost canonicalises it back. */
const group = (key: string): string => `${key.slice(0, 4)}-${key.slice(4, 8)}-${key.slice(8, 12)}`;

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
  private ev: RunitEvent | null;
  private previewable: EventPreview | null;

  /**
   * The event, or the same refusal the Supabase adapter gives.
   *
   * Parity matters more than convenience here: SupabaseRepository throws
   * 'Not joined to an event yet.' from requireEvent(), and if this adapter quietly
   * coped with a null event the e2e suite would prove a leniency that does not ship.
   */
  private requireEvent(): RunitEvent {
    if (!this.ev) throw new Error('Not joined to an event yet.');
    return this.ev;
  }

  /**
   * Mirrors `SupabaseRepository.requireGuest()`, and exists for the same reason: some
   * actions are structurally a guest's. A host holds no guest row, so this is a real
   * refusal and not a fallback -- the paths that have an honest empty answer (votes,
   * blocks, "my reports") check for null instead of calling this.
   */
  /** Read marks for THIS device, mirroring the adapter's session-scoped set (#24). */
  private readonly readMarks = new Set<BroadcastId>();
  /**
   * Whether the seat this device holds belongs to someone who also holds a HOST seat.
   *
   * `fold_seen_count` and `guest_seats` both exclude such a seat, so the fixture has to
   * as well or Lane B goes green on a number the backend does not agree with. It is not
   * `holdsHostSeat`: that signal starts true here so the seeded world can reach the
   * console, and it answers "could you claim a seat", not "did you arrive as staff".
   */
  private seatIsStaff = false;

  private requireGuest(): string {
    if (this.myGuestId === null) throw new Error('Not joined as a guest yet.');
    return this.myGuestId;
  }
  private hostList: Host[];
  private inviteeList: Invitee[];
  private sigInvitees: Signal<Invitee[]>;
  private listRows: { id: string; name: string; createdAt: string }[] = [];
  private listMembers = new Map<string, { email: string | null; phone: string | null; displayName: string | null }[]>();
  private sigGuestLists: Signal<GuestList[]>;
  private broadcastList: Broadcast[];
  /**
   * The last push token handed to `session.setPushToken` (#27). It is stored rather than
   * discarded so a test can prove the registration path reached the seam -- the only
   * claim about push any lane in this environment can honestly make.
   */
  private pushToken: string | null = null;
  private scheduleList: ScheduleItem[];
  private requestList: SongRequest[];
  private folderList: Folder[];
  private photoList: Photo[];
  private votes: Set<SongRequestId>;
  /**
   * NULL IS A REAL STATE HERE, and it has to be, or the suite cannot see #37. A founder
   * holds a host seat and no guest row -- `create_event` deliberately mints none -- so
   * `becomeGuest` had nothing to switch to and the one door out of the host console
   * raised. Seeding this as a plain string made that state unreachable in the fixture,
   * which is why all 228 journeys were green over a console a real founder could not
   * leave. Same shape as `Seed.event` being non-nullable until `?empty=1`.
   */
  private myGuestId: string | null;
  private blockList: BlockedGuest[] = [];
  private reportList: Report[] = [];
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
  /**
   * Always true in this adapter, and that is deliberate rather than lazy. The fixtures
   * ARE a host and a guest in one process -- it is what lets the screenshot harness and
   * all 208 journeys reach the host artboards through `RoleSwitch`. Against Supabase the
   * same flag is a real question, which is the whole point of #29.
   */
  private sigHoldsHostSeat: Signal<boolean>;
  private sigEvent: Signal<RunitEvent | null>;
  private sigMyEvents: Signal<HostedEvent[]>;
  private hostedList: HostedEvent[];
  private sigPreview: Signal<EventPreview | null>;
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
  private sigHosts: Signal<Host[]>;
  private sigBlocked: Signal<BlockedGuest[]>;
  private sigReports: Signal<Report[]>;
  private sigMyReports: Signal<ReadonlySet<string>>;
  private sigEntitlements: Signal<Entitlements>;
  private sigConnection: Signal<ConnectionState>;

  /** Live tier + usage. Advisory reads only; enforcement is in the write methods. */
  entitlements: Observable<Entitlements> = undefined as unknown as Observable<Entitlements>;
  connection: Observable<ConnectionState> = undefined as unknown as Observable<ConnectionState>;

  /**
   * Nothing to reconnect TO. This adapter is `live` by definition -- there is no socket --
   * so this exists to satisfy the seam rather than to do work, and saying that plainly is
   * better than a comment claiming it retries something.
   */
  reconnect = async (): Promise<void> => {};

  constructor(
    seed: Seed,
    opts: {
      now?: () => string;
      transfer?: (photo: Photo, onProgress: (fraction: number) => void) => Promise<void>;
      hostKey?: string;
      /**
       * A FIXTURE STATE, not a simulation. This adapter has no socket, so it is `live` by
       * definition -- which means the harness could not render the connection surface at
       * all without this. Same reasoning as `?empty=1`: the bug is never "the control is
       * broken", it is "no test can reach the state where it matters".
       */
      connection?: ConnectionState;
    } = {},
  ) {
    this.now = opts.now ?? (() => new Date().toISOString());
    // A FIXTURE, not a secret. The real key exists only as a bcrypt hash in Postgres
    // and is never in this repo; this exists so the claim flow has both branches to
    // exercise without a network.
    this.hostKey = opts.hostKey ?? DEMO_HOST_KEY;
    this.transfer = opts.transfer ?? (async () => {});
    this.ev = seed.event ? { ...seed.event } : null;
    this.previewable = seed.preview ? { ...seed.preview } : null;
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
    this.sigHoldsHostSeat = new Signal<boolean>(true);
    this.inviteeList = [...(seed.invitees ?? [])];
    this.listRows = [];
    this.listMembers = new Map();
    this.sigInvitees = new Signal<Invitee[]>(this.inviteeList);
    this.sigGuestLists = new Signal<GuestList[]>([]);
    this.sigEvent = new Signal<RunitEvent | null>(this.ev);
    this.hostedList = seed.hosted ? [...seed.hosted] : [];
    this.sigMyEvents = new Signal<HostedEvent[]>(this.hostedList);
    // Starts null, like the adapter it stands in for. A preview is something a code
    // produced, never something the world arrived holding.
    this.sigPreview = new Signal<EventPreview | null>(null);
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
    this.sigHosts = new Signal<Host[]>([]);
    this.sigBlocked = new Signal<BlockedGuest[]>([]);
    this.sigReports = new Signal<Report[]>([]);
    this.sigMyReports = new Signal<ReadonlySet<string>>(new Set());
    this.sigEntitlements = new Signal<Entitlements>(this.computeEntitlements());
    this.sigConnection = new Signal<ConnectionState>(opts.connection ?? 'live');
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

    // Success. Whether it waits is the EVENT's setting, not the tier's.
    //
    // MIRRORS THE TRIGGER, NOT A CLIENT RULE (#50). Against Supabase `set_photo_status`
    // decides this and `status` is not even in the INSERT grant; here there is no
    // database, so the fixture applies the same rule from the same source --
    // `events.photo_moderation`. If these two ever disagree, the e2e journeys describe a
    // moderation queue the real backend does not build.
    //
    // It reads the flag HERE, at the end of the transfer, rather than when the upload
    // began -- the trigger fires on the INSERT, which is this moment. A host who turns
    // approval on mid-party gates the next photo, not the one already on the wire.
    const moderated = this.requireEvent().photoModeration;
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
      tier: TIERS[this.ev?.tier ?? 'house_party'],
      usage: {
        guests: this.ev?.guestCount ?? 0,
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
    this.sigEvent.set(this.ev ? { ...this.ev } : null);
    this.sigInvitees.set(this.inviteeList);
    // The member count is FOLDED here rather than stored, the same way `photoCount` is on a
    // folder: two places holding one number is how they come to disagree.
    this.sigGuestLists.set(
      this.listRows.map((l) => ({
        id: l.id,
        name: l.name,
        memberCount: (this.listMembers.get(l.id) ?? []).length,
        createdAt: l.createdAt,
      })),
    );
    // Pinned first, then oldest-to-newest -- the canvas renders its feed in
    // insertion order with new messages at the bottom, chat-style.
    this.sigFeed.set(
      [...this.broadcastList].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt),
      ),
    );
    this.sigSchedule.set([...this.scheduleList].sort((a, b) => a.position - b.position));

    // THE BLOCK FILTER, applied once, here. Every guest-facing list below is derived
    // from an already-filtered array, so no screen can forget to apply it and no future
    // screen has to remember. The host's own lists (`pending`, `reports`) deliberately
    // do NOT go through this -- see the note on RunitRepository.moderation.
    const blocked = new Set(this.blockList.map((b) => b.guestId));
    const visibleRequests = this.requestList.filter(
      (r) => r.requestedByGuestId === null || !blocked.has(r.requestedByGuestId),
    );

    const live = visibleRequests.filter((r) => r.status !== 'played' && r.status !== 'declined');
    this.sigQueue.set(live.sort(byVotesDesc));
    this.sigIncoming.set(visibleRequests.filter((r) => r.status === 'pending').sort(byVotesDesc));
    this.sigAccepted.set(visibleRequests.filter((r) => r.status === 'accepted').sort(byVotesDesc));
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
            // The null check is load-bearing, not defensive: a host's upload carries
            // `uploadedByGuestId: null`, so without it a founder with no seat would find
            // every host photo in her own transfer list.
            this.myGuestId !== null &&
            p.uploadedByGuestId === this.myGuestId,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
    this.sigApproved.set(
      this.photoList
        .filter(
          (p) =>
            p.status === 'approved' &&
            (p.uploadedByGuestId === null || !blocked.has(p.uploadedByGuestId)),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
    // roleLabel travels now. It was stripped here, which is why a seat list could not
    // render "Riley · Bride" -- only the Session carried the label.
    this.sigHosts.set(this.hostList.map((h) => ({ ...h })));

    this.sigBlocked.set(
      [...this.blockList].sort((a, b) => b.blockedAt.localeCompare(a.blockedAt)),
    );
    // The host's backlog: UNRESOLVED only, oldest first. A resolved report stays in the
    // table as the audit trail but leaves the queue, or the queue never empties.
    this.sigReports.set(
      this.reportList
        .filter((r) => r.resolvedAt === null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
    this.sigMyReports.set(
      new Set(
        this.reportList
          .filter((r) => this.myGuestId !== null && r.reporterGuestId === this.myGuestId)
          .map((r) => subjectKey(r.subject)),
      ),
    );
  }

  private patchRequest(id: SongRequestId, patch: Partial<SongRequest>): void {
    this.requestList = this.requestList.map((r) => (r.id === id ? { ...r, ...patch } : r));
  }

  // ---------------------------------------------------------------- session

  session = {
    current: undefined as unknown as Observable<Session>,
    holdsHostSeat: undefined as unknown as Observable<boolean>,
    joinAsGuest: async ({ code, nickname }: { code: string; nickname: string }) => {
      // The canvas sets joined:true unconditionally -- it never validates the
      // code and never checks capacity. Both are real failure modes.
      if (code.trim().toUpperCase() !== this.ev?.code) {
        throw new JoinError('unknown_code');
      }
      const seat = checkLimit(this.computeEntitlements(), 'guests');
      if (!seat.allowed) throw new JoinError('event_full');

      const ev = this.requireEvent();
      this.ev = { ...ev, guestCount: ev.guestCount + 1 };
      // A seeded world already knows who you are; a created one does not, and
      // `join_event` mints the row either way.
      this.myGuestId ??= this.id('gst');
      this.seatIsStaff = false;
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
      if (code.trim().toUpperCase() !== this.ev?.code) {
        throw new JoinError('unknown_code');
      }
      const canonical = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (canonical(key) !== canonical(this.hostKey)) {
        throw new JoinError('bad_host_key');
      }
      const h = this.hostList[0];
      if (!h) throw new Error('This event has no host seat to claim.');
      this.sigSession.set({
        kind: 'host', hostId: h.id, displayName: h.displayName, role: h.role, roleLabel: h.roleLabel,
      });
    },

    /**
     * Parity with the adapter's own `becomeGuest`: a founder takes a seat on demand.
     *
     * `guestCount` DELIBERATELY DOES NOT MOVE. Staff are not guests -- in SQL that is
     * `public.guest_seats()` excluding anyone holding a host seat at the event, from both
     * the headcount and `tier_limits.max_guests`. Incrementing here would make the
     * fixture disagree with the backend about a number printed on the join screen, and
     * Lane B would go green on the wrong one.
     */
    becomeGuest: async () => {
      const s = this.sigSession.get();
      if (this.myGuestId === null) {
        this.myGuestId = this.id('gst');
        // Arrived from the console, so this seat is staff: it counts in no headcount and
        // no read count. `joinAsGuest` clears the flag, because that IS a guest arriving.
        this.seatIsStaff = true;
      }
      this.sigSession.set({
        kind: 'guest',
        guestId: this.myGuestId,
        nickname: s.kind === 'host' ? s.displayName : s.kind === 'guest' ? s.nickname : 'you',
      });
      this.recompute();
    },
    /**
     * Parity with the Supabase adapter, and the parity is the point.
     *
     * There is no auth here to keep or discard, so closeEvent and leave would otherwise
     * be indistinguishable -- and Lane B runs THIS adapter. If the two were left as one
     * method, the e2e suite would prove "leave, re-join, same guest" while the real
     * backend signed out and doubled the row. Both exist so the seam stays honest about
     * a difference the fixture cannot feel.
     */
    setNickname: async (nickname: string) => {
      const guestId = this.requireGuest();
      const name = nickname.trim();
      // Refused rather than defaulted, matching `set_nickname`'s 22023: a blank name is
      // the one identity in the room with nothing on it.
      if (!name) throw new Error('A nickname cannot be empty.');
      const stored = name.slice(0, 40);

      // The denormalised copies move with it, exactly as the RPC does in one transaction.
      // `requestedByName` and `uploadedByName` exist so a deleted guest does not blank the
      // history; leaving them stale is the state a rename is opened to fix.
      this.requestList = this.requestList.map((r) =>
        r.requestedByGuestId === guestId ? { ...r, requestedByName: stored } : r,
      );
      this.photoList = this.photoList.map((p) =>
        p.uploadedByGuestId === guestId ? { ...p, uploadedByName: stored } : p,
      );
      const current = this.sigSession.get();
      if (current.kind === 'guest') this.sigSession.set({ ...current, nickname: stored });
      this.recompute();
      return stored;
    },

    closeEvent: async () => {
      this.sigSession.set({ kind: 'anonymous' });
    },

    leave: async () => {
      // Mirrors the Supabase adapter: the address dies with the session, not with the
      // event. `closeEvent` deliberately keeps it.
      await this.session.setPushToken(null);
      await this.session.closeEvent();
    },

    /**
     * A REAL NO-OP THAT RESOLVES, never a throw.
     *
     * All 208 Playwright journeys boot this adapter, and the app registers on open, so a
     * throw here would redden the whole suite for a reason unrelated to whatever is under
     * test. This is the opposite direction from `hosts.invite`/`event.setTier` in the
     * Supabase adapter, which throw because the SCHEMA refuses them -- there is nothing
     * for a fixture to refuse here.
     *
     * The token is kept so a test can assert the registration path RAN and reached the
     * seam, which is the only thing any lane in this environment can prove about push.
     */
    setPushToken: async (token: string | null) => {
      this.pushToken = token;
    },
  };

  // --------------------------------------------------------------- invitees

  /**
   * THE TWO UNIQUE INDEXES, MIRRORED. `invitees_event_email` folds case;
   * `invitees_event_phone` folds through `phone_key`. This adapter is what the whole e2e
   * suite runs, so a rejection nobody can reach here is a rejection nobody ever tests --
   * the same argument `hosts.invite` makes for mirroring the server's caps.
   */
  private inviteeClash(person: { email?: string; phone?: string }): boolean {
    const email = person.email?.trim().toLowerCase();
    const phone = person.phone ? phoneKey(person.phone) : '';
    return this.inviteeList.some(
      (i) =>
        (!!email && i.email?.trim().toLowerCase() === email) ||
        (!!phone && !!i.phone && phoneKey(i.phone) === phone),
    );
  }

  private makeInvitee(person: { email?: string; phone?: string; displayName?: string }): Invitee {
    return {
      id: this.id('inv'),
      email: person.email?.trim() || null,
      phone: person.phone?.trim() || null,
      displayName: person.displayName?.trim() || null,
      // On the list is not sent. `send` is what stamps this, and only when the composer
      // was actually used.
      invitedAt: null,
      joinedGuestId: null,
    };
  }

  invitees = {
    all: undefined as unknown as Observable<Invitee[]>,

    add: async (person: { email?: string; phone?: string; displayName?: string }) => {
      const email = person.email?.trim();
      const phone = person.phone?.trim();
      // The check constraint, client-side. A name with no way to reach them is not an
      // invitee, and the server refuses it too (`invitees_reachable`).
      if (!email && !phone) throw new Error('Add an email or a phone number.');
      if (this.inviteeClash({ email, phone })) {
        throw new Error('They are already on the list.');
      }
      this.inviteeList = [...this.inviteeList, this.makeInvitee({ ...person, email, phone })];
      this.shiftInvitedCount(1);
      this.recompute();
    },

    /**
     * DUPLICATES ARE SKIPPED, NOT THROWN, and that is the whole difference from `add`.
     * A contact picker run twice, or a family list that overlaps a friends list, is the
     * NORMAL case -- failing the batch on the first repeat would make importing forty
     * people an exercise in finding which one you already had.
     *
     * It also folds WITHIN the batch, because two contacts can carry one number.
     */
    addMany: async (people: { email?: string; phone?: string; displayName?: string }[]) => {
      let added = 0;
      let skipped = 0;
      for (const person of people) {
        const email = person.email?.trim();
        const phone = person.phone?.trim();
        if ((!email && !phone) || this.inviteeClash({ email, phone })) {
          skipped += 1;
          continue;
        }
        this.inviteeList = [...this.inviteeList, this.makeInvitee({ ...person, email, phone })];
        added += 1;
      }
      if (added) this.shiftInvitedCount(added);
      this.recompute();
      return { added, skipped };
    },

    /**
     * IN MEMORY THERE IS NO COMPOSER, so this stamps and reports true.
     *
     * That is a real limit and it is stated rather than hidden: Lane B can prove the list
     * updates, the count moves and the row reads "Sent" -- it cannot prove Messages opened,
     * because `MemoryRepository` has no OS. `co-host.spec.ts` makes the same admission about
     * capped events. The composer itself lives in `src/lib/share.ts` and only a phone
     * witnesses it.
     */
    send: async (ids: InviteeId[]) => {
      const wanted = new Set(ids);
      const at = this.now();
      this.inviteeList = this.inviteeList.map((i) =>
        wanted.has(i.id) ? { ...i, invitedAt: i.invitedAt ?? at } : i,
      );
      this.recompute();
      return true;
    },

    remove: async (id: InviteeId) => {
      const before = this.inviteeList.length;
      this.inviteeList = this.inviteeList.filter((i) => i.id !== id);
      if (this.inviteeList.length !== before) this.shiftInvitedCount(-1);
      this.recompute();
    },
  };

  // ------------------------------------------------------------ guest lists

  /**
   * SAVED LISTS IN MEMORY (#59). The e2e suite IS this adapter, so a list that behaved
   * differently here would put Lane B's green board over a feature the real backend does
   * not have. It mirrors the three rules that matter: save merges by name, attach copies
   * and deduplicates, forget reaches both the list and the roster.
   */
  guestLists = {
    all: undefined as unknown as Observable<GuestList[]>,

    saveCurrent: async (name: string) => {
      const label = name.trim();
      if (!label) throw new Error('Give the list a name.');
      // Merge by name rather than refuse. Saving "Family" twice after adding somebody is
      // the normal case, and erroring at it is the fastest way to look broken.
      const existing = this.listRows.find(
        (l) => l.name.trim().toLowerCase() === label.toLowerCase(),
      );
      const id = existing?.id ?? this.id('gl');
      if (!existing) this.listRows = [...this.listRows, { id, name: label, createdAt: this.now() }];

      const members = this.listMembers.get(id) ?? [];
      const merged = [...members];
      for (const i of this.inviteeList) {
        const clash = merged.some(
          (m) =>
            (!!i.email && m.email?.toLowerCase() === i.email.toLowerCase()) ||
            (!!i.phone && !!m.phone && phoneKey(m.phone) === phoneKey(i.phone)),
        );
        if (!clash) merged.push({ email: i.email, phone: i.phone, displayName: i.displayName });
      }
      this.listMembers.set(id, merged);
      this.recompute();
      return id;
    },

    attach: async (id: GuestListId) => {
      const members = this.listMembers.get(id);
      if (!members) throw new Error('That list is gone.');
      const { added } = await this.invitees.addMany(
        members.map((m) => ({
          email: m.email ?? undefined,
          phone: m.phone ?? undefined,
          displayName: m.displayName ?? undefined,
        })),
      );
      return added;
    },

    remove: async (id: GuestListId) => {
      this.listRows = this.listRows.filter((l) => l.id !== id);
      this.listMembers.delete(id);
      this.recompute();
    },

    forget: async (who: { email?: string; phone?: string }) => {
      const email = who.email?.trim().toLowerCase();
      const phone = who.phone ? phoneKey(who.phone) : '';
      if (!email && !phone) throw new Error('Give an email or a phone number.');
      const hit = (r: { email: string | null; phone: string | null }) =>
        (!!email && r.email?.toLowerCase() === email) ||
        (!!phone && !!r.phone && phoneKey(r.phone) === phone);

      let gone = 0;
      for (const [listId, members] of this.listMembers) {
        const kept = members.filter((m) => !hit(m));
        gone += members.length - kept.length;
        this.listMembers.set(listId, kept);
      }
      const before = this.inviteeList.length;
      this.inviteeList = this.inviteeList.filter((i) => !hit(i));
      const removed = before - this.inviteeList.length;
      if (removed) this.shiftInvitedCount(-removed);
      gone += removed;
      this.recompute();
      return gone;
    },
  };

  /**
   * The client-side twin of `fold_invited_count()`. Without it the composer's
   * "Send to N guests" would not move when a host adds someone -- and since Lane B IS
   * this adapter, the entire feature would be invisible to every journey.
   *
   * IT SHIFTS BY A DELTA RATHER THAN RECOMPUTING, and that is a deliberate divergence
   * from the server, which does `count(*) from invitees`. The fixtures carry a seeded
   * `invitedCount` (the wedding's 180) with no rows behind it, because writing 180 fixture
   * invitees to make one number true would be absurd. Recomputing would therefore collapse
   * 180 to 1 the moment a host added anybody -- correct arithmetic, and it would read as a
   * regression to every journey and every person who saw it.
   *
   * The property the e2e suite actually needs is that the number MOVES when the list
   * changes, and a delta gives that on top of a seeded baseline. Against Supabase there is
   * no baseline: the count IS the row count, and the trigger is the authority.
   */
  private shiftInvitedCount(by: number): void {
    const ev = this.ev;
    if (!ev) return;
    this.ev = { ...ev, invitedCount: Math.max(0, ev.invitedCount + by) };
  }

  // ------------------------------------------------------------------ event

  event = {
    current: undefined as unknown as Observable<RunitEvent | null>,
    preview: undefined as unknown as Observable<EventPreview | null>,
    mine: undefined as unknown as Observable<HostedEvent[]>,

    loadMine: async () => {
      // No RPC to call and no identity to be signed out of, so this is a re-publish
      // rather than a fetch. It exists so the screens read both adapters identically.
      this.sigMyEvents.set([...this.hostedList]);
    },

    /**
     * Switch to another event this identity is staff at.
     *
     * The collections come up EMPTY, deliberately -- see `Seed.hosted`. Pretending the
     * other party had broadcasts and songs would make a fixture that flatters the app,
     * and the value of this world is proving the list and the switch, not inventing a
     * second evening.
     */
    open: async (eventId: string) => {
      const target = this.hostedList.find((e) => e.id === eventId);
      // Refused rather than obeyed, exactly as in SupabaseRepository: the list is a
      // convenience and the seat is the authority.
      if (!target) throw new Error('You do not hold a host seat at that event.');

      this.ev = {
        id: target.id,
        code: target.code,
        name: target.name,
        venue: target.venue,
        startsAt: target.startsAt,
        timezone: target.timezone,
        doorsLabel: target.doorsLabel,
        tier: 'house_party',
        activeFolderId: '',
        nowScheduleItemId: null,
        guestCount: target.guestCount,
        invitedCount: 0,
        // Off, matching the column default. `openEvent` builds an event out of a
        // host-seat listing (`my_events()`), which carries no settings -- so this is a
        // guess, and off is the same guess `create` makes.
        photoModeration: false,
      };
      this.broadcastList = [];
      this.scheduleList = [];
      this.requestList = [];
      this.photoList = [];
      // NOW PLAYING TOO, and it was the one both of these missed. Every other collection
      // was reset and `nowPlaying` was not, so a new or switched-into party inherited
      // whatever the LAST one was playing -- a Now Playing card, on every guest's Music
      // tab, for a song nobody in that room had asked for. `create_event` mints no
      // now_playing row and each event's row is its own, so this was the fixture
      // disagreeing with the backend: exactly what this adapter exists not to do.
      this.sigNowPlaying.set(null);
      this.folderList = [];
      this.hostList = [
        { id: this.id('hst'), displayName: 'Host', role: target.role as HostRole, roleLabel: target.roleLabel },
      ];
      this.sigHoldsHostSeat.set(true);
      this.sigSession.set({
        kind: 'host',
        hostId: this.hostList[0]!.id,
        displayName: this.hostList[0]!.displayName,
        role: this.hostList[0]!.role,
        roleLabel: this.hostList[0]!.roleLabel,
      });
      this.recompute();
    },

    lookUp: async (code: string) => {
      // Same normalisation as joinAsGuest and as event_preview's
      // `upper(code) = upper(btrim(p_code))`. A code read off a place card in a dim
      // room arrives with a stray space and the wrong case about as often as not.
      const wanted = code.trim().toUpperCase();
      const from = (e: EventPreview | null) => (e && e.code.toUpperCase() === wanted ? e : null);
      // The joined event first, so a fixture that seeds both cannot answer one code
      // two ways -- which is the only way a preview and a join could disagree.
      this.sigPreview.set(from(this.ev) ?? from(this.previewable));
    },

    create: async (input: NewEvent) => {
      const code = mintFromAlphabet(6);
      const key = mintFromAlphabet(12);
      const hostId = this.id('hst');

      // Everything create_event does, in the same order and for the same reasons -- and
      // the folder matters most: an event with no active folder refuses every upload,
      // so a party created without one has a camera that silently does nothing.
      const folderId = this.id('fld');
      this.folderList = [{ id: folderId, name: 'All photos', position: 0, photoCount: 0 }];
      this.ev = {
        id: this.id('evt'),
        code,
        name: input.name,
        venue: input.venue,
        startsAt: input.startsAt,
        timezone: input.timezone,
        doorsLabel: input.doorsLabel,
        // The column default, and honest: there is no purchase path, so any other tier
        // would give the ladder away and leave the gating layer unexercised.
        tier: 'house_party',
        activeFolderId: folderId,
        nowScheduleItemId: null,
        guestCount: 0,
        invitedCount: 0,
        // The column default. A party of eight that has to approve itself is friction
        // nobody asked for; the host turns it on from Host -> Event when she wants it.
        photoModeration: false,
      };
      this.hostList = [
        { id: hostId, displayName: input.hostName.trim() || 'Host', role: 'host', roleLabel: 'Host' },
      ];
      this.broadcastList = [];
      this.scheduleList = [];
      this.requestList = [];
      this.photoList = [];
      // NOW PLAYING TOO, and it was the one both of these missed. Every other collection
      // was reset and `nowPlaying` was not, so a new or switched-into party inherited
      // whatever the LAST one was playing -- a Now Playing card, on every guest's Music
      // tab, for a song nobody in that room had asked for. `create_event` mints no
      // now_playing row and each event's row is its own, so this was the fixture
      // disagreeing with the backend: exactly what this adapter exists not to do.
      this.sigNowPlaying.set(null);
      // The minted key becomes THIS fixture's key, so claimHost here behaves the way
      // claim_host does against Postgres: the key you were handed is the key that works.
      this.hostKey = key;
      // SHE HOLDS NO GUEST SEAT, exactly as `create_event` leaves her (#37). The fixture
      // used to carry the seeded guest id straight through a create, which made a founder
      // indistinguishable from someone who had joined -- so the console's one exit worked
      // here and raised against Postgres, and no lane could tell.
      this.myGuestId = null;
      this.sigSession.set({
        kind: 'host', hostId, displayName: this.hostList[0]!.displayName,
        role: 'host', roleLabel: 'Host',
      });
      this.recompute();
      return { code, hostKey: group(key) };
    },

    rotateHostKey: async () => {
      this.requireEvent();
      const key = mintFromAlphabet(12);
      this.hostKey = key;
      return group(key);
    },

    setActiveFolder: async (id: FolderId) => {
      this.ev = { ...this.requireEvent(), activeFolderId: id };
      this.recompute();
    },

    updateDetails: async (input: EventDetails) => {
      this.ev = { ...this.requireEvent(), ...input };
      this.recompute();
    },
    setPhotoModeration: async (on: boolean) => {
      this.ev = { ...this.requireEvent(), photoModeration: on };
      this.recompute();
    },

    setTier: async (tier: TierId) => {
      this.ev = { ...this.requireEvent(), tier };
      this.recompute();
    },
  };

  // ------------------------------------------------------------------- chat

  chat = {
    feed: undefined as unknown as Observable<Broadcast[]>,
    send: async ({ body, pinned }: { body: string; pinned: boolean }) => {
      const text = body.trim();
      if (!text) return;
      const s = this.sigSession.get();
      const host =
        s.kind === 'host'
          ? this.hostList.find((h) => h.id === s.hostId)
          : this.hostList[0];
      if (!host) throw new Error('no host to author the broadcast');

      // Degrade rather than reject. Refusing to post an announcement because
      // the plan cannot PIN it would be hostile.
      //
      // This used to say the toggle was already locked in the UI, so this was
      // defence in depth. It is not: `BroadcastPanel.tsx` renders an ungated
      // Pressable and imports no entitlements at all, so this is the only gate
      // IN THIS ADAPTER.
      //
      // It is no longer the only gate anywhere. `fold_pin_to_plan` is a trigger on
      // `public.broadcasts` that folds a pin the tier does not carry, so a free-tier
      // host cannot pin against Supabase either -- and it fires on INSERT **OR UPDATE**,
      // which is what keeps #26's un-pin control from handing the pin straight back.
      // The two must keep agreeing; `src/domain/tiers.test.ts` is what guards the
      // numbers, and Lane E is what proves the behaviour.
      const e = this.computeEntitlements();
      const canPin = pinned && checkFeature(e, 'pinnedAnnouncements').allowed;

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
      this.recompute();
    },

    setPinned: async (id: BroadcastId, pinned: boolean) => {
      // NO SESSION CHECK, matching `send` directly above rather than being stricter than
      // its own sibling. This adapter's `send` tolerates a non-host session and falls
      // back to `hostList[0]`, because the fixtures drive the host console without
      // always minting a host session. `SupabaseRepository` checks in BOTH methods,
      // because there the check is real. Each adapter is internally consistent; the
      // server policy (`broadcasts_pin`, `using (is_host(event_id))`) is the actual gate.

      // ASYMMETRIC ON PURPOSE, and the symmetric version is a real bug rather than a
      // theoretical one. Gating BOTH directions on `pinnedAnnouncements` refuses to take
      // a pin DOWN on any tier that cannot put one up -- and that state is reachable:
      // `event.setTier` downgrades, and so does a real plan change. The host would be
      // left with a pinned notice nothing could move, which is precisely the dead end
      // #26 exists to close, re-created inside its own fix.
      //
      // `chat.send` has the same shape for the same reason (`pinned && checkFeature`),
      // and so does the server: `fold_pin_to_plan` acts only `if new.pinned`.
      if (pinned) {
        const gate = checkFeature(this.computeEntitlements(), 'pinnedAnnouncements');
        if (!gate.allowed) throw new EntitlementError(gate.denial);
      }

      this.broadcastList = this.broadcastList.map((b) =>
        b.id === id ? { ...b, pinned } : b,
      );
      this.recompute();
    },

    markRead: async (ids: BroadcastId[]) => {
      // ONE READER, WHICH IS THE HONEST LIMIT OF A FIXTURE. Against Postgres `seen_count`
      // is folded over every guest's row; here there is exactly one person, so this counts
      // this device and nothing else. The property worth keeping is the one a screen can
      // get wrong: a second look does not add a second read.
      if (this.myGuestId === null || this.seatIsStaff) return;
      const fresh = ids.filter((id) => !this.readMarks.has(id));
      if (fresh.length === 0) return;
      for (const id of fresh) this.readMarks.add(id);
      this.broadcastList = this.broadcastList.map((b) =>
        fresh.includes(b.id) ? { ...b, seenCount: b.seenCount + 1 } : b,
      );
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
      const current = this.scheduleList.findIndex((s) => s.id === this.requireEvent().nowScheduleItemId);
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
      this.ev = { ...this.requireEvent(), nowScheduleItemId: id };
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

    remove: async (id: ScheduleItemId) => {
      const wasCurrent = this.ev?.nowScheduleItemId === id;
      this.scheduleList = this.scheduleList.filter((s) => s.id !== id);
      // MIRRORS `on delete set null` ON THE COLUMN. Deleting the item that is currently
      // running means nothing is running -- not that the previous one resumed. Guessing a
      // predecessor here would move every guest's Now/Next card to an item the host never
      // started, which is the exact harm `schedule.start()` refuses a rewind for.
      if (wasCurrent && this.ev) this.ev = { ...this.ev, nowScheduleItemId: null };
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

      // ONE SONG, ONE ROW (#44), mirroring the unique index rather than inventing a rule.
      // The queue is ranked by votes, so two rows for one song is not a tidiness problem:
      // it is the most-wanted song of the night sitting under songs one person asked for.
      //
      // Scoped to what is still IN the queue, exactly as the partial index is -- a played
      // song can come round again.
      const key = songKey(title, artist);
      const existing = this.requestList.find(
        (r) =>
          (r.status === 'pending' || r.status === 'accepted') &&
          songKey(r.title, r.artist) === key,
      );
      if (existing) {
        // The vote is the point of the merge. Idempotent, because asking twice for a song
        // you already voted for is the desired state arriving twice -- the composite key
        // does exactly this server-side.
        if (!this.votes.has(existing.id)) {
          this.votes.add(existing.id);
          this.patchRequest(existing.id, { voteCount: existing.voteCount + 1 });
        }
        this.recompute();
        return { merged: true };
      }

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
      return { merged: false };
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
      this.patchRequest(id, { status: 'accepted' });
      this.recompute();
    },

    decline: async (id: SongRequestId) => {
      this.patchRequest(id, { status: 'declined' });
      this.recompute();
    },

    // THESE FOUR ARE UNGATED, and were not always. They were the `djQueue`
    // feature, sold from the Party tier up, which meant the free tier could
    // collect requests and votes and act on NONE of them. Since playNext is the
    // only writer of nowPlaying, a house party's Now Playing bar never moved --
    // the one room this app is best in was the room its music tab did not work in.
    markPlayed: async (id: SongRequestId) => {
      this.patchRequest(id, { status: 'played' });
      this.recompute();
    },

    playNext: async () => {
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
      const folderId = this.requireEvent().activeFolderId;
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
          thumbPath: null,
          displayUrl: null,
          createdAt: this.now(),
        },
        ...this.photoList,
      ];
      this.recompute();

      return await this.runTransfer(id);
    },


    /**
     * There is no bucket behind this adapter, so the only bytes that exist are the ones
     * this device holds. A seeded row has none and never will -- the hue tile is its
     * permanent rendering, and a viewer opened on it shows exactly that.
     */
    fullUrl: async (id: PhotoId) => this.photoList.find((p) => p.id === id)?.localUri ?? null,

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
      // NOT GATED ON A TIER, and it used to be. The gate was `photoModeration`, which is
      // exactly backwards now the same flag lives on the event: a host who turned approval
      // ON is by definition entitled to work the queue she created, and one who left it
      // off has an empty queue. The condition could only ever refuse the person it was
      // built for.
      //
      // Same call #65 made about `hide`, one step earlier. Deciding what the room sees is
      // a review obligation, not something a free tier is sold half of.
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
      //
      // NOT GATED ON A TIER -- #65. It was gated on `photoModeration`, and that is what
      // made Guideline 1.2 unsatisfiable: `create_event` mints `house_party`, whose
      // photoModeration was false, so `hide` threw on every event this app can create and
      // a reported photo could not be taken down at all.
      //
      // The reasoning given then was that moderation "is a feature somebody pays for"
      // while removing REPORTED content is a review obligation. Half of that was right.
      // Stopping a photo being shown in the first place is the SAME obligation, one step
      // earlier -- which is why `photoModeration` is no longer a tier feature at all.
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
    all: undefined as unknown as Observable<Host[]>,
    invite: async ({ displayName, role, roleLabel }: NewHost) => {
      // Both gates mirror invite_host's, which reads them from `tier_limits` in Postgres.
      // Keeping them here too is not redundancy: this adapter is what the whole e2e suite
      // runs, so a denial nobody can reach here is a denial nobody ever tests.
      const e = this.computeEntitlements();
      const seat = checkLimit(e, 'hosts');
      if (!seat.allowed) throw new EntitlementError(seat.denial);
      if (role !== 'host') {
        const roles = checkFeature(e, 'hostRoles');
        if (!roles.allowed) throw new EntitlementError(roles.denial);
      }

      const hostId = this.id('hst');
      const key = mintFromAlphabet(12);
      this.hostList = [
        ...this.hostList,
        {
          id: hostId,
          displayName: displayName.trim(),
          role,
          // It used to be `roleLabel: displayName`, which printed "DJ Marco · DJ Marco"
          // in the console. The same fallback the SQL uses: the role's own human name.
          roleLabel: roleLabel?.trim() || DEFAULT_ROLE_LABEL[role],
        },
      ];
      this.recompute();
      return { hostId, hostKey: group(key) };
    },
  };

  // ------------------------------------------------------------- moderation

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
      // Already reported by this guest? Nothing to do. Matching file_report()'s
      // ON CONFLICT DO NOTHING rather than raising: a double tap is not a failure.
      const key = subjectKey(subject);
      const reporter = this.requireGuest();
      const mine = this.reportList.some(
        (r) => r.reporterGuestId === reporter && subjectKey(r.subject) === key,
      );
      if (mine) return;

      // The label is derived HERE, from the local rows, for the same reason the
      // database derives it in file_report(): a caller that supplies it can caption a
      // complaint as something it is not.
      const label = this.labelFor(subject);
      if (label === null) throw new Error(`Cannot report ${key}: no such subject in this event.`);
      if (subject.kind === 'guest' && subject.guestId === this.myGuestId) {
        throw new Error('You cannot report yourself.');
      }

      this.reportList = [
        ...this.reportList,
        {
          id: this.id('rep'),
          subject,
          reporterGuestId: reporter,
          reporterName: this.myNickname(),
          subjectLabel: label,
          reason,
          note: note ?? '',
          resolution: null,
          resolvedAt: null,
          createdAt: this.now(),
        },
      ];
      this.recompute();
    },

    block: async (guestId: GuestId) => {
      if (guestId === this.myGuestId) throw new Error('You cannot block yourself.');
      if (this.blockList.some((b) => b.guestId === guestId)) return;
      this.blockList = [
        ...this.blockList,
        { guestId, nickname: this.nicknameFor(guestId), blockedAt: this.now() },
      ];
      this.recompute();
    },

    unblock: async (guestId: GuestId) => {
      this.blockList = this.blockList.filter((b) => b.guestId !== guestId);
      this.recompute();
    },

    resolve: async (id: ReportId, resolution: ReportResolution) => {
      this.reportList = this.reportList.map((r) =>
        r.id === id ? { ...r, resolution, resolvedAt: this.now() } : r,
      );
      this.recompute();
    },
  };

  /**
   * The host-facing description of a reported thing, or null if it is not in this event.
   *
   * Null is the local stand-in for the adapter's `subject_not_in_event`: the id names
   * nothing here, so there is nothing to report.
   */
  private labelFor(subject: ReportSubject): string | null {
    switch (subject.kind) {
      case 'photo': {
        const photo = this.photoList.find((p) => p.id === subject.photoId);
        return photo ? `Photo from ${photo.uploadedByName}` : null;
      }
      case 'song_request': {
        const request = this.requestList.find((r) => r.id === subject.requestId);
        if (!request) return null;
        return request.artist ? `${request.title} -- ${request.artist}` : request.title;
      }
      case 'guest':
        return this.nicknameFor(subject.guestId) || null;
    }
  }

  /**
   * A guest's display name, found through the content they left behind.
   *
   * There is no guest directory to read -- on the real backend `guests` has no select
   * policy at all -- so a nickname is only ever knowable from a row that carries it.
   * That is exactly why the database stamps `blocked_name` with a trigger.
   */
  private nicknameFor(guestId: GuestId): string {
    const photo = this.photoList.find((p) => p.uploadedByGuestId === guestId);
    if (photo) return photo.uploadedByName;
    const request = this.requestList.find((r) => r.requestedByGuestId === guestId);
    if (request) return request.requestedByName;
    return 'Someone';
  }

  private myNickname(): string {
    const session = this.sigSession.get();
    if (session.kind === 'guest') return session.nickname;
    return this.myGuestId === null ? '' : this.nicknameFor(this.myGuestId);
  }

  private bumpFolder(id: FolderId, by: number): void {
    this.folderList = this.folderList.map((f) =>
      f.id === id ? { ...f, photoCount: Math.max(0, f.photoCount + by) } : f,
    );
  }

  /** Attach the signals to the public groups. See the note in the constructor. */
  private wire(): void {
    this.session.current = this.sigSession;
    this.session.holdsHostSeat = this.sigHoldsHostSeat;
    this.invitees.all = this.sigInvitees;
    this.guestLists.all = this.sigGuestLists;
    this.event.current = this.sigEvent;
    this.event.mine = this.sigMyEvents;
    this.event.preview = this.sigPreview;
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
    this.connection = this.sigConnection;
    this.hosts.all = this.sigHosts;
    this.moderation.blocked = this.sigBlocked;
    this.moderation.reports = this.sigReports;
    this.moderation.myReports = this.sigMyReports;
  }

  static create(
    seed: Seed,
    opts: {
      now?: () => string;
      transfer?: (photo: Photo, onProgress: (fraction: number) => void) => Promise<void>;
      /** Fixture value, not a secret -- the real key lives as a bcrypt hash in Postgres. */
      hostKey?: string;
      connection?: ConnectionState;
    } = {},
  ): MemoryRepository {
    return new MemoryRepository(seed, opts);
  }
}

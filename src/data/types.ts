/**
 * Runit domain types.
 *
 * Derived from the design canvas's `state` + `renderVals()`, with three of its
 * shortcuts corrected (see design/FIDELITY.md):
 *
 * 1. TIME. The canvas stores '4:10 PM', 'just now', 'now', 'TBD' and '3 min ago'
 *    in fields of the same name across three entities. Nothing sorts and nothing
 *    relativises. Here, anything that happened is an ISO instant; only the run
 *    of show keeps a wall-clock label, because that is genuinely what it is --
 *    "8:00 PM" on the schedule board, with no date attached.
 * 2. PRESENTATION. `initials`, the formatted time strings and the tile colours
 *    are NOT stored. They are derived at render. What IS stored is `hue`, a
 *    stable theme-independent number, so a photo placeholder re-themes on a
 *    light/dark switch with no data migration.
 * 3. IDENTITY. The canvas has exactly one user: a client-local `voted` map, a
 *    `mine` flag it wipes off every other row, and a hardcoded broadcast author.
 *    Ownership here is by id.
 */

export type EventId = string;
export type GuestId = string;
export type HostId = string;
export type BroadcastId = string;
export type ScheduleItemId = string;
export type SongRequestId = string;
export type PhotoId = string;
export type FolderId = string;

/** ISO-8601 instant. */
export type Instant = string;

export type TierId = 'house_party' | 'party' | 'event' | 'venue';

export type HostRole = 'host' | 'dj' | 'planner' | 'partner';

export interface RunitEvent {
  id: EventId;
  /** What guests type to join. The canvas seeds 'SR1017'. */
  code: string;
  name: string;
  venue: string;
  startsAt: Instant;
  doorsLabel: string;
  tier: TierId;
  /** New uploads file into this folder. */
  activeFolderId: FolderId;
  /** The run-of-show cursor. */
  nowScheduleItemId: ScheduleItemId | null;
  guestCount: number;
}

export interface Guest {
  id: GuestId;
  nickname: string;
  joinedAt: Instant;
}

export interface Host {
  id: HostId;
  displayName: string;
  role: HostRole;
  /**
   * What the design actually prints: "Bride", "Planner", "DJ". `role` is the
   * permission grade; this is the human label beside the name, and the canvas
   * shows both ("Riley · Bride").
   */
  roleLabel: string;
}

export type Session =
  | { kind: 'anonymous' }
  | { kind: 'guest'; guestId: GuestId; nickname: string }
  | { kind: 'host'; hostId: HostId; displayName: string; role: HostRole; roleLabel: string };

export type BroadcastKind = 'announcement' | 'schedule_started';

export interface Broadcast {
  id: BroadcastId;
  authorHostId: HostId;
  authorName: string;
  authorRoleLabel: string;
  kind: BroadcastKind;
  body: string;
  pinned: boolean;
  /** How many guests have read it. Real, not fabricated -- 0 until read. */
  seenCount: number;
  createdAt: Instant;
}

export interface ScheduleItem {
  id: ScheduleItemId;
  position: number;
  /** Wall-clock label, e.g. '8:00 PM'. Null means the canvas's 'TBD'. */
  timeLabel: string | null;
  title: string;
  place: string;
  startedAt: Instant | null;
}

export type SongRequestStatus = 'pending' | 'accepted' | 'played' | 'declined';

export interface SongRequest {
  id: SongRequestId;
  title: string;
  artist: string;
  requestedByGuestId: GuestId | null;
  requestedByName: string;
  status: SongRequestStatus;
  voteCount: number;
  createdAt: Instant;
}

export interface NowPlaying {
  title: string;
  artist: string;
  fromRequestId: SongRequestId | null;
  startedAt: Instant | null;
}

export interface Folder {
  id: FolderId;
  name: string;
  position: number;
  /** Approved photos only -- matches the canvas's folder counts. */
  photoCount: number;
}

export type PhotoStatus = 'uploading' | 'pending' | 'approved' | 'hidden' | 'failed';

export interface Photo {
  id: PhotoId;
  folderId: FolderId;
  uploadedByGuestId: GuestId | null;
  uploadedByName: string;
  status: PhotoStatus;
  /**
   * Hue in degrees, 0-359. The canvas derives placeholder tints from
   * `(seq * 67) % 360`; storing the hue rather than a colour keeps the record
   * theme-independent and serialisable.
   */
  hue: number;
  /** Null until a real capture pipeline exists -- see FIDELITY.md. */
  storagePath: string | null;
  createdAt: Instant;
}

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
export type InviteeId = string;

/** ISO-8601 instant. */
export type Instant = string;

export type TierId = 'house_party' | 'party' | 'event' | 'venue';

/**
 * The permission GRADE, and a genuinely closed set -- which is why the database can
 * enforce it as a check constraint.
 *
 * `'partner'` used to be here and never appeared in a fixture, a branch or a test: it was
 * a value nothing produced and the DB constraint rejected. The human-facing word belongs
 * in `Host.roleLabel`, which is free text precisely so an event can print "Partner",
 * "Bride", "Best Man" or "Head of Ops" without the schema having an opinion. Widening the
 * constraint to admit a dead union member would have made the type and the database agree
 * on a lie; narrowing makes them agree on what is true.
 */
export type HostRole = 'host' | 'dj' | 'planner';

export interface RunitEvent {
  id: EventId;
  /** What guests type to join. The canvas seeds 'SR1017'. */
  code: string;
  name: string;
  venue: string;
  startsAt: Instant;
  /**
   * IANA zone of the VENUE, e.g. 'America/New_York'.
   *
   * Times render in the event's zone, never the phone's: a guest standing in the
   * barn should read the same time as the sign on the door, whatever timezone
   * their phone thinks it is in. This field is what makes that possible for
   * instants created at runtime -- before it existed, a host in Chattanooga
   * posting at 7:02 PM saw their own message stamped 11:02 PM, because every
   * timestamp was formatted in UTC.
   */
  timezone: string;
  doorsLabel: string;
  tier: TierId;
  /** New uploads file into this folder. */
  activeFolderId: FolderId;
  /** The run-of-show cursor. */
  nowScheduleItemId: ScheduleItemId | null;
  /**
   * How many people are in the room right now -- the "{n} here" pill.
   * The canvas moves this 172 -> 173 when you join.
   */
  guestCount: number;
  /**
   * How many were invited -- what a host is addressing when they broadcast.
   * The canvas hardcodes 180 into "Send to 180 guests" while its guestCount
   * pill says 172, so these are two genuinely different numbers.
   */
  invitedCount: number;
  /**
   * Whether an uploaded photo waits for a host before the room can see it.
   *
   * ON THE EVENT, NOT ON THE TIER, and that is the whole point. It was
   * `TierFeatures.photoModeration`, which is false on `house_party` -- the only tier
   * `create_event` mints -- so every event this app can create put a guest's photo on
   * every screen in the room the instant it landed, and the gate sat behind a purchase
   * path that does not exist (#30).
   *
   * It is the host's choice about one party, on any tier, default off: eight friends in
   * a kitchen do not want to approve each other, two hundred people at a wedding do.
   * Enforced in the database by `set_photo_status`, which reads `events.photo_moderation`
   * -- never by the client, which is the party being moderated (#50's finding, preserved
   * by the move rather than lost to it).
   */
  photoModeration: boolean;
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

/**
 * Someone a host has put on the guest list (#25).
 *
 * THIS IS THE FIRST PERSONAL DATA IN THE APP BEYOND A CHOSEN NICKNAME, and it is somebody
 * else's: a host uploads an address before that person has consented to anything or heard
 * of Runit. The schema treats it as the strictest table it has, and the app should not be
 * more relaxed than the schema.
 */
export interface Invitee {
  id: InviteeId;
  /**
   * EITHER of these identifies an invitee and at least one is present -- the schema holds
   * that as a check constraint (#60). `email` was `not null` until a guest list could be
   * built from the phone's own contacts, at which point requiring an address meant dropping
   * most of an address book on the floor, because a contact is usually a phone number.
   *
   * Nullable in BOTH directions on purpose. A relative saved with only a mobile is a phone
   * and no email; a work list pasted from a spreadsheet is the reverse.
   */
  email: string | null;
  phone: string | null;
  /** Optional, purely so an invite could say "Hi Sam". Never required. */
  displayName: string | null;
  /**
   * WHEN THE INVITATION REACHED A COMPOSER -- not when it reached a person, and the
   * distinction is the whole reason this field is not a boolean.
   *
   * It was null forever and by design: "nothing may set it until something actually sends".
   * `invitees.send` now hands the message to the phone's own SMS or mail composer and
   * stamps this through `mark_invited`, because that is the closest thing to sending that
   * exists on this distribution. There is no delivery receipt on that path and there will
   * not be one -- the OS reports that the sheet was used and nothing after.
   *
   * So "on the list", "handed to a composer" and "actually arrived" are three facts and the
   * schema can honestly hold the first two.
   */
  invitedAt: Instant | null;
  /** Set when this address turns up. Nothing writes it yet. */
  joinedGuestId: GuestId | null;
}

export type GuestListId = string;

/**
 * A GUEST LIST THAT OUTLIVES ONE EVENT (#59).
 *
 * `invitees` is keyed to the event and cascades with it -- right for a roster, wrong for an
 * address book. The same family gets retyped for every birthday, and `create_event` allows
 * ten events per identity, so this is a state the schema already anticipates people reaching.
 *
 * IT BELONGS TO THE IDENTITY, not to an event, and an event BORROWS one by copy. Pointing an
 * event at a live list would mean editing the family list next March retroactively changes
 * what last September's party says it invited.
 */
export interface GuestList {
  id: GuestListId;
  name: string;
  /** How many people are on it. Folded by the adapter, not stored. */
  memberCount: number;
  createdAt: Instant;
}

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
  /**
   * Where the bytes live on THIS device: a `file://` in our cache on native, a
   * `blob:`/`data:` on web. Null for seeded rows, which have no bytes and never
   * will -- the hue tile is their permanent rendering.
   */
  localUri: string | null;
  /**
   * Transfer progress, 0..1, while `status === 'uploading'`. Null otherwise.
   *
   * Null is not zero: null means "not transferring", zero means "transferring
   * and nothing has moved yet". A spinner that cannot tell those apart shows
   * a stuck bar on every photo that already finished.
   */
  progress: number | null;
  /**
   * Why the last transfer attempt failed, for `status === 'failed'`. Shown to the
   * guest, so it has to be worth reading -- "Upload failed" tells them nothing
   * they cannot see.
   */
  failureReason: string | null;
  /**
   * Where the bytes live REMOTELY -- a bucket key a Supabase adapter resolves to
   * a signed URL. Deliberately separate from `localUri`: reusing one field for a
   * device path and a remote key collides the moment an adapter exists, because
   * they are resolved by completely different machinery.
   */
  storagePath: string | null;
  /**
   * The 400px copy's bucket key (#10). Null for photos taken before thumbnails existed,
   * and for one whose thumbnail could not be produced -- the full-size stands in for both.
   */
  thumbPath: string | null;
  /**
   * A SIGNED, EXPIRING URL the app can actually render -- resolved from `thumbPath` when
   * there is one and `storagePath` when there is not.
   *
   * Null until it has been resolved, and null forever in `MemoryRepository`, whose photos
   * have no bucket behind them. The hue tile is the layer underneath in both cases.
   *
   * Distinct from `localUri`, which is bytes on THIS device. The two are resolved by
   * completely different machinery and collapsing them is the mistake `storagePath`'s own
   * docblock has warned about since before an adapter existed.
   */
  displayUrl: string | null;
  createdAt: Instant;
}

// ---------------------------------------------------------------- moderation

export type ReportId = string;

/**
 * A CLOSED SET, matching the database's check constraint, and the words are the ones
 * App Review looks for. Free text alone would leave the host queue unsortable and give
 * a reviewer nothing to see.
 */
export type ReportReason = 'nudity' | 'harassment' | 'violence' | 'hate' | 'spam' | 'other';

/** What a host DID about it. Recorded because "we responded" is the claim being made. */
export type ReportResolution = 'removed' | 'blocked' | 'dismissed';

/**
 * The thing being reported.
 *
 * A discriminated union rather than three id fields, so a subject is impossible to
 * construct half-formed -- the same shape the `reports_one_subject` check enforces on
 * the other side of the wire.
 */
export type ReportSubject =
  | { kind: 'photo'; photoId: PhotoId }
  | { kind: 'song_request'; requestId: SongRequestId }
  | { kind: 'guest'; guestId: GuestId };

/** Stable identity for a subject, for "have I already reported this?" set membership. */
export function subjectKey(subject: ReportSubject): string {
  switch (subject.kind) {
    case 'photo':
      return `photo:${subject.photoId}`;
    case 'song_request':
      return `song_request:${subject.requestId}`;
    case 'guest':
      return `guest:${subject.guestId}`;
  }
}

export interface Report {
  id: ReportId;
  subject: ReportSubject;
  /** Null once the reporter leaves. The report outlives them, deliberately. */
  reporterGuestId: GuestId | null;
  /**
   * Denormalised on the server, not joined. A host cannot read `guests` at all, so
   * without this the queue would render every complaint anonymously.
   */
  reporterName: string;
  /** "Photo from Sam", "September -- Earth, Wind & Fire", a nickname. Server-derived. */
  subjectLabel: string;
  reason: ReportReason;
  note: string;
  resolution: ReportResolution | null;
  resolvedAt: Instant | null;
  createdAt: Instant;
}

/**
 * Someone this guest has blocked.
 *
 * `nickname` is stamped by a trigger from the real guest row for the same reason
 * `Report.reporterName` is: the blocker cannot look the name up themselves, and a
 * "Blocked people" list of UUIDs is a list nobody can use to unblock the right person.
 */
export interface BlockedGuest {
  guestId: GuestId;
  nickname: string;
  blockedAt: Instant;
}

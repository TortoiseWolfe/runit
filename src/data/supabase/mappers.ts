import type { PreviewRow, Row } from './database.types';
import { RowCache } from './signal';
import type {
  Broadcast, BroadcastKind, Folder, Host, HostRole, Invitee, NowPlaying, Photo, PhotoStatus,
  Report, ReportReason, ReportResolution, ReportSubject,
  RunitEvent, ScheduleItem, SongRequest, SongRequestStatus, TierId,
} from '../types';
import type { EventPreview } from '../repository';

/**
 * Postgres rows to domain objects.
 *
 * Three things this layer is responsible for, none of them obvious from the shape:
 *
 * 1. **snake_case to camelCase.** Mechanical, and the reason `database.types.ts`
 *    is generated rather than transcribed: a mistyped column does not raise.
 *    PostgREST returns the row without it and the mapper reads `undefined`, so
 *    the failure surfaces as a blank name three screens away.
 *
 * 2. **Narrowing text columns to unions.** The database enforces its side with
 *    check constraints, but `information_schema` reports them as `text`, so the
 *    generated types say `string`. Casting blindly would let a value the app has
 *    no branch for reach a switch statement. Each narrowing below falls back to a
 *    defined value AND is a place a future enum change shows up loudly.
 *
 * 3. **Refusing to invent device state.** `Photo.localUri`, `.progress` and
 *    `.failureReason` are per-DEVICE and deliberately absent from the schema, so
 *    every mapped photo has them null. The upload overlay in SupabaseRepository
 *    merges the real values over the top for the current guest's own rows. A
 *    mapper that guessed here would show one guest another guest's progress bar.
 */

/* ---------------------------------------------------------------- narrowing */

/**
 * Narrow a text column to a union, falling back rather than lying.
 *
 * `Object.freeze`d allow-lists rather than a cast, because a cast makes the
 * compiler agree with a value the database might not contain any more -- e.g. if
 * someone widens the hosts.role check constraint without touching HostRole, a
 * cast produces a `HostRole` that is not one, and the bug appears wherever that
 * value is switched on.
 */
function narrow<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const TIERS = ['house_party', 'party', 'event', 'venue'] as const satisfies readonly TierId[];
const HOST_ROLES = ['host', 'dj', 'planner'] as const satisfies readonly HostRole[];
const BROADCAST_KINDS = ['announcement', 'schedule_started'] as const satisfies readonly BroadcastKind[];
const REQUEST_STATUSES = ['pending', 'accepted', 'played', 'declined'] as const satisfies readonly SongRequestStatus[];
/** Only the three the DB can hold. `uploading` and `failed` never come from a row. */
const PHOTO_STATUSES = ['pending', 'approved', 'hidden'] as const satisfies readonly PhotoStatus[];
const REPORT_REASONS = ['nudity', 'harassment', 'violence', 'hate', 'spam', 'other'] as const satisfies readonly ReportReason[];
const REPORT_RESOLUTIONS = ['removed', 'blocked', 'dismissed'] as const satisfies readonly ReportResolution[];

/* ------------------------------------------------------------------ mappers */

export function toEvent(r: Row<'events'>): RunitEvent {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    venue: r.venue,
    startsAt: r.starts_at,
    timezone: r.timezone,
    doorsLabel: r.doors_label,
    tier: narrow(TIERS, r.tier, 'house_party'),
    // The column is nullable (an event exists before its first folder does) but
    // the domain type is not, because every upload needs a destination. Empty
    // string is the honest "no folder yet" here: it matches no folder id, so an
    // upload before a folder exists is refused rather than filed somewhere wrong.
    activeFolderId: r.active_folder_id ?? '',
    nowScheduleItemId: r.now_schedule_item_id,
    guestCount: r.guest_count,
    invitedCount: r.invited_count,
  };
}

/**
 * The `event_preview` RPC's row -> the invitation.
 *
 * NOT toEvent with fields dropped, and the difference matters. `toEvent` takes a
 * whole `events` row; this takes what a SECURITY DEFINER function chose to return,
 * which is a deliberately narrower set -- no tier, no counts, no folder. Mapping the
 * two through one function would mean the projection had to be re-decided here every
 * time someone touched it, and the safe direction for that mistake is the wrong one.
 *
 * There is no `narrow()` call and no fallback: every column here is `not null` in the
 * schema, and unlike `tier` there is no closed set to fall back to.
 */
export function toPreview(r: PreviewRow): EventPreview {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    venue: r.venue,
    startsAt: r.starts_at,
    timezone: r.timezone,
    doorsLabel: r.doors_label,
  };
}

export function toHost(r: Row<'hosts'>): Host {
  return {
    id: r.id,
    displayName: r.display_name,
    role: narrow(HOST_ROLES, r.role, 'host'),
    roleLabel: r.role_label,
  };
}

/**
 * `invited_at` and `joined_guest_id` are carried across even though nothing writes either
 * one yet (#25). They are the two facts that keep "on the list" separate from "was
 * emailed" and from "turned up", and dropping them here would quietly collapse a
 * distinction the schema is built around.
 */
export function toInvitee(r: Row<'invitees'>): Invitee {
  return {
    id: r.id,
    email: r.email,
    phone: r.phone,
    displayName: r.display_name,
    invitedAt: r.invited_at,
    joinedGuestId: r.joined_guest_id,
  };
}

export function toBroadcast(r: Row<'broadcasts'>): Broadcast {
  return {
    id: r.id,
    // Nullable in the schema on purpose -- `on delete set null` -- so history
    // survives a host being removed. The denormalised author_name/role_label are
    // what the feed actually renders, which is why deleting a host does not blank
    // the message.
    authorHostId: r.author_host_id ?? '',
    authorName: r.author_name,
    authorRoleLabel: r.author_role_label,
    kind: narrow(BROADCAST_KINDS, r.kind, 'announcement'),
    body: r.body,
    pinned: r.pinned,
    seenCount: r.seen_count,
    createdAt: r.created_at,
  };
}

export function toScheduleItem(r: Row<'schedule_items'>): ScheduleItem {
  return {
    id: r.id,
    position: r.position,
    timeLabel: r.time_label,
    title: r.title,
    place: r.place,
    startedAt: r.started_at,
  };
}

export function toSongRequest(r: Row<'song_requests'>): SongRequest {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    requestedByGuestId: r.requested_by_guest_id,
    requestedByName: r.requested_by_name,
    status: narrow(REQUEST_STATUSES, r.status, 'pending'),
    voteCount: r.vote_count,
    createdAt: r.created_at,
  };
}

export function toNowPlaying(r: Row<'now_playing'>): NowPlaying {
  return {
    title: r.title,
    artist: r.artist,
    fromRequestId: r.from_request_id,
    startedAt: r.started_at,
  };
}

export function toFolder(r: Row<'folders'>): Folder {
  return { id: r.id, name: r.name, position: r.position, photoCount: r.photo_count };
}

export function toPhoto(r: Row<'photos'>): Photo {
  return {
    id: r.id,
    folderId: r.folder_id,
    uploadedByGuestId: r.uploaded_by_guest_id,
    uploadedByName: r.uploaded_by_name,
    status: narrow(PHOTO_STATUSES, r.status, 'pending'),
    hue: r.hue,
    // DEVICE STATE. Absent from the schema by design -- see decision 2 at the top
    // of the migration. The repository's upload overlay fills these in for the
    // current guest's own in-flight rows and for nobody else's.
    localUri: null,
    progress: null,
    failureReason: null,
    storagePath: r.storage_path,
    thumbPath: r.thumb_path,
    // Resolved later by the signing layer, never by the mapper: a mapper turns a ROW into
    // a domain object, and a signed URL is a network round trip with an expiry.
    displayUrl: null,
    createdAt: r.created_at,
  };
}

/**
 * A report row's three nullable subject columns back into one discriminated union.
 *
 * The database's `reports_one_subject` check guarantees exactly one is non-null and
 * that it matches `subject_kind`, so a row that fails this is a row that should not
 * exist. It still cannot throw -- a mapper that throws takes down the whole realtime
 * batch over one bad row -- so it degrades to `guest` with a null-ish id, which the
 * host queue renders as an unactionable entry rather than crashing the console.
 */
function toReportSubject(r: Row<'reports'>): ReportSubject {
  if (r.subject_kind === 'photo' && r.subject_photo_id !== null) {
    return { kind: 'photo', photoId: r.subject_photo_id };
  }
  if (r.subject_kind === 'song_request' && r.subject_request_id !== null) {
    return { kind: 'song_request', requestId: r.subject_request_id };
  }
  return { kind: 'guest', guestId: r.subject_guest_id ?? '' };
}

export function toReport(r: Row<'reports'>): Report {
  return {
    id: r.id,
    subject: toReportSubject(r),
    reporterGuestId: r.reporter_guest_id,
    // Both of these are denormalised server-side, not joined: `guests` has no select
    // policy, so there is nothing for a host to join TO. See the migration.
    reporterName: r.reporter_name,
    subjectLabel: r.subject_label,
    reason: narrow(REPORT_REASONS, r.reason, 'other'),
    note: r.note,
    resolution: r.resolution === null ? null : narrow(REPORT_RESOLUTIONS, r.resolution, 'dismissed'),
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  };
}

/* --------------------------------------------------------------- comparators */

/**
 * Field-by-field comparators for RowCache.
 *
 * These are written out rather than deep-equalled because the failure modes are
 * asymmetric. Missing a field the UI reads means STALE DATA on screen, which is
 * silent and awful; comparing one field too many just costs a render. So every
 * field of the domain type is listed, and adding a field to the type without
 * adding it here is the mistake to watch for.
 */

export const eventCache = () =>
  new RowCache<RunitEvent>(
    (e) => e.id,
    (a, b) =>
      a.code === b.code && a.name === b.name && a.venue === b.venue &&
      a.startsAt === b.startsAt && a.timezone === b.timezone &&
      a.doorsLabel === b.doorsLabel && a.tier === b.tier &&
      a.activeFolderId === b.activeFolderId && a.nowScheduleItemId === b.nowScheduleItemId &&
      a.guestCount === b.guestCount && a.invitedCount === b.invitedCount,
  );

export const broadcastCache = () =>
  new RowCache<Broadcast>(
    (b) => b.id,
    (a, b) =>
      a.authorHostId === b.authorHostId && a.authorName === b.authorName &&
      a.authorRoleLabel === b.authorRoleLabel && a.kind === b.kind && a.body === b.body &&
      a.pinned === b.pinned && a.seenCount === b.seenCount && a.createdAt === b.createdAt,
  );

export const scheduleCache = () =>
  new RowCache<ScheduleItem>(
    (s) => s.id,
    (a, b) =>
      a.position === b.position && a.timeLabel === b.timeLabel && a.title === b.title &&
      a.place === b.place && a.startedAt === b.startedAt,
  );

export const requestCache = () =>
  new RowCache<SongRequest>(
    (r) => r.id,
    (a, b) =>
      a.title === b.title && a.artist === b.artist &&
      a.requestedByGuestId === b.requestedByGuestId && a.requestedByName === b.requestedByName &&
      a.status === b.status && a.voteCount === b.voteCount && a.createdAt === b.createdAt,
  );

export const folderCache = () =>
  new RowCache<Folder>(
    (f) => f.id,
    (a, b) => a.name === b.name && a.position === b.position && a.photoCount === b.photoCount,
  );

export const photoCache = () =>
  new RowCache<Photo>(
    (p) => p.id,
    (a, b) =>
      a.folderId === b.folderId && a.uploadedByGuestId === b.uploadedByGuestId &&
      a.uploadedByName === b.uploadedByName && a.status === b.status && a.hue === b.hue &&
      a.localUri === b.localUri && a.progress === b.progress &&
      a.failureReason === b.failureReason && a.storagePath === b.storagePath &&
      a.thumbPath === b.thumbPath &&
      // LISTED, and it has to be. Omit it and the first signed URL is reported as
      // "unchanged": RowCache hands back the old object with displayUrl null, the signal
      // never publishes, and the feature resolves every URL, pays the egress and renders
      // nothing. The comparator's own docblock says a missing field means STALE DATA.
      a.displayUrl === b.displayUrl &&
      a.createdAt === b.createdAt,
  );

export const hostCache = () =>
  new RowCache<Host>(
    (h) => h.id,
    (a, b) =>
      a.displayName === b.displayName && a.role === b.role && a.roleLabel === b.roleLabel,
  );

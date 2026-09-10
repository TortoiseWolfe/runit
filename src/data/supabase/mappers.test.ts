import { photoCache, toBroadcast, toEvent, toHost, toInvitee, toPhoto, toSongRequest } from './mappers';
import type { Row } from './database.types';
import type { Photo } from '../types';

const photoRow = (over: Partial<Row<'photos'>> = {}): Row<'photos'> => ({
  id: 'p1',
  event_id: 'e1',
  folder_id: 'f1',
  uploaded_by_guest_id: 'g1',
  uploaded_by_name: 'Ada',
  status: 'pending',
  hue: 120,
  storage_path: 'e1/p1.jpg',
  thumb_path: null,
  created_at: '2026-09-04T12:00:00Z',
  ...over,
});

describe('narrowing text columns to unions', () => {
  /**
   * Postgres enforces these with check constraints, but information_schema
   * reports the columns as `text`, so the generated types say `string`. A cast
   * would make the compiler agree with a value the app has no branch for.
   */
  it('accepts values the constraint allows', () => {
    expect(toHost({ id: 'h', event_id: 'e', auth_user_id: null, display_name: 'R', role: 'dj', role_label: 'DJ', created_at: 'x' }).role).toBe('dj');
    expect(toPhoto(photoRow({ status: 'approved' })).status).toBe('approved');
  });

  it('falls back rather than passing through a value nothing branches on', () => {
    // Simulates someone widening the DB check constraint without touching the TS
    // union -- the case where a cast would produce a HostRole that is not one.
    const host = toHost({ id: 'h', event_id: 'e', auth_user_id: null, display_name: 'R', role: 'sommelier', role_label: 'Wine', created_at: 'x' });
    expect(host.role).toBe('host');
    // The free-text label is untouched: that is the field that carries the human
    // word, which is the whole reason `role` can stay a closed set.
    expect(host.roleLabel).toBe('Wine');
  });

  it('never produces the two client-only photo statuses from a row', () => {
    // 'uploading' and 'failed' are device state. A row that somehow claimed one
    // must not become a photo the host queue believes has no bytes.
    expect(toPhoto(photoRow({ status: 'uploading' })).status).toBe('pending');
    expect(toPhoto(photoRow({ status: 'failed' })).status).toBe('pending');
  });
});

describe('device state is never invented', () => {
  it('leaves localUri, progress and failureReason null on every mapped row', () => {
    const p = toPhoto(photoRow());
    expect(p.localUri).toBeNull();
    expect(p.progress).toBeNull();
    expect(p.failureReason).toBeNull();
    // storagePath is the shared one and DOES come from the row -- conflating the
    // two is what hands a file:// path to a signed-URL resolver.
    expect(p.storagePath).toBe('e1/p1.jpg');
  });
});

describe('nullable columns the domain type declares non-null', () => {
  it('maps a null active folder to a value that matches no folder', () => {
    const base: Row<'events'> = {
      id: 'e1', code: 'AB12', name: 'Party', venue: 'Barn', starts_at: 'x',
      timezone: 'America/New_York', doors_label: '', tier: 'event',
      active_folder_id: null, now_schedule_item_id: null,
      guest_count: 3, invited_count: 10, created_at: 'x',
    };
    // Not a fake id. Empty string matches no folder, so an upload attempted
    // before any folder exists is refused rather than filed somewhere wrong.
    expect(toEvent(base).activeFolderId).toBe('');
  });

  it('keeps a deleted host\'s message readable', () => {
    const b = toBroadcast({
      id: 'b1', event_id: 'e1', author_host_id: null, author_name: 'Riley',
      author_role_label: 'Bride', kind: 'announcement', body: 'Hi', pinned: false,
      seen_count: 0, created_at: 'x',
    });
    // on delete set null is deliberate: the denormalised name and label are what
    // the feed renders, so removing a host does not blank the history.
    expect(b.authorName).toBe('Riley');
    expect(b.authorRoleLabel).toBe('Bride');
  });

  it('keeps an orphaned song request attributed', () => {
    const r = toSongRequest({
      id: 'r1', event_id: 'e1', title: 'Song', artist: 'A',
      requested_by_guest_id: null, requested_by_name: 'Devon',
      status: 'pending', vote_count: 2, created_at: 'x',
    });
    expect(r.requestedByGuestId).toBeNull();
    expect(r.requestedByName).toBe('Devon');
  });
});

describe('photoCache comparator covers every field the UI can read', () => {
  /**
   * THE POINT OF THIS TEST. RowCache reuses the previous object when `same`
   * returns true, which is what keeps list identity stable. A comparator that
   * forgets a field therefore does not cost a render -- it SHOWS STALE DATA, and
   * silently. Writing the fields out by hand is exactly the kind of thing that
   * rots when the type gains a field.
   *
   * So this walks the type instead of trusting the list: mutate one field at a
   * time and assert the cache notices every single one.
   */
  const base: Photo = {
    id: 'p1', folderId: 'f1', uploadedByGuestId: 'g1', uploadedByName: 'Ada',
    status: 'pending', hue: 120, localUri: null, progress: null,
    failureReason: null, storagePath: 'e1/p1.jpg', thumbPath: 'e1/p1_t.jpg',
    displayUrl: null, createdAt: '2026-09-04T12:00:00Z',
  };

  // `id` is the cache KEY, not a compared field -- changing it makes a different
  // row rather than a changed one, so it is excluded on purpose.
  const mutations: { [K in Exclude<keyof Photo, 'id'>]: Photo[K] } = {
    folderId: 'f2',
    uploadedByGuestId: 'g2',
    uploadedByName: 'Grace',
    status: 'approved',
    hue: 240,
    localUri: 'file:///tmp/a.jpg',
    progress: 0.5,
    failureReason: 'Network unavailable',
    storagePath: 'e1/p1-v2.jpg',
    thumbPath: 'e1/p1-v2_t.jpg',
    // The one that matters most (#10). Omitted from the comparator, the FIRST signed URL
    // reads as "unchanged" -- the cache hands back the old object with displayUrl null and
    // the image never appears, while every URL is still resolved and paid for.
    displayUrl: 'https://example.test/signed?token=abc',
    createdAt: '2026-09-04T13:00:00Z',
  };

  it.each(Object.keys(mutations))('notices a change to %s', (field) => {
    const cache = photoCache();
    const [first] = cache.reconcile([{ ...base }]);
    const changed = { ...base, [field]: mutations[field as keyof typeof mutations] };
    const [second] = cache.reconcile([changed as Photo]);
    expect(second).not.toBe(first);
  });

  it('reuses the object when nothing changed at all', () => {
    const cache = photoCache();
    const [first] = cache.reconcile([{ ...base }]);
    const [second] = cache.reconcile([{ ...base }]);
    expect(second).toBe(first);
  });
});

describe('toInvitee carries every column the schema has (#60)', () => {
  /**
   * NOTHING COVERED THIS MAPPER, and #60 is what made that expensive. `invitees` gained a
   * `phone` column and `email` became nullable; a mapper that forgot either would read as
   * null forever, on every device, with no error anywhere -- the same silent shape the photo
   * comparator above exists to prevent.
   *
   * It walks the ROW type rather than listing fields by hand, so a column added to
   * `database.types.ts` and forgotten in `toInvitee` fails here rather than in somebody's
   * guest list. Lane H proves production HAS the columns; this proves we read them.
   */
  const row: Row<'invitees'> = {
    id: 'inv1',
    event_id: 'e1',
    email: 'sam@example.test',
    phone: '(555) 010-1234',
    display_name: 'Sam',
    invited_at: '2026-09-10T12:00:00Z',
    joined_guest_id: 'g1',
    created_at: '2026-09-04T12:00:00Z',
  };

  // `event_id` and `created_at` are deliberately not on the domain type: the list is always
  // read scoped to one event, and nothing renders when a row was created.
  const CARRIED: Record<string, unknown> = {
    id: 'inv1',
    email: 'sam@example.test',
    phone: '(555) 010-1234',
    displayName: 'Sam',
    invitedAt: '2026-09-10T12:00:00Z',
    joinedGuestId: 'g1',
  };

  it.each(Object.keys(CARRIED))('carries %s through unchanged', (field) => {
    expect((toInvitee(row) as unknown as Record<string, unknown>)[field]).toEqual(CARRIED[field]);
  });

  it('maps every column that is not deliberately dropped', () => {
    // A coverage floor. If `database.types.ts` gains a column, this count moves and somebody
    // has to decide whether the domain type wants it -- rather than it being silently absent.
    const dropped = ['event_id', 'created_at'];
    expect(Object.keys(row).length - dropped.length).toBe(Object.keys(CARRIED).length);
  });

  it('keeps a phone-only invitee, which is the whole of #60', () => {
    const out = toInvitee({ ...row, email: null });
    expect(out.email).toBeNull();
    expect(out.phone).toBe('(555) 010-1234');
  });
});

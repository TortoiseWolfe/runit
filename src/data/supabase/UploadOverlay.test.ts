import { UploadOverlay } from './UploadOverlay';

/**
 * The upload state machine is the piece no verification lane can see.
 *
 * Lane B has no backend, Lane C is one emulator with one identity, and lane E
 * tests the database rather than this. These rows are also genuinely synthetic --
 * an uploading photo has NO database row, because a guest cannot patch
 * storage_path in afterwards -- so realtime will never correct a mistake here.
 */

const begin = (o: UploadOverlay, id: string, at = '2026-09-04T12:00:00Z') =>
  o.begin(id, {
    localUri: `file:///tmp/${id}.jpg`,
    folderId: 'f1',
    hue: 120,
    createdAt: at,
    uploadedByName: 'Ada',
  });

describe('a photo in flight', () => {
  it('starts at progress 0, not null', () => {
    // Null means "not transferring"; zero means "transferring, nothing has moved".
    // A bar that cannot tell them apart shows a stuck spinner on every photo that
    // already finished.
    const o = new UploadOverlay();
    begin(o, 'p1');
    expect(o.rows('g1')[0]).toMatchObject({ status: 'uploading', progress: 0 });
  });

  it('reports itself as in flight, so retry refuses to start a second transfer', () => {
    const o = new UploadOverlay();
    begin(o, 'p1');
    expect(o.isInFlight('p1')).toBe(true);
  });

  it('carries the local uri, because nothing else can render it yet', () => {
    // There is no storage_path and no row: the hue tile plus localUri is the only
    // way this photo appears on screen at all.
    const o = new UploadOverlay();
    begin(o, 'p1');
    const row = o.rows('g1')[0]!;
    expect(row.localUri).toBe('file:///tmp/p1.jpg');
    expect(row.storagePath).toBeNull();
  });
});

describe('a photo that failed', () => {
  it('drops progress to null and is no longer in flight', () => {
    const o = new UploadOverlay();
    begin(o, 'p1');
    o.setProgress('p1', 0.4);
    o.fail('p1', 'Network unavailable');
    const row = o.rows('g1')[0]!;
    expect(row).toMatchObject({ status: 'failed', progress: null, failureReason: 'Network unavailable' });
    // A frozen progress bar on a failed upload is exactly what shipped once.
    expect(o.isInFlight('p1')).toBe(false);
  });

  it('goes back to uploading on a retry, clearing the reason', () => {
    const o = new UploadOverlay();
    begin(o, 'p1');
    o.fail('p1', 'Network unavailable');
    o.setProgress('p1', 0);
    const row = o.rows('g1')[0]!;
    expect(row.status).toBe('uploading');
    expect(row.failureReason).toBeNull();
  });
});

describe('settling', () => {
  it('removes the row entirely once the insert succeeded', () => {
    // From here the real row arrives over realtime. Leaving the overlay entry
    // would show the guest two copies of one photo.
    const o = new UploadOverlay();
    begin(o, 'p1');
    o.settle('p1');
    expect(o.rows('g1')).toEqual([]);
    expect(o.size).toBe(0);
  });
});

describe('operations on an id the overlay does not know', () => {
  it('are no-ops rather than resurrections', () => {
    // A late progress callback from a settled transfer must not put a finished
    // photo back into `uploading`.
    const o = new UploadOverlay();
    begin(o, 'p1');
    o.settle('p1');
    o.setProgress('p1', 0.9);
    o.fail('p1', 'too late');
    expect(o.rows('g1')).toEqual([]);
  });
});

describe('ordering', () => {
  it('is newest first, matching MemoryRepository exactly', () => {
    // Same list on screen; a different order between adapters is a visible
    // difference with no cause a reader could find.
    const o = new UploadOverlay();
    begin(o, 'older', '2026-09-04T10:00:00Z');
    begin(o, 'newer', '2026-09-04T14:00:00Z');
    expect(o.rows('g1').map((r) => r.id)).toEqual(['newer', 'older']);
  });
});

describe('ownership', () => {
  it('attributes every row to the guest it is handed', () => {
    // photos.mine is scoped to the uploader: nobody else's failed upload is any
    // of their business, and there is no row for RLS to scope on the way there is
    // for a delivered photo.
    const o = new UploadOverlay();
    begin(o, 'p1');
    expect(o.rows('g7')[0]!.uploadedByGuestId).toBe('g7');
    expect(o.rows(null)[0]!.uploadedByGuestId).toBeNull();
  });
});

import type { GuestId, Photo, PhotoId } from '../types';

/**
 * The part of a photo that exists only on the phone doing the uploading.
 *
 * WHY THIS IS A SEPARATE THING AND NOT A COLUMN. `localUri`, `progress` and
 * `failureReason` are per-DEVICE: where the bytes sit in this phone's cache, how
 * far this phone's transfer has got, why this phone's attempt failed. Sharing
 * them would broadcast one guest's cache path to the room and let a second device
 * "resume" a transfer it is not performing. The migration says this outright
 * (decision 2), and the schema has no columns for any of them.
 *
 * WHY IT OWNS THE WHOLE `uploading` AND `failed` LIFECYCLE. The row-level
 * security only composes one way: `photos_moderate` is HOSTS ONLY, so a guest
 * cannot UPDATE their own photo row after inserting it. `storage_path` therefore
 * has to be written in the INSERT, which means the INSERT cannot happen until the
 * bytes have landed. So while a photo is uploading there is no database row at
 * all, and if the transfer fails there never is one.
 *
 * That makes these rows genuinely synthetic rather than a decoration over
 * something real -- which is the opposite of how the in-memory adapter works, and
 * is the single biggest structural difference between the two implementations.
 */

export interface Transfer {
  localUri: string;
  /** 0..1 while uploading. Null once it has failed -- see Photo.progress. */
  progress: number | null;
  failureReason: string | null;
  folderId: string;
  hue: number;
  createdAt: string;
  uploadedByName: string;
}

export class UploadOverlay {
  private transfers = new Map<PhotoId, Transfer>();

  begin(id: PhotoId, t: Omit<Transfer, 'progress' | 'failureReason'>): void {
    // Progress starts at 0, not null. Null means "not transferring" and zero
    // means "transferring, nothing has moved yet" -- a bar that cannot tell them
    // apart shows a stuck spinner on every photo that already finished.
    this.transfers.set(id, { ...t, progress: 0, failureReason: null });
  }

  setProgress(id: PhotoId, progress: number): void {
    const t = this.transfers.get(id);
    if (!t) return;
    this.transfers.set(id, { ...t, progress, failureReason: null });
  }

  fail(id: PhotoId, reason: string): void {
    const t = this.transfers.get(id);
    if (!t) return;
    this.transfers.set(id, { ...t, progress: null, failureReason: reason });
  }

  /** The bytes landed and the row was inserted; realtime owns it from here. */
  settle(id: PhotoId): void {
    this.transfers.delete(id);
  }

  get(id: PhotoId): Transfer | undefined {
    return this.transfers.get(id);
  }

  /** True while a transfer is running, so retry() can refuse to start a second. */
  isInFlight(id: PhotoId): boolean {
    const t = this.transfers.get(id);
    return t !== undefined && t.failureReason === null;
  }

  /**
   * The uploader's own in-flight and failed photos, newest first.
   *
   * Matches MemoryRepository's `mine` ordering exactly
   * (`b.createdAt.localeCompare(a.createdAt)`), because the screen renders them
   * in one list and a different order between adapters is a visible difference
   * with no cause a reader could find.
   */
  rows(guestId: GuestId | null): Photo[] {
    return [...this.transfers.entries()]
      .map(([id, t]) => ({
        id,
        folderId: t.folderId,
        uploadedByGuestId: guestId,
        uploadedByName: t.uploadedByName,
        status: (t.failureReason === null ? 'uploading' : 'failed') as Photo['status'],
        hue: t.hue,
        localUri: t.localUri,
        progress: t.progress,
        failureReason: t.failureReason,
        // No bytes are anywhere shared yet, by construction: the row is inserted
        // only once the upload succeeds.
        storagePath: null,
        thumbPath: null,
        displayUrl: null,
        createdAt: t.createdAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** For the entitlement usage count, which counts pending + uploading. */
  get size(): number {
    return this.transfers.size;
  }
}

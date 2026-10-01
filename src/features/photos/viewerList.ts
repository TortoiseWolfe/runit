import type { Photo, PhotoId } from '@/data/types';

/**
 * Which photo the viewer is on (spec 001b req 4): the photo's id, and the index it was last
 * seen at. The id is what the viewer follows; `at` is only used when the id has gone.
 */
export type Viewing = { id: PhotoId; at: number };

/**
 * The viewer's list (spec 001b req 2): this guest's own WAITING photos in the active folder
 * first, as the grid draws them, then the approved photos. Sending and failed transfers are
 * not in it (req 5) -- they carry progress and Retry, not a photo anybody has received.
 * `mineHere` is already folder-filtered for `pending` rows by PhotosScreen.
 */
export function viewerList(mineHere: Photo[], visible: Photo[]): Photo[] {
  const waiting = mineHere.filter((p) => p.status === 'pending');
  const ids = new Set(waiting.map((p) => p.id));
  return [...waiting, ...visible.filter((p) => !ids.has(p.id))];
}

/**
 * FOLLOW THE PHOTO, NOT THE SLOT (spec 001b req 4). Returns the SAME object when nothing
 * moved, so a caller can compare by identity. Approved while open: the id is still in the
 * list, so the viewer stays on it. Hidden while open: the photo that took its slot is the
 * next one; if there is none, the viewer closes (null).
 */
export function followViewing(list: Photo[], viewing: Viewing | null): Viewing | null {
  if (viewing === null) return null;
  const found = list.findIndex((p) => p.id === viewing.id);
  if (found >= 0) return found === viewing.at ? viewing : { id: viewing.id, at: found };
  const next = list[viewing.at];
  return next ? { id: next.id, at: viewing.at } : null;
}

/**
 * What the viewer draws for a photo (spec 001b req 3). A waiting photo is visible to its
 * uploader only, so it carries the mark and offers neither Save nor Report. Everything else
 * is unchanged.
 */
export function viewerControls(photo: Photo | null): { waiting: boolean; save: boolean; report: boolean } {
  const waiting = photo?.status === 'pending';
  return { waiting, save: !waiting, report: !waiting };
}

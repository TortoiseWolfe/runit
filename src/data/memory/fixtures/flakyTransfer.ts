import type { Photo } from '../../types';

/**
 * A transfer that reports progress and can fail on demand.
 *
 * WHY THIS EXISTS. The in-memory adapter's real transfer is instantaneous,
 * because nothing is being sent anywhere -- the bytes are already on the device.
 * That is the honest default and it means `uploading` and `failed` are otherwise
 * unreachable states: you cannot see a progress bar for work that is not
 * happening, and you cannot retry something that never fails.
 *
 * So the states that a network-backed adapter WILL produce are driven from here
 * instead, in tests and in manual QA. This is a fixture, not a simulation shipped
 * to users -- `MemoryRepository.create(seed)` with no options still completes
 * instantly.
 */
export function flakyTransfer(opts: {
  /** Fractions to report before settling, e.g. [0.25, 0.6, 0.9]. */
  steps?: number[];
  /** Fail every attempt whose 1-based index is in this list. */
  failAttempts?: number[];
  message?: string;
} = {}) {
  const steps = opts.steps ?? [0.5];
  const failAttempts = new Set(opts.failAttempts ?? []);
  const attempts = new Map<string, number>();

  return async (photo: Photo, onProgress: (fraction: number) => void): Promise<void> => {
    const n = (attempts.get(photo.id) ?? 0) + 1;
    attempts.set(photo.id, n);
    for (const step of steps) onProgress(step);
    if (failAttempts.has(n)) {
      throw new Error(opts.message ?? 'Upload failed. Check your connection.');
    }
  };
}

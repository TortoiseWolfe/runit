/**
 * Write actions: typed, toast-aware wrappers around repository calls.
 *
 * Screens call these, never the repository directly, so the paywall routing and
 * the confirmation copy live in exactly one place.
 */
import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';

import { denialMessage } from '@/domain/denials';
import { EntitlementError, JoinError, ScheduleError, type UploadOutcome } from '@/data/repository';
import { capturePhoto } from '@/lib/capture';
import { checkLimit } from '@/domain/entitlements';
import { useEntitlements } from './hooks';
import type { HostRole, ScheduleItemId, SongRequestId, PhotoId, FolderId } from '@/data/types';
import { useRepository } from './RepositoryProvider';
import { useToast } from './ToastProvider';

/**
 * Runs a repository write and turns an EntitlementError into a contextual REFUSAL
 * rather than an unexplained no-op. Every gated action goes through it.
 *
 * It used to push the pricing modal. That modal is cut from v1 -- it listed
 * $19/$79/$599 with no purchase path on the screen at all -- so the denial now
 * surfaces as a toast naming the specific limit or feature. The copy is the same
 * copy, moved to `domain/denials.ts`; what is gone is the attempt to sell a fix.
 *
 * The important property is unchanged and is the whole point of this function: a
 * gated action must never fail silently.
 */
export function useGuardedAction() {
  const { show } = useToast();
  return useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      try {
        await fn();
        return true;
      } catch (e) {
        if (e instanceof EntitlementError) {
          show(denialMessage(e.denial));
          return false;
        }
        throw e;
      }
    },
    [show],
  );
}

export function useJoinActions() {
  const repo = useRepository();
  const { show } = useToast();
  const router = useRouter();
  return useMemo(
    () => ({
      join: async (code: string, nickname: string) => {
        try {
          await repo.session.joinAsGuest({ code, nickname });
          show(`Welcome${nickname.trim() ? `, ${nickname.trim()}` : ''}. You're in.`);
          router.replace('/chat');
          return true;
        } catch (e) {
          show(e instanceof JoinError ? e.message : 'Could not join. Try again.');
          return false;
        }
      },
    }),
    [repo, show, router],
  );
}

export function useMusicActions() {
  const repo = useRepository();
  const { show } = useToast();
  const guarded = useGuardedAction();
  return useMemo(
    () => ({
      vote: (id: SongRequestId, on: boolean) => repo.music.setVote(id, on),
      request: async (raw: string) => {
        const text = raw.trim();
        if (!text) return;
        // Canvas: t.split(/\s[–-]\s/), artist defaulting to 'Unknown artist'.
        const [title, artist = ''] = text.split(/\s[–-]\s/);
        await repo.music.request({ title: (title ?? text).trim(), artist: artist.trim() });
        show('Request sent to the DJ');
      },
      accept: (id: SongRequestId) => guarded(() => repo.music.accept(id)),
      decline: (id: SongRequestId) => guarded(() => repo.music.decline(id)),
      markPlayed: (id: SongRequestId) => guarded(() => repo.music.markPlayed(id)),
      playNext: () => guarded(() => repo.music.playNext()),
    }),
    [repo, show, guarded],
  );
}

export function usePhotoActions() {
  const repo = useRepository();
  const entitlements = useEntitlements();
  const { show } = useToast();
  const guarded = useGuardedAction();
  return useMemo(
    () => ({
      capture: async (folderName: string) => {
        // ADVISORY pre-check, before the camera opens. `upload()` enforces the
        // cap authoritatively -- that must not move, because a check living only
        // in a handler is bypassed by the second caller. But enforcement alone
        // runs AFTER the guest has framed and taken a shot, and telling someone
        // their photo is refused once they have already taken it is the worst
        // possible moment. So: ask cheaply first, enforce properly second.
        const cap = checkLimit(entitlements, 'photos');
        if (!cap.allowed) {
          // Route to the paywall WITHOUT opening the camera. Reusing `guarded`
          // rather than pushing the route by hand keeps one implementation of
          // "what a denial does", so the deep-link params cannot drift.
          await guarded(() => {
            throw new EntitlementError(cap.denial);
          });
          return;
        }

        const shot = await capturePhoto();
        // null means the guest backed out of the camera. Not an error, and not
        // something to raise a toast about.
        if (!shot) return;

        // The canvas reads activeFolder from a stale closure for this toast
        // while its setState reads fresh state, so it can name the wrong
        // folder. The name is passed in from the same render here.
        // The outcome is READ, not assumed. `upload()` deliberately does not throw
        // on a transfer failure -- that is a state the guest can retry, not a
        // billing problem for the paywall guard -- so `guarded` returns true
        // either way. Announcing success off that boolean is how the toast came
        // to read "Uploaded ... awaiting host approval" over a tile that was
        // simultaneously offering Retry. Found on a device, not in this lane.
        let outcome: UploadOutcome | undefined;
        const ok = await guarded(async () => {
          outcome = await repo.photos.upload({ localUri: shot.uri });
        });
        if (!ok) return; // routed to the paywall
        if (outcome === 'failed') {
          // The failed tile carries the reason and the Retry button, so this
          // says the one thing the tile cannot: that nothing was sent.
          show('Upload failed. Your photo is saved — tap Retry.');
        } else if (outcome === 'approved') {
          // Free tier has no approval queue; promising a host review that will
          // never happen is a smaller lie than the last one but still a lie.
          show(`Added to ${folderName}`);
        } else {
          show(`Uploaded to ${folderName} · awaiting host approval`);
        }
      },
      // NOT wrapped in `guarded`. A retry cannot raise an EntitlementError --
      // the cap was taken when the row was created and is still held by it --
      // so routing this through the paywall guard could only mislead.
      retry: (id: PhotoId) => repo.photos.retry(id),
      approve: (id: PhotoId) => guarded(() => repo.photos.approve(id)),
      hide: (id: PhotoId) => guarded(() => repo.photos.hide(id)),
      addFolder: (name: string) => guarded(() => repo.photos.addFolder({ name })),
      selectFolder: (id: FolderId) => repo.event.setActiveFolder(id),
    }),
    [repo, show, guarded, entitlements],
  );
}

export function useHostActions() {
  const repo = useRepository();
  const guarded = useGuardedAction();
  const { show } = useToast();
  return useMemo(
    () => ({
      send: (body: string, pinned: boolean, push: boolean) =>
        repo.chat.send({ body, pinned, push }),
      /**
       * Forwards through the run of show. A tap that would move the cursor
       * BACKWARDS is refused and explained rather than performed -- the row above
       * the current one is the easiest to hit by mistake and the most expensive to
       * hit, because it rewinds every guest's Now/Next card and broadcasts again.
       * The host restarts an item deliberately by holding it (`restartScheduleItem`).
       */
      startScheduleItem: async (id: ScheduleItemId) => {
        try {
          await repo.schedule.start(id);
          return true;
        } catch (e) {
          if (e instanceof ScheduleError) {
            show(`${e.message} Hold the row to do it anyway.`);
            return false;
          }
          throw e;
        }
      },
      /** The deliberate form of the above. Bound to onLongPress, never to a tap. */
      restartScheduleItem: async (id: ScheduleItemId) => {
        await repo.schedule.start(id, { rewind: true });
        return true;
      },
      addScheduleItem: () =>
        repo.schedule.add({ title: 'New item', timeLabel: null, place: '' }),
      invite: (displayName: string, role: HostRole) =>
        guarded(() => repo.hosts.invite({ displayName, role })),
    }),
    [repo, guarded, show],
  );
}

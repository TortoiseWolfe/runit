/**
 * Write actions: typed, toast-aware wrappers around repository calls.
 *
 * Screens call these, never the repository directly, so the paywall routing and
 * the confirmation copy live in exactly one place.
 */
import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';

import { EntitlementError, JoinError, ScheduleError } from '@/data/repository';
import { capturePhoto } from '@/lib/capture';
import { checkLimit } from '@/domain/entitlements';
import { useEntitlements } from './hooks';
import type { HostRole, ScheduleItemId, SongRequestId, PhotoId, FolderId } from '@/data/types';
import { useRepository } from './RepositoryProvider';
import { useToast } from './ToastProvider';

/**
 * Runs a repository write and turns an EntitlementError into a contextual
 * paywall rather than an unexplained no-op. Every gated action goes through it.
 */
export function useGuardedAction() {
  const router = useRouter();
  return useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      try {
        await fn();
        return true;
      } catch (e) {
        if (e instanceof EntitlementError) {
          const d = e.denial;
          router.push({
            pathname: '/pricing',
            params: {
              reason: d.kind,
              detail: d.kind === 'limit' ? d.limit : d.feature,
              highlight: d.upgradeTo ?? '',
            },
          });
          return false;
        }
        throw e;
      }
    },
    [router],
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
        const ok = await guarded(() => repo.photos.upload({ localUri: shot.uri }));
        if (ok) show(`Uploaded to ${folderName} · awaiting host approval`);
      },
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

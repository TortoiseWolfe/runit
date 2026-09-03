/**
 * Write actions: typed, toast-aware wrappers around repository calls.
 *
 * Screens call these, never the repository directly, so the paywall routing and
 * the confirmation copy live in exactly one place.
 */
import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';

import { EntitlementError, JoinError } from '@/data/repository';
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
      markPlayed: (id: SongRequestId) => repo.music.markPlayed(id),
      playNext: () => repo.music.playNext(),
    }),
    [repo, show, guarded],
  );
}

export function usePhotoActions() {
  const repo = useRepository();
  const { show } = useToast();
  const guarded = useGuardedAction();
  return useMemo(
    () => ({
      capture: async (folderName: string) => {
        // The canvas reads activeFolder from a stale closure for this toast
        // while its setState reads fresh state, so it can name the wrong
        // folder. The name is passed in from the same render here.
        const ok = await guarded(() => repo.photos.upload({ localUri: null }));
        if (ok) show(`Uploaded to ${folderName} · awaiting host approval`);
      },
      approve: (id: PhotoId) => repo.photos.approve(id),
      hide: (id: PhotoId) => repo.photos.hide(id),
      addFolder: (name: string) => guarded(() => repo.photos.addFolder({ name })),
      selectFolder: (id: FolderId) => repo.event.setActiveFolder(id),
    }),
    [repo, show, guarded],
  );
}

export function useHostActions() {
  const repo = useRepository();
  const guarded = useGuardedAction();
  return useMemo(
    () => ({
      send: (body: string, pinned: boolean, push: boolean) =>
        repo.chat.send({ body, pinned, push }),
      startScheduleItem: (id: ScheduleItemId) => repo.schedule.start(id),
      addScheduleItem: () =>
        repo.schedule.add({ title: 'New item', timeLabel: null, place: '' }),
      invite: (displayName: string, role: HostRole) =>
        guarded(() => repo.hosts.invite({ displayName, role })),
    }),
    [repo, guarded],
  );
}

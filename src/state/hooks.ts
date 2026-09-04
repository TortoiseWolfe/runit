/**
 * Read hooks. A screen imports these and never touches the repository shape.
 */
import { useRepository } from './RepositoryProvider';
import { useObservable } from './useObservable';

export const useSession = () => useObservable(useRepository().session.current);
export const useEvent = () => useObservable(useRepository().event.current);
export const useFeed = () => useObservable(useRepository().chat.feed);
export const useSchedule = () => useObservable(useRepository().schedule.items);
export const useQueue = () => useObservable(useRepository().music.queue);
export const useIncoming = () => useObservable(useRepository().music.incoming);
export const useAccepted = () => useObservable(useRepository().music.accepted);
export const useNowPlaying = () => useObservable(useRepository().music.nowPlaying);
export const useMyVotes = () => useObservable(useRepository().music.myVotes);
export const useFolders = () => useObservable(useRepository().photos.folders);
export const usePendingPhotos = () => useObservable(useRepository().photos.pending);
export const useApprovedPhotos = () => useObservable(useRepository().photos.approved);
/** This guest's own in-flight and failed uploads. Nobody else's. */
export const useMyUploads = () => useObservable(useRepository().photos.mine);
export const useHosts = () => useObservable(useRepository().hosts.all);
/** Live tier + usage. For ADVISORY checks only -- the write methods enforce. */
export const useEntitlements = () => useObservable(useRepository().entitlements);

/** The current guest's own request, if they have one in the live queue. */
export function useMyRequest() {
  const queue = useQueue();
  const session = useSession();
  if (session.kind !== 'guest') return null;
  const idx = queue.findIndex((r) => r.requestedByGuestId === session.guestId);
  return idx === -1 ? null : { request: queue[idx]!, rank: idx + 1 };
}

/** Active folder, resolved. New uploads file into it. */
export function useActiveFolder() {
  const folders = useFolders();
  const event = useEvent();
  return folders.find((f) => f.id === event?.activeFolderId) ?? null;
}

/** The run-of-show "Now / Next" pair the Chat header shows. */
export function useNowNext() {
  const schedule = useSchedule();
  const event = useEvent();
  const idx = schedule.findIndex((s) => s.id === event?.nowScheduleItemId);
  return {
    nowIndex: idx,
    now: idx === -1 ? null : schedule[idx]!,
    next: idx === -1 ? null : (schedule[idx + 1] ?? null),
  };
}

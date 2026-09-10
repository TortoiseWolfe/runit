/**
 * Read hooks. A screen imports these and never touches the repository shape.
 */
import { useEffect } from 'react';

import { useRepository } from './RepositoryProvider';
import { useObservable } from './useObservable';

export const useSession = () => useObservable(useRepository().session.current);
/**
 * Whether a HOST SEAT is held here, which is not the same as which view is on screen
 * (#29). A host looking at the guest side reads `kind: 'guest'` and still holds her seat.
 */
export const useHoldsHostSeat = () => useObservable(useRepository().session.holdsHostSeat);
export const useEvent = () => useObservable(useRepository().event.current);
/**
 * The events this identity is staff at (#17). Empty for everyone who hosts nothing,
 * which is most people. Null until `useLoadMyEvents` has run.
 */
export const useMyEvents = () => useObservable(useRepository().event.mine);

/** What a code resolved to before joining. Null until `useLookUpInvite` has run. */
export const usePreview = () => useObservable(useRepository().event.preview);
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
/** Host-only by policy; a guest observes an empty list rather than an error (#25). */
export const useInvitees = () => useObservable(useRepository().invitees.all);

/** Saved lists this identity owns (#59). Empty for a guest, by policy and by design. */
export const useGuestLists = () => useObservable(useRepository().guestLists.all);
/** Live tier + usage. For ADVISORY checks only -- the write methods enforce. */
export const useEntitlements = () => useObservable(useRepository().entitlements);
/** Whether live updates are actually arriving (#45). `live` on MemoryRepository always. */
export const useConnection = () => useObservable(useRepository().connection);

/* -------------------------------------------------- moderation (Guideline 1.2) */

/**
 * People this guest has blocked. For the management list ONLY -- their content is
 * already filtered out of useApprovedPhotos, useQueue, useIncoming and useAccepted
 * before those hooks return, so no screen needs to consult this to render correctly.
 */
export const useBlocked = () => useObservable(useRepository().moderation.blocked);
/** The host's open-report queue: unresolved, oldest first. */
export const useReports = () => useObservable(useRepository().moderation.reports);
/** Subject keys this guest has already reported. See `subjectKey` in data/types. */
export const useMyReports = () => useObservable(useRepository().moderation.myReports);

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

/* ------------------------------------------------------------------ invitation */

/**
 * Resolve `?code=` into `event.preview`, once, on arrival.
 *
 * ONLY FROM A LINK OR A QR. It deliberately does not fire while someone types: a
 * lookup per keystroke would mint an anonymous auth user for every half-typed code
 * and turn the join field into a code-guessing probe with the rate limit as its only
 * brake. Somebody who followed a link has already been given the code by whoever is
 * running the event.
 *
 * THE EFFECT SETS NO STATE. It calls one repository method, and the answer arrives
 * through the observable that `usePreview` already reads. That is not tidiness -- the
 * React Compiler rules reject `setState` inside an effect, and they are right to: the
 * version that keeps a local copy has two sources of truth for the same lookup.
 *
 * A failure is swallowed on purpose. The consequence of a preview that does not load
 * is a screen that says "An event", which is exactly what this screen said before the
 * lookup existed. Raising a toast for it would interrupt someone who came here to
 * type a nickname, over a thing they never asked for.
 */
/**
 * Load the events this identity hosts, once, on mount.
 *
 * SEPARATE FROM `useMyEvents` on purpose, and the same split as `useLookUpInvite` beside
 * `usePreview`: the read is a pure observable and the load is an effect, so a screen that
 * only wants to DRAW the list does not also trigger a fetch, and the effect sets no state
 * of its own -- which the React Compiler rules reject and were right to.
 *
 * `deps` re-runs it. The join screen passes the session kind, so signing into a seat or
 * closing an event refreshes the list rather than leaving a stale one on screen.
 */
export function useLoadMyEvents(dep?: unknown): void {
  const repo = useRepository();
  useEffect(() => {
    void repo.event.loadMine();
  }, [repo, dep]);
}

export function useLookUpInvite(code: string | undefined): void {
  const repo = useRepository();
  useEffect(() => {
    if (!code?.trim()) return;
    void repo.event.lookUp(code).catch(() => {});
  }, [repo, code]);
}

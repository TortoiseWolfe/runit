/**
 * Write actions: typed, toast-aware wrappers around repository calls.
 *
 * Screens call these, never the repository directly, so the paywall routing and
 * the confirmation copy live in exactly one place.
 */
import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';

import { denialMessage } from '@/domain/denials';
import {
  EntitlementError, JoinError, ScheduleError,
  type CreatedEvent, type EventDetails, type InvitedHost, type NewEvent, type NewHost,
  type UploadOutcome,
} from '@/data/repository';
import { capturePhoto } from '@/lib/capture';
import { checkLimit } from '@/domain/entitlements';
import { useEntitlements } from './hooks';
import type {
  BroadcastId, FolderId, GuestId, PhotoId, ReportId, ReportReason, ReportResolution,
  ReportSubject, ScheduleItemId, SongRequestId,
} from '@/data/types';
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
      /**
       * `hostKey` is optional and, when present, runs AFTER the join.
       *
       * That order is not cosmetic. Claiming a host seat binds an auth user, and
       * against Supabase there is no auth user until the anonymous sign-in inside
       * joinAsGuest. Claiming first would have nothing to bind.
       *
       * A wrong key does NOT undo the join. The guest is already seated and their seat
       * is idempotent; throwing them back to the form to retype a nickname would punish
       * a typo in the optional field by discarding the work of the required ones.
       */
      join: async (code: string, nickname: string, hostKey?: string) => {
        try {
          await repo.session.joinAsGuest({ code, nickname });
        } catch (e) {
          show(e instanceof JoinError ? e.message : 'Could not join. Try again.');
          return false;
        }

        const key = hostKey?.trim();
        if (key) {
          try {
            await repo.session.claimHost({ code, key });
            show('You are the host of this event.');
            router.replace('/host/broadcast');
            return true;
          } catch (e) {
            // The failure is the ONLY toast raised on this path. Falling through to the
            // welcome would replace this message within a frame -- one Toast, one slot,
            // last writer wins -- so the person who mistyped their key would be told
            // nothing at all and simply arrive as a guest wondering why.
            show(e instanceof JoinError ? e.message : 'Could not claim the host seat.');
            router.replace('/chat');
            return true;
          }
        }

        show(`Welcome${nickname.trim() ? `, ${nickname.trim()}` : ''}. You're in.`);
        router.replace('/chat');
        return true;
      },
    }),
    [repo, show, router],
  );
}

/**
 * Leaving the event, which is the only session write a guest can make.
 *
 * closeEvent rather than leave: see LeaveSheet's header and the seam's own doc. The
 * navigation is here rather than in the sheet because every other action in this file
 * routes from here too, and a screen that both mutates the session and decides where to
 * go afterwards is the shape that made /join unreachable in the first place.
 */
export function useSessionActions() {
  const repo = useRepository();
  const router = useRouter();
  return useMemo(
    () => ({
      closeEvent: async () => {
        await repo.session.closeEvent();
        router.replace('/join');
      },
    }),
    [repo, router],
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

/**
 * Bringing an event into existence.
 *
 * Its own hook rather than a member of useHostActions, because the caller is by
 * definition NOT a host yet -- that is the whole point of the call. Bundling it there
 * would put the one action a non-host needs behind a name that says otherwise.
 */
export function useCreateActions() {
  const repo = useRepository();
  const { show } = useToast();
  return useMemo(
    () => ({
      /**
       * Returns the created event on success and `null` on failure, so the screen can
       * show the key without also having to decide what an error means.
       *
       * Caught and toasted here rather than left to bubble: `create_event` raises named
       * conditions -- no name, no timezone, ten events already -- and each is something
       * a person can act on. An unhandled rejection would leave a host looking at a
       * spinner that stopped.
       */
      createEvent: async (input: NewEvent): Promise<CreatedEvent | null> => {
        try {
          const made = await repo.event.create(input);
          // NO ROUTER PUSH HERE. The screen swaps itself to the key panel and moves on
          // only when the host says she has written it down -- navigating away would
          // destroy the one copy of a key that exists nowhere else.
          return made;
        } catch (e) {
          show(e instanceof Error ? e.message : 'Could not create that event.');
          return null;
        }
      },
    }),
    [repo, show],
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
       * #26. Through `guarded`, so a free tier's attempt to pin surfaces as the toast
       * that NAMES the limit rather than as an unhandled throw -- the same treatment
       * every other capped control gets. Un-pinning cannot be refused (the adapters gate
       * only the `true` direction), so the guard is simply inert in that direction.
       */
      setBroadcastPinned: (id: BroadcastId, pinned: boolean) =>
        guarded(() => repo.chat.setPinned(id, pinned)),
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
      /**
       * Mint a co-host seat and hand back the key that redeems it, once.
       *
       * `guarded` returns false on an EntitlementError after toasting the limit, so the
       * caller distinguishes "denied" from "here is the key" by the null. The key is NOT
       * toasted: a toast is gone in four seconds and this string exists nowhere else.
       */
      invite: async (input: NewHost): Promise<InvitedHost | null> => {
        let minted: InvitedHost | null = null;
        try {
          const ok = await guarded(async () => {
            minted = await repo.hosts.invite(input);
          });
          if (!ok) return null;
        } catch (e) {
          // `guarded` handles EntitlementError and RE-THROWS everything else, so the
          // adapter's own refusals -- not a host, no name, a schema mismatch -- would
          // otherwise surface as an unhandled rejection with the sheet still open.
          show(e instanceof Error ? e.message : 'Could not add that co-host.');
          return null;
        }
        return minted;
      },
      /**
       * Correct the event's name, date, venue or doors line.
       *
       * Caught and toasted here rather than left to `guarded`, which re-throws
       * anything that is not an EntitlementError. The failure that matters is a
       * non-host reaching this: against Supabase that update matches the policy on
       * nothing, affects zero rows and raises nothing at all, so `assertWrote` in the
       * adapter is what turns it into an error -- and an uncaught one would surface as
       * an unhandled rejection with the host still looking at a form they think saved.
       */
      /**
       * A fresh recovery key, retiring the old one.
       *
       * Returns the plaintext for the caller to display once; there is no second chance
       * to read it, so a screen that drops this return value has destroyed it.
       */
      rotateHostKey: async (): Promise<string | null> => {
        try {
          return await repo.event.rotateHostKey();
        } catch (e) {
          show(e instanceof Error ? e.message : 'Could not issue a new key.');
          return null;
        }
      },
      saveEventDetails: async (input: EventDetails) => {
        try {
          await repo.event.updateDetails(input);
          show('Saved. Every guest sees it now.');
          return true;
        } catch {
          show('Could not save those details. Only a host of this event can.');
          return false;
        }
      },
    }),
    [repo, guarded, show],
  );
}

/**
 * Report, block and resolve.
 *
 * Guideline 1.2 wants these reachable and wants them to visibly do something -- a
 * reviewer taps Report and looks for evidence it was received. So every path here
 * ends in a toast, including the already-reported one, which would otherwise look
 * like a dead button to the one person pressing it correctly.
 */
export function useModerationActions() {
  const repo = useRepository();
  const { show } = useToast();
  return useMemo(
    () => ({
      report: async (subject: ReportSubject, reason: ReportReason, note?: string) => {
        await repo.moderation.report({ subject, reason, note });
        show('Reported. A host will review it.');
      },
      block: async (guestId: GuestId, nickname: string) => {
        await repo.moderation.block(guestId);
        show(`You will not see posts from ${nickname}.`);
      },
      unblock: async (guestId: GuestId, nickname: string) => {
        await repo.moderation.unblock(guestId);
        show(`Unblocked ${nickname}.`);
      },
      resolve: async (id: ReportId, resolution: ReportResolution) => {
        await repo.moderation.resolve(id, resolution);
        show(
          resolution === 'removed'
            ? 'Removed, and the report is closed.'
            : resolution === 'blocked'
              ? 'Closed, and the guest is blocked.'
              : 'Closed with no action.',
        );
      },
    }),
    [repo, show],
  );
}

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
import { canPickContacts, pickContact } from '@/lib/contacts';
import { registerForPush } from '@/lib/push';
import { checkLimit } from '@/domain/entitlements';
import { useEntitlements } from './hooks';
import type {
  GuestListId,
  BroadcastId, FolderId, GuestId, InviteeId, PhotoId, ReportId, ReportReason, ReportResolution,
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

        // REGISTER FOR PUSH AFTER THE SEAT EXISTS, never before: `set_push_token` scopes
        // the token to a `guests` row, and there is no row until the join lands.
        //
        // NOT AWAITED INTO THE HAPPY PATH, and never allowed to fail it. The OS prompt
        // can sit on screen for as long as the person likes, and a guest who says no is
        // in a completely normal state -- `registerForPush` returns null and the seam
        // stores null. Blocking the welcome on a permission dialog would make the app
        // feel broken to the one person who declined it.
        void registerForPush()
          .then((token) => repo.session.setPushToken(token))
          .catch((e) => console.warn('push: registration did not complete', e));

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
  const { show } = useToast();
  return useMemo(
    () => ({
      closeEvent: async () => {
        await repo.session.closeEvent();
        router.replace('/join');
      },
      /**
       * Open another event this identity is staff at (#17).
       *
       * ROUTES TO THE HOST CONSOLE, because `open` leaves the caller holding a host seat
       * and the console is where that seat is useful -- landing her on the guest chat of a
       * party she runs would be a step backwards from the screen she tapped on.
       *
       * The throw is caught and shown, not swallowed: `open` refuses an event the caller
       * holds no seat at, and a list row that silently does nothing is the shape of the
       * three inert controls #29 and #37 were about.
       */
      openEvent: async (eventId: string) => {
        try {
          await repo.event.open(eventId);
          router.replace('/host/broadcast');
        } catch (e) {
          show(e instanceof Error ? e.message : 'That event could not be opened.');
        }
      },
      /**
       * #43. Returns nothing to the caller and reports through the toast instead, because
       * the two outcomes a person cares about are "it changed" and "it did not", and the
       * sheet closes either way. The stored name is what is quoted -- `set_nickname` trims
       * and caps, so echoing the input would name something the room is not seeing.
       */
      setNickname: async (nickname: string) => {
        try {
          const stored = await repo.session.setNickname(nickname);
          show(`You are ${stored} now.`);
        } catch {
          show('Could not change your name. Try again.');
        }
      },
    }),
    [repo, router, show],
  );
}

/**
 * #24. Fire-and-forget by contract: the caller is a scroll handler, and a read that fails
 * to record is a wrong number rather than a broken screen. The `.catch` is REQUIRED and
 * not a habit -- `void` on a promise does not catch, so a throw here would surface as an
 * unhandled rejection over a feed someone is quietly reading. The adapter un-marks on
 * failure, so the next sweep retries; nothing is dropped permanently by swallowing this.
 */
export function useChatActions() {
  const repo = useRepository();
  return useMemo(
    () => ({
      markRead: (ids: BroadcastId[]) => {
        void repo.chat.markRead(ids).catch(() => {});
      },
    }),
    [repo],
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
        const { merged } = await repo.music.request({
          title: (title ?? text).trim(),
          artist: artist.trim(),
        });
        // TWO OUTCOMES, TWO SENTENCES (#44). A request that merged into a song already in
        // the queue adds no row, so "Request sent to the DJ" would describe something the
        // guest cannot find -- they would look for their song at the bottom and see
        // nothing. Saying the vote landed is both true and better news.
        show(merged ? 'Already in the queue — your vote is on it' : 'Request sent to the DJ');
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
          outcome = await repo.photos.upload({ localUri: shot.uri, thumbLocalUri: shot.thumbUri });
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
      /**
       * GUARDED, and the draft survives a failure (#45's neighbour).
       *
       * This was a bare pass-through, awaited by `BroadcastPanel` with no catch, over a
       * method that throws three ways -- not a host, a PostgREST error, and `assertWrote`'s
       * RLS refusal. There is no error boundary in this app, so a refused broadcast was an
       * unhandled rejection: no toast, no log, and the host left staring at her own text
       * with no idea whether it went. On the exact path #45 was reported from.
       *
       * NOT through `useGuardedAction`: `chat.send` cannot raise an EntitlementError -- a
       * pin the tier cannot carry is FOLDED, not refused -- so routing it through the
       * paywall guard could only mislead, exactly as `retry` argues above.
       *
       * Returns whether it landed so the caller can keep the draft. Destroying what she
       * typed on a failure is worse than the silence this replaces.
       */
      send: async (body: string, pinned: boolean): Promise<boolean> => {
        try {
          await repo.chat.send({ body, pinned });
          return true;
        } catch (e) {
          show(e instanceof Error ? e.message : 'Could not send that announcement.');
          return false;
        }
      },
      /**
       * #26. Through `guarded`, so a free tier's attempt to pin surfaces as the toast
       * that NAMES the limit rather than as an unhandled throw -- the same treatment
       * every other capped control gets. Un-pinning cannot be refused (the adapters gate
       * only the `true` direction), so the guard is simply inert in that direction.
       */
      setBroadcastPinned: (id: BroadcastId, pinned: boolean) =>
        guarded(() => repo.chat.setPinned(id, pinned)),
      /**
       * #25. Returns whether it landed, so the screen can keep a rejected address in the
       * field instead of vanishing it -- a duplicate is the common case and the host
       * wants to see what they typed.
       *
       * A duplicate is not an EntitlementError, so `guarded` would rethrow it; the catch
       * here surfaces the adapter's sentence, which is already human ("That address is
       * already on the list.").
       */
      addInvitee: async (email: string, displayName?: string) => {
        try {
          await repo.invitees.add({ email, displayName });
          return true;
        } catch (e) {
          show(e instanceof Error ? e.message : 'Could not add that address.');
          return false;
        }
      },
      removeInvitee: (id: InviteeId) => repo.invitees.remove(id),

      /**
       * THE ADDRESS BOOK, ONE CONTACT AT A TIME BECAUSE THAT IS THE OS'S RULE (#60).
       *
       * Both platforms' system pickers return a single contact per presentation; a
       * multi-select needs full READ_CONTACTS and our own list UI, which is a whole
       * address-book read in exchange for a nicer control -- not a trade worth making with
       * somebody else's contacts.
       *
       * It reports what actually happened rather than assuming. A picked contact can be a
       * duplicate (a family list run twice) or carry no way to reach anybody at all, and
       * both are ordinary. Silence after a tap is the failure this repo keeps closing.
       */
      addFromContacts: async () => {
        // NO PICKER AT ALL IS NOT A DISMISSAL, and treating them the same made this button
        // do nothing, silently, in the browser. `pickContact` returns null for both, so the
        // platform has to be asked separately.
        if (!canPickContacts) {
          show('Contacts only work in the app on a phone. Type the address here instead.');
          return false;
        }
        const picked = await pickContact();
        // Backing out IS a decision, and gets no toast -- the same as backing out of the
        // camera. Only the impossible case above speaks.
        if (!picked) return false;
        if (!picked.email && !picked.phone) {
          show(`${picked.name ?? 'That contact'} has no email or phone saved.`);
          return false;
        }
        const { added, skipped } = await repo.invitees.addMany([
          { email: picked.email ?? undefined, phone: picked.phone ?? undefined, displayName: picked.name ?? undefined },
        ]);
        show(added > 0 ? `${picked.name ?? 'Added'} is on the list.` : 'They are already on the list.');
        return added > 0 || skipped === 0;
      },

      /**
       * HANDS THE INVITATION TO THE PHONE'S OWN COMPOSER, and stamps `invited_at` only if
       * the sheet was used. A dismissal leaves the list exactly as it was -- a host who
       * backed out has invited nobody, and a date beside a message that was never sent is
       * worse than no date, which is what this column held for the life of the repo.
       */
      /**
       * SAVING THE ROSTER AS A LIST (#59), which is how a first list comes to exist. Nobody
       * builds an address book in the abstract; they invite people to a party and then want
       * the same forty next time.
       */
      saveGuestList: async (name: string) => {
        try {
          await repo.guestLists.saveCurrent(name);
          show(`Saved as "${name.trim()}".`);
          return true;
        } catch (e) {
          show(e instanceof Error ? e.message : 'Could not save that list.');
          return false;
        }
      },

      /** Copies a saved list onto this event. Reports what actually landed. */
      attachGuestList: async (id: GuestListId, name: string) => {
        try {
          const added = await repo.guestLists.attach(id);
          show(
            added > 0
              ? `Added ${added} from "${name}".`
              : `Everyone on "${name}" is already invited.`,
          );
          return true;
        } catch (e) {
          show(e instanceof Error ? e.message : 'Could not attach that list.');
          return false;
        }
      },

      removeGuestList: (id: GuestListId) => repo.guestLists.remove(id),

      /**
       * FORGETS SOMEBODY EVERYWHERE. The toast names the number because the whole point is
       * that it reaches more than the row you were looking at -- every saved list and every
       * event you host, finished ones included.
       */
      forgetPerson: async (who: { email?: string; phone?: string }) => {
        try {
          const gone = await repo.guestLists.forget(who);
          show(gone > 0 ? `Removed from ${gone} place${gone === 1 ? '' : 's'}.` : 'Nothing to remove.');
          return true;
        } catch (e) {
          show(e instanceof Error ? e.message : 'Could not remove them.');
          return false;
        }
      },

      sendInvitations: async (ids: InviteeId[]) => {
        if (ids.length === 0) return false;
        try {
          const sent = await repo.invitees.send(ids);
          show(
            sent
              ? `Invitation sent to ${ids.length}.`
              : 'No share sheet here — nothing was sent.',
          );
          return sent;
        } catch (e) {
          show(e instanceof Error ? e.message : 'Could not send that.');
          return false;
        }
      },
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
      /**
       * A REAL TITLE, OR NOTHING (#64). This inserted `'New item'` -- a row the host could
       * neither rename nor delete, on a card whose own helper text tells her to tap rows
       * when they start, which broadcasts that placeholder to every guest into a feed with
       * no delete path.
       *
       * It refuses rather than substituting, for the same reason `set_nickname` refuses an
       * empty name: a placeholder somebody has to live with is worse than being asked again.
       */
      addScheduleItem: async (title: string, timeLabel?: string) => {
        const name = title.trim();
        if (!name) {
          show('Give the item a name first.');
          return false;
        }
        try {
          await repo.schedule.add({
            title: name,
            // NULL, not '', and the difference renders: the card prints "TBD" for null,
            // which is the canvas's own word for an item whose time is not decided yet.
            timeLabel: timeLabel?.trim() || null,
            place: '',
          });
          return true;
        } catch (e) {
          show(e instanceof Error ? e.message : 'Could not add that.');
          return false;
        }
      },

      removeScheduleItem: async (id: ScheduleItemId) => {
        try {
          await repo.schedule.remove(id);
          return true;
        } catch (e) {
          show(e instanceof Error ? e.message : 'Could not remove that.');
          return false;
        }
      },
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

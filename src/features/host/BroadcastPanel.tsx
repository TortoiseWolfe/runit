import { useState } from 'react';
import {
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { EventQr } from '@/components/ui/EventQr';
import { icsFilename, icsFor, shareMessage } from '@/lib/invite';
import { shareIcs, shareText } from '@/lib/share';
import { useToast } from '@/state/ToastProvider';

import { formatClock } from '@/lib/format';
import { useHostActions } from '@/state/actions';
import { useEvent, useFeed, useNowNext, useSchedule } from '@/state/hooks';
import { alpha, border, eyebrow, radius, useTheme, weight } from '@/theme';

/** Artboard 03, Broadcast segment. */
export function BroadcastPanel() {
  const { tokens, fade, depthCss } = useTheme();
  const event = useEvent();
  const feed = useFeed();
  const schedule = useSchedule();
  const { nowIndex } = useNowNext();
  const {
    send, setBroadcastPinned, startScheduleItem, restartScheduleItem,
    addScheduleItem, removeScheduleItem,
  } = useHostActions();
  const [draft, setDraft] = useState('');
  const [pinned, setPinned] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [itemTitle, setItemTitle] = useState('');
  const [itemTime, setItemTime] = useState('');
  const { show } = useToast();

  // Addressed to everyone invited, not just whoever is currently in the room.
  const invited = event?.invitedCount ?? 0;
  /**
   * Sharing lives on the HOST console and nowhere else, because handing out the code is
   * a host's job. It sits above the composer for the same reason: a guest who never got
   * the code cannot read an announcement.
   */
  const onShare = async () => {
    if (!event) return;
    const shared = await shareText(shareMessage(event));
    if (!shared) show(`No share sheet here. The code is ${event.code.toUpperCase()}.`);
  };

  /**
   * THE HOST COULD NOT SEND THE DATE (#61).
   *
   * `icsFor` has existed and been tested since the invitation work -- eleven assertions
   * covering CRLF, octet folding, escaping and a stable UID -- and it was reachable from
   * exactly ONE place: the guest's join screen, in the app, AFTER they arrived. The person
   * who most needs a date on their calendar is the one who has not got that far, and the
   * only message that reaches them is the one the HOST sends from here. `shareMessage`
   * carries the name, the code, the venue and the doors label; the start time went out as
   * prose or not at all.
   *
   * A SEPARATE CONTROL RATHER THAN FOLDING IT INTO `Share invite`. A share sheet takes one
   * payload -- `Share.share` takes `message` OR `url`, and platforms disagree about what
   * happens when you pass both -- so combining them would make the text invitation worse on
   * some phones to make the calendar file possible on others. Two controls, each doing one
   * legible thing, is also what the guest side already offers.
   *
   * The same `Pick<RunitEvent, ...>` the guest path uses, which the full event satisfies --
   * including `id`, the calendar UID, so a host adding it and a guest adding it produce ONE
   * entry rather than two.
   */
  const onAddToCalendar = async () => {
    if (!event) return;
    const shared = await shareIcs(icsFilename(event), icsFor(event));
    // Reporting the outcome rather than assuming it, exactly as JoinScreen does: on a
    // desktop browser there is no share sheet at all, and a control that silently does
    // nothing is the failure the calendar pill spent months demoted to a View to avoid.
    show(shared ? 'Calendar file ready.' : 'Calendar export needs the app on a phone.');
  };

  const onAddScheduleItem = async () => {
    // CLEARS ONLY ON SUCCESS, the same rule as the broadcast composer: a refusal that
    // wipes what somebody typed punishes them for the app's own message.
    if (await addScheduleItem(itemTitle, itemTime)) {
      setItemTitle('');
      setItemTime('');
    }
  };

  const onSend = async () => {
    if (!draft.trim()) return;
    // THE DRAFT SURVIVES A FAILURE. `send` used to be unguarded, so a refusal was an
    // unhandled rejection -- and because the clear ran on the line after an `await` that
    // never returned, the text happened to stay. Now that the throw is caught, clearing
    // unconditionally would DESTROY what she typed on exactly the failure that most
    // deserves a retry.
    if (!(await send(draft, pinned))) return;
    setDraft('');
    setPinned(false);
  };

  return (
    /*
      No KeyboardAvoidingView here, and that is the rule rather than an oversight: a
      KAV must be OUTERMOST for its offset to be 0, and HostConsoleChrome sits above
      the <Slot/> in host/_layout.tsx -- so one here would need a hand-measured header
      height that drifts the first time the chrome changes. This screen is a plain
      scrolling document, so it insets itself instead.

      keyboardShouldPersistTaps fixes a LIVE bug: the Send Pressable is inside this
      same ScrollView as the textarea, so under RN's 'never' default a host's first
      tap on Send is swallowed dismissing the keyboard. Two taps to send an
      announcement, and nothing on screen to explain why.

      keyboardDismissMode matters more here than anywhere else: the field is
      multiline, so its Return inserts a newline and there is no return key to close
      the keyboard with. 'interactive' is iOS-only and silently degrades to 'none' on
      Android, which would leave Android hosts with no way out at all.
    */
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      testID="host-broadcast"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets
    >
      {/* THE INVITE ROW IS NOT DRAWN UNTIL THERE IS SOMETHING TO INVITE ANYONE TO.
          These two were `disabled={!event}`, and both were reported from a phone on the
          same evening -- "press show QR and nothing happens", "press Share Invite
          nothing happens". They were not broken handlers. They were disabled buttons,
          and a disabled button with no explanation reads as broken software.

          Same boolean, same fix, same rule as the calendar pill on JoinScreen: a control
          that cannot act is not drawn. tests/e2e/empty-world.spec.ts asserts the general
          form -- nothing visible may be aria-disabled -- so the next one of these fails a
          test instead of a person's evening. */}
      {event ? (
      <View style={s.inviteRow}>
        <Pressable
          onPress={onShare}
          accessibilityRole="button"
          accessibilityLabel="Share the join code and link"
          hitSlop={8}
          testID="host-share"
        >
          <Text style={[s.inviteAction, { color: tokens.accent }]}>Share invite →</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowQr((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showQr }}
          accessibilityLabel={showQr ? 'Hide the QR code' : 'Show a QR code to scan'}
          hitSlop={8}
          testID="host-qr-toggle"
        >
          <Text style={[s.inviteAction, { color: tokens.accent }]}>
            {showQr ? 'Hide QR' : 'Show QR'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onAddToCalendar}
          accessibilityRole="button"
          accessibilityLabel="Share a calendar file for this event"
          hitSlop={8}
          testID="host-share-calendar"
        >
          <Text style={[s.inviteAction, { color: tokens.accent }]}>Calendar</Text>
        </Pressable>
      </View>
      ) : null}

      {showQr && event && (
        <View style={s.qrHolder}>
          <EventQr code={event.code} />
        </View>
      )}

      <TextInput
        value={draft}
        onChangeText={setDraft}
        multiline
        placeholder={`Announce something to all ${invited} guests…`}
        placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
        accessibilityLabel="Announcement"
        testID="broadcast-draft"
        style={[
          s.textarea,
          { boxShadow: depthCss.groove },
          { borderColor: tokens.base300, backgroundColor: tokens.base200, color: tokens.baseContent },
        ]}
      />

      <View style={s.pillRow}>
        <Pressable
          onPress={() => setPinned((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ selected: pinned }}
          testID="pin-toggle"
          style={[
            s.pill,
            { borderColor: tokens.base300, backgroundColor: pinned ? tokens.primary : 'transparent' },
          ]}
        >
          <Text style={[s.pillText, { color: pinned ? tokens.primaryContent : tokens.baseContent }]}>
            {pinned ? 'Pinned ✓' : 'Pin to top'}
          </Text>
        </Pressable>
        {/* The canvas draws a "Push notification · on" pill here. It is not drawn,
            because push does not exist: `expo-notifications` is not a dependency.
            A badge telling a host her announcement will buzz 180 phones, over a code
            path that does nothing, is the most expensive kind of lie in this app --
            she would rely on it.

            The `push` ARGUMENT that used to sit behind it is gone too (#27). It was a
            boolean every caller passed `true` and every adapter discarded, and the
            ladder sold it at $79. Restore the pill when push exists, not before.
            FIDELITY notes O and Z. */}
      </View>

      <Pressable
        onPress={onSend}
        accessibilityRole="button"
        testID="broadcast-send"
        style={[s.send, { backgroundColor: tokens.primary }]}
      >
        <Text style={[s.sendText, { color: tokens.primaryContent }]}>Send to {invited} guests</Text>
      </Pressable>

      <View style={s.sectionHead}>
        <Text style={[s.sectionTitle, { color: alpha(tokens.baseContent, fade.muted) }]}>
          Run of show
        </Text>
        {/* A bare text link is ~15pt tall -- under the 24x24 of WCAG 2.2 SC 2.5.8
            (Target Size (Minimum), Level AA). hitSlop is the right fix here and
            not on the rows above: this link has no interactive neighbour, so RN's
            "z-index of sibling views takes precedence" caveat cannot bite. */}
      </View>

      {/* A COMPOSER, BECAUSE "+ Add" COULD ONLY MAKE "New item" (#64). It inserted a row
          with a literal placeholder title, no rename, no time and no delete -- and the
          helper below tells the host to tap rows when they start, which broadcasts that
          placeholder to every guest into a feed with no delete path.

          Title and time side by side because that is how a run of show is read, and the
          time is OPTIONAL: a host planning at noon knows there will be speeches and not
          when. `timeLabel` is null then, and the row prints the canvas's own "TBD". */}
      <View style={s.scheduleCompose}>
        <TextInput
          value={itemTitle}
          onChangeText={setItemTitle}
          placeholder="Cake, speeches, first dance…"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          accessibilityLabel="What happens"
          testID="schedule-title"
          returnKeyType="next"
          submitBehavior="submit"
          style={[s.scheduleInput, s.scheduleTitleInput,
            { borderColor: tokens.base300, color: tokens.baseContent, backgroundColor: tokens.base100 }]}
        />
        <TextInput
          value={itemTime}
          onChangeText={setItemTime}
          placeholder="8:30 PM"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          accessibilityLabel="When, if you know yet"
          testID="schedule-time"
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={onAddScheduleItem}
          style={[s.scheduleInput, s.scheduleTimeInput,
            { borderColor: tokens.base300, color: tokens.baseContent, backgroundColor: tokens.base100 }]}
        />
        <Pressable
          onPress={onAddScheduleItem}
          accessibilityRole="button"
          accessibilityLabel="Add this to the run of show"
          hitSlop={8}
          testID="schedule-add"
          style={[s.scheduleAdd, { borderColor: tokens.base300 }]}
        >
          <Text style={[s.link, { color: tokens.accent }]}>Add</Text>
        </Pressable>
      </View>

      <View style={[s.scheduleCard, { borderColor: tokens.base300 }]}>
        {schedule.map((item, i) => {
          const past = i < nowIndex;
          const current = i === nowIndex;
          return (
            // A WRAPPER, so the remove control is a SIBLING of the row rather than nested
            // inside a Pressable -- a button inside a button swallows one of the two taps.
            // The testID moves here so a count assertion measures ROWS, not controls.
            <View key={item.id} testID="schedule-row" style={s.scheduleLine}>
            <Pressable
              onPress={() => startScheduleItem(item.id)}
              onLongPress={past ? () => restartScheduleItem(item.id) : undefined}
              accessibilityRole="button"
              accessibilityLabel={`Start ${item.title}`}
              // "Start Ceremony" does not say that it announces to everyone, nor
              // that it cannot be taken back. The hint is where that belongs.
              accessibilityHint={
                past
                  ? `Already ran. Double tap and hold to restart it and move the run of show back for all ${invited} guests.`
                  : `Announces to all ${invited} guests. This cannot be undone.`
              }
              testID={`schedule-${item.id}`}
              style={[
                s.scheduleRow,
                { backgroundColor: current ? tokens.base200 : 'transparent' },
              ]}
            >
              <Text style={[s.time, { color: alpha(tokens.baseContent, fade.body) }]}>
                {item.timeLabel ?? 'TBD'}
              </Text>
              <Text
                style={[
                  s.scheduleTitle,
                  {
                    color: alpha(tokens.baseContent, past ? fade.past : 1),
                    fontWeight: current ? weight.semibold : weight.regular,
                  },
                ]}
              >
                {item.title}
              </Text>
              <Text style={[s.action, { color: alpha(tokens.baseContent, fade.body) }]}>
                {current ? 'Now' : past ? 'Done' : 'Start →'}
              </Text>
            </Pressable>
            {/* REMOVE, which nothing could do. The schema always allowed it --
                `schedule_write` is `for all` -- and no client ever used it, so a mistyped
                row was permanent on a card the host is told to tap. */}
            <Pressable
              onPress={() => void removeScheduleItem(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.title} from the run of show`}
              hitSlop={10}
              testID={`schedule-remove-${item.id}`}
            >
              <Text style={[s.action, { color: alpha(tokens.baseContent, fade.muted) }]}>
                ✕
              </Text>
            </Pressable>
            </View>
          );
        })}
      </View>

      <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.faint) }]}>
        Tap a row when it starts. Guests see “Now / Next” at the top of Chat and get an announcement.
      </Text>

      <Text style={[s.sectionTitle, { color: alpha(tokens.baseContent, fade.muted), marginTop: 8 }]}>
        Sent
      </Text>
      {[...feed].reverse().map((b) => (
        <View
          key={b.id}
          testID={`sent-${b.id}`}
          style={[s.sentCard, { backgroundColor: tokens.base200, borderColor: tokens.base300 }]}
        >
          <Text style={[s.sentText, { color: tokens.baseContent }]}>{b.body}</Text>
          <View style={s.sentFooter}>
            <Text style={[s.sentMeta, { color: alpha(tokens.baseContent, fade.soft) }]}>
              {b.authorName} · {formatClock(b.createdAt, event?.timezone ?? 'UTC')} · seen by{' '}
              {b.seenCount}
            </Text>
            {/*
              #26. Until this existed a pin was permanent: `broadcasts` had no UPDATE
              policy, so a notice that stopped being true two hours in sat above the feed
              for the rest of the night with nothing anywhere that could move it.

              NOT `disabled` on a free tier -- the house rule. The repository throws
              `EntitlementError`, `useGuardedAction` catches it and the toast names the
              limit; a greyed control explains nothing. Un-pinning is never refused.

              hitSlop because the label is ~13pt, well under SC 2.5.8's 24x24 AA floor,
              and `pnpm audit:targets` is the only lane that can see it -- react-native-web
              drops hitSlop, so lane B would keep reporting failure after a correct fix.
            */}
            <Pressable
              onPress={() => void setBroadcastPinned(b.id, !b.pinned)}
              accessibilityRole="button"
              accessibilityLabel={b.pinned ? 'Un-pin this announcement' : 'Pin this announcement'}
              accessibilityState={{ selected: b.pinned }}
              testID={`sent-pin-${b.id}`}
              hitSlop={12}
            >
              <Text style={[s.sentPin, { color: b.pinned ? tokens.primary : alpha(tokens.baseContent, fade.soft) }]}>
                {b.pinned ? 'Pinned · tap to un-pin' : 'Pin to top'}
              </Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  inviteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // ~15pt of text, under SC 2.5.8's 24x24 AA minimum, so all three carry hitSlop. They are
  // each other's nearest neighbour, hence the space-between rather than flush siblings:
  // RN's own docs note slop "never extends past the parent view bounds and the Z-index of
  // sibling views always takes precedence".
  //
  // THREE now, not two (#61). 'Calendar' rather than '+ Add to calendar' -- the guest's
  // pill has a row to itself and this one does not, and the same rule the segment track
  // records applies here: at 402pt the shortest true label is the one that survives.
  inviteAction: { fontSize: 15, fontWeight: weight.semibold },
  qrHolder: { alignItems: 'center', paddingVertical: 8 },
  scroll: { flex: 1 },
  content: { paddingVertical: 16, paddingHorizontal: 20, gap: 14 },
  sentFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, marginTop: 2,
  },
  sentPin: { fontSize: 13, fontWeight: weight.semibold },
  textarea: {
    minHeight: 110, borderRadius: radius.selector, borderWidth: border,
    padding: 14, fontSize: 16, lineHeight: 22, textAlignVertical: 'top',
  },
  pillRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: border },
  pillText: { fontSize: 13 },
  send: { height: 52, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 16, fontWeight: weight.semibold },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 },
  sectionTitle: { ...eyebrow.section, fontSize: 12 },
  link: { fontSize: 13 },
  scheduleCompose: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  scheduleInput: { borderWidth: border, borderRadius: radius.field, paddingHorizontal: 12, minHeight: 44, fontSize: 14 },
  scheduleTitleInput: { flex: 1 },
  // Wide enough for "12:30 PM" and no wider: the title is what needs the room.
  scheduleTimeInput: { width: 92 },
  scheduleAdd: { borderWidth: border, borderRadius: radius.field, minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  scheduleLine: { flexDirection: 'row', alignItems: 'center' },
  scheduleCard: { borderRadius: radius.selector, borderWidth: border, padding: 4, gap: 6 },
  // Rows are separated deliberately. They used to sit flush inside a card with
  // overflow:'hidden' and no gap, so the nearest thing to the current row was the
  // PAST row -- and tapping that rewound the run of show for every guest. The gap
  // is the fix that hitSlop cannot be: RN's own docs say slop "never extends past
  // the parent view bounds" and that overlaps resolve by sibling z-order, so slop
  // between flush siblings buys ambiguity, not safety.
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderRadius: radius.field },
  // 72 not 64: the design itself wraps "11:30 PM" at 64. FIDELITY note A.
  time: { width: 72, fontSize: 14, fontVariant: ['tabular-nums'] },
  scheduleTitle: { flex: 1, fontSize: 14 },
  action: { fontSize: 12 },
  helper: { fontSize: 12, lineHeight: 18 },
  sentCard: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.selector, borderWidth: border },
  sentText: { fontSize: 14, lineHeight: 20 },
  sentMeta: { fontSize: 11, marginTop: 6 },
});

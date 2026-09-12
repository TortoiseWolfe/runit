import { Pressable, StyleSheet, Text, View } from 'react-native';

import { checkOpen } from '@/domain/entitlements';
import { whenAndWhere } from '@/lib/format';
import { icsFilename, icsFor } from '@/lib/invite';
import { shareIcs } from '@/lib/share';
import { useEntitlements, useEvent } from '@/state/hooks';
import { useToast } from '@/state/ToastProvider';
import { alpha, border, radius, useTheme } from '@/theme';

/**
 * WHEN AND WHERE, ON THE ONE SCREEN EVERY GUEST WHO JOINED ACTUALLY REACHES -- #62.
 *
 * The calendar route existed and only one kind of guest could use it. `+ Add to calendar`
 * lives on `JoinScreen`, which is the screen BEFORE the join, and it is drawn only when
 * there is an invitation to draw it from -- `event ?? preview`. So:
 *
 *   tapped a link, or scanned the QR  -> preview resolves -> the pill is there
 *   TYPED THE CODE                    -> no preview, by design -> never saw it
 *   already joined, reopened the app  -> lands here -> never sees it again
 *
 * The middle case is deliberate and stays: `useLookUpInvite` is driven by `params.code`
 * and not by the field, because a lookup per keystroke is an oracle handed out one letter
 * at a time. The third is everybody, every night after the first. And the three guest tabs
 * between them rendered the event's NAME and nothing else -- no date, no venue, no way to
 * put the evening in a calendar. The host could send an .ics (#61); the guest standing in
 * the room could not keep one.
 *
 * ON THE CHAT TAB AND NOT IN `EventHeader`, which is the tempting place because the header
 * already carries the event name and is on all three tabs. It is also already up to three
 * pills wide beside a flexing name, and its own note records that a fourth does not fit at
 * 402pt. This is a row in a scrolling document instead, where it costs nothing it has to
 * take from something else.
 *
 * NOT DRAWN WITHOUT AN EVENT, which is the rule three device reports bought (`?empty=1`,
 * `tests/e2e/empty-world.spec.ts`): a control that cannot act should not be on screen. An
 * .ics for an event with no name, no date and no venue is exactly the pill that got
 * reported as "the first button doesn't even work".
 */
export function EventLine() {
  const { tokens, fade } = useTheme();
  const event = useEvent();
  const entitlements = useEntitlements();
  const { show } = useToast();

  if (!event) return null;

  /**
   * SAID BEFORE ANYONE TAPS -- #41.
   *
   * A free event stops accepting things a week after it starts, and the controls stay on
   * screen: this is a limit a host can lift by upgrading, so the house rule is a refusal
   * that NAMES the limit rather than a greyed control that explains nothing. But a refusal
   * you only meet by trying is still a guest typing a song request into a field that was
   * never going to take it. One muted sentence here is what makes the toast a confirmation
   * instead of a surprise.
   *
   * The tense matters. It does not say what was lost -- everything is still readable and
   * still savable for another three weeks under #40's retention clock -- so it says what
   * remains, which is the thing a guest can still act on.
   */
  const open = checkOpen(entitlements, event.startsAt).allowed;

  const onAddToCalendar = async () => {
    // The same `Pick<RunitEvent, ...>` the join screen and the host console pass, and the
    // same `id` -- which is the calendar UID, so a guest who added the invitation from a
    // link and then adds it again from here updates ONE entry rather than making a second.
    const shared = await shareIcs(icsFilename(event), icsFor(event));
    // Says something either way. On a desktop browser there is no share sheet at all, and a
    // control that silently does nothing is the failure this pill spent months demoted to a
    // View to avoid.
    show(shared ? 'Calendar file ready.' : 'Calendar export needs the app on a phone.');
  };

  const row = (
    <View style={s.row} testID="chat-event-line">
      <Text
        testID="chat-when-where"
        style={[s.when, { color: alpha(tokens.baseContent, fade.muted) }]}
        // Two lines, not one: "Fri, Sep 11 · Doors 7:00 PM · The Barn at Willow Creek" does
        // not fit on one at 402pt, and a venue truncated to an ellipsis is the half a guest
        // most needs. Two and then clip, so a pathological venue cannot take the tab.
        numberOfLines={2}
      >
        {whenAndWhere(event)}
      </Text>
      <Pressable
        onPress={onAddToCalendar}
        accessibilityRole="button"
        accessibilityLabel={`Add ${event.name} to your calendar`}
        // 13pt of text in a 6pt-padded pill is under SC 2.5.8's 24, hence the slop -- the
        // same treatment and the same measurement as the join screen's pill. Its only
        // interactive neighbour is the run-of-show card BELOW it, and slop never extends
        // past the parent, so the two cannot overlap.
        hitSlop={8}
        style={[s.pill, { borderColor: tokens.base300 }]}
        testID="chat-add-calendar"
      >
        <Text style={[s.pillText, { color: alpha(tokens.baseContent, fade.muted) }]}>
          + Calendar
        </Text>
      </Pressable>
    </View>
  );

  return open ? (
    row
  ) : (
    <View style={s.stack}>
      {row}
      <Text
        testID="event-ended"
        style={[s.ended, { color: alpha(tokens.baseContent, fade.muted) }]}
      >
        This event has ended · everything here is still yours to look at and save
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stack: { gap: 6 },
  ended: { fontSize: 13, lineHeight: 17 },
  when: { flex: 1, fontSize: 13, lineHeight: 17 },
  pill: {
    flexGrow: 0,
    flexShrink: 0,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: border,
  },
  pillText: { fontSize: 13 },
});

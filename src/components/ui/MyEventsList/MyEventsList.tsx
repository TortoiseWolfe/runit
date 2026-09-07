import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useEvent, useMyEvents } from '@/state/hooks';
import { useSessionActions } from '@/state/actions';
import { formatEventDate } from '@/lib/format';
import { alpha, eyebrow, radius, useTheme, weight } from '@/theme';

/**
 * The parties this person runs, and the way back into one -- issue #17.
 *
 * WHY IT EXISTS AT ALL. `create_event` has allowed TEN events per identity since it
 * shipped, and nothing could list them. The anonymous session persists across restarts
 * (`persistSession: true` over `secureSessionStorage`), so a host who closed the app kept
 * her identity and lost `event.current` -- and her only route back to her own party was to
 * remember the six-character code she had given her guests. The schema was never the
 * blocker; the screen was.
 *
 * IT CROSSES TWO FEATURES, which is this folder's stated bar. The join screen draws it for
 * a returning host who is standing outside every event, and the host console draws it for
 * one who is standing inside one and wants another. The same rows and the same tap.
 *
 * THE CURRENT EVENT IS IN THE LIST AND MARKED, rather than filtered out. Dropping it would
 * make this "switch to" instead of "your events", and then a host looking at a list of one
 * would see an empty box while standing in the party it omitted. It is not pressable,
 * because a control that navigates you to where you already are is a control that looks
 * broken.
 *
 * IT DRAWS NOTHING WHEN THERE IS NOTHING, and that is the common case: most people who
 * open this app are guests who host no events, and an empty "Your events" heading on the
 * join screen would be a promise to them that the app does not mean.
 */
export function MyEventsList({
  heading = 'Your events',
  hideCurrent = false,
}: {
  heading?: string;
  /**
   * Leave out the event already on screen. The join screen sets it because the event you
   * are in is that screen's HEADLINE -- printing its name twice, once as the invitation
   * and once as a row, reads as a bug rather than a convenience. The host console does
   * not, because there the list IS the map of where you are and the current row is what
   * orients you in it.
   */
  hideCurrent?: boolean;
}) {
  const { tokens, fade } = useTheme();
  const all = useMyEvents();
  const current = useEvent();
  const { openEvent } = useSessionActions();

  const events = hideCurrent ? all.filter((e) => e.id !== current?.id) : all;
  // Nothing to show is nothing to draw -- an empty "Your events" heading on the join
  // screen would be a promise to the guests who are most of this app's users.
  if (events.length === 0) return null;

  return (
    <View style={s.wrap} testID="my-events">
      <Text style={[s.heading, { color: alpha(tokens.baseContent, fade.muted) }]}>
        {heading}
      </Text>
      {events.map((e) => {
        const here = e.id === current?.id;
        const body = (
          <View style={s.row}>
            <View style={s.text}>
              <Text style={[s.name, { color: tokens.baseContent }]} numberOfLines={1}>
                {e.name}
              </Text>
              <Text
                style={[s.meta, { color: alpha(tokens.baseContent, fade.body) }]}
                numberOfLines={1}
              >
                {/* The same three facts the join screen composes, in the same order, so a
                    host reading her list and then her party does not meet two different
                    descriptions of one evening. */}
                {formatEventDate(e.startsAt, e.timezone)} · {e.roleLabel} ·{' '}
                {e.guestCount === 1 ? '1 guest' : `${e.guestCount} guests`}
              </Text>
            </View>
            {here ? (
              <View style={[s.badge, { backgroundColor: tokens.base300 }]}>
                <Text style={[s.badgeText, { color: tokens.baseContent }]}>Here</Text>
              </View>
            ) : (
              <Text style={[s.go, { color: tokens.accent }]}>Open</Text>
            )}
          </View>
        );

        // A View for the current event, not a disabled Pressable: `aria-disabled` is what
        // empty-world.spec.ts counts to prove no screen ships a dead control, and a row
        // that is correctly inert would read there as one more dead button.
        return here ? (
          <View
            key={e.id}
            testID={`my-event-${e.code}`}
            style={[s.card, { borderColor: tokens.base300, backgroundColor: tokens.base200 }]}
          >
            {body}
          </View>
        ) : (
          <Pressable
            key={e.id}
            testID={`my-event-${e.code}`}
            accessibilityRole="button"
            accessibilityLabel={`Open ${e.name}`}
            onPress={() => void openEvent(e.id)}
            hitSlop={4}
            style={[s.card, { borderColor: tokens.base300 }]}
          >
            {body}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  heading: { ...eyebrow.section, fontWeight: weight.semibold },
  // 56 clears WCAG 2.2 SC 2.5.8 (24) comfortably; a list row is a big target by nature and
  // the audit reads the declaration, not the render.
  card: { minHeight: 56, borderWidth: 1, borderRadius: radius.field, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: weight.semibold },
  meta: { fontSize: 13 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontSize: 11, fontWeight: weight.medium },
  go: { fontSize: 14, fontWeight: weight.semibold },
});

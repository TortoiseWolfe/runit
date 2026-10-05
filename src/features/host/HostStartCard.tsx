import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HostStart, HostStartKey } from './hostStart';
import { alpha, border, radius, useTheme, weight } from '@/theme';

/**
 * SPEC 012 -- a new host's three first things, at the top of Broadcast.
 *
 * It REPLACES `empty-room-share` rather than sitting beside it: that nudge was this card's
 * first item all along, so the invite item's button keeps its testID, its accessibility label
 * and its `onShare`, and the #70 journeys still hold it.
 *
 * ONE BUTTON, on the first open item only. Done items are text with a tick; open items after
 * the first are text without one. Every control drawn here acts, and none is ever disabled --
 * `empty-world.spec.ts` counts `[aria-disabled="true"]` across the screen.
 *
 * Pure presentation: `hostStartItems()` decides what is done, the panel owns the actions and
 * the hide flag. A card that read its own state could not be tested without a repository.
 */
export function HostStartCard({
  start, onInvite, onAnnounce, onPlan, onHide,
}: {
  start: HostStart;
  onInvite: () => void;
  onAnnounce: () => void;
  onPlan: () => void;
  onHide: () => void;
}) {
  const { tokens, fade } = useTheme();
  if (!start.firstOpen) return null;

  const action: Record<HostStartKey, { label: string; a11y: string; testID: string; onPress: () => void }> = {
    invite: {
      label: 'Share the invitation',
      a11y: 'Share the join code and link',
      testID: 'empty-room-share',
      onPress: onInvite,
    },
    announce: {
      label: 'Write the first one',
      a11y: 'Write the first announcement',
      testID: 'host-start-announce-go',
      onPress: onAnnounce,
    },
    plan: {
      label: 'Add the first moment',
      a11y: 'Add the first moment to the run of show',
      testID: 'host-start-plan-go',
      onPress: onPlan,
    },
  };
  const next = action[start.firstOpen];

  return (
    <View testID="host-start" style={[s.card, { borderColor: tokens.base300, backgroundColor: tokens.base200 }]}>
      <Text style={[s.title, { color: tokens.baseContent }]}>Getting started</Text>
      {/* The sentence the empty-room nudge carried, kept for as long as it is true: an
          announcement reaches only people who have joined. */}
      {start.firstOpen === 'invite' ? (
        <Text style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}>
          Nobody can see an announcement until they have joined. Send everyone the code first.
        </Text>
      ) : null}

      {start.items.map((item) => (
        <View
          key={item.key}
          testID={`host-start-${item.key}`}
          accessibilityLabel={`${item.label}${item.done ? ', done' : ''}`}
          style={s.item}
        >
          <Text
            style={[s.mark, { color: item.done ? tokens.success : alpha(tokens.baseContent, fade.muted) }]}
          >
            {item.done ? '✓' : '○'}
          </Text>
          <Text
            style={[
              s.itemText,
              item.done
                ? { color: alpha(tokens.baseContent, fade.muted), textDecorationLine: 'line-through' }
                : { color: tokens.baseContent },
            ]}
          >
            {item.label}
          </Text>
        </View>
      ))}

      <Pressable
        onPress={next.onPress}
        accessibilityRole="button"
        accessibilityLabel={next.a11y}
        testID={next.testID}
        style={[s.cta, { backgroundColor: tokens.primary }]}
      >
        <Text style={[s.ctaText, { color: tokens.primaryContent }]}>{next.label}</Text>
      </Pressable>

      <Pressable
        onPress={onHide}
        accessibilityRole="button"
        accessibilityLabel="Hide the getting started card"
        testID="host-start-hide"
        style={s.hide}
      >
        <Text style={[s.hideText, { color: alpha(tokens.baseContent, fade.muted) }]}>Hide this</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 14, padding: 16, gap: 8, borderWidth: border, borderRadius: radius.field },
  title: { fontSize: 16, fontWeight: weight.semibold },
  body: { fontSize: 14, lineHeight: 20 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 18, fontSize: 15, fontWeight: weight.semibold, textAlign: 'center' },
  itemText: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20 },
  /* 48 tall, an explicit height rather than hitSlop -- the primary action on the screen while
     the card is up, and `audit:targets` reads the number. */
  cta: { height: 48, marginTop: 4, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 16, fontWeight: weight.semibold },
  /* A text link with real padding rather than hitSlop, which react-native-web drops: 24pt
     tall is SC 2.5.8's floor. alignSelf keeps the box the size of the words. */
  hide: { alignSelf: 'flex-start', minHeight: 24, paddingVertical: 4, justifyContent: 'center' },
  hideText: { fontSize: 13, textDecorationLine: 'underline' },
});

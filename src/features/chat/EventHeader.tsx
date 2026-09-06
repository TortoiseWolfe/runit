import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBlocked, useEvent } from '@/state/hooks';
import { alpha, border, insetDelta, radius, tracking, useTheme, weight } from '@/theme';

/**
 * Canvas: `padding: 66px 20px 12px`, a base-300 bottom border, an 11px
 * uppercase eyebrow over the event name at 19/600, and a "{n} here" pill on the
 * right filled base-200 with a base-300 hairline.
 */
export function EventHeader({ eyebrow: eyebrowText }: { eyebrow: string }) {
  const { tokens, fade } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const event = useEvent();
  const blocked = useBlocked();

  return (
    <View
      style={[
        s.header,
        { paddingTop: insets.top + insetDelta.header, borderBottomColor: tokens.base300 },
      ]}
    >
      <View style={s.titles}>
        <Text style={[s.eyebrow, { color: alpha(tokens.baseContent, fade.soft) }]}>
          {eyebrowText}
        </Text>
        <Text style={[s.title, { color: tokens.baseContent }]} numberOfLines={1}>
          {event?.name ?? ''}
        </Text>
      </View>
      {/*
        SHOWN ONLY WHEN IT IS NON-EMPTY, which is the whole design. Most guests block
        nobody, so a permanent fourth tab would cost every one of them a slot to carry
        an empty list. Appearing the moment there is something to manage puts the way
        back exactly where someone who just blocked a person will look for it.
      */}
      {blocked.length > 0 && (
        <Pressable
          onPress={() => router.navigate('/blocked')}
          accessibilityRole="button"
          accessibilityLabel={`Manage ${blocked.length} blocked ${blocked.length === 1 ? 'person' : 'people'}`}
          testID="blocked-pill"
          hitSlop={8}
          style={[s.pill, { backgroundColor: tokens.base200, borderColor: tokens.base300 }]}
        >
          <Text style={[s.pillText, { color: tokens.baseContent }]}>
            {blocked.length} blocked
          </Text>
        </Pressable>
      )}
      <View
        testID="guest-count-pill"
        style={[s.pill, { backgroundColor: tokens.base200, borderColor: tokens.base300 }]}
      >
        <Text style={[s.pillText, { color: tokens.baseContent }]}>{event?.guestCount ?? 0} here</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: border,
  },
  titles: { flex: 1 },
  eyebrow: { fontSize: 11, letterSpacing: tracking(0.12, 11), textTransform: 'uppercase' },
  title: { fontSize: 19, fontWeight: weight.semibold, letterSpacing: tracking(-0.01, 19) },
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: border,
  },
  pillText: { fontSize: 12 },
});

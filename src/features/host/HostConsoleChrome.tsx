import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';

import { RoleSwitch } from '@/components/ui/RoleSwitch';
import { useIncoming, usePendingPhotos, useSession } from '@/state/hooks';
import { border, insetDelta, radius, useTheme, weight } from '@/theme';

type Segment = { href: '/host/broadcast' | '/host/dj' | '/host/photos'; label: string; badge?: number };

/**
 * Canvas: `padding: 66px 20px 10px`, gap 12, a base-300 bottom border, the word
 * "Host" at 19/600 with a secondary-filled role pill, then a 3-up segmented
 * control on a base-200 track whose active button is base-100.
 *
 * The canvas models the segments as `hostTab` local state. They are routes here
 * so /host/dj is directly addressable -- which is what lets the screenshot
 * harness reach each one, and removes a second copy of navigation state.
 */
export function HostConsoleChrome() {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const incoming = useIncoming();
  const pending = usePendingPhotos();

  const segments: Segment[] = [
    { href: '/host/broadcast', label: 'Broadcast' },
    { href: '/host/dj', label: 'DJ queue', badge: incoming.length },
    { href: '/host/photos', label: 'Photos', badge: pending.length },
  ];

  return (
    <View
      style={[
        s.header,
        { paddingTop: insets.top + insetDelta.header, borderBottomColor: tokens.base300 },
      ]}
    >
      <View style={s.titleRow}>
        <Text style={[s.title, { color: tokens.baseContent }]}>Host</Text>
        <RoleSwitch />
        {session.kind === 'host' && (
          <View style={[s.rolePill, { backgroundColor: tokens.secondary }]}>
            <Text style={[s.roleText, { color: tokens.secondaryContent }]}>
              {session.displayName} · {session.roleLabel}
            </Text>
          </View>
        )}
      </View>

      <View style={[s.track, { backgroundColor: tokens.base200 }]}>
        {segments.map(({ href, label, badge }) => {
          const active = pathname === href;
          return (
            <Pressable
              key={href}
              onPress={() => router.navigate(href)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              testID={`host-segment-${label.split(' ')[0]!.toLowerCase()}`}
              style={[s.segment, { backgroundColor: active ? tokens.base100 : 'transparent' }]}
            >
              <Text style={[s.segmentText, { color: tokens.baseContent }]} numberOfLines={1}>
                {label}
                {badge ? ` · ${badge}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 10, gap: 12, borderBottomWidth: border },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { fontSize: 19, fontWeight: weight.semibold },
  rolePill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill },
  roleText: { fontSize: 12 },
  track: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.selector }, // .75rem
  segment: {
    flex: 1,
    height: 34,
    borderRadius: radius.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: weight.medium },
});

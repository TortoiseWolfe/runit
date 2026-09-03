import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';

import { ChatIcon, MusicIcon, PhotosIcon, type TabIconProps } from '@/components/icons/TabIcons';
import { border, insetDelta, tabBar, useTheme, weight } from '@/theme';

type Tab = { href: '/chat' | '/photos' | '/music'; label: string; Icon: (p: TabIconProps) => React.JSX.Element };

const TABS: Tab[] = [
  { href: '/chat', label: 'Chat', Icon: ChatIcon },
  { href: '/photos', label: 'Photos', Icon: PhotosIcon },
  { href: '/music', label: 'Music', Icon: MusicIcon },
];

/**
 * Canvas: a 3-column grid, `padding: 8px 12px 28px`, a base-300 top border and
 * a base-100 fill. The 28px bottom padding stands in for the mockup's fake home
 * indicator, so on a real device it becomes the bottom safe-area inset.
 */
export function GuestTabBar() {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View
      style={[
        s.bar,
        {
          backgroundColor: tokens.base100,
          borderTopColor: tokens.base300,
          paddingBottom: Math.max(insets.bottom, insetDelta.tabBarMin),
        },
      ]}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        const color = active ? tokens.primary : tokens.tabInactive;
        return (
          <Pressable
            key={href}
            style={s.item}
            onPress={() => router.navigate(href)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            testID={`tab-${label.toLowerCase()}`}
          >
            <Icon color={color} />
            <Text style={[s.label, { color }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: tabBar.paddingTop,
    paddingHorizontal: 12,
    borderTopWidth: border,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: tabBar.gap,
    paddingVertical: tabBar.buttonPaddingVertical,
  },
  label: { fontSize: tabBar.labelSize, fontWeight: weight.medium },
});

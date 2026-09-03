import type { ReactNode } from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, insetDelta } from '@/theme';

export type TopKind = 'header' | 'page' | 'none';
export type BottomKind = 'tabbar' | 'page' | 'none';

/**
 * The single place the canvas's device-frame padding becomes real insets.
 *
 * The artboards hardcode padding-top 66 (headers) / 70 (join) and
 * padding-bottom 28 (tab bar) because <IOSDevice> paints a 62px fake status bar
 * and a 34px home-indicator zone. On a real phone the OS provides both, so
 * those numbers must be re-derived from useSafeAreaInsets rather than copied.
 * See src/theme/layout.ts for the arithmetic.
 *
 * Nothing else in the app should reference 66, 70 or 28.
 *
 * useSafeAreaInsets rather than <SafeAreaView>: the tab bar and header need the
 * inset as *padding* so base-100 paints under the home indicator and the
 * header's bottom border sits below the notch. SafeAreaView would inset the
 * whole subtree and let the screen background show through.
 */
export function Screen({
  top = 'page',
  bottom = 'page',
  style,
  children,
}: {
  top?: TopKind;
  bottom?: BottomKind;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();

  const paddingTop =
    top === 'header' ? insets.top + insetDelta.header
    : top === 'page' ? insets.top + insetDelta.page
    : 0;

  const paddingBottom =
    bottom === 'tabbar' ? Math.max(insets.bottom, insetDelta.tabBarMin)
    : bottom === 'page' ? insets.bottom + insetDelta.pageBottom
    : 0;

  return (
    <View
      style={[{ flex: 1, backgroundColor: tokens.base100, paddingTop, paddingBottom }, style]}
    >
      {children}
    </View>
  );
}

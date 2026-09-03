import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '@/state/ToastProvider';
import { insetDelta, radius, tabBar, toast as toastMetrics, useTheme } from '@/theme';

/**
 * Canvas: absolutely positioned, inset 20 left and right, `bottom: 120px`,
 * radius .75rem, neutral fill, 14px centred, and
 * `@keyframes toastin { from { opacity:0; transform:translateY(8px) } }` over
 * .2s ease-out.
 *
 * The 120 is measured from the artboard floor, which includes the mockup's fake
 * home indicator. Rebuilt from the tab bar upward instead, so it sits the same
 * distance above the tabs on any device.
 */
export function Toast() {
  const { toast } = useToast();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  // useState rather than useRef: the value must be stable across renders, but
  // reading a ref during render is exactly what the React Compiler rules ban.
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!toast) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    // Keyed on toast.id, not text: an identical repeat message must replay the
    // entry animation rather than sit there looking stale.
  }, [toast?.id, anim, toast]);

  if (!toast) return null;

  const bottom =
    tabBar.contentHeight +
    Math.max(insets.bottom, insetDelta.tabBarMin) +
    toastMetrics.offsetAboveTabBar;

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      testID="toast"
      pointerEvents="none"
      style={[
        s.wrap,
        {
          bottom,
          backgroundColor: tokens.neutral,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      <Text style={[s.text, { color: tokens.neutralContent }]}>{toast.text}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: toastMetrics.insetHorizontal,
    right: toastMetrics.insetHorizontal,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.selector, // canvas: .75rem
    boxShadow: '0px 10px 30px rgba(0, 0, 0, 0.3)',
  },
  text: { fontSize: 14, textAlign: 'center' },
});

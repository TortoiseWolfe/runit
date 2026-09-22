import { StyleSheet, Text, View, Pressable } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { alpha, border, radius, useTheme, weight } from '@/theme';

import { buttonInk } from './buttonInk';

/**
 * THE ONE BUTTON.
 *
 * Seven screens hand-styled their own `s.cta` -- Join, Create (twice), Sign in, Feedback,
 * Name and both QR scanners -- and `EventDetailsPanel` drew three more as `s.rotate` rows.
 * Ten controls, four heights, three font sizes, no hierarchy between a primary action and a
 * secondary one, and a primary that was a flat grey fill. The owner opened the live site on
 * a desktop and said the buttons look bland; they did, and there was no single place to fix
 * that. This is that place. #84, step 2 of 5.
 *
 * WHAT MAKES IT LOOK RAISED is in `buttonInk.ts`, and it is ScriptHammer's `sh-btn-primary`
 * ported rather than reinvented. Read that file for the physics.
 *
 * THREE LAYERS, AND THE ORDER IS THE WHOLE TRICK.
 *
 *   1. the Pressable   -- solid `fill`, plus the outer coloured glow.
 *   2. the gradient    -- an <Svg> over it, `pointerEvents="none"`.
 *   3. the bevel       -- inset rim light and bottom occlusion, ABOVE the gradient.
 *
 * Layer 3 cannot be merged into 1 or 2. A CSS inset shadow paints between an element's
 * background and its CONTENT, so an inset on the Pressable draws UNDER the gradient child
 * and an inset on the gradient's own wrapper draws under the <Svg> inside it. Either way
 * the rim light vanishes, silently, leaving a gradient that looks almost right. And the
 * glow cannot move onto an inner layer, because an outer shadow needs a box that is not
 * clipped by the thing it is glowing out of.
 *
 * NO `disabled` PROP, AND THAT IS DELIBERATE. `empty-world.spec.ts` asserts
 * `[aria-disabled="true"]` has count 0 across a screen -- this repo's standing gate against
 * a drawn control that does nothing. react-native-web renders a disabled Pressable exactly
 * that way, so a `disabled` prop here would be a loaded gun pointed at the one check that
 * scales with the class of bug instead of with the instances of it. The existing screens
 * already show the answer: `cohost-invite` swaps its label to "6 hosts on this plan" and
 * fades it, and `CreateEventScreen` renders a sentence instead of a button. Change what it
 * says; never grey it out.
 *
 * THE GRADIENT ID IS KEYED ON THE FILL, not on `useId()`. SVG ids resolve document-wide on
 * web, across separate <svg> elements -- two buttons both defining `#grad` would collide and
 * the first would win. Keying on the colour makes a collision HARMLESS by construction:
 * two buttons that collide are asking for the same gradient. A random id would work too and
 * would leave a different gradient def in the document for every button on screen.
 */

export type ButtonVariant = 'primary' | 'secondary';
export type ButtonSize = 'sm' | 'md' | 'lg';
/**
 * Secondary only, and only the LABEL. `EventDetailsPanel` already drew two of its rows in
 * `tokens.accent` -- "Email the invitation to 12" and each saved guest list -- because those
 * act on the list rather than adding to it. That distinction was on screen before this
 * component existed and is preserved rather than flattened; it is a named tone instead of a
 * `labelColor` prop so the set stays closed and a screen cannot invent a third.
 */
export type ButtonTone = 'default' | 'accent';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Spacing only -- margins from the screen that owns the layout. Not a way to restyle it. */
  style?: StyleProp<ViewStyle>;
  /**
   * Fade the label without disabling the control, for the "you have reached the cap" shape
   * `cohost-invite` already uses. The button still presses, and still says why.
   */
  quiet?: boolean;
  tone?: ButtonTone;
}

/**
 * The three heights the app already had, kept rather than invented: 56 was the join screen's
 * (the one action the whole product exists for), 52 the create/sign-in/feedback CTAs, and
 * 44-46 the sheets and the co-host rows. All three clear WCAG 2.2 SC 2.5.8 at 24 with room
 * to spare; `audit-touch-targets.mjs` reads `height` off this table.
 */
const SIZES = {
  sm: { height: 46, fontSize: 15 },
  md: { height: 52, fontSize: 16 },
  lg: { height: 56, fontSize: 17 },
} as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  testID,
  accessibilityLabel,
  accessibilityHint,
  style,
  quiet = false,
  tone = 'default',
}: ButtonProps) {
  const { tokens, fade, depth } = useTheme();
  const dims = SIZES[size];

  if (variant === 'secondary') {
    /**
     * THE QUIET TWIN IS A RAISED PLATE WITH AN EDGE, not ScriptHammer's `sh-btn-ghost`.
     * That one is a groove cut into the page -- and in THIS app `groove` is what every
     * TextInput wears, so a secondary button built from it would be a control that looks
     * exactly like a field. Raised-with-a-border says "press me" and cannot be mistaken for
     * somewhere to type.
     */
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={[
          s.base,
          { height: dims.height, backgroundColor: tokens.base100, borderWidth: border, borderColor: tokens.base300, boxShadow: depth.plate },
          style,
        ]}
      >
        <Text
          style={[
            s.label,
            {
              fontSize: dims.fontSize,
              color: quiet
                ? alpha(tokens.baseContent, fade.faint)
                : tone === 'accent'
                  ? tokens.accent
                  : tokens.baseContent,
            },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  /**
   * `primary`, AND THE TOKEN IS THE CANVAS'S DECISION RATHER THAN THIS COMPONENT'S.
   * `theme-tokens.spec.ts:165` asserts the join CTA is filled with primary and that it is a
   * different token from the field above it, which is a fact about the design, not about
   * how a button is drawn. ScriptHammer fills ITS raised button with `secondary` -- the warm
   * tan this app already spends on the host role pill -- and switching to it here is one
   * line and somebody else's call. FIDELITY note BB.
   */
  const ink = buttonInk(tokens.primary);
  const gid = `btn-${ink.fill.replace('#', '')}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={[s.base, { height: dims.height, backgroundColor: ink.fill, boxShadow: ink.glow }, style]}
    >
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.clip]}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ink.top} />
              <Stop offset="1" stopColor={ink.fill} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gid})`} />
        </Svg>
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.clip, { boxShadow: ink.bevel }]} />
      <Text style={[s.label, { fontSize: dims.fontSize, color: tokens.primaryContent }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: {
    /**
     * THE FLOOR IS HERE, NOT IN `SIZES`, and it earns its place twice.
     *
     * `pnpm audit:targets` failed this component on its first run and was right to: every
     * height above comes from a runtime lookup, and that lane deliberately refuses to
     * resolve one -- the same refusal that keeps it from chasing `StyleSheet.create`
     * through spreads. A gate that guesses is a heuristic wearing a measurement's clothes.
     *
     * `minHeight` is not a token pushed at the auditor either. React Native clamps `height`
     * up to `minHeight`, so this is the real runtime floor: a size added to that table
     * cannot make a button smaller than WCAG 2.2 SC 2.5.8 (Level AA) allows, whatever
     * number somebody types.
     */
    minHeight: 46,
    borderRadius: radius.field,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  clip: { borderRadius: radius.field, overflow: 'hidden' },
  label: { fontWeight: weight.semibold },
});

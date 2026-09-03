import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Screen } from '@/components/ui/Screen';
import { FEATURED_TIER, TIERS, TIER_ORDER, type Tier } from '@/domain/tiers';
import type { TierId } from '@/data/types';
import { alpha, border, eyebrow, fade, radius, tracking, useTheme, weight } from '@/theme';

/** Contextual headline: a denial names the limit or feature that sent you here. */
const REASON_COPY: Record<string, string> = {
  folders: 'You have used every folder your plan allows.',
  photos: 'Your album is full.',
  hosts: 'Every host seat on your plan is taken.',
  guests: 'This event has reached its guest limit.',
  photoModeration: 'Approving photos before they appear needs a paid plan.',
  djQueue: 'Accepting and declining requests needs a paid plan.',
  hostRoles: 'Host roles need the Event plan.',
  pinnedAnnouncements: 'Pinned announcements need the Event plan.',
  pushNotifications: 'Push notifications need the Event plan.',
  zipExport: 'ZIP export needs the Event plan.',
};

function TierCard({ tier, highlighted }: { tier: Tier; highlighted: boolean }) {
  const { tokens } = useTheme();
  const featured = tier.id === FEATURED_TIER;
  const bg = featured ? tokens.neutral : tokens.base100;
  const fg = featured ? tokens.neutralContent : tokens.baseContent;

  return (
    <View
      testID={`tier-${tier.id}`}
      style={[
        s.card,
        {
          backgroundColor: bg,
          borderColor: highlighted ? tokens.accent : tokens.base300,
          borderWidth: highlighted ? 2 : border,
        },
      ]}
    >
      <View style={s.head}>
        <Text style={[s.name, { color: alpha(fg, fade.body) }]}>{tier.name}</Text>
        <Text style={[s.scale, { color: alpha(fg, fade.muted) }]}>{tier.scaleLabel}</Text>
      </View>

      <Text style={[s.priceLine, { color: fg }]}>
        <Text style={s.price}>{tier.priceLabel}</Text>
        {tier.periodLabel ? (
          <Text style={[s.period, { color: alpha(fg, fade.muted) }]}> {tier.periodLabel}</Text>
        ) : null}
      </Text>

      <Text style={[s.audience, { color: alpha(fg, fade.strong) }]}>{tier.audience}</Text>

      {/* Canvas: a 1px rule of `currentColor` at .15 -- so it takes the card's
          own foreground, which differs on the featured card. */}
      <View style={[s.divider, { backgroundColor: alpha(fg, 0.15) }]} />

      {tier.featureLines.map((line) => (
        <View key={line} style={s.featureRow}>
          <Text style={[s.dash, { color: alpha(fg, fade.faint) }]}>—</Text>
          <Text style={[s.feature, { color: fg }]}>{line}</Text>
        </View>
      ))}

      <Text style={[s.example, { color: alpha(fg, fade.soft) }]}>{tier.exampleLabel}</Text>
    </View>
  );
}

/**
 * Artboard 04.
 *
 * The canvas lays this out as `grid-template-columns: repeat(4, minmax(0,1fr))`
 * at ~1240px, which cannot survive 402pt. Vertical stack; every internal card
 * metric is preserved exactly. FIDELITY deviation 3.
 */
export function PricingScreen() {
  const { tokens } = useTheme();
  const params = useLocalSearchParams<{ reason?: string; detail?: string; highlight?: string }>();
  const highlight = (params.highlight || '') as TierId | '';
  const reason = params.detail ? REASON_COPY[params.detail] : undefined;

  return (
    <Screen top="page" bottom="page">
      <ScrollView contentContainerStyle={s.content} testID="pricing">
        <View>
          <Text style={[s.kicker, { color: alpha(tokens.baseContent, fade.muted) }]}>
            Business model
          </Text>
          <Text style={[s.title, { color: tokens.baseContent }]}>
            Runit, from 3 guests to 3,000
          </Text>
          <Text style={[s.blurb, { color: alpha(tokens.baseContent, fade.body) }]}>
            {reason ??
              'Free covers a house party. Per-event pricing covers weddings and parties. Venues, planners and DJs who run events every week move to an annual plan.'}
          </Text>
        </View>

        {TIER_ORDER.map((id) => (
          <TierCard key={id} tier={TIERS[id]} highlighted={highlight === id} />
        ))}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  kicker: { ...eyebrow.section, fontSize: 12 },
  title: { fontSize: 24, fontWeight: weight.semibold, letterSpacing: tracking(-0.02, 24), marginTop: 6 },
  blurb: { fontSize: 14, lineHeight: 21, marginTop: 6 },

  card: { borderRadius: radius.box, padding: 24, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  name: { ...eyebrow.list },
  scale: { fontSize: 12, textAlign: 'right' },
  priceLine: { alignItems: 'flex-end' },
  price: { fontSize: 34, fontWeight: weight.semibold, letterSpacing: tracking(-0.03, 34) },
  period: { fontSize: 13 },
  audience: { fontSize: 14, lineHeight: 20, minHeight: 40 },
  divider: { height: 1 },
  featureRow: { flexDirection: 'row', gap: 8 },
  dash: { fontSize: 13, lineHeight: 18 },
  feature: { flex: 1, fontSize: 13, lineHeight: 18 },
  example: { fontSize: 12, marginTop: 2 },
});

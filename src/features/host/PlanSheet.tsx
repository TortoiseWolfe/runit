import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TierId } from '@/data/types';
import { TIERS, TIER_ORDER } from '@/domain/tiers';
import { alpha, border, radius, useTheme, weight } from '@/theme';

/**
 * SPEC 002. The four plans by what they HOLD -- guests, hosts, photos -- and one Choose per
 * plan. No prices anywhere: the pricing screen was cut (#30) because prices with no purchase
 * path invite App Review 3.1.1, and during the beta every plan is free. The copy says so.
 *
 * Caps come from `src/domain/tiers.ts`, which `tiers.test.ts` holds to the migration's own
 * seed; nothing here is a literal. Infinity reads as "unlimited".
 *
 * A Modal, like the delete sheets beside it: the backdrop is a `flex: 1` Pressable inside a
 * <Modal>, which `audit:targets` recognises by STYLE. Each Choose carries a measured
 * minHeight rather than hitSlop, because react-native-web drops hitSlop and the gutter
 * gate measures the control's own box.
 */
const cap = (n: number, word: string) => (Number.isFinite(n) ? `${n} ${word}` : `unlimited ${word}`);

export function PlanSheet({
  visible,
  current,
  onPick,
  onClose,
}: {
  visible: boolean;
  current: TierId;
  onPick: (tier: TierId) => void;
  onClose: () => void;
}) {
  const { tokens, fade } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} testID="plan-sheet">
      <Pressable
        style={[s.backdrop, { backgroundColor: alpha(tokens.neutral, 0.6) }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        testID="plan-sheet-backdrop"
      />
      <View style={[s.sheet, { backgroundColor: tokens.base200, borderTopColor: tokens.base300 }]}>
        <Text style={[s.title, { color: tokens.baseContent }]}>Choose a plan</Text>
        <Text style={[s.sub, { color: alpha(tokens.baseContent, fade.muted) }]}>
          Free during the beta. The plan sets how many people can join and how many photos the album holds.
        </Text>
        <ScrollView style={s.list} contentContainerStyle={s.listContent} keyboardShouldPersistTaps="handled">
          {TIER_ORDER.map((id) => {
            const t = TIERS[id];
            const selected = id === current;
            return (
              <View
                key={id}
                style={[s.row, { borderColor: selected ? tokens.primary : tokens.base300, backgroundColor: tokens.base100 }]}
                testID={`plan-option-${id}`}
              >
                <View style={s.rowBody}>
                  <Text style={[s.name, { color: tokens.baseContent }]}>
                    {t.name}
                    {selected ? '  · current' : ''}
                  </Text>
                  <Text style={[s.caps, { color: alpha(tokens.baseContent, fade.muted) }]}>
                    {cap(t.limits.maxGuests, 'guests')} · {cap(t.limits.maxHosts, 'hosts')} · {cap(t.limits.maxPhotos, 'photos')}
                  </Text>
                </View>
                {selected ? null : (
                  <Pressable
                    onPress={() => onPick(id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Choose the ${t.name} plan`}
                    testID={`plan-pick-${id}`}
                    style={[s.choose, { backgroundColor: tokens.primary }]}
                  >
                    <Text style={[s.chooseText, { color: tokens.primaryContent }]}>Choose</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Keep the current plan"
          testID="plan-sheet-cancel"
          style={[s.cancel, { borderColor: tokens.base300 }]}
        >
          <Text style={[s.cancelText, { color: tokens.baseContent }]}>Keep it as it is</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    borderTopWidth: border,
    borderTopLeftRadius: radius.selector,
    borderTopRightRadius: radius.selector,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  title: { fontSize: 18, fontWeight: weight.semibold },
  sub: { fontSize: 13, marginTop: 4, marginBottom: 12 },
  list: { flexGrow: 0 },
  listContent: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: border,
    borderRadius: radius.field,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowBody: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: weight.semibold },
  caps: { fontSize: 12, marginTop: 2 },
  choose: { minHeight: 44, paddingHorizontal: 16, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  chooseText: { fontSize: 14, fontWeight: weight.semibold },
  cancel: { marginTop: 14, minHeight: 46, borderWidth: border, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, fontWeight: weight.semibold },
});

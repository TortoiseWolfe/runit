import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { useEvent } from '@/state/hooks';
import { useJoinActions } from '@/state/actions';
import { alpha, border, eyebrow, fade, radius, tracking, useTheme, weight } from '@/theme';

/**
 * Artboard 01.
 *
 * Canvas: `padding: 70px 24px 40px`, column, gap 28. The 70 and 40 include the
 * mockup's fake status bar and home indicator, so <Screen top="page"
 * bottom="page"> re-derives them from real insets. Everything else is verbatim.
 */
export function JoinScreen() {
  const { tokens } = useTheme();
  const event = useEvent();
  const { join } = useJoinActions();
  // The canvas pre-fills the code and calls it "scanned the QR". Until a real
  // camera scan exists, the seed code is the honest stand-in for that.
  const [code, setCode] = useState(event?.code ?? '');
  const [nickname, setNickname] = useState('');
  const [joined, setJoined] = useState(false);

  const onJoin = async () => {
    const ok = await join(code, nickname);
    if (ok) setJoined(true);
  };

  const inputStyle = [
    s.input,
    { borderColor: tokens.base300, backgroundColor: tokens.base100, color: tokens.baseContent },
  ];

  return (
    <Screen top="page" bottom="page" style={s.screen}>
      <View>
        <Text style={[s.eyebrow, { color: alpha(tokens.baseContent, fade.muted) }]}>
          You&apos;re invited to
        </Text>
        <Text style={[s.title, { color: tokens.baseContent }]}>{event?.name ?? 'An event'}</Text>
        <Text style={[s.subtitle, { color: alpha(tokens.baseContent, fade.body) }]}>
          {event?.doorsLabel ?? ''}
        </Text>
        <Pressable style={[s.calendarPill, { borderColor: tokens.base300 }]}>
          <Text style={[s.calendarText, { color: tokens.accent }]}>+ Add to calendar</Text>
        </Pressable>
      </View>

      <View style={[s.card, { backgroundColor: tokens.base200 }]}>
        <Text style={[s.hint, { color: alpha(tokens.baseContent, fade.body) }]}>
          Scanned the QR? Your code is filled in. Otherwise type it.
        </Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="Event code"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Event code"
          testID="join-code"
          style={[...inputStyle, s.codeInput]}
        />
        <TextInput
          value={nickname}
          onChangeText={setNickname}
          placeholder="Nickname (shown with your requests)"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          accessibilityLabel="Nickname"
          testID="join-nickname"
          style={[...inputStyle, s.nickInput]}
        />
        <Text style={[s.fine, { color: alpha(tokens.baseContent, fade.soft) }]}>
          No account, no phone number. Hosts can see nicknames; guests can&apos;t see each other.
        </Text>
      </View>

      <Pressable
        onPress={onJoin}
        accessibilityRole="button"
        testID="join-submit"
        style={[s.cta, { backgroundColor: tokens.primary }]}
      >
        <Text style={[s.ctaText, { color: tokens.primaryContent }]}>
          {joined ? "You're in ✓" : 'Run it'}
        </Text>
      </Pressable>

      <Text style={[s.footer, { color: alpha(tokens.baseContent, fade.faint) }]}>
        Runit · Event plan
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  screen: { paddingHorizontal: 24, gap: 28 },
  eyebrow: { ...eyebrow.section, fontSize: 12 },
  title: { fontSize: 34, fontWeight: weight.semibold, letterSpacing: tracking(-0.02, 34), lineHeight: 37, marginTop: 6 },
  subtitle: { fontSize: 15, marginTop: 8 },
  calendarPill: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: border,
  },
  calendarText: { fontSize: 13 },
  card: { borderRadius: radius.box, padding: 20, gap: 14 },
  hint: { fontSize: 13 },
  input: { height: 48, borderRadius: radius.field, borderWidth: border, paddingHorizontal: 14 },
  codeInput: { fontSize: 18, letterSpacing: tracking(0.2, 18) },
  nickInput: { fontSize: 16 },
  fine: { fontSize: 12, lineHeight: 18 },
  cta: { height: 56, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 17, fontWeight: weight.semibold },
  footer: { marginTop: 'auto', textAlign: 'center', fontSize: 12 },
});

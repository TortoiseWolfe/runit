import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Screen } from '@/components/ui/Screen';
import { Toast } from '@/components/ui/Toast';
import { useEvent } from '@/state/hooks';
import { useJoinActions } from '@/state/actions';
import { alpha, border, eyebrow, radius, tracking, useTheme, weight } from '@/theme';

/**
 * Artboard 01.
 *
 * Canvas: `padding: 70px 24px 40px`, column, gap 28. The 70 and 40 include the
 * mockup's fake status bar and home indicator, so <Screen top="page"
 * bottom="page"> re-derives them from real insets. Everything else is verbatim.
 */
export function JoinScreen() {
  const { tokens, fade } = useTheme();
  const event = useEvent();
  const { join } = useJoinActions();

  /**
   * `?code=` FIRST, and the order matters more than it looks.
   *
   * The canvas pre-fills the code and calls it "scanned the QR", and until now the
   * seeded event supplied that. Against Supabase it cannot: `events_read` admits
   * members only, so `event` is NULL until you have already joined. A guest arriving
   * at this screen for the first time would see an empty field and no event name --
   * the canvas's promise, broken by the backend that makes the app real.
   *
   * A link carrying the code is what restores it, which is why this is the param
   * rather than the seed that wins. `runit://join?code=HOUSE7` and `/join?code=HOUSE7`
   * both land here; before this the route read no params at all and dropped the code
   * on the floor.
   */
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(
    (typeof params.code === 'string' ? params.code : undefined) ?? event?.code ?? '',
  );
  const [nickname, setNickname] = useState('');
  const [hostKey, setHostKey] = useState('');
  const [joined, setJoined] = useState(false);

  const onJoin = async () => {
    const ok = await join(code, nickname, hostKey);
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
        {/* An aggregate count, and deliberately nothing more -- no names, no
            avatars. It reads as social proof before you commit, and it is what
            makes the e2e suite able to prove that joining INCREMENTS the room
            rather than merely that the room reads 173 afterwards. Before this
            existed there was no screen showing the count pre-join, so a seed of
            173 that never incremented was indistinguishable from a seed of 172
            that did. See tests/e2e/join.spec.ts and FIDELITY note J. */}
        {event ? (
          <Text
            testID="join-guest-count"
            style={[s.alreadyHere, { color: alpha(tokens.baseContent, fade.muted) }]}
          >
            {event.guestCount} already here
          </Text>
        ) : null}
        {/* A View, not a Pressable, until calendar export exists. It was a
            Pressable with no onPress, no role and no label -- it looked and felt
            like a button and did nothing, which is worse than not offering it.
            The canvas draws this affordance, so the pixels stay; the lie does
            not. Wire it back up when expo-calendar lands (CLAUDE.md, "Not built
            yet") and restore the Pressable with a real handler. */}
        <View style={[s.calendarPill, { borderColor: tokens.base300 }]}>
          <Text style={[s.calendarText, { color: alpha(tokens.baseContent, fade.muted) }]}>
            + Add to calendar
          </Text>
        </View>
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
        {/* OPTIONAL, and last, because almost nobody types in it: at a party of ten
            there is one host and nine guests. It is a plain field rather than a
            separate screen because the host has to join as a guest first anyway --
            there is no auth user to bind a host seat to until the anonymous sign-in
            inside joinAsGuest has run. */}
        <TextInput
          value={hostKey}
          onChangeText={setHostKey}
          placeholder="Host key (optional)"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Host key, optional"
          accessibilityHint="Leave empty unless you are running this event."
          testID="join-host-key"
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

      {/* join() reports both outcomes through the toast -- the welcome on the
          way to Chat, and "That code doesn't match an event." when it doesn't.
          The guest and host layouts each mount a <Toast>, but /join sits
          outside both, so the rejection message had nowhere to render and a bad
          code failed silently. Mounted here so the failure is visible on the
          screen that causes it. */}
      <Toast />
    </Screen>
  );
}

const s = StyleSheet.create({
  screen: { paddingHorizontal: 24, gap: 28 },
  eyebrow: { ...eyebrow.section, fontSize: 12 },
  title: { fontSize: 34, fontWeight: weight.semibold, letterSpacing: tracking(-0.02, 34), lineHeight: 37, marginTop: 6 },
  subtitle: { fontSize: 15, marginTop: 8 },
  alreadyHere: { fontSize: 13, marginTop: 6 },
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

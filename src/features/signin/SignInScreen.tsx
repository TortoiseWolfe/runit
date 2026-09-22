import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/Button';
import { ReportLink } from '@/components/ui/ReportLink';
import { Screen } from '@/components/ui/Screen';
import { Toast } from '@/components/ui/Toast';
import type { EmailCodeMode } from '@/data/repository';
import { useSignInActions } from '@/state/actions';
import { alpha, border, eyebrow, radius, useTheme, weight } from '@/theme';

/**
 * Host sign-in by emailed code (#18).
 *
 * NOT UNDER `/host`, and that is the same call `CreateEventScreen` made: `host/_layout`
 * redirects anyone without a seat, and everyone arriving here is by definition someone the
 * app does not yet recognise as a host. A screen for a person who is not yet a host cannot
 * live behind a guard that only hosts pass.
 *
 * ONE SCREEN, TWO PHASES, rather than two routes. The address has to stay on screen while
 * the code is typed -- a host who mistyped it otherwise stands watching an inbox that will
 * never receive anything, with no way to see why. Editing it returns to the address phase
 * and drops the mode, because a code issued for one address is refused against another and
 * `MemoryRepository.pendingEmail` already models that refusal.
 *
 * THE MODE IS CARRIED, NOT RE-DERIVED. `requestEmailCode` answers `attach` or `sign_in`,
 * and `verifyOtp` needs a different `type` for each -- sending the wrong one rejects a
 * CORRECT code. By the time the code is typed the identity is mid-upgrade, so asking again
 * would get a different answer. See `session.requestEmailCode`.
 */
export function SignInScreen() {
  const { tokens, fade, depthCss } = useTheme();
  const router = useRouter();
  const { requestCode, submitCode } = useSignInActions();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<EmailCodeMode | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<TextInput>(null);

  /**
   * SECONDS UNTIL ANOTHER CODE CAN BE SENT, and this is a real rule rather than politeness:
   * `max_frequency = "60s"` in `[remotes.production]` is a PER-ADDRESS throttle, so a
   * second request inside the minute is refused by GoTrue with 429.
   *
   * Counting down here is what keeps `code_too_soon` a backstop instead of the normal
   * experience. The number is live, which is exactly why it is here and not in `JOIN_COPY`
   * -- that table holds one static sentence per reason so no call site can compose wording.
   */
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    const got = await requestCode(email);
    setBusy(false);
    // `null` means the action already toasted. Staying on the address phase is the point:
    // advancing to a code field for a code that was never sent is the cruellest possible
    // response to a refused send.
    if (!got) return;
    setMode(got);
    setWait(60);
    codeRef.current?.focus();
  };

  const verify = async () => {
    if (busy || !mode) return;
    setBusy(true);
    const ok = await submitCode({ email, code, mode });
    setBusy(false);
    if (!ok) return;
    /*
     * `replace`, not `push`. Sign-in is not a place to come back to, and the back gesture
     * from the events list should leave the app rather than re-open a form for an identity
     * that is now signed in.
     *
     * AND IT GOES TO `/join`, WHICH ALREADY RENDERS THE ANSWER. `submitEmailCode` calls
     * `event.loadMine()`, and `JoinScreen` draws `<MyEventsList hideCurrent />` -- #17's
     * work. A second event list here would be a copy of a list that exists, and the two
     * would drift.
     */
    router.replace('/join');
  };

  /** Editing the address invalidates the code that was sent to the old one. */
  const onEmailChange = (v: string) => {
    setEmail(v);
    if (mode) {
      setMode(null);
      setCode('');
    }
  };

  const fieldStyle = [
    s.input,
    { boxShadow: depthCss.groove },
    { borderColor: tokens.base300, backgroundColor: tokens.base200, color: tokens.baseContent },
  ];

  return (
    <Screen top="page" bottom="page">
      {/*
        `automaticallyAdjustKeyboardInsets` is the strategy rather than a
        KeyboardAvoidingView, matching CreateEventScreen: this is a short scrolling
        document, not a pinned CTA over a form, so there is nothing to hold above the
        keyboard -- the scroll view just needs to know how much of itself is covered.

        `keyboardShouldPersistTaps` is not optional. RN's 'never' default eats the first
        tap on any control while the keyboard is up, so "Send me a code" would need
        tapping twice from a focused field and read as a dead button.
      */}
      <ScrollView
        contentContainerStyle={s.content}
        testID="host-signin"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={[s.eyebrow, { color: alpha(tokens.baseContent, fade.muted) }]}>
          Hosts only
        </Text>
        <Text style={[s.title, { color: tokens.baseContent }]}>Sign in</Text>
        <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.body) }]}>
          We email you a six-digit code. Guests never need this — they join with the event
          code and a name.
        </Text>

        <Text style={[s.label, { color: alpha(tokens.baseContent, fade.muted) }]}>EMAIL</Text>
        <TextInput
          value={email}
          onChangeText={onEmailChange}
          placeholder="you@example.com"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          accessibilityLabel="Your email address"
          testID="signin-email"
          onSubmitEditing={send}
          submitBehavior="submit"
          returnKeyType="next"
          style={fieldStyle}
        />

        {mode ? (
          <View style={s.block}>
            <Text style={[s.label, { color: alpha(tokens.baseContent, fade.muted) }]}>
              SIX-DIGIT CODE
            </Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
              keyboardType="number-pad"
              maxLength={6}
              // iOS lifts the code straight out of the message with this. It is the one
              // affordance that makes a six-digit code less annoying than a link.
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              accessibilityLabel="The six-digit code we emailed you"
              testID="signin-code"
              onSubmitEditing={verify}
              submitBehavior="blurAndSubmit"
              returnKeyType="go"
              ref={codeRef}
              style={[...fieldStyle, s.codeInput]}
            />
            <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.soft) }]}>
              Sent to {email.trim()}. Codes last 10 minutes. Editing the address above starts
              over.
            </Text>

            <Button onPress={verify} testID="signin-verify" style={s.ctaGap} label="Sign in" />

            {/*
              A COUNTDOWN SENTENCE, THEN A CONTROL -- never a disabled control.
              `empty-world.spec.ts` asserts `[aria-disabled="true"]` has count 0 across a
              whole screen, which is this repo's gate against drawing a door nobody can
              open. So while the throttle is running there is no button at all, only the
              reason; the button returns when pressing it would work. Same swap
              `CreateEventScreen` makes between `create-submit` and `create-blocked`.
            */}
            {wait > 0 ? (
              <Text
                testID="signin-resend-wait"
                style={[s.helper, { color: alpha(tokens.baseContent, fade.faint) }]}
              >
                Another code can be sent in {wait}s.
              </Text>
            ) : (
              <Pressable
                onPress={send}
                accessibilityRole="button"
                accessibilityLabel="Send another code"
                hitSlop={10}
                testID="signin-resend"
              >
                <Text style={[s.link, { color: tokens.primary }]}>Send another code</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <Button onPress={send} testID="signin-send" style={s.ctaGap} label="Send me a code" />
        )}

        <Pressable
          onPress={() => router.replace('/join')}
          accessibilityRole="button"
          accessibilityLabel="Go back to joining an event"
          hitSlop={10}
          testID="signin-back"
        >
          <Text style={[s.link, { color: alpha(tokens.baseContent, fade.soft) }]}>
            ← Back
          </Text>
        </Pressable>

        {/*
          A CODE THAT NEVER ARRIVES HAS TO BE REPORTABLE FROM HERE.

          This screen is one long wait on somebody else's infrastructure: GoTrue, custom
          SMTP, Resend, a DNS record, a spam filter. Every one of those has failed in this
          repo's history -- five real sign-in emails once arrived carrying the DEFAULT
          template with no six-digit code in them at all (FIDELITY AZ), against this exact
          screen asking for six digits. A host in that state could read "Sent to
          ruth@example.com" and had nowhere to say that nothing came.

          It is `/join` she would have to walk back to, and she has no reason to think the
          answer is there. `inset={0}` because this screen's content container already pads
          to 20.
        */}
        <ReportLink />
      </ScrollView>
      <Toast />
    </Screen>
  );
}

const s = StyleSheet.create({
  // paddingHorizontal is mandatory: <Screen> sets VERTICAL insets only, so a content
  // container without it renders flush at x=0 and the gutter gate fails. Same note as
  // CreateEventScreen, which is where that was learned.
  content: { paddingVertical: 16, paddingHorizontal: 20, gap: 10 },
  eyebrow: { ...eyebrow.section, fontSize: 12 },
  title: { fontSize: 30, fontWeight: weight.semibold, marginBottom: 6 },
  label: { fontSize: 11, letterSpacing: 0.6, marginTop: 6 },
  input: {
    height: 48, borderRadius: radius.field, borderWidth: border,
    paddingHorizontal: 14, fontSize: 16,
  },
  // Tabular and spaced because six digits get read off a screen and typed one at a time.
  codeInput: { fontSize: 22, letterSpacing: 6, fontVariant: ['tabular-nums'] },
  block: { gap: 10 },
  helper: { fontSize: 12, lineHeight: 18 },
  ctaGap: { marginTop: 10 },
  link: { fontSize: 13, fontWeight: weight.semibold, paddingVertical: 6 },
});

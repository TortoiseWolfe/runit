import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { pickScreenshot } from '@/lib/pickScreenshot';
import { useFeedbackActions } from '@/state/actions';
import { alpha, border, radius, useTheme, weight } from '@/theme';

/**
 * THE CHANNEL THAT REPLACES TESTFLIGHT'S THE DAY WE SHIP -- #77.
 *
 * `tools/feedback-to-issues.mjs` calls itself "the channel for testers who have no terminal",
 * and it is right, and it stops working at launch: TestFlight feedback exists only for beta
 * builds. After that a customer's only route to us is a support URL on a static page. Nobody
 * standing in a party opens a browser and composes an email about a button.
 *
 * SO IT IS ONE TAP FROM WHERE IT BROKE, and it asks for one thing: what happened. No
 * category picker, no severity, no email field -- every one of those is a reason to give up,
 * and none of them tells us anything their sentence will not.
 *
 * THE DEVICE DETAIL IS COLLECTED, NOT ASKED FOR. A person reporting that the join code would
 * not take does not know their build number and should not have to. It is also SHOWN before
 * they send, because a report that quietly harvests is a different product from one that
 * says what it is sending.
 *
 * WHAT DELIBERATELY DOES NOT TRAVEL: their nickname, any address, and any other guest's name.
 * `feedback-to-issues.mjs` drops `testerEmail` for the reason that applies twice as hard
 * here -- a private repo can be made public and git history is forever.
 */
export function FeedbackSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { tokens, fade } = useTheme();
  const { send } = useFeedbackActions();
  const [body, setBody] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const facts = deviceFacts();

  const submit = async () => {
    if (busy || !body.trim()) return;
    setBusy(true);
    const ok = await send(body, facts, shot);
    setBusy(false);
    if (!ok) return;
    setBody('');
    setShot(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="feedback-sheet"
    >
      <Pressable
        style={[s.backdrop, { backgroundColor: alpha(tokens.neutral, 0.6) }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID="feedback-backdrop"
      />
      <View style={[s.sheet, { backgroundColor: tokens.base200, borderTopColor: tokens.base300 }]}>
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={[s.title, { color: tokens.baseContent }]}>Something not right?</Text>
          <Text style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}>
            Tell us what happened in your own words. It goes straight to the people who build
            this.
          </Text>

          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="The code wouldn't take, the photo never showed up…"
            placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
            multiline
            maxLength={2000}
            accessibilityLabel="What happened"
            testID="feedback-body"
            style={[
              s.input,
              { borderColor: tokens.base300, backgroundColor: tokens.base100, color: tokens.baseContent },
            ]}
          />

          {/*
            A PICTURE, IF THEY CHOOSE ONE -- and the picker is the privacy design rather
            than a convenience (#77). Capturing the current view automatically would send
            other guests' photographs and names to a repository without the reporter ever
            seeing what left their phone. The library lets them pick, and crop somebody out.

            OPTIONAL, AND THE LABEL SAYS SO. Demanding a screenshot turns a ten-second
            report into a task, and a sentence on its own is worth filing.
          */}
          <Pressable
            onPress={async () => setShot((await pickScreenshot()) ?? null)}
            accessibilityRole="button"
            accessibilityLabel={shot ? 'Change the picture' : 'Add a picture'}
            hitSlop={8}
            testID="feedback-attach"
            style={[s.attach, { borderColor: tokens.base300 }]}
          >
            <Text style={[s.attachText, { color: tokens.baseContent }]}>
              {shot ? 'Picture attached · change it' : 'Add a picture (optional)'}
            </Text>
          </Pressable>

          {/* SHOWN, NOT HARVESTED. They can read exactly what goes with it. */}
          <Text
            style={[s.facts, { color: alpha(tokens.baseContent, fade.faint) }]}
            testID="feedback-facts"
          >
            Sent with this: {factLine(facts)}
            {shot ? ' · the picture you chose' : ''}. No name, no email, nothing about anyone
            else at your event.
          </Text>

          {/* NO CONTROL AT ALL UNTIL THERE IS SOMETHING TO SEND, rather than a disabled one.
              `empty-world.spec.ts` counts `[aria-disabled="true"]` across a screen, which is
              this repo's gate against drawing a door nobody can open. */}
          {body.trim() ? (
            <Pressable
              onPress={submit}
              accessibilityRole="button"
              testID="feedback-send"
              style={[s.cta, { backgroundColor: tokens.primary }]}
            >
              <Text style={[s.ctaText, { color: tokens.primaryContent }]}>
                {busy ? 'Sending…' : 'Send it'}
              </Text>
            </Pressable>
          ) : (
            <Text
              style={[s.facts, { color: alpha(tokens.baseContent, fade.faint) }]}
              testID="feedback-empty"
            >
              Write a line above and a Send button appears.
            </Text>
          )}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            testID="feedback-cancel"
            style={[s.cancel, { borderColor: tokens.base300 }]}
          >
            <Text style={[s.cancelText, { color: tokens.baseContent }]}>Not now</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * WHAT THE PHONE KNOWS AND THE PERSON DOES NOT.
 *
 * Exported so the test can read it without mounting a modal, and so the sentence the sheet
 * prints is built from the same object that is sent -- a summary composed separately would
 * be free to describe something else.
 */
export function deviceFacts(): Record<string, unknown> {
  const expo = Constants.expoConfig;
  return {
    app: expo?.version ?? 'unknown',
    build:
      Platform.OS === 'ios'
        ? (expo?.ios?.buildNumber ?? 'unknown')
        : String(expo?.android?.versionCode ?? 'unknown'),
    platform: Platform.OS,
    os: String(Platform.Version),
    // `deviceName` is the only field here a person could consider theirs -- "Ruth's iPhone" --
    // so it is deliberately left out. The MODEL is what reproduces a bug; the name is not.
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** The same facts as one readable line, for the sentence above the Send button. */
export function factLine(f: Record<string, unknown>): string {
  return [`${f.platform} ${f.os}`, `app ${f.app} (${f.build})`, String(f.timezone)]
    .filter(Boolean)
    .join(' · ');
}

const s = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '85%',
    borderTopWidth: border, borderTopLeftRadius: radius.box, borderTopRightRadius: radius.box,
  },
  content: { padding: 24, paddingBottom: 40, gap: 12 },
  title: { fontSize: 19, fontWeight: weight.semibold },
  body: { fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 110, borderRadius: radius.field, borderWidth: border,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 15,
    textAlignVertical: 'top',
  },
  facts: { fontSize: 12, lineHeight: 18 },
  // 44 tall, over SC 2.5.8's 24pt AA minimum, and a full-width row because it is a choice
  // rather than the action -- the Send button below it is the one with weight.
  attach: {
    height: 44, borderRadius: radius.field, borderWidth: border,
    alignItems: 'center', justifyContent: 'center',
  },
  attachText: { fontSize: 14 },
  cta: { height: 52, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  ctaText: { fontSize: 16, fontWeight: weight.semibold },
  cancel: { height: 48, borderRadius: radius.field, borderWidth: border, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15 },
});

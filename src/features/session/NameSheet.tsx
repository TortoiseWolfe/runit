import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useSessionActions } from "@/state/actions";
import { alpha, border, radius, useTheme, weight } from "@/theme";

/**
 * Changing the name the room sees — issue #43.
 *
 * A guest typed a nickname once, on the join screen, and no screen ever showed it back.
 * They found out it was wrong the way everyone else did: under a song request, in front of
 * the room — and there was nothing anywhere to fix it. The capability existed in SQL the
 * whole time (`join_event` upserts the nickname) and nothing called it.
 *
 * THE SAVED NAME IS THE STORED ONE. `set_nickname` trims and caps at 40 and returns what
 * it wrote; this renders that rather than what was typed, because a field echoing its own
 * input would show a name the room is not seeing.
 */
export function NameSheet({
  nickname,
  onClose,
}: {
  nickname: string;
  onClose: () => void;
}) {
  const { tokens, fade } = useTheme();
  const { setNickname } = useSessionActions();
  /**
   * MOUNTED ONLY WHILE OPEN, which is why this is a plain initialiser and there is no
   * effect keeping it in step.
   *
   * The obvious shape is `useEffect(() => { if (!visible) setDraft(nickname) })`, and the
   * React Compiler lint rejects it -- setState synchronously in an effect, cascading
   * renders. The rejection is right, and the caller rendering this only when it is open
   * gets the same property for free: every opening is a fresh mount, so the field always
   * shows the name the room is seeing and a cancelled draft cannot come back.
   */
  const [draft, setDraft] = useState(nickname);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await setNickname(draft);
    setBusy(false);
    onClose();
  };

  const empty = draft.trim().length === 0;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="name-sheet"
    >
      {/*
        A KeyboardAvoidingView rather than `automaticallyAdjustKeyboardInsets`, per note Q's
        table: this is content pinned to the visible bottom, and inside a Modal the KAV IS
        the outermost element, so `keyboardVerticalOffset` stays 0. Never both on one
        subtree -- iOS compensates twice and pushes the content off the top.
      */}
      <KeyboardAvoidingView behavior="padding" style={s.avoid}>
        <Pressable
          style={s.scrim}
          onPress={onClose}
          accessibilityLabel="Close"
        />
        <View
          style={[
            s.sheet,
            { backgroundColor: tokens.base100, borderTopColor: tokens.base300 },
          ]}
        >
          <Text style={[s.title, { color: tokens.baseContent }]}>
            Your name here
          </Text>
          <Text
            style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}
          >
            This is what the room sees on your song requests and photos.
            Changing it updates the ones you have already sent.
          </Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Nickname"
            placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
            autoCorrect={false}
            accessibilityLabel="Your nickname"
            testID="name-input"
            returnKeyType="done"
            // "blurAndSubmit": this is the last and only field of the form, and submitting
            // saves and closes the sheet. Keeping the keyboard up would leave it raised over
            // the screen underneath. Lane A3 requires the choice be stated rather than
            // inherited -- RN 0.86 changed the default.
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => {
              if (!empty && !busy) void save();
            }}
            style={[
              s.input,
              {
                borderColor: tokens.base300,
                color: tokens.baseContent,
                backgroundColor: tokens.base200,
              },
            ]}
          />
          {/* NOT `disabled`, which the house rule reserves for nothing at all: an empty
            field simply does not draw a Save, the same treatment the create form gives a
            nameless event. A control that refuses is worse than one that is not there. */}
          {!empty && (
            <Pressable
              onPress={() => void save()}
              accessibilityRole="button"
              testID="name-save"
              hitSlop={8}
              style={[s.cta, { backgroundColor: tokens.primary }]}
            >
              <Text style={[s.ctaText, { color: tokens.primaryContent }]}>
                {busy ? "Saving…" : "Save"}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            testID="name-cancel"
            hitSlop={8}
          >
            <Text
              style={[
                s.cancel,
                { color: alpha(tokens.baseContent, fade.muted) },
              ]}
            >
              Cancel
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  avoid: { flex: 1 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 34,
    gap: 14,
    borderTopWidth: border,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  title: { fontSize: 18, fontWeight: weight.semibold },
  body: { fontSize: 14, lineHeight: 20 },
  input: {
    borderWidth: border,
    borderRadius: radius.field,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 44,
  },
  cta: {
    borderRadius: radius.field,
    paddingVertical: 14,
    alignItems: "center",
    minHeight: 44,
  },
  ctaText: { fontSize: 15, fontWeight: weight.semibold },
  cancel: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 10,
    minHeight: 24,
  },
});

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useModerationActions } from '@/state/actions';
import type { GuestId, ReportReason, ReportSubject } from '@/data/types';
import { alpha, eyebrow, radius, useTheme, weight } from '@/theme';

/**
 * The Guideline 1.2 sheet: one place a guest can report a thing, and block whoever
 * posted it.
 *
 * REPORTING AND BLOCKING ARE OFFERED TOGETHER BUT KEPT SEPARATE. They answer
 * different questions -- "a host should look at this" and "I do not want to see this
 * person" -- and a guest often wants both, so the sheet ends with an optional block
 * rather than making it a fifth reason. Bundling them would mean either reporting
 * someone you only wanted to mute, or muting someone you only wanted reviewed.
 *
 * The reasons are the database's closed set, in the same order, because a queue a
 * host can sort is worth more than a free-text box nobody reads. `note` is optional
 * on purpose: requiring an explanation before someone can flag a photograph of
 * themselves is a reason not to flag it.
 */
const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: 'nudity', label: 'Nudity or sexual content', hint: 'Explicit or suggestive images' },
  { value: 'harassment', label: 'Harassment or bullying', hint: 'Targeting someone at this event' },
  { value: 'violence', label: 'Violence or threats', hint: 'Threatening or graphic content' },
  { value: 'hate', label: 'Hate speech', hint: 'Attacks a group or identity' },
  { value: 'spam', label: 'Spam', hint: 'Repetitive or off-topic' },
  { value: 'other', label: 'Something else', hint: 'Anything a host should see' },
];

export interface ReportSheetProps {
  visible: boolean;
  onClose: () => void;
  subject: ReportSubject | null;
  /** What is being reported, in the guest's words. "Priya's photo", "Levitating". */
  subjectLabel: string;
  /**
   * Who posted it, for the optional block. Null when nothing can be attributed --
   * a seeded row with no owner, for instance -- and the block option is then hidden
   * rather than shown pointing at nobody.
   */
  author: { guestId: GuestId; nickname: string } | null;
  /** True once this guest has already reported this subject. */
  alreadyReported: boolean;
}

export function ReportSheet({
  visible,
  onClose,
  subject,
  subjectLabel,
  author,
  alreadyReported,
}: ReportSheetProps) {
  const { tokens, fade } = useTheme();
  const { report, block } = useModerationActions();
  const [busy, setBusy] = useState(false);

  const choose = async (reason: ReportReason) => {
    if (!subject || busy) return;
    setBusy(true);
    try {
      await report(subject, reason);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const onBlock = async () => {
    if (!author || busy) return;
    setBusy(true);
    try {
      await block(author.guestId, author.nickname);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable
        style={[s.backdrop, { backgroundColor: alpha(tokens.neutral, 0.55) }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID="report-sheet-backdrop"
      />
      <View style={[s.sheet, { backgroundColor: tokens.base100, borderColor: tokens.base300 }]}>
        <Text style={[s.eyebrow, { color: alpha(tokens.baseContent, fade.muted) }]}>REPORT</Text>
        <Text style={[s.subject, { color: tokens.baseContent, fontWeight: weight.semibold }]}>
          {subjectLabel}
        </Text>

        {alreadyReported ? (
          // Not an error state. The report landed; saying so is what stops a guest
          // tapping again and concluding the button is broken.
          <Text style={[s.doneNote, { color: alpha(tokens.baseContent, fade.body) }]} testID="report-already">
            You have already reported this. A host can see it.
          </Text>
        ) : (
          <ScrollView style={s.list} contentContainerStyle={s.listInner}>
            {REASONS.map((r) => (
              <Pressable
                key={r.value}
                style={[s.reason, { borderColor: tokens.base300 }]}
                onPress={() => choose(r.value)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Report for ${r.label}`}
                testID={`report-reason-${r.value}`}
              >
                <Text style={[s.reasonLabel, { color: tokens.baseContent, fontWeight: weight.medium }]}>
                  {r.label}
                </Text>
                <Text style={[s.reasonHint, { color: alpha(tokens.baseContent, fade.muted) }]}>{r.hint}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {author !== null && (
          <Pressable
            style={[s.block, { borderColor: tokens.base300 }]}
            onPress={onBlock}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Block ${author.nickname}`}
            testID="report-block"
          >
            <Text style={[s.blockLabel, { color: tokens.error, fontWeight: weight.semibold }]}>
              Block {author.nickname}
            </Text>
            <Text style={[s.reasonHint, { color: alpha(tokens.baseContent, fade.muted) }]}>
              You will stop seeing their photos and song requests
            </Text>
          </Pressable>
        )}

        <Pressable
          style={s.cancel}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          testID="report-cancel"
        >
          <Text style={[s.cancelLabel, { color: alpha(tokens.baseContent, fade.muted) }]}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    borderTopLeftRadius: radius.box,
    borderTopRightRadius: radius.box,
    borderTopWidth: 1,
    maxHeight: '85%',
  },
  eyebrow: { ...eyebrow.card },
  subject: { fontSize: 17, marginTop: 4, marginBottom: 14 },
  list: { flexGrow: 0 },
  listInner: { gap: 8 },
  // 56 clears WCAG 2.2 SC 2.5.8 (24, AA) with room, and SC 2.5.5 (44, AAA) too --
  // this is a destructive choice made in a hurry, so the target is generous.
  reason: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderRadius: radius.field },
  reasonLabel: { fontSize: 15 },
  reasonHint: { fontSize: 12, marginTop: 2 },
  doneNote: { fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  block: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderRadius: radius.field, marginTop: 12 },
  blockLabel: { fontSize: 15 },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  cancelLabel: { fontSize: 15 },
});

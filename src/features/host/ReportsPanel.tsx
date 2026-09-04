import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatRelative } from '@/lib/format';
import { useModerationActions } from '@/state/actions';
import { useEvent, useReports } from '@/state/hooks';
import type { ReportReason } from '@/data/types';
import { alpha, border, eyebrow, radius, useTheme, weight } from '@/theme';

/**
 * The host's side of Guideline 1.2.
 *
 * "A mechanism to report offensive content AND TIMELY RESPONSES TO CONCERNS" is one
 * requirement, not two, and the second half is the part an app usually fails. This
 * panel is the response path: every open report is here, oldest first, with the three
 * things a host can actually do about it.
 *
 * The queue shows `subjectLabel` and `reporterName` straight from the row. Neither is
 * joined and neither could be: `guests` has no select policy, so a host cannot look up
 * either name. The server denormalises them at file_report() time.
 */
const REASON_TEXT: Record<ReportReason, string> = {
  nudity: 'Nudity or sexual content',
  harassment: 'Harassment or bullying',
  violence: 'Violence or threats',
  hate: 'Hate speech',
  spam: 'Spam',
  other: 'Something else',
};

export function ReportsPanel() {
  const { tokens, fade } = useTheme();
  const reports = useReports();
  const event = useEvent();
  const { resolve } = useModerationActions();

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} testID="host-reports">
      <Text style={[s.section, { color: alpha(tokens.baseContent, fade.muted) }]}>
        Open reports · {reports.length}
      </Text>

      {reports.length === 0 && (
        // An empty queue is a real state and says so. A blank pane reads as a screen
        // that failed to load, which is the wrong thing to show a reviewer.
        <Text style={[s.empty, { color: alpha(tokens.baseContent, fade.faint) }]} testID="reports-empty">
          Nothing has been reported. Anything a guest flags will appear here.
        </Text>
      )}

      {reports.map((r) => (
        <View
          key={r.id}
          testID={`report-${r.id}`}
          style={[s.row, { borderColor: tokens.base300, backgroundColor: tokens.base200 }]}
        >
          <View style={s.head}>
            <Text style={[s.reason, { color: tokens.error, fontWeight: weight.semibold }]}>
              {REASON_TEXT[r.reason]}
            </Text>
            <Text style={[s.when, { color: alpha(tokens.baseContent, fade.faint) }]}>
              {formatRelative(r.createdAt, event?.timezone ?? 'UTC')}
            </Text>
          </View>

          <Text style={[s.subject, { color: tokens.baseContent }]} numberOfLines={2}>
            {r.subjectLabel}
          </Text>
          <Text style={[s.meta, { color: alpha(tokens.baseContent, fade.muted) }]} numberOfLines={1}>
            Reported by {r.reporterName}
          </Text>
          {r.note !== '' && (
            <Text style={[s.note, { color: alpha(tokens.baseContent, fade.body) }]}>“{r.note}”</Text>
          )}

          <View style={s.actions}>
            {/*
              Three outcomes, and the row records WHICH -- a resolution with no verdict
              is a host saying they looked and refusing to say what they did. `removed`
              does not itself hide the content: the host hides the photo or declines the
              request on its own screen, where they can see it. This closes the report.
            */}
            <Pressable
              onPress={() => resolve(r.id, 'removed')}
              accessibilityRole="button"
              accessibilityLabel="Mark as removed and close this report"
              testID={`resolve-removed-${r.id}`}
              style={[s.action, { borderColor: tokens.base300 }]}
            >
              <Text style={[s.actionText, { color: tokens.baseContent }]}>Removed</Text>
            </Pressable>
            <Pressable
              onPress={() => resolve(r.id, 'blocked')}
              accessibilityRole="button"
              accessibilityLabel="Mark as blocked and close this report"
              testID={`resolve-blocked-${r.id}`}
              style={[s.action, { borderColor: tokens.base300 }]}
            >
              <Text style={[s.actionText, { color: tokens.baseContent }]}>Blocked</Text>
            </Pressable>
            <Pressable
              onPress={() => resolve(r.id, 'dismissed')}
              accessibilityRole="button"
              accessibilityLabel="Dismiss this report with no action"
              testID={`resolve-dismissed-${r.id}`}
              style={[s.action, { borderColor: tokens.base300 }]}
            >
              <Text style={[s.actionText, { color: alpha(tokens.baseContent, fade.muted) }]}>
                No action
              </Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 20, gap: 10, paddingBottom: 40 },
  section: { ...eyebrow.card },
  empty: { fontSize: 14, lineHeight: 21, paddingVertical: 12 },
  row: { borderWidth: border, borderRadius: radius.selector, padding: 14, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reason: { fontSize: 13 },
  when: { fontSize: 12 },
  subject: { fontSize: 15, fontWeight: weight.medium },
  meta: { fontSize: 12 },
  note: { fontSize: 13, lineHeight: 19, marginTop: 4, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  // 40 high clears SC 2.5.8 (24, AA) comfortably; these sit in a row of three and
  // each one closes a complaint, so they get real width rather than icon-sized taps.
  action: {
    flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center',
    borderWidth: border, borderRadius: radius.field, paddingHorizontal: 8,
  },
  actionText: { fontSize: 13, fontWeight: weight.medium },
});

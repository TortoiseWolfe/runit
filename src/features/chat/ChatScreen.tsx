import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useEvent, useFeed, useHoldsHostSeat } from '@/state/hooks';
import { alpha, border, useTheme } from '@/theme';
import { RoleSwitch } from '@/components/ui/RoleSwitch';
import { LeaveSheet } from '@/features/session/LeaveSheet';
import { BroadcastBubble } from './BroadcastBubble';
import { EventHeader } from './EventHeader';
import { NowNextCard } from './NowNextCard';

/**
 * Artboard 02, Chat tab.
 *
 * Canvas: header, a scrolling column at `padding: 16px 20px` with `gap: 14`
 * holding the run-of-show card then the broadcasts, and a base-300 topped
 * footer reading "Announcements only · hosts post here".
 */
export function ChatScreen() {
  const { tokens, fade } = useTheme();
  const feed = useFeed();
  const event = useEvent();
  const [leaving, setLeaving] = useState(false);
  const holdsHostSeat = useHoldsHostSeat();

  return (
    <View style={s.wrap}>
      <EventHeader eyebrow="Announcements" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        testID="chat-feed"
      >
        <NowNextCard />
        {feed.map((b) => (
          <BroadcastBubble key={b.id} broadcast={b} timeZone={event?.timezone ?? 'UTC'} />
        ))}
      </ScrollView>
      <View style={[s.footer, { borderTopColor: tokens.base300 }]}>
        {/* The footer, not EventHeader: this is the least-trafficked surface in the app
            and the one that already carries session-shaped controls. EventHeader is on
            all three tabs, and a mis-tap there would drop someone out of the party. */}
        <Pressable
          onPress={() => setLeaving(true)}
          accessibilityRole="button"
          accessibilityLabel="Leave this event"
          hitSlop={8}
          testID="leave-event"
        >
          <Text style={[s.footerText, { color: alpha(tokens.baseContent, fade.faint) }]}>
            Leave
          </Text>
        </Pressable>
        <Text style={[s.footerText, { color: alpha(tokens.baseContent, fade.faint) }]}>
          Announcements only · hosts post here
        </Text>
        {/*
          DRAWN ONLY FOR SOMEONE WHO HOLDS A HOST SEAT (#29).

          Every guest used to see this, and against the shipping adapter its only possible
          outcome for them was a toast saying the host console is not theirs -- `becomeHost`
          matches `hosts.auth_user_id = auth.uid()`, so a role is not something a picker can
          grant. Nine people out of ten who tapped it got a refusal.

          NOT `disabled`, and not a denial toast either: the house rule about never
          disabling applies to a control someone could earn by upgrading. This one they
          cannot earn by any action available on this screen, so the honest treatment is
          the one FIDELITY note O used for the push pill -- do not draw it.

          The way IN for a real host is untouched: a host key on the join screen, or
          creating the event. This removes a door that was painted on.
        */}
        {holdsHostSeat ? <RoleSwitch /> : null}
      </View>
      <LeaveSheet visible={leaving} onClose={() => setLeaving(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingVertical: 16, paddingHorizontal: 20, gap: 14 },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    paddingTop: 10, paddingBottom: 8, paddingHorizontal: 20, borderTopWidth: border,
  },
  footerText: { flex: 1, fontSize: 12, textAlign: 'center' },
});

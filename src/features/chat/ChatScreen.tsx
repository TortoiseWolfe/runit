import { useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { BroadcastId } from '@/data/types';
import { useChatActions } from '@/state/actions';
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
  const { markRead } = useChatActions();

  /**
   * WHAT COUNTS AS SEEN -- #24, and the reason that issue was not a five-minute fix.
   *
   * Marking on load would count FETCHES: open the tab, and six announcements you never
   * scrolled to are read. So this measures the viewport. Each bubble reports its box
   * through `onLayout` (coordinates are relative to the content container, which is the
   * frame `contentOffset` is measured in), the ScrollView reports its own height and
   * offset, and a sweep marks whatever actually overlaps.
   *
   * ALL THREE LIVE IN REFS AND ARE ONLY EVER TOUCHED IN HANDLERS. Reading a ref during
   * render is rejected by the React Compiler rules and rightly -- and none of this belongs
   * in state anyway: it drives one network call, never a repaint, so `setState` here would
   * re-render the feed on every scroll frame to change nothing on screen.
   *
   * `sent` is what keeps this from being a request per frame. The adapter dedupes too, and
   * the database would absorb the rest as 23505 -- but a phone on a venue's wifi should
   * not be sending any of that.
   */
  const boxes = useRef(new Map<BroadcastId, { y: number; h: number }>());
  const port = useRef({ y: 0, h: 0 });
  const sent = useRef(new Set<BroadcastId>());

  const sweep = () => {
    const { y, h } = port.current;
    // Before the ScrollView has measured itself, everything would "overlap" a zero-height
    // window under a naive comparison. Nothing is visible yet, so nothing is read yet.
    if (h <= 0) return;
    const fresh: BroadcastId[] = [];
    for (const [id, box] of boxes.current) {
      if (sent.current.has(id)) continue;
      if (box.y < y + h && box.y + box.h > y) {
        sent.current.add(id);
        fresh.push(id);
      }
    }
    if (fresh.length > 0) markRead(fresh);
  };

  const onFeedLayout = (e: LayoutChangeEvent) => {
    port.current = { ...port.current, h: e.nativeEvent.layout.height };
    sweep();
  };

  const onFeedScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    port.current = {
      y: e.nativeEvent.contentOffset.y,
      h: e.nativeEvent.layoutMeasurement.height,
    };
    sweep();
  };

  const onBubbleLayout = (id: BroadcastId) => (e: LayoutChangeEvent) => {
    boxes.current.set(id, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height });
    sweep();
  };

  return (
    <View style={s.wrap}>
      <EventHeader eyebrow="Announcements" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        testID="chat-feed"
        onLayout={onFeedLayout}
        onScroll={onFeedScroll}
        // 16ms on iOS, where the default is 0 and would deliver ONE event per gesture --
        // enough to mark what you landed on and nothing you scrolled past.
        scrollEventThrottle={16}
      >
        <NowNextCard />
        {feed.map((b) => (
          // A wrapper rather than an onLayout prop on BroadcastBubble: the bubble is a
          // presentational component used by the host console too, and measurement is this
          // screen's concern. It is still one flex child, so the container's `gap` is
          // unchanged.
          <View key={b.id} onLayout={onBubbleLayout(b.id)}>
            <BroadcastBubble broadcast={b} timeZone={event?.timezone ?? 'UTC'} />
          </View>
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

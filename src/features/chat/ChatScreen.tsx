import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useFeed } from '@/state/hooks';
import { alpha, border, fade, useTheme } from '@/theme';
import { RoleSwitch } from '@/components/ui/RoleSwitch';
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
  const { tokens } = useTheme();
  const feed = useFeed();

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
          <BroadcastBubble key={b.id} broadcast={b} />
        ))}
      </ScrollView>
      <View style={[s.footer, { borderTopColor: tokens.base300 }]}>
        <Text style={[s.footerText, { color: alpha(tokens.baseContent, fade.faint) }]}>
          Announcements only · hosts post here
        </Text>
        <RoleSwitch />
      </View>
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

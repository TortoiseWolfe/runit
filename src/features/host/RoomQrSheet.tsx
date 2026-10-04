import { useKeepAwake } from 'expo-keep-awake';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EventQr } from '@/components/ui/EventQr';
import { INVITE_ORIGIN } from '@/lib/invite';
import { alpha, useTheme, weight } from '@/theme';

/**
 * SHOW TO THE ROOM (spec 009, #108). The host's phone or tablet becomes a sign.
 *
 * WHY IT EXISTS: two real events could not get guests in. S7Y9RX had zero sign-ins and the
 * first wedding beta had two guests all day -- the planner: "without a way to publicly
 * announce it was almost impossible." The QR this replaced was 180px inside the Broadcast
 * panel: something to show one person across a table, not a room.
 *
 * THE QR IS SIZED FROM THE WINDOW, not a constant: the largest square that leaves room for
 * the words, 160 to 640pt, in either orientation -- a phone held up and a tablet on its side
 * at the door are both the use. It is the same `EventQr`, so it still encodes `joinLink`
 * and Lane F (`pnpm verify:qr`) decodes THIS one now.
 *
 * KEPT AWAKE WHILE OPEN. A sign that goes dark after thirty seconds is a sign nobody reads.
 * `suppressDeactivateWarnings` because on the web the Wake Lock request can be refused (an
 * old Safari, a background tab), and releasing a lock that was never granted otherwise
 * throws on close.
 *
 * THEME COLOURS, NOT A WHITE PAGE: the QR already sits on its own white plate, and a dark
 * screen is kinder to a dark room.
 */
export function RoomQrSheet({
  visible,
  onClose,
  code,
  name,
}: {
  visible: boolean;
  onClose: () => void;
  code: string;
  name: string;
}) {
  return (
    <Modal
      visible={visible}
      // NO ENTRANCE ANIMATION, measured: Lane F screenshotted the QR mid-fade, the console
      // showing through it, and jsQR could not decode it. A sign does not need to arrive
      // gracefully; it needs to be readable the instant it is up.
      animationType="none"
      presentationStyle="fullScreen"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      {visible ? <Room code={code} name={name} onClose={onClose} /> : null}
    </Modal>
  );
}

/** Everything that is not the QR: name, call to action, label, code, the typed route. */
const WORDS_HEIGHT = 300;

function Room({ code, name, onClose }: { code: string; name: string; onClose: () => void }) {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const { tokens, fade } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const room = Math.min(width - 48, height - insets.top - insets.bottom - WORDS_HEIGHT);
  const size = Math.max(160, Math.min(640, Math.floor(room)));
  const host = INVITE_ORIGIN.replace(/^https?:\/\//, '');

  return (
    <View
      style={[
        s.room,
        { backgroundColor: tokens.base100, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
      ]}
      testID="room-qr"
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close the room QR"
        testID="room-qr-close"
        style={[s.close, { top: insets.top + 8 }]}
      >
        <Text style={[s.closeText, { color: tokens.accent }]}>Done</Text>
      </Pressable>
      <Text style={[s.name, { color: tokens.baseContent }]} numberOfLines={2} testID="room-qr-name">
        {name}
      </Text>
      <Text style={[s.cta, { color: alpha(tokens.baseContent, fade.body) }]}>Scan to join the party</Text>
      <EventQr code={code} size={size} large />
      <Text style={[s.url, { color: alpha(tokens.baseContent, fade.body) }]}>
        or open {host} and type the code
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  room: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  close: {
    position: 'absolute',
    right: 16,
    minWidth: 64,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 17, fontWeight: weight.semibold },
  name: { fontSize: 30, fontWeight: weight.semibold, textAlign: 'center' },
  cta: { fontSize: 20, textAlign: 'center' },
  url: { fontSize: 15, textAlign: 'center' },
});

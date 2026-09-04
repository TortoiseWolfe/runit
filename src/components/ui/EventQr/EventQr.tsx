import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { joinLink } from '@/lib/invite';
import { alpha, eyebrow, radius, tracking, useTheme, weight } from '@/theme';

/**
 * The event code as something a phone camera can read.
 *
 * WHY THIS EXISTS AT ALL. The canvas has said "Scanned the QR? Your code is filled in"
 * since the first artboard, and until now nothing anywhere produced a code to scan --
 * the only way a guest could get one was to be told it out loud. This is the half that
 * had to come first; the scanner (issue #1) is only useful once this exists.
 *
 * IT ENCODES THE DEEP LINK, NOT THE BARE CODE. A camera app resolves `runit://join?code=X`
 * straight into the app with the field already filled, which is the experience the canvas
 * describes. A bare code would scan to a meaningless string and leave the guest typing it
 * anyway.
 *
 * THE CODE IS PRINTED BENEATH IT, and that is not decoration. The custom scheme only
 * resolves on a phone that already has Runit installed; everyone else needs to read
 * something. A QR with no human-readable fallback is a dead end for exactly the people
 * who most need help getting in.
 *
 * ALWAYS DARK-ON-LIGHT, in both colour schemes. QR contrast is a scanner requirement
 * rather than a design choice -- inverted codes fail on a meaningful fraction of camera
 * apps, and this is the one surface where the theme does not get a vote.
 */
export function EventQr({ code, size = 180 }: { code: string; size?: number }) {
  const { tokens, fade } = useTheme();

  return (
    <View style={s.wrap} testID="event-qr">
      <View style={[s.plate, { width: size + 24, height: size + 24 }]}>
        <QRCode
          value={joinLink(code)}
          size={size}
          color="#000000"
          backgroundColor="#FFFFFF"
          // Medium recovery: survives a phone camera at an angle, in a dim room, or a
          // printed sign with a thumbprint on it, without inflating the module count.
          ecl="M"
        />
      </View>
      <Text style={[s.label, { color: alpha(tokens.baseContent, fade.muted) }]}>
        OR TYPE THE CODE
      </Text>
      <Text style={[s.code, { color: tokens.baseContent }]} testID="event-qr-code">
        {code.toUpperCase()}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  plate: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.box,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...eyebrow.section, fontSize: 11 },
  code: {
    fontSize: 28,
    fontWeight: weight.semibold,
    letterSpacing: tracking(0.18, 28),
  },
});

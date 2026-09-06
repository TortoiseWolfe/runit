import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { codeFromScan, joinLink } from '@/lib/invite';
import { alpha, useTheme, weight } from '@/theme';

/**
 * The scanner, on the platform that has no camera to scan with.
 *
 * SAME REASON `capture.web.ts` EXISTS. `expo-camera`'s `CameraView` needs `getUserMedia`,
 * which headless Chromium refuses outright -- so importing the native sheet into the web
 * bundle would either hang the harness or paint a permanently empty frame, and either way
 * Lane B would be measuring the harness rather than the app. A `.web.tsx` sibling keeps
 * the native module out of the browser bundle entirely; Metro picks the platform.
 *
 * WHAT IT DOES NOT DO IS PRETEND. Outside the harness this says plainly that scanning
 * needs the phone, and the way back to typing is the same control the native sheet draws.
 * That is the honest web behaviour: RunIt ships to iOS, and the web export exists to be
 * measured.
 *
 * UNDER `EXPO_PUBLIC_FIDELITY=1` it offers one button that feeds `codeFromScan` the exact
 * string our own QR encodes -- `joinLink(...)`, not a literal, so the harness cannot go
 * green on a payload the generator no longer produces. That is what lets Lane B drive
 * scan -> code in the field -> join as a journey. It proves the WIRING and nothing about a
 * lens: no lane in this environment can point a camera at anything, and FIDELITY note AL
 * says so rather than implying coverage.
 */
const HARNESS = process.env.EXPO_PUBLIC_FIDELITY === '1';

/** The seeded event's code -- the one a harness QR would be showing. */
const HARNESS_CODE = 'SR1017';

export function QrScanner({
  visible,
  onClose,
  onCode,
}: {
  visible: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const { tokens, fade } = useTheme();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={[s.sheet, { backgroundColor: tokens.base100 }]} testID="qr-scanner">
        <Text style={[s.title, { color: tokens.baseContent }]}>Scan the invitation</Text>
        <View style={[s.frame, { borderColor: tokens.base300 }]}>
          <Text style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}>
            Scanning needs the RunIt app on a phone. Type the code instead.
          </Text>
          {HARNESS ? (
            <Pressable
              onPress={() => {
                // Through the real parser, from the real generator. A test that called
                // onCode('SR1017') directly would pass against a scanner that read
                // nothing at all.
                const code = codeFromScan(joinLink(HARNESS_CODE));
                if (code) onCode(code);
              }}
              accessibilityRole="button"
              testID="qr-simulate"
              hitSlop={8}
              style={[s.cta, { backgroundColor: tokens.primary }]}
            >
              <Text style={[s.ctaText, { color: tokens.primaryContent }]}>
                Simulate a scan
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close the scanner and type the code instead"
          testID="qr-cancel"
          hitSlop={8}
        >
          <Text style={[s.cancel, { color: tokens.accent }]}>Type the code instead</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 24, paddingTop: 72, paddingBottom: 40, gap: 18 },
  title: { fontSize: 20, fontWeight: weight.semibold },
  frame: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    gap: 16,
    padding: 20,
  },
  body: { fontSize: 15, lineHeight: 21 },
  cta: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', minHeight: 44 },
  ctaText: { fontSize: 15, fontWeight: weight.semibold },
  cancel: { fontSize: 15, textAlign: 'center', paddingVertical: 12, minHeight: 44 },
});

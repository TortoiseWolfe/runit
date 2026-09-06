import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { codeFromScan } from '@/lib/invite';
import { alpha, useTheme, weight } from '@/theme';

/**
 * Scanning a QR to join — issue #28, and the half of the invitation that never shipped.
 *
 * `README.md` has promised "guests scan a QR or type a code" since the first commit, and
 * the canvas's *"Scanned the QR?"* copy sits over a pre-filled field standing in for a
 * scanner that did not exist. Generation shipped -- `EventQr` on the host console, and
 * Lane F decodes what it actually encodes -- and nothing anywhere read one back in.
 * FIDELITY note O records an attempt to close that by editing the README instead, and
 * reverting it: the code was what was behind, and quietening the claim made the gap
 * harder to find rather than smaller.
 *
 * THE FIELD NEVER GOES AWAY. This opens over the join screen and closes back onto it with
 * the code filled in; the issue asked for a manual fallback never more than one tap away,
 * and the honest reading of that is that typing stays the primary path and scanning is the
 * shortcut. Everything that can go wrong here -- no permission, a QR for something else, a
 * camera that will not start -- ends in the same place: the field, with a sentence saying
 * what happened.
 *
 * PARSING IS NOT HERE. `codeFromScan` is pure and lives beside `joinLink`, which is what
 * produced the string being read; every interesting failure of a scanner is a string
 * failure, and those are tested rather than pointed at a lens.
 */
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
  const [permission, requestPermission] = useCameraPermissions();
  const [rejected, setRejected] = useState<string | null>(null);

  /**
   * ONE SCAN PER OPENING. `onBarcodeScanned` fires on every frame that resolves a code --
   * several times a second while the QR is in shot -- so without this the join screen
   * would take the same code twenty times and the sheet would close over itself.
   */
  const [taken, setTaken] = useState(false);

  const onBarcode = ({ data }: { data: string }) => {
    if (taken) return;
    const code = codeFromScan(data);
    if (!code) {
      // A QR that is not ours: a wifi card, a menu, somebody's business card. Saying so
      // is the whole difference between "this app is broken" and "wrong code".
      setRejected('That QR is not a RunIt invitation.');
      return;
    }
    setTaken(true);
    onCode(code);
  };

  const granted = permission?.granted === true;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={[s.sheet, { backgroundColor: tokens.base100 }]} testID="qr-scanner">
        <Text style={[s.title, { color: tokens.baseContent }]}>Scan the invitation</Text>

        {granted ? (
          <View style={[s.frame, { borderColor: tokens.base300 }]}>
            <CameraView
              style={s.camera}
              facing="back"
              // QR ONLY. `CameraView` will happily read PDF417 and every 1D format, and a
              // barcode off a wine bottle resolving to digits would sail through a looser
              // parser. Narrowing here means the parser never sees them.
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcode}
            />
          </View>
        ) : (
          <View style={s.frame}>
            <Text style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}>
              {permission?.canAskAgain === false
                ? 'Camera access is off for RunIt. You can turn it on in Settings, or type the code instead.'
                : 'RunIt needs the camera to read an invitation QR.'}
            </Text>
            {permission?.canAskAgain !== false && (
              <Pressable
                onPress={() => void requestPermission()}
                accessibilityRole="button"
                testID="qr-allow"
                hitSlop={8}
                style={[s.cta, { backgroundColor: tokens.primary }]}
              >
                <Text style={[s.ctaText, { color: tokens.primaryContent }]}>
                  Allow camera
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {rejected ? (
          <Text testID="qr-rejected" style={[s.body, { color: tokens.baseContent }]}>
            {rejected}
          </Text>
        ) : null}

        {/* The way back to typing, and it is drawn whatever else on this sheet is true --
            including while the camera is running. A scanner someone cannot get out of is
            worse than no scanner. */}
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
  camera: { flex: 1 },
  body: { fontSize: 15, lineHeight: 21 },
  cta: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', minHeight: 44 },
  ctaText: { fontSize: 15, fontWeight: weight.semibold },
  cancel: { fontSize: 15, textAlign: 'center', paddingVertical: 12, minHeight: 44 },
});

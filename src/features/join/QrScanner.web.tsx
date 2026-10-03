import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { codeFromScan, joinLink } from '@/lib/invite';
import { Button } from '@/components/ui/Button';
import { alpha, useTheme, weight } from '@/theme';

/**
 * The scanner in a browser -- which, since #78, is where most guests ARE.
 *
 * IT USED TO REFUSE, AND THE REASON HAD EXPIRED. This file said "Scanning needs the RunIt app
 * on a phone" on the premise that the web export existed only to be measured. Then the browser
 * became the guest route, and on 2026-10-03 the first wedding planner ran her whole event from
 * Safari on an iPhone -- a phone with a perfectly good camera, behind a sheet telling her to go
 * and install something.
 *
 * HOW: `getUserMedia` for the back camera, frames drawn to a canvas, and `jsqr` reading them,
 * because Safari has no `BarcodeDetector` (Chromium on this platform does not either -- Lane F
 * found that first, and decodes with jsQR for the same reason). The decoded string goes through
 * `codeFromScan`, the SAME parser the native sheet uses, so a QR that is not ours is said to be
 * not ours rather than typed into the field.
 *
 * iOS NEEDS `playsInline` AND `muted`, or the preview opens fullscreen in the system player and
 * the canvas reads nothing. Both are set on the element and again on the node, because React
 * has a long history of not reflecting `muted` as an attribute.
 *
 * THE CAMERA LIVES IN A CHILD THAT ONLY MOUNTS WHILE THE SHEET IS OPEN, so closing it -- by
 * Cancel, by a scan, by the system back -- unmounts the child, and the cleanup stops every
 * track. A light left on after the sheet closes is the failure that would make somebody stop
 * trusting the page.
 *
 * UNDER `EXPO_PUBLIC_FIDELITY=1` IT STILL DOES NOT OPEN A CAMERA. Headless Chromium refuses
 * `getUserMedia`, so Lane B keeps its one button that feeds `codeFromScan` the exact string our
 * own QR encodes -- `joinLink(...)`, not a literal. That proves the WIRING; the lens is proved
 * by `tools/prove-web-scan.mjs`, which feeds Chromium a fake camera showing a real QR.
 */
const HARNESS = process.env.EXPO_PUBLIC_FIDELITY === '1';

/** The seeded event's code -- the one a harness QR would be showing. */
const HARNESS_CODE = 'SR1017';

/** jsQR's cost grows with pixels; a phone's 1080p frame is ten times what a QR needs. */
const MAX_SIDE = 640;
const SCAN_EVERY_MS = 200;

type Cam = 'starting' | 'live' | 'foreign' | 'blocked' | 'none';

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
          {HARNESS ? (
            <View style={s.pad}>
              <Text style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}>
                No camera in the harness. Simulate the scan, or type the code.
              </Text>
              <Button
                onPress={() => {
                  // Through the real parser, from the real generator. A test that called
                  // onCode('SR1017') directly would pass against a scanner that read
                  // nothing at all.
                  const code = codeFromScan(joinLink(HARNESS_CODE));
                  if (code) onCode(code);
                }}
                testID="qr-simulate"
                size="sm"
                label="Simulate a scan"
              />
            </View>
          ) : visible ? (
            <Camera onCode={onCode} />
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

function Camera({ onCode }: { onCode: (code: string) => void }) {
  const { tokens, fade } = useTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onCodeRef = useRef(onCode);
  const [cam, setCam] = useState<Cam>('starting');

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const stop = () => {
      done = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };

    const tick = () => {
      if (done) return;
      const v = videoRef.current;
      if (v && ctx && v.readyState >= 2 && v.videoWidth > 0) {
        const k = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * k);
        const h = Math.round(v.videoHeight * k);
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(v, 0, 0, w, h);
        const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, {
          inversionAttempts: 'dontInvert',
        });
        if (hit?.data) {
          const code = codeFromScan(hit.data);
          if (code) {
            stop();
            onCodeRef.current(code);
            return;
          }
          setCam('foreign');
        }
      }
      timer = setTimeout(tick, SCAN_EVERY_MS);
    };

    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!media?.getUserMedia) {
      // Asynchronously, so the state change is not a synchronous set inside the effect.
      void Promise.resolve().then(() => {
        if (!done) setCam('none');
      });
    } else {
      media
        .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then((s) => {
          if (done) {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = s;
          const v = videoRef.current;
          if (v) {
            v.muted = true;
            v.setAttribute('playsinline', '');
            v.srcObject = s;
            void v.play().catch(() => undefined);
          }
          setCam('live');
          tick();
        })
        .catch((e: unknown) => {
          if (done) return;
          const name = (e as { name?: string } | null)?.name;
          setCam(name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : 'none');
        });
    }

    return stop;
  }, []);

  const showVideo = cam === 'starting' || cam === 'live' || cam === 'foreign';
  const line =
    cam === 'starting'
      ? 'Starting the camera…'
      : cam === 'live'
        ? "Point the camera at the invitation's QR code."
        : cam === 'foreign'
          ? "That QR code isn't a RunIt invitation."
          : cam === 'blocked'
            ? 'The camera is blocked for this page. On iPhone: tap aA in the address bar, then Website Settings, then Camera, and choose Allow. Or type the code.'
            : "This browser can't open a camera. Type the code instead.";

  return (
    <View style={s.fill}>
      {showVideo ? (
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          data-testid="qr-video"
          style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
        />
      ) : null}
      <Text
        testID="qr-status"
        style={[
          s.status,
          showVideo
            ? { color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.55)', ...s.overlay }
            : { color: alpha(tokens.baseContent, fade.body) },
        ]}
      >
        {line}
      </Text>
    </View>
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
  },
  pad: { gap: 16, padding: 20 },
  fill: { flex: 1, justifyContent: 'flex-end' },
  body: { fontSize: 15, lineHeight: 21 },
  status: { fontSize: 15, lineHeight: 21, padding: 12 },
  /** Over the preview, not under it: the video is 100% of the frame, so a sibling below it is clipped. */
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  cancel: { fontSize: 15, textAlign: 'center', paddingVertical: 12, minHeight: 44 },
});

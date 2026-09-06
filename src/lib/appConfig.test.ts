import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The parts of `app.json` that no lane can see fail.
 *
 * A wrong permission string does not error, does not fail a build, and does not show up
 * in any screenshot. It appears once, in a system dialog, on a real phone, and if it is
 * the wrong sentence the person reading it declines -- and a declined camera is
 * indistinguishable from a broken one to everybody afterwards.
 */
const config = JSON.parse(readFileSync(join(__dirname, '../../app.json'), 'utf8')) as {
  expo: { plugins: (string | [string, Record<string, unknown>])[] };
};

const configured = (name: string) =>
  config.expo.plugins.find((p): p is [string, Record<string, unknown>] =>
    Array.isArray(p) && p[0] === name,
  )?.[1];

describe('the camera permission, which two plugins both write (#28)', () => {
  it('is declared by both plugins that ask for the camera', () => {
    // `expo-image-picker` has wanted it since photo capture (#12); `expo-camera` wants it
    // for QR scanning. Both exist and both are used.
    expect(configured('expo-image-picker')?.cameraPermission).toEqual(expect.any(String));
    expect(configured('expo-camera')?.cameraPermission).toEqual(expect.any(String));
  });

  it('says the SAME thing in both, because only one of them survives', () => {
    // Config plugins apply in order and both write `NSCameraUsageDescription`, so the
    // later one silently wins. Two plausible strings would mean the dialog explains
    // whichever use lost -- a guest asked to allow the camera "to add photos to the album"
    // while pointing it at a QR at the door. This is the only place that can catch it:
    // the plist it produces is prebuild output and `/android` and `/ios` are gitignored.
    expect(configured('expo-camera')?.cameraPermission).toBe(
      configured('expo-image-picker')?.cameraPermission,
    );
  });

  it('names both uses, since one sentence has to cover both', () => {
    const text = String(configured('expo-camera')?.cameraPermission);
    expect(text).toMatch(/scan/i);
    expect(text).toMatch(/photo/i);
  });

  it('asks for no microphone, which neither feature needs', () => {
    // A permission requested and never used is a rejection at App Review and a reason for
    // a guest to decline everything on the sheet.
    expect(configured('expo-camera')?.microphonePermission).toBe(false);
    expect(configured('expo-image-picker')?.microphonePermission).toBe(false);
  });
});

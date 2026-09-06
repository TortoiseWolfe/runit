/**
 * The resize decision (#11), which had no test at all and three silent failure modes.
 *
 * WHY IT COULD NOT BE CAUGHT ANY OTHER WAY. `expo-image-picker` types the dimensions it
 * hands back as `number` while documenting that either "can be `0` if the system did not
 * provide the width". So `pnpm typecheck` is green on the broken code and would be green
 * on any patch that only added `?? 0`. Both outputs are valid JPEGs, so no static lane can
 * tell a skipped resize from a performed one — the only observable difference is the
 * FILE SIZE, which needs a device (Lane C).
 *
 * What these tests can prove, and it is the useful half: that the resize decision no
 * longer reads the picker's numbers at all, and therefore cannot be poisoned by them.
 */
import { capturePhoto } from './capture';

/*
 * `mock`-prefixed on purpose. jest hoists `jest.mock()` above the imports, so its factory
 * may not close over an ordinary out-of-scope variable; the prefix is the documented
 * escape hatch. `secureSessionStorage.test.ts` carries the same note for the same reason.
 *
 * Recorded per test so an assertion can name the exact resize that was scheduled.
 */
const mockResizes: Array<{ width?: number | null; height?: number | null }> = [];
let mockSaved = 0;

/** What the DECODER reports. Deliberately independent of what the picker claims. */
let mockDecoded = { width: 4000, height: 3000 };
/** What the PICKER claims. Every test here makes it lie. */
let mockPickerAsset: { uri: string; width: number; height: number } = {
  uri: 'file:///tmp/shot.jpg',
  width: 4000,
  height: 3000,
};

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [mockPickerAsset] })),
}));

jest.mock('expo-file-system', () => ({
  // `adopt()` is not under test; it needs a filesystem and has its own failure modes.
  Directory: class {
    exists = true;
    create() {}
  },
  File: class {
    uri = 'file:///cache/runit-photos/1.jpg';
    constructor(..._a: unknown[]) {}
    copy() {}
  },
  Paths: { cache: 'file:///cache' },
}));

jest.mock('expo-image-manipulator', () => {
  const save = async () => {
    mockSaved += 1;
    return { uri: 'file:///tmp/out.jpg', width: 1, height: 1 };
  };
  const ref = () => ({ ...mockDecoded, saveAsync: save });
  const context = () => ({
    resize(size: { width?: number | null; height?: number | null }) {
      mockResizes.push(size);
      return this;
    },
    renderAsync: async () => ref(),
  });
  return {
    ImageManipulator: { manipulate: () => context() },
    SaveFormat: { JPEG: 'jpeg' },
  };
});

beforeEach(() => {
  mockResizes.length = 0;
  mockSaved = 0;
  mockDecoded = { width: 4000, height: 3000 };
  mockPickerAsset = { uri: 'file:///tmp/shot.jpg', width: 4000, height: 3000 };
});

describe('the resize decision reads the DECODER, never the picker', () => {
  /**
   * THE ASSERTION THAT PROVES THE FIX. The picker reports 0x0 -- its own documented
   * failure -- while the decoder reports a 12-megapixel frame. Before this change that
   * combination skipped the resize entirely and uploaded the full image.
   */
  it('resizes a large photo even when the picker reports 0 x 0', async () => {
    mockPickerAsset = { ...mockPickerAsset, width: 0, height: 0 };
    await capturePhoto();
    expect(mockResizes).toEqual([{ width: 1600 }]);
  });

  it('resizes even when the picker reports undefined dimensions', async () => {
    // `Math.max(undefined, undefined)` is NaN, and every comparison with NaN is false --
    // so the old `NaN > MAX_EDGE` was false and the resize was skipped.
    mockPickerAsset = { ...mockPickerAsset, width: undefined as unknown as number, height: undefined as unknown as number };
    await capturePhoto();
    expect(mockResizes).toEqual([{ width: 1600 }]);
  });

  /**
   * THE WORST OF THE THREE, and the one the issue did not name. One dimension zero and
   * the other real meant `longEdge` was real, so a scale WAS computed -- and then
   * `resize({ width: Math.round(0 * 0.4) })` asked for a width of ZERO. That is not a
   * skipped resize, it is a degenerate one, and the contextual API validates nothing.
   */
  it('never asks for a zero-width resize when the picker reports one axis as 0', async () => {
    mockPickerAsset = { ...mockPickerAsset, width: 0, height: 4000 };
    await capturePhoto();
    expect(mockResizes).toEqual([{ width: 1600 }]);
    expect(mockResizes.some((r) => r.width === 0 || r.height === 0)).toBe(false);
  });
});

describe('what it asks for', () => {
  it('clamps the LONG edge on a landscape photo', async () => {
    mockDecoded = { width: 4000, height: 3000 };
    await capturePhoto();
    expect(mockResizes).toEqual([{ width: 1600 }]);
  });

  it('clamps the HEIGHT on a portrait photo', async () => {
    // The old code always passed `width`, which was right for portrait only by arithmetic
    // accident. Clamping the edge directly makes the orientation branch load-bearing.
    mockDecoded = { width: 3000, height: 4000 };
    await capturePhoto();
    expect(mockResizes).toEqual([{ height: 1600 }]);
  });

  it('does not resize a photo already under the limit', async () => {
    mockDecoded = { width: 1200, height: 900 };
    await capturePhoto();
    expect(mockResizes).toEqual([]);
    // ...but still re-encodes at QUALITY, which is the other half of the size win.
    expect(mockSaved).toBe(1);
  });

  it('leaves a photo exactly at the limit alone', async () => {
    mockDecoded = { width: 1600, height: 1200 };
    await capturePhoto();
    expect(mockResizes).toEqual([]);
  });
});

describe('when the decoder itself returns nonsense', () => {
  it('throws loudly rather than uploading a full frame', async () => {
    // A tripwire on the NATIVE decoder, which is a different and far less likely claim
    // than distrusting the picker. Silence here would be the original bug wearing a
    // new hat.
    mockDecoded = { width: 0, height: 0 };
    await expect(capturePhoto()).rejects.toThrow(/reported no size/);
  });
});

/**
 * The WEB compression path (#11), which did not exist.
 *
 * WHY THIS FILE HAS A SEAM. No lane in this repo can reach `shrink` through
 * `capturePhoto`: the compression lives in the `change` listener, only reachable on the
 * NON-fidelity branch, and that branch opens an OS file chooser nothing in
 * `tools/shoot-app.mjs` answers — which is precisely why the fidelity branch exists.
 * jsdom implements no `canvas.toBlob` either. Injecting the decoder and the canvas is the
 * only way any of this is testable, and untested compression is how a 12MB original
 * reaches a 10MB bucket and fails as a generic transfer error.
 *
 * What is still NOT proven here: that a real browser's `createImageBitmap` and
 * `canvas.toBlob` behave as these fakes do, and that EXIF orientation survives. Only a
 * hand-run in a real browser shows that.
 */
import { shrink } from './capture.web';

const blob = (bytes: number, type = 'image/jpeg') =>
  new Blob([new Uint8Array(bytes)], { type });

/** A fake decoder and canvas that record what they were asked for. */
function deps(size: { width: number; height: number }, opts: { toBlobNull?: boolean } = {}) {
  const drew: { w: number; h: number }[] = [];
  const made: { w: number; h: number }[] = [];
  let closed = 0;
  return {
    drew,
    made,
    closed: () => closed,
    decode: async () => ({ ...size, close: () => { closed += 1; } }),
    canvas: (w: number, h: number) => {
      made.push({ w, h });
      return {
        draw: (_src: unknown, dw: number, dh: number) => void drew.push({ w: dw, h: dh }),
        toBlob: async () => (opts.toBlobNull ? null : blob(1000, 'image/jpeg')),
      };
    },
  };
}

describe('shrinking a picked file', () => {
  it('clamps the long edge of a landscape photo and keeps the ratio', async () => {
    const d = deps({ width: 4000, height: 3000 });
    const out = await shrink(blob(5_000_000), d);
    expect(d.made).toEqual([{ w: 1600, h: 1200 }]);
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1200);
  });

  it('clamps the long edge of a portrait photo', async () => {
    const d = deps({ width: 3000, height: 4000 });
    await shrink(blob(5_000_000), d);
    expect(d.made).toEqual([{ w: 1200, h: 1600 }]);
  });

  it('re-encodes a small photo without enlarging it', async () => {
    // Still worth a pass: the JPEG re-encode at QUALITY is the other half of the size win,
    // and a picked PNG becomes a JPEG, matching native.
    const d = deps({ width: 800, height: 600 });
    const out = await shrink(blob(400_000, 'image/png'), d);
    expect(d.made).toEqual([{ w: 800, h: 600 }]);
    expect(out.blob.type).toBe('image/jpeg');
  });

  it('actually returns the compressed bytes, not the original', async () => {
    // The claim the whole issue is about. Before this, `upload()` received the file the
    // picker handed over, whatever its size.
    const original = blob(5_000_000);
    const out = await shrink(original, deps({ width: 4000, height: 3000 }));
    expect(out.blob).not.toBe(original);
    expect(out.blob.size).toBeLessThan(original.size);
  });

  it('releases the decoded bitmap', async () => {
    // A full-resolution bitmap held per photo is how a browser tab dies after six shots.
    const d = deps({ width: 4000, height: 3000 });
    await shrink(blob(5_000_000), d);
    expect(d.closed()).toBe(1);
  });
});

describe('when the browser will not co-operate', () => {
  it('hands back the ORIGINAL when toBlob yields null, never null itself', async () => {
    // Returning null here would be indistinguishable from "the guest backed out", which
    // `actions.ts` swallows silently — so a compression failure would look like a
    // cancelled camera: no photo, no toast, no error.
    const original = blob(5_000_000);
    const out = await shrink(original, deps({ width: 4000, height: 3000 }, { toBlobNull: true }));
    expect(out.blob).toBe(original);
  });

  it('does not build a zero-sized canvas when the decode reports no size', async () => {
    // The same unvalidated-input trap the native path had. A 0x0 canvas produces a blank
    // image, which is worse than an uncompressed one.
    const d = deps({ width: 0, height: 0 });
    const original = blob(5_000_000);
    const out = await shrink(original, d);
    expect(d.made).toEqual([]);
    expect(out.blob).toBe(original);
  });

  it('releases the bitmap even on that path', async () => {
    const d = deps({ width: 0, height: 0 });
    await shrink(blob(5_000_000), d);
    expect(d.closed()).toBe(1);
  });
});

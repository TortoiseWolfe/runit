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

/**
 * THE PRODUCT'S OWN NAME, IN THE FOUR SENTENCES IT INTRODUCES ITSELF WITH -- #57.
 *
 * `tools/audit-brand-casing.mjs` is the repo-wide gate and it covers these too. This exists
 * anyway, and not as a duplicate: the audit knows only that `Runit` is wrong, while these
 * assert the strings say `RunIt` AT ALL. A permission sentence rewritten to drop the product
 * name -- "Lets you add a photo you already have" -- passes the audit and is a worse dialog,
 * because a system prompt with no app name in it reads as though something else is asking.
 *
 * These four are the highest-stakes copy in the app by a distance. They appear once, in an
 * OS dialog, on a real phone, and the answer is permanent until somebody digs through
 * Settings. Nothing else here can see them: the plist is prebuild output and `/ios` is
 * gitignored, so `app.json` is the only committed source.
 */
describe('the permission dialogs name the product, and spell it right (#57)', () => {
  const strings = () => [
    configured('expo-image-picker')?.photosPermission,
    configured('expo-image-picker')?.cameraPermission,
    configured('expo-camera')?.cameraPermission,
    configured('expo-media-library')?.savePhotosPermission,
  ];

  it('found all four, so the assertions below are measuring something', () => {
    // A coverage floor, the same doctrine as the static audits: if a plugin is renamed
    // these silently become `undefined`, and `undefined` contains no wrong spelling.
    const found = strings();
    expect(found).toHaveLength(4);
    for (const s of found) expect(typeof s).toBe('string');
  });

  it.each([
    ['expo-image-picker', 'photosPermission'],
    ['expo-image-picker', 'cameraPermission'],
    ['expo-camera', 'cameraPermission'],
    ['expo-media-library', 'savePhotosPermission'],
  ])('%s.%s introduces the app as RunIt', (plugin, key) => {
    const text = String(configured(plugin)?.[key]);
    expect(text).toContain('RunIt');
    // The failure this is really about. `Runit` is correct in the bundle id, the scheme,
    // the Pages host and the repo name, so it is the spelling everyone's fingers know --
    // and these four sentences shipped with it for the life of the app.
    expect(text).not.toMatch(/\bRunit\b/);
  });
});

/**
 * A KEY DECLARED TWICE IS A KEY SILENTLY DISCARDED -- #74.
 *
 * `expo.ios` carried `infoPlist` TWICE. Duplicate keys are legal JSON and the last one wins,
 * so `ITSAppUsesNonExemptEncryption: false` was dropped before Expo ever read the file and
 * had never been written into a plist. The cost landed on the other side of a build: every
 * upload stopping to ask for export compliance by hand, which #69 counts among the
 * declarations blocking submission.
 *
 * NOTHING COULD HAVE CAUGHT IT. The plist is prebuild output and `/ios` is gitignored, so
 * `app.json` is the only place it is visible -- the same argument the camera-permission
 * checks above make. `tsc` never parses this file, and a linter would not flag legal JSON.
 *
 * IT SCANS THE RAW TEXT, AND THE FIRST ATTEMPT AT THIS DID NOT WORK. Counting calls to a
 * `JSON.parse` reviver looks like the cheap route and is wrong: **duplicates are collapsed
 * before the reviver ever runs.** Measured -- `JSON.parse('{"a":{},"a":{}}', fn)` calls `fn`
 * with `a` exactly ONCE. Any check written against the parsed object, by any means, passes
 * on the broken file. The text is the only witness.
 *
 * The scanner is deliberately small rather than general: it tracks brace depth, skips string
 * contents, and treats a quoted run followed by `:` as a key at the current depth. That is
 * enough for a config file and stops well short of being a JSON parser nobody asked for.
 */
describe('no key in app.json is declared twice (#74)', () => {
  /** Every key declared more than once in its own object, as `depth:key`. */
  const duplicateKeys = (raw: string): string[] => {
    const stack: (Set<string> | null)[] = [];
    const dupes: string[] = [];

    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i]!;
      if (c === '{') stack.push(new Set());
      else if (c === '[') stack.push(null); // arrays hold no keys, but must balance
      else if (c === '}' || c === ']') stack.pop();
      else if (c === '"') {
        // Read the string, honouring escapes, so a brace or quote inside one is inert.
        let j = i + 1;
        let text = '';
        while (j < raw.length && raw[j] !== '"') {
          if (raw[j] === '\\') {
            text += raw[j + 1] ?? '';
            j += 2;
          } else {
            text += raw[j];
            j += 1;
          }
        }
        // A key is a string whose next non-space character is a colon.
        let k = j + 1;
        while (k < raw.length && /\s/.test(raw[k]!)) k += 1;
        if (raw[k] === ':') {
          const here = stack[stack.length - 1];
          if (here) {
            const at = `${stack.length}:${text}`;
            if (here.has(text)) dupes.push(at);
            else here.add(text);
          }
        }
        i = j;
      }
    }
    return dupes;
  };

  const RAW = readFileSync(join(__dirname, '../../app.json'), 'utf8');

  it('finds none', () => {
    expect(duplicateKeys(RAW)).toEqual([]);
  });

  it('and the scan would actually notice one, which is the half that can rot', () => {
    // A detector that stopped detecting would pass the assertion above having measured
    // nothing -- the coverage-floor doctrine the static audits already carry. So it is run
    // over a file that IS broken, in the exact shape #74 had.
    const broken =
      '{"expo":{"ios":{"infoPlist":{"a":1},"infoPlist":{"b":2}}}}';
    expect(duplicateKeys(broken)).toContain('3:infoPlist');
  });

  it('does not cry duplicate over the same key at different levels, or inside strings', () => {
    // `name` legitimately appears at several depths in this file, and a brace or a colon
    // inside a string value must not move the scanner. Without this the check would be
    // switched off within a week for crying wolf.
    expect(duplicateKeys('{"a":{"name":1},"b":{"name":2}}')).toEqual([]);
    expect(duplicateKeys('{"a":"{\\"name\\": 1}","name":2}')).toEqual([]);
  });

  it('kept the declaration the duplicate was eating', () => {
    // The instance, not the class: `ITSAppUsesNonExemptEncryption` is what was being
    // discarded, and `false` is the claim -- RunIt ships no non-exempt encryption.
    const ios = (
      JSON.parse(RAW) as { expo: { ios: { infoPlist: Record<string, unknown> } } }
    ).expo.ios.infoPlist;
    expect(ios.ITSAppUsesNonExemptEncryption).toBe(false);
    // ...and did not lose the one that was winning.
    expect(ios.LSApplicationQueriesSchemes).toEqual(['spotify']);
  });
});

import { factLine, factsFrom } from './deviceFacts';

/**
 * WHAT A FEEDBACK REPORT SAYS ABOUT THE PHONE IT CAME FROM -- and the build number is the fact
 * a beta needs most, because it is what tells you whether a bug is already fixed.
 *
 * NOTHING TESTED THIS BEFORE, and it was wrong twice over. `deviceFacts()` read the build from
 * `Constants.expoConfig.ios.buildNumber` / `android.versionCode` -- APP CONFIG -- and both are
 * absent from `app.json`, because `appVersionSource: "remote"` keeps them in EAS. And every
 * Android preview build was `versionCode 1` regardless, so a report from the APK handed out on
 * 2026-09-11 and one from any later APK were indistinguishable.
 *
 * `factsFrom` takes its environment as an argument, the same seam `shrink` in capture.web.ts
 * uses and for the same reason: the live values come from a native module that no unit test
 * can instantiate, and a function that reads them directly ships unverified.
 */
const live = (over: Partial<Parameters<typeof factsFrom>[0]>) =>
  factsFrom({
    os: 'ios',
    osVersion: '18.1',
    appVersion: '0.1.0',
    buildVersion: '14',
    locale: 'en-US',
    timezone: 'America/New_York',
    ...over,
  });

describe('the build a report names is the build that is INSTALLED', () => {
  it('reads the iOS build off the binary', () => {
    const f = live({ os: 'ios', buildVersion: '14' });
    expect(f.platform).toBe('ios');
    expect(f.build).toBe('14');
    expect(f.app).toBe('0.1.0');
  });

  it('reads the Android versionCode off the binary', () => {
    const f = live({ os: 'android', osVersion: '34', buildVersion: '2' });
    expect(f.platform).toBe('android');
    expect(f.os).toBe('34');
    expect(f.build).toBe('2');
  });

  it('says unknown when the binary genuinely has no value, rather than inventing one', () => {
    // Honest absence. A default of "1" would be the old Android bug wearing a new face.
    expect(live({ os: 'android', buildVersion: null }).build).toBe('unknown');
  });
});

describe('a browser report says it came from a browser', () => {
  /*
   * THE BROWSER ROUTE WENT LIVE IN e9225cb, so web reports now actually arrive. There
   * `Platform.Version` is undefined and both native fields are null, and the old code
   * stringified them -- a report reading "web undefined · app 0.1.0 (unknown)".
   */
  it('names web as both platform and build, and never prints undefined', () => {
    const f = live({ os: 'web', osVersion: undefined, appVersion: null, buildVersion: null });
    expect(f.platform).toBe('web');
    expect(f.build).toBe('web');
    expect(JSON.stringify(f)).not.toContain('undefined');
  });

  /*
   * AND THE VALUE react-native-web ACTUALLY RETURNS IS "0.0.0", NOT UNDEFINED.
   *
   * The case above assumed a browser has no `Platform.Version`. It does: react-native-web
   * returns the string "0.0.0", measured by sending a real report from the live site on
   * 2026-09-21. The row landed with `os: "0.0.0"` and the sheet showed "web 0.0.0" to the
   * person reading it. The test above passed against an assumption and the product did not.
   * A browser has no OS version this can honestly report, so it reports none.
   */
  it('reports no OS version from a browser, including the 0.0.0 react-native-web returns', () => {
    const f = live({ os: 'web', osVersion: '0.0.0', appVersion: '0.1.0', buildVersion: null });
    expect(f.os).toBeUndefined();
    expect(factLine(f)).toBe('web · app 0.1.0 (web) · America/New_York');
  });
});

describe('the one line printed above the Send button', () => {
  it('reads cleanly on a phone', () => {
    expect(factLine(live({ os: 'android', osVersion: '34', buildVersion: '2' }))).toBe(
      'android 34 · app 0.1.0 (2) · America/New_York',
    );
  });

  it('never shows a person the word undefined', () => {
    const line = factLine(live({ os: 'web', osVersion: undefined, appVersion: null, buildVersion: null }));
    expect(line).not.toContain('undefined');
    expect(line).not.toContain('null');
  });
});

/*
 * AND THE WIRING, which is the half that was actually wrong.
 *
 * Everything above tests `factsFrom`, the pure half -- and a regression back to reading
 * `Constants.expoConfig` would sail straight past all of it, because that mistake lives in
 * `deviceFacts()`, not in the formatting. So the native module is mocked with values that
 * DIFFER from config, and the report has to carry the binary's. Config says nothing about the
 * build at all (remote versioning), so reading it yields `unknown`, never `14`.
 */
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '0.1.0',
  nativeBuildVersion: '14',
}));

describe('deviceFacts reads the installed package, not app config', () => {
  it('reports the build the binary carries', () => {
    // jest-expo runs as iOS; Constants.expoConfig has no ios.buildNumber, because remote
    // versioning never writes one -- so '14' can only have come from expo-application.
    const { deviceFacts } = jest.requireActual<typeof import('./deviceFacts')>('./deviceFacts');
    const f = deviceFacts();
    expect(f.build).toBe('14');
    expect(f.build).not.toBe('unknown');
  });
});

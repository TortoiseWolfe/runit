import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * WHAT A FEEDBACK REPORT SAYS ABOUT THE PHONE IT CAME FROM.
 *
 * THE BUILD NUMBER IS READ OFF THE INSTALLED BINARY, NOT OFF APP CONFIG, and the difference
 * was the whole bug. This used to read `Constants.expoConfig.ios.buildNumber` and
 * `android.versionCode`. Both are ABSENT from `app.json`: `eas.json` sets
 * `appVersionSource: "remote"`, so EAS keeps the build number and writes it into the native
 * project at build time, never into config. So the field a report most needs -- which build is
 * this, and is the bug already fixed in it -- came out as `unknown`.
 *
 * And on Android it was worse than absent. Every `preview` build was `versionCode 1`, because
 * only the `production` profile auto-incremented, so the APK handed out on 2026-09-11 and every
 * APK after it reported the same number. `eas.json` increments `preview` now too.
 *
 * `expo-application` reads `CFBundleVersion` / `versionCode` from the package that is actually
 * installed, which is true whatever EAS does with versioning.
 *
 * NOTHING IDENTIFYING. Platform, OS version, app version, build, locale and timezone. Not the
 * device NAME -- "Ruth's iPhone" is the one field here a person would consider theirs, and it
 * reproduces nothing that the model does not.
 */

export interface FactsEnv {
  /** `Platform.OS` */
  os: string;
  /** `Platform.Version`. Undefined on web. */
  osVersion: string | number | undefined;
  /** The installed binary's marketing version, or config's on web where there is no binary. */
  appVersion: string | null;
  /** The installed binary's build number. Null on web. */
  buildVersion: string | null;
  locale: string;
  timezone: string;
}

/**
 * PURE, AND THE SEAM IS DELIBERATE -- the shape `shrink` in `capture.web.ts` takes and for the
 * same reason. The live values come from a native module no unit test can instantiate, so a
 * function that reads them directly ships untested. It did, for as long as it existed.
 */
export function factsFrom(env: FactsEnv): Record<string, string> {
  const web = env.os === 'web';
  const facts: Record<string, string> = {
    app: env.appVersion ?? 'unknown',
    // A browser has no build number to report and saying so plainly beats "unknown", which
    // reads as a failure to find one. On a phone, absence is reported honestly -- a default of
    // "1" would be the old Android bug wearing a new face.
    build: web ? 'web' : (env.buildVersion ?? 'unknown'),
    platform: env.os,
    locale: env.locale,
    timezone: env.timezone,
  };
  // Omitted rather than stringified. `String(undefined)` is how a report came to read
  // "web undefined".
  if (env.osVersion !== undefined && env.osVersion !== null) facts.os = String(env.osVersion);
  return facts;
}

/** The live environment. The one place that touches a native module. */
export function deviceFacts(): Record<string, string> {
  const intl = Intl.DateTimeFormat().resolvedOptions();
  return factsFrom({
    os: Platform.OS,
    osVersion: Platform.Version,
    // Config is the right source ONLY on web, where the bundle was built from it and there is
    // no installed package to ask. `version` is present in app.json -- remote versioning
    // manages the build number, not the marketing version -- so this fallback is real.
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
    buildVersion: Application.nativeBuildVersion,
    locale: intl.locale,
    timezone: intl.timeZone,
  });
}

/** The same facts as one readable line, for the sentence above the Send button. */
export function factLine(f: Record<string, string>): string {
  return [
    [f.platform, f.os].filter(Boolean).join(' '),
    `app ${f.app} (${f.build})`,
    f.timezone,
  ]
    .filter(Boolean)
    .join(' · ');
}

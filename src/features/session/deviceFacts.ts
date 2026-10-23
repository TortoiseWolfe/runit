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
  //
  // AND NEVER FROM A BROWSER, because react-native-web's `Platform.Version` is the string
  // "0.0.0" -- not undefined, which is what this first assumed. Measured by sending a real
  // report from the live site: the row landed with `os: "0.0.0"`. A browser has no OS version
  // this can honestly report, and the user agent that would carry one is the fingerprint
  // the "nothing identifying" rule exists to keep out.
  if (!web && env.osVersion !== undefined && env.osVersion !== null) {
    facts.os = String(env.osVersion);
  }
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

export type ReportSeat = 'guest' | 'host' | 'host-as-guest' | 'none';

export interface ReportEnv {
  /** `usePathname()` -- the path only, never the query string. */
  pathname: string | null | undefined;
  /** `useSession().kind`. Null before the session has resolved. */
  sessionKind: 'anonymous' | 'guest' | 'host' | null | undefined;
  /** `session.holdsHostSeat`, which is not the same fact as `sessionKind` (see `repository.ts`). */
  holdsHostSeat: boolean;
  /** `useConnection()`. */
  connection: string | null | undefined;
}

/**
 * THE ROUTES A REPORT MAY NAME. Anything else is `/other`, because `+not-found` renders for ANY
 * typed path and a path is free text a stranger wrote.
 */
const KNOWN_ROUTES = new Set([
  '/', '/join', '/signin', '/create', '/chat', '/music', '/photos', '/blocked',
  '/host/broadcast', '/host/dj', '/host/reports', '/host/photos', '/host/event',
]);

/**
 * THE ADMISSION CODE NEVER TRAVELS IN A ROUTE. `/i/S7Y9RX` is the invitation bridge and its last
 * segment IS the six-character code, which admits anyone to the party -- and the filer prints
 * this value into a PUBLIC issue (`issueBody` keeps the event as a uuid for the same reason).
 * So the dynamic segment is named, never read.
 */
export function routeFor(pathname: string | null | undefined): string {
  if (!pathname) return '/other';
  const path = (pathname.split(/[?#]/)[0] ?? '').replace(/(.)\/+$/, '$1');
  if (/^\/i(\/[^/]*)?$/.test(path)) return path === '/i' ? '/i' : '/i/[code]';
  return KNOWN_ROUTES.has(path) ? path : '/other';
}

/**
 * WHICH SEAT THE REPORTER IS SITTING IN. `session.kind` is the VIEW and `holdsHostSeat` is the
 * SEAT: a host who switched to the guest side reads `kind: 'guest'` and still holds hers, and
 * that is the state #135 could only guess at (#116 reopened a guest as host-shaped).
 */
export function seatFor(kind: ReportEnv['sessionKind'], holdsHostSeat: boolean): ReportSeat {
  if (kind === 'host') return 'host';
  if (kind === 'guest') return holdsHostSeat ? 'host-as-guest' : 'guest';
  return 'none';
}

/** The device facts plus where in the app the report was written. Pure. */
export function reportContext(facts: Record<string, string>, env: ReportEnv): Record<string, string> {
  const ctx: Record<string, string> = {
    ...facts,
    route: routeFor(env.pathname),
    seat: seatFor(env.sessionKind, env.holdsHostSeat),
  };
  if (env.connection) ctx.connection = env.connection;
  return ctx;
}

/** The same facts as one readable line, for the sentence above the Send button. */
export function factLine(f: Record<string, string>): string {
  return [
    [f.platform, f.os].filter(Boolean).join(' '),
    `app ${f.app} (${f.build})`,
    f.timezone,
    f.route && `on ${f.route}`,
    f.seat && `seat: ${f.seat}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Web implementation. Metro picks this over `push.ts` for the web bundle, which is the
 * point: **it imports `expo-notifications` not at all.** The package stays out of the web
 * bundle rather than being branched around at runtime, exactly as `capture.web.ts` keeps
 * the camera packages out.
 *
 * IT MUST NEVER TOUCH THE NETWORK, and that is the whole reason this file exists.
 * `getExpoPushTokenAsync` does a round trip to `exp.host` that will never resolve behind
 * Playwright's static `webServer`, so a shared implementation would HANG the screenshot
 * harness and all 208 journeys -- the same trap `capture.web.ts` documents for the file
 * chooser and `getUserMedia`.
 *
 * IT RETURNS null, NOT A SENTINEL, and that is a deliberate difference from
 * `capture.web.ts`. That file returns a synthetic 1x1 PNG because a test asserting the
 * exact data URI proves the value came from the capture PATH rather than a literal. There
 * is no equivalent here: a fake token would flow to `set_push_token` and be stored as a
 * real routable address that routes nowhere, and every Lane B assertion built on it would
 * be measuring the stub. A guest who cannot receive notifications is already a first-class
 * state -- the browser is simply always in it.
 */
export async function registerForPush(): Promise<string | null> {
  return null;
}

import type { PickedContact } from './contacts';

/**
 * Web implementation. Metro picks this over `contacts.ts` for the web bundle, which keeps
 * `expo-contacts` out of it entirely rather than branching around it at runtime.
 *
 * WHY IT RESOLVES INSTEAD OF THROWING. `expo-secure-store` taught this repo the rule the
 * hard way: an Expo native module's web build is a stub by DEFAULT, so every method is
 * `undefined` and calling one throws rather than returning null. The Playwright suite drives
 * the caller's behaviour -- does the button raise the right toast, does it stay enabled --
 * and a web build that threw would fail the suite for a reason that has nothing to do with
 * the code under test.
 *
 * There is a real `navigator.contacts` Contact Picker API in Chrome on Android, and it is
 * deliberately NOT used: it is unavailable in every other browser, unavailable in the
 * headless harness, and this app's web build exists to be tested rather than to be somebody's
 * address book. Returning null is the honest answer for a browser.
 */
export async function pickContact(): Promise<PickedContact | null> {
  return null;
}

/**
 * WHETHER A CONTACT PICKER EXISTS AT ALL ON THIS PLATFORM.
 *
 * `pickContact` returning null is ambiguous by construction: on a phone it means "they
 * backed out", and on web it means "there is no picker here, and there never was". The
 * caller treated both as a dismissal and therefore said NOTHING -- so on the web build the
 * button was a control that did nothing, silently, which is the exact failure this repo has
 * closed three times elsewhere and which I rebuilt here.
 */
export const canPickContacts = false;

/**
 * The browser half of `hints.ts`. `expo-secure-store` has NO web implementation -- its web
 * build is `export default {}`, so calling it THROWS (CLAUDE.md, FIDELITY AB) -- so this uses
 * localStorage, which a private window or a blocked-storage setting can refuse. Every refusal
 * reads as "not hidden", for the same reason as the native half.
 */
const keyFor = (name: string, scope: string) => `hint.${name}.${scope}`;

export async function hintHidden(name: string, scope: string): Promise<boolean> {
  try {
    return globalThis.localStorage?.getItem(keyFor(name, scope)) === '1';
  } catch {
    return false;
  }
}

export async function hideHint(name: string, scope: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(keyFor(name, scope), '1');
  } catch {
    // Refused. The card comes back on the next visit; nothing else is lost.
  }
}

import * as SecureStore from 'expo-secure-store';

/**
 * Per-device "I've seen this, put it away" flags (spec 012's Hide). A HINT, not data: hiding
 * a getting-started card is not a fact about the party, so it never reaches the server, and
 * losing it costs one more look at a card -- which is why every failure reads as "not hidden".
 *
 * SecureStore because it is already a dependency and there is no AsyncStorage here; its keys
 * allow letters, digits, `.`, `-` and `_` only, so the event id goes in after a `.`.
 */
const keyFor = (name: string, scope: string) => `hint.${name}.${scope.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export async function hintHidden(name: string, scope: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(keyFor(name, scope))) === '1';
  } catch {
    return false;
  }
}

export async function hideHint(name: string, scope: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(name, scope), '1');
  } catch {
    // Not remembered on this device. The card comes back next time; nothing else is lost.
  }
}

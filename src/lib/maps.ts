import { Linking, Platform } from 'react-native';

/**
 * "WHERE IS IT" -- ANSWERED BY THE PHONE'S OWN MAP, WITHOUT VALIDATING ANYTHING.
 *
 * The obvious request is to validate `venue` as an address. It is the wrong bar, and doing it
 * would make the product worse:
 *
 *   - MOST VENUES ARE NOT ADDRESSES. "Melva's", "The Barn at Willow Creek", "my place",
 *     "Grandma's". Rejecting those to satisfy a format breaks the common case, and a guest
 *     reading "Melva's" is BETTER served than by a street number they would have to recognise.
 *   - Real validation means geocoding -- an API key, a bill, a network dependency on the
 *     create path, and somebody else's location data crossing a third party. For a field
 *     whose only job is to tell a guest where to go.
 *
 * A map query needs none of that. Every platform's map app takes free text and does the
 * resolving, exactly as well as the guest would by typing it themselves -- and a guest who
 * knows where Melva's is does not tap the link at all. The venue stays whatever the host
 * would naturally say.
 *
 * PLATFORM-SPECIFIC BY DESIGN. `geo:` is Android's scheme and iOS does not register it;
 * `maps:` is Apple's and Android does not. The https fallback is what a browser needs, and is
 * also the honest answer on web where there is no map app to hand off to.
 */
export function mapsUrl(venue: string): string | null {
  const q = venue.trim();
  if (!q) return null;
  const e = encodeURIComponent(q);
  if (Platform.OS === 'ios') return `maps:0,0?q=${e}`;
  if (Platform.OS === 'android') return `geo:0,0?q=${e}`;
  return `https://www.google.com/maps/search/?api=1&query=${e}`;
}

/**
 * Resolves FALSE when there was nowhere to send them or the OS refused the handoff, so the
 * caller can say something true rather than leave a control that appears to do nothing --
 * the failure this repo has already paid for three times with painted-on buttons.
 */
export async function openMaps(venue: string): Promise<boolean> {
  const url = mapsUrl(venue);
  if (!url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    // A phone with no map app registered for the scheme. Rare, and not a crash.
    return false;
  }
}

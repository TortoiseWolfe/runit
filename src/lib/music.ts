import { Linking, Platform } from 'react-native';

/**
 * MAKING THE SONG ACTUALLY PLAY.
 *
 * The request loop ended at a cursor in a database. A guest asked for a song, the room
 * upvoted it, the host accepted it and tapped "Play next" -- and nothing came out of any
 * speaker, because RunIt has never contained an audio path. The queue was a to-do list the
 * host then had to retype into whatever was actually playing music.
 *
 * RUNIT CANNOT STREAM THE AUDIO ITSELF, and that is licensing rather than effort. Spotify's
 * API is closed to us, Apple Music's needs a support ticket only the account holder can send
 * (#8, docs/apple-support-ticket-musickit.md), and hosting the audio would mean holding a
 * catalogue licence. None of that is a weekend.
 *
 * IT DOES NOT NEED TO. The host already has a music app, already signed in, already connected
 * to the speakers. Handing the song to it is the whole job -- the same move the venue's
 * Directions link makes: no API key, no account, no catalogue, and the app that is actually
 * good at this does the part it is good at.
 *
 * SEARCH RATHER THAN A TRACK ID, deliberately. A track id needs a catalogue lookup, which
 * needs the API we do not have. A search for "title artist" lands on the song in one tap and
 * degrades honestly when the guest typed something ambiguous -- which is also exactly what
 * the host would have typed by hand.
 */
export type MusicService = 'spotify' | 'apple' | 'youtube';

/** The order they are tried when nothing is remembered: whichever is actually installed. */
export const SERVICES: MusicService[] = ['spotify', 'apple', 'youtube'];

export const serviceLabel: Record<MusicService, string> = {
  spotify: 'Spotify',
  apple: 'Apple Music',
  youtube: 'YouTube Music',
};

/**
 * The deep link, per service.
 *
 * `spotify:search:` is Spotify's own scheme and opens the installed app directly. Apple Music
 * has no reliable search scheme, so the https URL is used -- iOS hands `music.apple.com` to
 * the Music app through its universal link, and a browser opens it anywhere else. YouTube
 * Music is https for the same reason.
 *
 * WEB GETS https FOR ALL THREE, because a browser cannot open an app scheme and a silent
 * failure is the one outcome this must not have.
 */
export function musicUrl(service: MusicService, title: string, artist: string): string | null {
  const q = [title, artist].map((v) => (v ?? '').trim()).filter(Boolean).join(' ');
  if (!q) return null;
  const e = encodeURIComponent(q);
  if (service === 'spotify') {
    return Platform.OS === 'web'
      ? `https://open.spotify.com/search/${e}`
      : `spotify:search:${e}`;
  }
  if (service === 'apple') return `https://music.apple.com/search?term=${e}`;
  return `https://music.youtube.com/search?q=${e}`;
}

/**
 * Opens the song in whichever service is actually available, preferring `preferred`.
 *
 * Returns the service used, or null if nothing could be opened -- so the caller can say
 * something true rather than leave a control that appears to do nothing. `canOpenURL` is what
 * distinguishes "Spotify is installed" from "Spotify is not", and on iOS it only answers for
 * schemes declared in `LSApplicationQueriesSchemes`, which `app.json` declares.
 */
export async function playSong(
  title: string,
  artist: string,
  preferred?: MusicService,
): Promise<MusicService | null> {
  const order = preferred ? [preferred, ...SERVICES.filter((s) => s !== preferred)] : SERVICES;
  for (const service of order) {
    const url = musicUrl(service, title, artist);
    if (!url) return null;
    try {
      // An https URL always "can" open, which is why the app-scheme services are tried
      // first: the fallbacks would otherwise always win and the installed app never open.
      if (!(await Linking.canOpenURL(url))) continue;
      await Linking.openURL(url);
      return service;
    } catch {
      // Try the next one rather than failing the tap. A refused scheme is not an error.
    }
  }
  return null;
}

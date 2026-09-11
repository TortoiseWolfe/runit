import { Platform } from 'react-native';

import { musicUrl, SERVICES, serviceLabel } from './music';

/**
 * The half a device cannot test cheaply and the half that fails SILENTLY: a scheme the
 * platform does not register opens nothing and reports no error.
 */
describe('musicUrl', () => {
  const as = (os: string) => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  afterEach(() => as('ios'));

  it("uses Spotify's own scheme on a phone and https in a browser", () => {
    // A browser cannot open an app scheme, and a silent failure is the one outcome this
    // must not have.
    as('ios');
    expect(musicUrl('spotify', 'Dancing Queen', 'ABBA')).toBe('spotify:search:Dancing%20Queen%20ABBA');
    as('web');
    expect(musicUrl('spotify', 'Dancing Queen', 'ABBA')).toBe('https://open.spotify.com/search/Dancing%20Queen%20ABBA');
  });

  it('searches title AND artist, since a title alone is ambiguous', () => {
    // "Hurt" is Nine Inch Nails and Johnny Cash. The artist is what makes the first result
    // the song the guest meant.
    const url = musicUrl('apple', 'Hurt', 'Johnny Cash');
    expect(url).toContain('Hurt');
    expect(url).toContain('Johnny%20Cash');
  });

  it('still works when a guest gave no artist, because the field is optional', () => {
    const url = musicUrl('youtube', 'Dancing Queen', '');
    expect(url).toContain('Dancing%20Queen');
    expect(url).not.toContain('undefined');
  });

  it('is null when there is nothing to search for', () => {
    // The caller draws no control for null rather than one that cannot act.
    expect(musicUrl('spotify', '', '')).toBeNull();
    expect(musicUrl('spotify', '   ', '  ')).toBeNull();
  });

  it('encodes, so an ampersand in a title is not a truncated query', () => {
    const url = musicUrl('youtube', 'Peaches & Herb', 'Reunited');
    expect(url).toContain('%26');
  });

  it('every service has a label, because the toast names the one it used', () => {
    for (const s of SERVICES) expect(serviceLabel[s]).toBeTruthy();
  });
});

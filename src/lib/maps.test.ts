import { Platform } from 'react-native';

import { mapsUrl } from './maps';

/**
 * The interesting part of this module is a STRING, which is the half a device test cannot
 * see cheaply and the half that is easy to get wrong: a scheme the platform does not
 * register opens nothing, silently.
 */
describe('mapsUrl', () => {
  const as = (os: string) => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  };
  afterEach(() => as('ios'));

  it('uses the scheme each platform actually registers', () => {
    // `geo:` is Android's and iOS does not register it; `maps:` is Apple's and Android does
    // not. Getting this backwards opens nothing and reports no error.
    // An apostrophe is UNRESERVED in encodeURIComponent and comes through as itself -- my
    // first version of this assertion expected %27 and was wrong about the encoder, not
    // about the code.
    as('ios');
    expect(mapsUrl("Melva's")).toBe("maps:0,0?q=Melva's");
    as('android');
    expect(mapsUrl("Melva's")).toBe("geo:0,0?q=Melva's");
    as('web');
    expect(mapsUrl("Melva's")).toContain('https://www.google.com/maps/search/');
  });

  it('encodes, so a venue with an ampersand is not a truncated query', () => {
    as('android');
    const url = mapsUrl('Sam & Riley, 12 Main St');
    expect(url).toContain('%26');
    expect(url).not.toMatch(/q=[^&]*&[^=]*=/);
  });

  it('takes free text, because a venue is usually not an address', () => {
    // The whole argument against validating this field. These are the real inputs.
    for (const v of ["Melva's", 'The Barn at Willow Creek', 'my place', "Grandma's"]) {
      expect(mapsUrl(v)).toBeTruthy();
    }
  });

  it('is null when there is nowhere to send anybody', () => {
    // The caller draws no control for null. A Directions button on a blank venue is a
    // button that cannot act, which this repo does not draw.
    expect(mapsUrl('')).toBeNull();
    expect(mapsUrl('   ')).toBeNull();
  });
});

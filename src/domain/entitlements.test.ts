import { TIERS, TIER_ORDER, type TierFeatures, type TierLimits } from './tiers';
import {
  checkFeature, checkLimit, capLabel, firstTierWith, nextTierFor,
  type Entitlements,
} from './entitlements';

const ent = (tierId: keyof typeof TIERS, usage: Partial<Entitlements['usage']> = {}): Entitlements => ({
  tier: TIERS[tierId],
  usage: { guests: 0, hosts: 0, photosStored: 0, folders: 0, ...usage },
});

describe('the ladder is actually a ladder', () => {
  // The canvas lists features INCREMENTALLY -- the Venue card does not repeat
  // "unlimited photos". We spell every flag out rather than computing
  // inheritance by rank (inheritance breaks the moment one tier drops a
  // feature), so these two tests are what stop a typo silently taking a
  // feature away from a dearer tier.
  const featureKeys = Object.keys(TIERS.venue.features) as (keyof TierFeatures)[];
  it.each(featureKeys)('feature %s never disappears as tiers get dearer', (key) => {
    const seq = TIER_ORDER.map((t) => Number(TIERS[t].features[key]));
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
  });

  const limitKeys: (keyof TierLimits)[] = ['maxGuests', 'maxHosts', 'maxPhotos', 'maxFolders'];
  it.each(limitKeys)('limit %s never shrinks as tiers get dearer', (key) => {
    const seq = TIER_ORDER.map((t) => TIERS[t].limits[key] as number);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
  });

  // WAS `toHaveLength(5)`, because the canvas draws five rows in every pricing
  // column. That assertion turned a visual-balance rule into pressure to keep
  // writing lines, and the file obliged: eight of them named features nothing
  // enforced. Even columns are not worth advertising fiction for, so the rule is
  // now a range -- no column is empty, none overflows the design -- and the
  // audit in tools/audit-tier-claims.mjs guards what the lines may CLAIM.
  it('every tier states between three and five feature lines', () => {
    for (const t of TIER_ORDER) {
      expect(TIERS[t].featureLines.length).toBeGreaterThanOrEqual(3);
      expect(TIERS[t].featureLines.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('checkLimit', () => {
  it('allows under the cap and flags the last one', () => {
    expect(checkLimit(ent('party', { folders: 1 }), 'folders')).toEqual({ allowed: true, atCap: false });
    expect(checkLimit(ent('party', { folders: 2 }), 'folders')).toEqual({ allowed: true, atCap: true });
  });

  it('denies at the cap and names the cheapest sufficient tier', () => {
    const r = checkLimit(ent('party', { folders: 3 }), 'folders');
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.denial).toMatchObject({ kind: 'limit', limit: 'folders', current: 3, max: 3, upgradeTo: 'event' });
    }
  });

  it('treats Infinity limits as never capped', () => {
    expect(checkLimit(ent('event', { photosStored: 999_999 }), 'photos')).toEqual({ allowed: true, atCap: false });
  });

  it('has no upgrade path beyond the top tier', () => {
    const r = checkLimit(ent('venue', { guests: 3000 }), 'guests');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.denial.upgradeTo).toBeNull();
  });
});

describe('checkFeature', () => {
  it('gates moderation to Party and up', () => {
    expect(checkFeature(ent('house_party'), 'photoModeration').allowed).toBe(false);
    expect(checkFeature(ent('party'), 'photoModeration').allowed).toBe(true);
  });

  it('gates host roles and push to Event and up', () => {
    expect(checkFeature(ent('party'), 'hostRoles').allowed).toBe(false);
    expect(checkFeature(ent('event'), 'hostRoles').allowed).toBe(true);
    expect(firstTierWith('pushNotifications')).toBe('event');
  });

  // Venue used to grant this, and nothing read it -- so it granted nothing. The
  // flag stays in TierFeatures as the build target; `null` is the honest answer
  // until enforcement exists. Shipping request caps means flipping venue to true
  // AND adding a checkFeature call, and audit:tiers fails if only the first
  // happens. Change this line to `.toBe('venue')` on that day.
  it('does not yet grant request caps to any tier, because nothing enforces them', () => {
    expect(firstTierWith('requestCaps')).toBeNull();
  });
});

describe('the demo wedding', () => {
  // 180 guests is the number on the canvas. It matters: it puts the demo on a
  // tier where nothing is capped, so the entire gating layer is invisible
  // unless we also ship the house-party fixture.
  it('lands on Event, not Party', () => {
    expect(nextTierFor('guests', 180)).toBe('event');
  });
});

describe('capLabel', () => {
  it('reads as a fact, not a nag', () => {
    expect(capLabel(ent('party', { folders: 3 }), 'folders')).toBe('3 of 3');
  });
  it('is absent when the limit is unlimited', () => {
    expect(capLabel(ent('venue', { folders: 12 }), 'folders')).toBeNull();
  });
});

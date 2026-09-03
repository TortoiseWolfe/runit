/**
 * Tier gating.
 *
 * Pure functions -- no React, no repository. The repository calls them at the
 * point of the write, which is what stops a deep link, a retry, or a future web
 * client from routing around a check that only existed in a button handler.
 *
 * `upgradeTo` is the field that makes a paywall contextual instead of generic:
 * hitting the folder cap on Party yields 'event', so the screen can say
 * "You've used all 3 folders. Event gives you 10" rather than showing a price
 * list and hoping.
 */
import type { TierId } from '@/data/types';
import { TIERS, TIER_ORDER, type Tier, type TierFeatures, type TierLimits } from './tiers';

export interface Usage {
  guests: number;
  hosts: number;
  photosStored: number;
  folders: number;
}

export interface Entitlements {
  tier: Tier;
  usage: Usage;
}

export type LimitKey = 'guests' | 'hosts' | 'photos' | 'folders';

const LIMIT_FIELD: Record<LimitKey, keyof TierLimits> = {
  guests: 'maxGuests',
  hosts: 'maxHosts',
  photos: 'maxPhotos',
  folders: 'maxFolders',
};

const USAGE_FIELD: Record<LimitKey, keyof Usage> = {
  guests: 'guests',
  hosts: 'hosts',
  photos: 'photosStored',
  folders: 'folders',
};

export type EntitlementDenial =
  | {
      kind: 'limit';
      limit: LimitKey;
      current: number;
      max: number;
      tierId: TierId;
      upgradeTo: TierId | null;
    }
  | {
      kind: 'feature';
      feature: keyof TierFeatures;
      tierId: TierId;
      upgradeTo: TierId | null;
    };

export type Check =
  | { allowed: true; atCap: boolean }
  | { allowed: false; denial: EntitlementDenial };

/** The cheapest tier that would permit `needed` of `limit`. */
export function nextTierFor(limit: LimitKey, needed: number): TierId | null {
  return TIER_ORDER.find((t) => (TIERS[t].limits[LIMIT_FIELD[limit]] as number) >= needed) ?? null;
}

/** The cheapest tier that includes `feature`. */
export function firstTierWith(feature: keyof TierFeatures): TierId | null {
  return TIER_ORDER.find((t) => TIERS[t].features[feature]) ?? null;
}

/** Can we add `count` more of `limit`? */
export function checkLimit(e: Entitlements, limit: LimitKey, count = 1): Check {
  const max = e.tier.limits[LIMIT_FIELD[limit]] as number;
  const current = e.usage[USAGE_FIELD[limit]];
  if (current + count <= max) {
    return { allowed: true, atCap: current + count === max };
  }
  return {
    allowed: false,
    denial: {
      kind: 'limit',
      limit,
      current,
      max,
      tierId: e.tier.id,
      upgradeTo: nextTierFor(limit, current + count),
    },
  };
}

export function checkFeature(e: Entitlements, feature: keyof TierFeatures): Check {
  if (e.tier.features[feature]) return { allowed: true, atCap: false };
  return {
    allowed: false,
    denial: {
      kind: 'feature',
      feature,
      tierId: e.tier.id,
      upgradeTo: firstTierWith(feature),
    },
  };
}

/** `3 of 3 folders` -- the label a disabled countable control carries. */
export function capLabel(e: Entitlements, limit: LimitKey): string | null {
  const max = e.tier.limits[LIMIT_FIELD[limit]] as number;
  if (!Number.isFinite(max)) return null;
  return `${e.usage[USAGE_FIELD[limit]]} of ${max}`;
}

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
    }
  /**
   * The event's window has closed -- #41.
   *
   * A THIRD ARM RATHER THAN A `feature` OR A `limit`, because it is neither. A limit is a
   * COUNT you have run out of and a feature is a capability you never had; this is a
   * capability you HAD and time took away, and the sentence a person needs is different in
   * kind: nothing they delete will get it back.
   *
   * It is still an entitlement, which is why it lives here rather than becoming its own
   * error type -- `eventTtlHours` is null on every paid tier, so upgrading genuinely
   * reopens the event, and `upgradeTo` points at the tier that does it.
   */
  | {
      kind: 'closed';
      tierId: TierId;
      /** When it stopped accepting things, so the copy can say it rather than imply it. */
      closedAt: string;
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

/** The cheapest tier that never expires. */
export function firstTierWithoutExpiry(): TierId | null {
  return TIER_ORDER.find((t) => TIERS[t].limits.eventTtlHours === null) ?? null;
}

/**
 * Is this event still taking new things? -- #41.
 *
 * THE SERVER IS THE GATE AND THIS IS THE SENTENCE. `public.event_is_open()` is what
 * actually refuses the write, in the `with check` of every content policy and inside the
 * definer RPCs that bypass those policies. This exists so the refusal arrives as a sentence
 * naming what happened instead of as a bare row-level-security error -- a closed-event
 * refusal on `photos` is error 42501, which is the same code as every other RLS failure and
 * says nothing a person could act on.
 *
 * That split is the house rule rather than a special case: every cap here is computed
 * client-side for the message and enforced server-side for the truth.
 *
 * `now` is injectable because a window is a claim about time, and a test that cannot fix
 * the clock cannot assert one.
 */
export function checkOpen(
  e: Entitlements,
  startsAt: string,
  now: Date = new Date(),
): Check {
  const ttl = e.tier.limits.eventTtlHours;
  // Null is forever, the same convention every numeric cap here uses.
  if (ttl === null) return { allowed: true, atCap: false };

  const closesAt = new Date(startsAt).getTime() + ttl * 3_600_000;
  if (now.getTime() < closesAt) return { allowed: true, atCap: false };

  return {
    allowed: false,
    denial: {
      kind: 'closed',
      tierId: e.tier.id,
      closedAt: new Date(closesAt).toISOString(),
      upgradeTo: firstTierWithoutExpiry(),
    },
  };
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

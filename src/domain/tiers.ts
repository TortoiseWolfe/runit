/**
 * The pricing ladder.
 *
 * Marketing copy and enforced numbers live side by side deliberately, so a
 * pricing change is one diff and the paywall can never advertise a limit the
 * code does not enforce.
 *
 * `featureLines` WAS transcribed verbatim from the canvas, and that is exactly how
 * the file came to advertise eight things nothing enforces. A grep for each
 * TierFeatures key found `customBranding`, `venueBranding`, `zipExport`,
 * `requestCaps`, `multiDjQueues`, `folderTemplates`, `bulkQrPrinting` and
 * `prioritySupport` with ZERO call sites outside this file -- two of them on the
 * featured $79 tier. `albumRetentionDays` and `eventTtlHours` have none either, so
 * "Album kept 90 days" and "Event expires after 48h" were equally unbacked.
 *
 * Nobody could buy any of it, because the purchase path was cut from v1. That made
 * it harmless and would have made it mis-selling the day IAP shipped.
 *
 * THE RULE NOW: a line in `featureLines` names something this codebase enforces --
 * a limit `checkLimit` reads, or a feature `checkFeature` gates. The flags stay in
 * `TierFeatures` as the build target; the LINE comes back when the feature does.
 * `entitlements.test.ts` checks this, so the ladder cannot drift back into fiction.
 */
import type { TierId } from '@/data/types';

export interface TierLimits {
  maxGuests: number;
  maxHosts: number;
  maxPhotos: number;
  maxFolders: number;
  /** Free events go read-only after this many hours. Null = no expiry. */
  eventTtlHours: number | null;
  albumRetentionDays: number | null;
}

export interface TierFeatures {
  photoModeration: boolean;
  hostRoles: boolean;
  customBranding: boolean;
  venueBranding: boolean;
  pinnedAnnouncements: boolean;
  zipExport: boolean;
  requestCaps: boolean;
  multiDjQueues: boolean;
  folderTemplates: boolean;
  bulkQrPrinting: boolean;
  prioritySupport: boolean;
}

export interface Tier {
  id: TierId;
  name: string;
  scaleLabel: string;
  priceLabel: string;
  periodLabel: string;
  audience: string;
  featureLines: readonly string[];
  limits: TierLimits;
  features: TierFeatures;
  /** The footnote row under the pricing grid. */
  exampleLabel: string;
}

const INF = Number.POSITIVE_INFINITY;

export const TIERS: Record<TierId, Tier> = {
  house_party: {
    id: 'house_party',
    name: 'House party',
    scaleLabel: 'up to 10',
    priceLabel: 'Free',
    periodLabel: '',
    audience: 'Dinner parties, game night, a living-room DJ.',
    featureLines: [
      '1 host',
      'Chat, Photos, Music',
      '100 photos · 1 folder',
      'Requests, upvotes, play next',
    ],
    limits: { maxGuests: 10, maxHosts: 1, maxPhotos: 100, maxFolders: 1, eventTtlHours: 48, albumRetentionDays: null },
    features: {
      photoModeration: false, hostRoles: false, customBranding: false,
      venueBranding: false, pinnedAnnouncements: false,
      zipExport: false, requestCaps: false, multiDjQueues: false, folderTemplates: false,
      bulkQrPrinting: false, prioritySupport: false,
    },
    exampleLabel: '3 guests · living room',
  },
  party: {
    id: 'party',
    name: 'Party',
    scaleLabel: 'up to 50',
    priceLabel: '$19',
    periodLabel: '/ event',
    audience: 'Birthdays, reunions, backyard weddings.',
    featureLines: [
      'Up to 50 guests',
      '2 hosts',
      '1,000 photos · 3 folders',
      'Approve-before-show moderation',
    ],
    limits: { maxGuests: 50, maxHosts: 2, maxPhotos: 1000, maxFolders: 3, eventTtlHours: null, albumRetentionDays: 90 },
    features: {
      photoModeration: true, hostRoles: false, customBranding: false,
      venueBranding: false, pinnedAnnouncements: false,
      zipExport: false, requestCaps: false, multiDjQueues: false, folderTemplates: false,
      bulkQrPrinting: false, prioritySupport: false,
    },
    exampleLabel: '30 guests · birthday, dinner',
  },
  event: {
    id: 'event',
    name: 'Event',
    scaleLabel: 'up to 300',
    priceLabel: '$79',
    periodLabel: '/ event',
    audience: 'Weddings, corporate parties, one-off shows.',
    featureLines: [
      'Up to 300 guests',
      '5 hosts with roles (host, DJ, planner)',
      'Unlimited photos · 10 folders',
      'Pinned announcements',
    ],
    limits: { maxGuests: 300, maxHosts: 5, maxPhotos: INF, maxFolders: 10, eventTtlHours: null, albumRetentionDays: 365 },
    features: {
      photoModeration: true, hostRoles: true, customBranding: false,
      venueBranding: false, pinnedAnnouncements: true,
      zipExport: false, requestCaps: false, multiDjQueues: false, folderTemplates: false,
      bulkQrPrinting: false, prioritySupport: false,
    },
    exampleLabel: '300 guests · wedding, corporate',
  },
  venue: {
    id: 'venue',
    name: 'Venue',
    scaleLabel: 'up to 3,000',
    priceLabel: '$599',
    periodLabel: '/ year',
    audience: 'Venues, planners, DJs, festivals that run events every week.',
    featureLines: [
      'Up to 3,000 guests',
      'Unlimited hosts + staff seats',
      'Unlimited photos and folders',
    ],
    limits: { maxGuests: 3000, maxHosts: INF, maxPhotos: INF, maxFolders: INF, eventTtlHours: null, albumRetentionDays: null },
    features: {
      photoModeration: true, hostRoles: true, customBranding: false,
      venueBranding: false, pinnedAnnouncements: true,
      zipExport: false, requestCaps: false, multiDjQueues: false, folderTemplates: false,
      bulkQrPrinting: false, prioritySupport: false,
    },
    exampleLabel: '3,000 guests · festival, venue season',
  },
};

/** Cheapest to dearest. Drives both the pricing screen order and upgrade search. */
export const TIER_ORDER: readonly TierId[] = ['house_party', 'party', 'event', 'venue'];

export const TIER_RANK: Record<TierId, number> = TIER_ORDER.reduce(
  (acc, id, i) => ({ ...acc, [id]: i }),
  {} as Record<TierId, number>,
);

/** The canvas highlights "Event" with the neutral fill. */
export const FEATURED_TIER: TierId = 'event';

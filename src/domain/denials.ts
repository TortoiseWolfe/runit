import type { EntitlementDenial, LimitKey } from './entitlements';
import type { TierFeatures } from './tiers';

/**
 * The sentence a guest or host sees when a tier gate refuses something.
 *
 * WHY THIS IS NOT IN THE PRICING SCREEN ANY MORE. It used to be `REASON_COPY` inside
 * `features/pricing/PricingScreen.tsx`, which was the paywall's contextual headline.
 * The paywall is cut from v1 -- it advertised $19/$79/$599 with no purchase path
 * anywhere on the screen, which is a Guideline 3.1.1 and 2.1 problem, not a design one.
 *
 * The copy itself was never the problem, so it moved here rather than being rewritten,
 * and `useGuardedAction` now raises it as a toast instead of navigating. A denial still
 * names the specific thing that was refused; it just no longer tries to sell a fix.
 *
 * Living in `domain/` is deliberate: it sits beside the `tiers.ts` that produces the
 * denial, so a new limit and its sentence are one diff apart. `tiers.ts` already carries
 * that rule for the ladder itself.
 */

const LIMIT_COPY: Record<LimitKey, string> = {
  folders: 'You have used every folder this event allows.',
  photos: 'Your album is full.',
  hosts: 'Every host seat on this event is taken.',
  guests: 'This event has reached its guest limit.',
};

const FEATURE_COPY: Partial<Record<keyof TierFeatures, string>> = {
  hostRoles: 'Host roles are not enabled for this event.',
  pushNotifications: 'Push notifications are not enabled for this event.',
  zipExport: 'ZIP export is not enabled for this event.',
};

/**
 * Never returns empty. A denial the copy map has not met yet still has to say something
 * -- a silent refusal is the failure mode this whole path exists to prevent, and it is
 * exactly what shipped once already (see FIDELITY note on the unreachable paywall).
 */
export function denialMessage(denial: EntitlementDenial): string {
  if (denial.kind === 'limit') {
    return LIMIT_COPY[denial.limit] ?? `This event has reached its ${denial.limit} limit.`;
  }
  // #41. NOT phrased as a loss. Everything already here is still readable and still
  // savable -- only new things are refused -- and saying so is the difference between a
  // guest closing the app and a guest saving the photos before the retention clock runs.
  if (denial.kind === 'closed') {
    return 'This event has ended. Everything here is still yours to look at and save.';
  }
  return FEATURE_COPY[denial.feature] ?? 'That is not enabled for this event.';
}

import type { EventPreview } from '../../repository';
import type { RunitEvent } from '../../types';

/**
 * Narrow a seeded event to what `event_preview` would actually return.
 *
 * WHY THIS IS NOT `preview: someSeed.event`. That assignment typechecks --
 * `EventPreview` is a `Pick` of `RunitEvent`, and TypeScript only runs excess-property
 * checks on object literals -- but at runtime it hands the fixture the tier, the guest
 * count and the folder id, none of which the RPC returns. The fixture would then be
 * more generous than production, and a screen that read a count off a preview would
 * work in all 142 journeys and render `undefined` on a phone.
 *
 * Listing the fields is the point. This is the client-side copy of the projection in
 * `event_preview`, and if the two ever disagree it should take an edit here to do it.
 */
export function previewOf(e: RunitEvent): EventPreview {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    venue: e.venue,
    startsAt: e.startsAt,
    timezone: e.timezone,
    doorsLabel: e.doorsLabel,
  };
}

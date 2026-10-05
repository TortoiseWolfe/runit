/**
 * SPEC 012 -- what a new host should do first, decided from REAL STATE ONLY.
 *
 * A pure function, the same split as `deleteSheetState()` and `viewerControls`: the card
 * draws what this hands it and decides nothing. That is what lets the rules be unit-tested
 * against every pairing of counts, including the ones no seed reaches.
 *
 * NOTHING HERE IS TICKED BY A TAP ON THE CHECKLIST. Each item is an outcome a host can
 * cause from anywhere -- the share sheet, the event screen, the composer -- and the card
 * notices. A checklist that ticked itself when its own button was pressed would congratulate
 * a host for opening a share sheet she then dismissed.
 */
export type HostStartKey = 'invite' | 'announce' | 'plan';

export interface HostStartItem {
  key: HostStartKey;
  label: string;
  done: boolean;
}

export interface HostStartInput {
  invitedCount: number;
  guestCount: number;
  /** Announcements on the event, any author. */
  broadcasts: number;
  /** Rows in the run of show. */
  scheduleRows: number;
}

export interface HostStart {
  items: HostStartItem[];
  /** The one item whose button is drawn, or null when everything is done. */
  firstOpen: HostStartKey | null;
}

export function hostStartItems(input: HostStartInput): HostStart {
  const items: HostStartItem[] = [
    /*
     * INVITED OR JOINED, either one. Sharing from the phone's share sheet leaves no record
     * anywhere, so somebody arriving is the only proof that a share worked. This is the same
     * pairing `empty-room-share` was drawn on (#70), kept so that journey still holds.
     */
    { key: 'invite', label: 'Invite your guests', done: input.invitedCount > 0 || input.guestCount > 0 },
    { key: 'announce', label: 'Post a first announcement', done: input.broadcasts > 0 },
    { key: 'plan', label: 'Add the plan for the night', done: input.scheduleRows > 0 },
  ];
  return { items, firstOpen: items.find((i) => !i.done)?.key ?? null };
}

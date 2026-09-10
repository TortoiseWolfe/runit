import * as Contacts from 'expo-contacts';

/**
 * THE PHONE ALREADY KNOWS WHO TO INVITE -- #60.
 *
 * Before this, the only way an address reached a guest list was one at a time, typed into a
 * single field on a phone keyboard with no autocomplete. A host with forty relatives typed
 * forty addresses and got to check each one for typos, which is a good way to ship a list
 * nobody ever populates -- and a reusable guest list (#59) is worth nothing if building the
 * first one costs an evening.
 *
 * IT IS A PICKER, NOT A SYNC, AND THAT IS THE PRIVACY POSITION. `EventDetailsPanel` records
 * that a guest list is "the first personal data in the app beyond a chosen nickname, and it
 * is somebody else's". Reading the whole address book to a server would be a different
 * product. This asks the OS for a selection, keeps what the host chose, and never sees the
 * rest -- `presentContactPickerAsync` does not even require the READ_CONTACTS permission on
 * either platform, because the OS runs the UI and hands back one record.
 *
 * ONE AT A TIME IS THE OS'S RULE, NOT OURS. Apple's and Google's system pickers return a
 * single contact per presentation; there is no multi-select in the no-permission path. So
 * the caller loops, and the UI is built around "add another" rather than around a checklist.
 * The alternative -- `requestPermissionsAsync` plus `getContactsAsync` and our own list -- is
 * a full address-book read for a marginally nicer control, and that trade is not worth
 * making for somebody else's contacts.
 *
 * A CONTACT IS USUALLY A PHONE NUMBER. That is the whole reason `invitees.email` stopped
 * being `not null`: filtering to contacts that happen to have an email saved would silently
 * drop most of an address book and read as a broken picker.
 */
export interface PickedContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Opens the OS contact picker and returns what the host chose, or null if they backed out.
 *
 * Returns null rather than throwing on a dismissal, for the same reason `capture.ts` does:
 * backing out is a decision, not a failure, and a toast apologising for it is the app
 * arguing with the person using it.
 */
export async function pickContact(): Promise<PickedContact | null> {
  const contact = await Contacts.presentContactPickerAsync();
  if (!contact) return null;

  // FIRST OF EACH, and the ordering is the OS's own -- a contact carries several numbers and
  // several addresses, and the platforms put the primary one first. Asking the host which of
  // Aunt Sam's three numbers to use, forty times, is the friction this feature exists to
  // remove; a wrong pick costs one edit, and the row is editable.
  const phone = contact.phoneNumbers?.find((p) => p.number)?.number ?? null;
  const email = contact.emails?.find((e) => e.email)?.email ?? null;

  // A contact with a name and no way to reach them is not an invitee. The schema refuses it
  // too (`invitees_reachable`), and refusing here means the host learns immediately rather
  // than after a round trip.
  if (!phone && !email) return { name: contact.name ?? null, email: null, phone: null };

  return {
    name: contact.name?.trim() || null,
    email: email?.trim() || null,
    phone: phone?.trim() || null,
  };
}

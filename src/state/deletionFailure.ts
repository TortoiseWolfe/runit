import { JoinError } from '@/data/repository';

/**
 * WHAT A FAILED DELETE SAYS -- #115.
 *
 * Both deletions go through the `delete-account` Edge Function, and the adapter wraps any
 * failure in a `JoinError` whose sentence was written for the DOOR. A transport failure came
 * out as "Sign-in is unavailable right now. Your code is fine", and before that as the raw
 * supabase-js text "Failed to send a request to the Edge Function". Neither tells a host what
 * happened or what to do. Same rule as `JOIN_COPY`: the sentence carries the remedy.
 *
 * TRANSPORT IS DECIDED BY NAME, never by message. `FunctionsFetchError` is what functions-js
 * throws when the request never arrived (the CORS defect fixed in fe314db looked exactly like
 * this from a browser), and a `JoinError` with reason `offline` is auth-js's dead socket.
 */
export const DELETE_UNREACHABLE = {
  event: 'Could not reach RunIt to delete this. Check your connection and try again.',
  account: 'Could not reach RunIt to delete your account. Check your connection and try again.',
} as const;

export const DELETE_FAILED = {
  event: 'Could not delete this event. Try again in a moment.',
  account: 'Could not delete your account. Try again in a moment.',
} as const;

const nameOf = (e: unknown): unknown =>
  typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined;

export function deletionFailureMessage(e: unknown, what: 'event' | 'account'): string {
  const cause = typeof e === 'object' && e !== null ? (e as { cause?: unknown }).cause : undefined;
  const unreachable =
    nameOf(e) === 'FunctionsFetchError' ||
    nameOf(cause) === 'FunctionsFetchError' ||
    (e instanceof JoinError && e.reason === 'offline');
  return unreachable ? DELETE_UNREACHABLE[what] : DELETE_FAILED[what];
}

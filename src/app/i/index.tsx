import { Redirect } from 'expo-router';

/**
 * `/i/` with no code — a link that got truncated in a message, or a card that lost its
 * last characters to a fold.
 *
 * Without this the dynamic segment simply does not match and expo-router falls through to
 * `+not-found`, which tells someone holding a real invitation that the thing does not
 * exist. That is a different claim and a wrong one. They still have an event to get into;
 * they just have to type the code.
 *
 * The empty-code branch inside `[code].tsx` cannot cover this: a dynamic segment needs a
 * segment, so that file is never reached at all for this path.
 */
export default function InviteLinkNoCode() {
  return <Redirect href="/join" />;
}

import { JoinError } from '@/data/repository';
import { deletionFailureMessage } from './deletionFailure';

/** functions-js's transport failure, by the name it really carries. */
const fetchFailed = () =>
  Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' });
/** The function answered, and answered no. */
const refused = () =>
  Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError' });

describe('what a failed delete says (#115)', () => {
  it('turns an unreachable Edge Function into a sentence, wrapped the way the adapter throws it', () => {
    const wrapped = new JoinError('session_unavailable', { cause: fetchFailed() });
    expect(deletionFailureMessage(wrapped, 'event')).toBe(
      'Could not reach RunIt to delete this. Check your connection and try again.',
    );
    expect(deletionFailureMessage(wrapped, 'account')).toBe(
      'Could not reach RunIt to delete your account. Check your connection and try again.',
    );
  });

  it('says the same for the bare transport error and for a dead auth socket', () => {
    expect(deletionFailureMessage(fetchFailed(), 'event')).toBe(
      'Could not reach RunIt to delete this. Check your connection and try again.',
    );
    expect(deletionFailureMessage(new JoinError('offline'), 'event')).toBe(
      'Could not reach RunIt to delete this. Check your connection and try again.',
    );
  });

  it('never shows supabase-js text or the join door\'s sign-in sentence for a refused delete', () => {
    const wrapped = new JoinError('session_unavailable', { cause: refused() });
    const event = deletionFailureMessage(wrapped, 'event');
    const account = deletionFailureMessage(wrapped, 'account');
    expect(event).toBe('Could not delete this event. Try again in a moment.');
    expect(account).toBe('Could not delete your account. Try again in a moment.');
    for (const said of [event, account]) {
      expect(said).not.toContain('Edge Function');
      expect(said).not.toContain('Sign-in');
    }
  });
});

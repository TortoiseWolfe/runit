import { AppState, type AppStateStatus } from 'react-native';

import { attachAppStateBridge, type AppStateBridgeTarget } from './appStateBridge';

/**
 * The bridge is the app's ONLY self-heal path and its only cost control: it is what
 * closes eight Realtime channels when the phone goes in a pocket, and what reopens them.
 * It had no test. Every rule below is one its own docblock states and nothing checked.
 */
type Handler = (s: AppStateStatus) => void;

let detach: (() => void) | null = null;

function arm() {
  // jest-expo's AppState mock reports `currentState` as 'unknown', under which the bridge
  // (correctly) starts as not-active and the first 'background' is a no-op. A real phone
  // that has just mounted the root layout is active; say so.
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
  const remove = jest.fn();
  let handler: Handler | null = null;
  const spy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, h) => {
      handler = h as Handler;
      return { remove } as ReturnType<typeof AppState.addEventListener>;
    });
  spy.mockClear();
  const target: AppStateBridgeTarget = {
    suspend: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
  };
  const attach = (t: AppStateBridgeTarget = target) => (detach = attachAppStateBridge(t));
  return { spy, remove, target, attach, fire: (s: AppStateStatus) => handler?.(s) };
}

afterEach(() => {
  // The bridge keeps ONE listener per process in module state; leave none behind for the
  // next test to inherit, or a stale `remove` count leaks across cases.
  detach?.();
  detach = null;
  jest.restoreAllMocks();
});

describe('attachAppStateBridge', () => {
  it('suspends when the app leaves the foreground and resumes when it returns', () => {
    const { target, attach, fire } = arm();
    attach();
    fire('background');
    expect(target.suspend).toHaveBeenCalledTimes(1);
    fire('active');
    expect(target.resume).toHaveBeenCalledTimes(1);
  });

  /**
   * `inactive` IS not-active. iOS passes through it for the app switcher and for an
   * incoming call; treating only `background` as suspended leaves the socket open for
   * every one of those. Mutation-checked: `next === 'background'` turns this red.
   */
  it('treats inactive as leaving, not as a no-op', () => {
    const { target, attach, fire } = arm();
    attach();
    fire('inactive');
    expect(target.suspend).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a transition that does not change whether the app is active', () => {
    const { target, attach, fire } = arm();
    attach();
    fire('inactive');
    fire('background'); // still not active -- one suspend, not two
    expect(target.suspend).toHaveBeenCalledTimes(1);
    expect(target.resume).not.toHaveBeenCalled();
  });

  /**
   * ONE LISTENER PER PROCESS. The test suite creates many repositories; stacking a
   * listener per instance would suspend and resume every dead one on each transition.
   */
  it('replaces a previous registration rather than stacking a second listener', () => {
    const { spy, remove, target, attach, fire } = arm();
    attach();
    const second: AppStateBridgeTarget = {
      suspend: jest.fn().mockResolvedValue(undefined),
      resume: jest.fn().mockResolvedValue(undefined),
    };
    attach(second);
    expect(remove).toHaveBeenCalledTimes(1); // the first subscription was torn down
    expect(spy).toHaveBeenCalledTimes(2);
    fire('background');
    expect(second.suspend).toHaveBeenCalledTimes(1);
    expect(target.suspend).not.toHaveBeenCalled();
  });

  it('detaches cleanly, and a later detach of a replaced bridge does not remove its successor', () => {
    const { remove, target, attach } = arm();
    const detachFirst = attach();
    attachAppStateBridge(target); // replaces: remove() called once here
    detachFirst(); // the first sub's remove() again -- must not null the CURRENT one
    expect(remove).toHaveBeenCalledTimes(2);
  });

  /**
   * A rejected resume is WARNED, never thrown: React Native gives no way to hold the app
   * open until a promise settles, and an unhandled rejection here would crash the app on
   * its way to the foreground -- on the one path that exists to heal it.
   */
  it('reports a failed resume instead of throwing it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { target, attach, fire } = arm();
    (target.resume as jest.Mock).mockRejectedValue(new Error('token refresh failed'));
    attach();
    fire('background');
    fire('active');
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not reconnect/), expect.any(Error));
  });
});

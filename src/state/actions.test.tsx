import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import type { Observable, RunitRepository } from '@/data/repository';
import type { Entitlements } from '@/domain/entitlements';
import { TIERS } from '@/domain/tiers';
import { capturePhoto } from '@/lib/capture';
import {
  ACTION_FAILED, CAMERA_FAILED, PHOTO_NOT_ADDED,
  useGuardedAction, useHostActions, useMusicActions, usePhotoActions,
} from './actions';
import { RepositoryProvider } from './RepositoryProvider';
import { ToastProvider, useToastState } from './ToastProvider';

/**
 * #135 AND #136: A TAP THAT FAILS MUST SAY SO.
 *
 * Both reports came from an iPhone on build 18, where a guest who reopened her party from
 * "Your events" held no guest id (#116). The camera opened, the photo was taken, and then
 * `photos.upload` threw before any tile existed. `useGuardedAction` handled `EntitlementError`
 * and RE-THREW everything else, so the throw left `capture`, left the shutter's `onPress`, and
 * became an unhandled rejection: no tile, no toast, a photo that simply vanished. A song request
 * died the same way. #116 fixed that one cause; this pins the class, so the next cause cannot
 * be silent either.
 */
jest.mock('@/lib/capture', () => ({ capturePhoto: jest.fn() }));
// expo-router ships ESM jest cannot load, and nothing here navigates. The contacts and push
// halves load native modules jest-expo cannot construct; nothing here touches either.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/lib/contacts', () => ({ canPickContacts: jest.fn(), pickContact: jest.fn() }));
jest.mock('@/lib/push', () => ({ registerForPush: jest.fn() }));
const mockedCapture = capturePhoto as jest.MockedFunction<typeof capturePhoto>;

type Actions = {
  guarded: ReturnType<typeof useGuardedAction>;
  photos: ReturnType<typeof usePhotoActions>;
  music: ReturnType<typeof useMusicActions>;
  hosts: ReturnType<typeof useHostActions>;
};

let actions: Actions;
/** Hands the hooks' output out in an effect: assigning it during render is a side effect. */
function Probe({ onActions }: { onActions: (a: Actions) => void }) {
  const a: Actions = {
    guarded: useGuardedAction(),
    photos: usePhotoActions(),
    music: useMusicActions(),
    hosts: useHostActions(),
  };
  useEffect(() => {
    onActions(a);
  });
  return null;
}
function ToastText() {
  const t = useToastState();
  return <Text testID="toast">{t?.text ?? 'none'}</Text>;
}

const toast = () => screen.getByTestId('toast').props.children as string;

/**
 * THE INTERFACE, NOT AN ADAPTER. `src/state` may not import one (the seam rule in
 * eslint.config.js), and these tests are about what the ACTIONS do with a throw, whoever throws
 * it. Only the members the actions under test reach are present; a plan with room for photos
 * keeps the advisory cap check out of the way.
 */
const constant = <T,>(value: T): Observable<T> => ({ get: () => value, subscribe: () => () => {} });
const roomy: Entitlements = {
  tier: TIERS.event,
  usage: { guests: 1, hosts: 1, photosStored: 0, folders: 1 },
};

async function mount() {
  const repo = {
    entitlements: constant(roomy),
    photos: { upload: jest.fn() },
    music: { request: jest.fn() },
    hosts: { invite: jest.fn() },
  };
  await render(
    <RepositoryProvider repository={repo as unknown as RunitRepository}>
      <ToastProvider>
        <Probe
          onActions={(a) => {
            actions = a;
          }}
        />
        <ToastText />
      </ToastProvider>
    </RepositoryProvider>,
  );
  return repo;
}

/** Run an action the way an `onPress` does: nobody awaits it, so a rejection is lost. */
async function tap<T>(fn: () => Promise<T>): Promise<T> {
  let out!: T;
  await act(async () => {
    out = await fn();
  });
  return out;
}

beforeEach(() => {
  mockedCapture.mockReset();
  // The real error is logged for whoever reads the device log; the test only cares what the
  // person was told.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('useGuardedAction (#135, #136)', () => {
  it('says a failure that is not a denial out loud and reports false, instead of re-throwing it', async () => {
    await mount();
    const ok = await tap(() =>
      actions.guarded(() => Promise.reject(new Error('Not joined as a guest yet.'))),
    );
    expect(ok).toBe(false);
    expect(toast()).toBe(ACTION_FAILED);
  });

  it('takes the caller’s own sentence for that failure', async () => {
    await mount();
    const ok = await tap(() =>
      actions.guarded(() => Promise.reject(new Error('anything')), 'Could not do that one thing.'),
    );
    expect(ok).toBe(false);
    expect(toast()).toBe('Could not do that one thing.');
  });
});

describe('taking a photo (#135: "I can’t see the pictures I just took")', () => {
  it('says the photo was not added when the upload is refused before any tile exists', async () => {
    const repo = await mount();
    mockedCapture.mockResolvedValue({ uri: 'file:///shot.jpg', width: 1600, height: 1200, thumbUri: null });
    // Build 18's #116 seat: the repository refuses before the overlay has a tile to draw.
    repo.photos.upload.mockRejectedValue(new Error('Not joined as a guest yet.'));

    await tap(() => actions.photos.capture('All photos'));

    expect(toast()).toBe(PHOTO_NOT_ADDED);
  });

  it('says so when the camera or the resize throws, rather than dropping the shot silently', async () => {
    await mount();
    mockedCapture.mockRejectedValue(new Error('capture: the decoded image reported no size (0x0)'));

    await tap(() => actions.photos.capture('All photos'));

    expect(toast()).toBe(CAMERA_FAILED);
  });

  it('still says nothing when the guest backs out of the camera', async () => {
    await mount();
    mockedCapture.mockResolvedValue(null);

    await tap(() => actions.photos.capture('All photos'));

    expect(toast()).toBe('none');
  });
});

describe('requesting a song (#136)', () => {
  it('keeps the draft and says the request did not go through when the adapter throws', async () => {
    const repo = await mount();
    repo.music.request.mockRejectedValue(new Error('Not joined as a guest yet.'));

    const landed = await tap(() => actions.music.request('Dancing Queen – ABBA'));

    expect(landed).toBe(false);
    expect(toast()).toBe(ACTION_FAILED);
  });
});

describe('inviting a co-host', () => {
  // A REGRESSION GUARD, green before and after. `invite` was the one caller that wrapped
  // `guarded` in its own catch to surface the adapter's sentence; that sentence must survive
  // `guarded` no longer throwing.
  it('still shows the adapter’s own sentence for a refusal', async () => {
    const repo = await mount();
    repo.hosts.invite.mockRejectedValue(new Error('A co-host needs a name and a role.'));

    const minted = await tap(() => actions.hosts.invite({ displayName: '', role: 'host' }));

    expect(minted).toBeNull();
    expect(toast()).toBe('A co-host needs a name and a role.');
  });
});

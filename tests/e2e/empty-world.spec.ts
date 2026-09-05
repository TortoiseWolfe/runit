import { expect, test } from '@playwright/test';

import { open } from './helpers';

/**
 * The world the app actually launches into, which nothing tested until now.
 *
 * `events_read` admits members only, so against Supabase `event.current` is null until
 * joinAsGuest returns. Every other spec in this directory boots `weddingSeed`, so the
 * join screen always had a name, a date and a working calendar pill. The state a real
 * guest sees on a cold open had never been rendered in a single test -- and
 * join.spec.ts CLICKS that pill and passes, because in the only world it can build the
 * pill works.
 *
 * Three separate device reports came out of that one gap: "+ Add to calendar does
 * nothing", "press Show QR and nothing happens", "press Share Invite nothing happens".
 * All three are `disabled={!event}`. Not broken handlers -- disabled buttons.
 *
 * `?empty=1` boots the same screens with no event, so the dead half of that boolean is
 * finally reachable.
 */
test.describe('the app opened cold, before any event exists', () => {
  /**
   * THE CLASS ASSERTION, and the one worth keeping.
   *
   * react-native-web renders a disabled Pressable as `aria-disabled="true"`, so this is
   * a fact about the DOM rather than a heuristic. Anything a person can see and cannot
   * use is a bug report waiting to happen: it reads as broken software, and it costs a
   * round trip through a device to discover.
   *
   * If a control genuinely must be disabled, name it here deliberately -- an exception
   * with a reason, not an accident.
   */
  test('shows nothing a person can tap but not use', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?empty=1');

    await expect(page.getByTestId('join-submit')).toBeVisible();
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  test('does not offer a calendar entry for an event it cannot name', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?empty=1');

    // The pill promises an .ics for an event with no name, no date and no venue. Either
    // it should not be here, or it should have something to offer.
    await expect(page.getByTestId('join-add-calendar')).toHaveCount(0);
  });

  test('a guest can still type a code and try, which is the whole point of the screen', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?empty=1');

    await expect(page.getByTestId('join-code')).toBeVisible();
    await expect(page.getByTestId('join-code')).toHaveValue('');
    await expect(page.getByTestId('join-submit')).toBeEnabled();
  });
});

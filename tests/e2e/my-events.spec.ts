import { expect, test } from '@playwright/test';

import { joinAsGuest, open, switchToHost } from './helpers';

/**
 * #17 — the events this identity hosts, and the way back into one.
 *
 * `create_event` has allowed TEN events per identity since it shipped, and nothing could
 * list them. The anonymous session persists across restarts, so a host who closed the app
 * kept her identity and lost `event.current`: her only route back to a party she had made
 * was to remember the six-character code she gave her guests. The schema was never the
 * blocker; the screen was.
 *
 * WHAT THESE CAN AND CANNOT PROVE, said plainly rather than implied. `weddingSeed` holds
 * two hosted events, and the switch moves to one whose collections are EMPTY -- Memory
 * carries a single event's broadcasts, songs and photos, so `open()` cannot furnish a
 * second evening. That is a true statement about the adapter and not a pretend party, and
 * it is why these assert the LIST and the SWITCH rather than the content on the far side.
 * The same honesty as `invitation.spec.ts`, which proves the invitation screen and says it
 * cannot prove the join that follows.
 *
 * The identity in `weddingSeed` holds a host seat at the wedding -- which is what
 * `role-switch` being reachable in that world already means -- so the list appearing for
 * it is correct rather than a fixture leaking somebody else's events.
 */
test.describe('the events this identity hosts', () => {
  test('the join screen offers a way back into a party you already run', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // `?hosting=1`: two events made, standing in neither. Where every host is the second
    // time she opens the app, and a state no world could reach before this one.
    await open(page, scheme, '/join?hosting=1');

    const list = page.getByTestId('my-events');
    await expect(list).toBeVisible();
    // Both parties, and the one she is standing in is among them rather than filtered
    // out -- a host with a single event would otherwise meet an empty box.
    await expect(page.getByTestId('my-event-SR1017')).toBeVisible();
    await expect(page.getByTestId('my-event-RH2210')).toBeVisible();
    await expect(list).toContainText('Rehearsal Dinner');
    });

  test('it names the seat and the headcount, not just the party', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?hosting=1');
    // The role LABEL, which is the free-text one a person recognises ('Bride'), not the
    // permission grade underneath it.
    await expect(page.getByTestId('my-event-SR1017')).toContainText('Bride');
    // 172 rather than 173: guest_seats() excludes staff, and this is the same number the
    // header pill shows. A list that disagreed with the screen it leads to would be worse
    // than no list.
    await expect(page.getByTestId('my-event-SR1017')).toContainText('172 guests');
    });

  test('tapping the other one opens it, and lands in the host console', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?hosting=1');
    await page.getByTestId('my-event-RH2210').click();

    // The console, because `open` leaves her holding a host seat and that is where the
    // seat is useful. Landing her on the guest chat of a party she runs would be a step
    // backwards from the row she tapped.
    await expect(page.getByTestId('host-broadcast')).toBeVisible();
    await page.getByTestId('host-segment-event').click();
    await expect(page.getByTestId('host-event-details')).toContainText('Rehearsal Dinner');
    });

  test('the event you are already in is not a control, so nothing looks broken', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // The console, not the join screen: there the current event IS the headline, so the
    // list leaves it out. Here the list is the map of where you are, so it marks it.
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();

    const here = page.getByTestId('my-event-SR1017');
    await expect(here).toContainText('Here');
    // A View rather than a disabled Pressable, deliberately: empty-world.spec.ts counts
    // aria-disabled across a screen to prove no dead controls ship, and a correctly inert
    // row would read there as one more dead button.
    expect(await here.getAttribute('aria-disabled')).toBeNull();
  });

  test('the join screen does not print the event you are in twice', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    // `weddingSeed` has an event AND hosts two. The invitation heading already names this
    // one, so the list leaves it out -- printing it again reads as a bug, and join.spec.ts
    // asserts that name appears exactly once.
    await expect(page.getByText("Sam & Riley's Wedding", { exact: true })).toHaveCount(1);
    await expect(page.getByTestId('my-event-SR1017')).toHaveCount(0);
    // The OTHER one is still offered, which is the point of showing a list here at all.
    await expect(page.getByTestId('my-event-RH2210')).toBeVisible();
  });

  test('a guest who hosts nothing is offered nothing', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // The common case, and the one a promise on the join screen would be worst for:
    // most people opening this app are guests, and an empty "Your events" heading would
    // be a claim the app does not mean.
    await open(page, scheme, '/join?empty=1');
    await expect(page.getByTestId('my-events')).toHaveCount(0);
  });
});

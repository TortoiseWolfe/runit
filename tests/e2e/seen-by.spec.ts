import { expect, test, type Page } from '@playwright/test';

import { joinAsGuest, switchToHost } from './helpers';

/**
 * "seen by N" under an announcement -- issue #24.
 *
 * `broadcast_reads` shipped in the first migration with a policy AND a fold trigger and
 * NO WRITER, so `seen_count` summed an empty table and every announcement read **seen by
 * 0** forever, under the host's own eyes, however many people opened it. The migration's
 * debt note offered two exits: write `chat.markRead()`, or stop rendering the number.
 *
 * WHAT MAKES THIS HARD ENOUGH TO BE A FILE. The number is only worth anything if it
 * counts people who SAW the announcement. Marking on load counts fetches -- open the tab
 * and six announcements you never scrolled to are "read" -- so `ChatScreen` measures the
 * viewport and marks what overlaps it. These tests are about that distinction, which is
 * why one of them scrolls and the assertion before the scroll is the load-bearing half.
 *
 * WHAT THIS FILE CANNOT PROVE. It runs MemoryRepository, where there is exactly ONE
 * reader, so an increment here is this device and nothing else; against Postgres the fold
 * counts every guest's row. The rule that a host's own read does not count is mirrored in
 * the fixture and enforced in `fold_seen_count`, and only Lane E can watch the real one.
 */

/** The seeded counts, from src/data/memory/fixtures/wedding.ts. */
const SEEDED = { jordan: 162, riley: 171, marco: 158 };

/** Every "seen by N" in the host's broadcast panel, in render order. */
async function seenCounts(page: Page): Promise<number[]> {
  const text = await page.getByTestId('host-broadcast').innerText();
  return [...text.matchAll(/seen by (\d+)/g)].map((m) => Number(m[1]));
}

/**
 * Bodies that push the feed past a screenful. Six, because three seeded announcements
 * already fit at 402x874 -- a feed that does not overflow cannot be scrolled, and a test
 * that cannot scroll cannot tell a viewport sweep from a marking-on-load.
 */
const EXTRA = ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'];

/** Post EXTRA from the host console and come back to the guest feed. */
async function extraAnnouncements(page: Page) {
  await switchToHost(page);
  for (const body of EXTRA) {
    await page.getByTestId('broadcast-draft').fill(body);
    await page.getByTestId('broadcast-send').click();
  }
  await page.getByTestId('role-switch').click();
  await expect(page.getByTestId('chat-feed')).toBeVisible();
}

/** Drive the guest feed to the bottom, the way a thumb does. */
async function scrollFeedToEnd(page: Page) {
  await page.getByTestId('chat-feed').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(120);
}

test.describe('an announcement counts who actually saw it', () => {
  test('reading the feed moves every number that was on screen', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    // All three seeded announcements fit at 402x874, so all three move by exactly one.
    // The three seeded values differ from each other, which is what makes this an
    // assertion about each row rather than about a total.
    expect(await seenCounts(page)).toEqual([
      SEEDED.marco + 1,
      SEEDED.riley + 1,
      SEEDED.jordan + 1,
    ]);
  });

  test('and counts a reader once, not once per glance', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    // THE FEED HAS TO OVERFLOW OR THIS TEST PROVES NOTHING. The three seeded
    // announcements fit at 402x874, so `scrollTop = scrollHeight` moves nothing, fires no
    // scroll event, and runs no second sweep -- an earlier version of this test passed
    // with the deduplication removed from BOTH the screen and the adapter, which is the
    // exact assertion this suite exists to not contain. Measured, not reasoned.
    await extraAnnouncements(page);

    await scrollFeedToEnd(page);
    await page.getByTestId('chat-feed').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(120);
    await scrollFeedToEnd(page);

    await switchToHost(page);
    const counts = await seenCounts(page);
    // Six sweeps over the same rows. Without the sent-set in the screen and the dedupe in
    // the adapter, this is where "seen by 172" becomes "seen by 400".
    expect(counts.slice(0, EXTRA.length)).toEqual(EXTRA.map(() => 1));
    expect(counts.slice(EXTRA.length)).toEqual([
      SEEDED.marco + 1,
      SEEDED.riley + 1,
      SEEDED.jordan + 1,
    ]);
  });

  test('an announcement below the fold is not read until you scroll to it', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    // New announcements land at the end of the feed, which is exactly where a guest who
    // opens the tab is not looking.
    await extraAnnouncements(page);
    await switchToHost(page);
    const before = await seenCounts(page);
    // THE LOAD-BEARING ASSERTION IN THIS FILE. If marking fired on load, every one of
    // these would already be 1 -- and the number would be counting fetches, which is the
    // failure mode that makes a "seen by" worse than useless.
    expect(before.filter((n) => n === 0).length).toBeGreaterThan(0);

    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await scrollFeedToEnd(page);

    await switchToHost(page);
    expect(await seenCounts(page)).not.toEqual(before);
    expect((await seenCounts(page)).filter((n) => n === 0)).toEqual([]);
  });
});

test.describe('the author is not an audience', () => {
  test('a host reading her own announcement does not count as a reader', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await page.goto('/create');
    await expect(page.getByTestId('scheme-probe')).toHaveText(scheme, { timeout: 20_000 });
    await page.getByTestId('create-host-name').fill('Ruth');
    await page.getByTestId('create-name').fill("Ruth's 40th");
    await page.getByTestId('create-date').fill('2026-09-11');
    await page.getByTestId('create-time').fill('19:00');
    await page.getByTestId('create-venue').fill('The garden');
    await page.getByTestId('create-doors').fill('Doors 7:00 PM');
    await page.getByTestId('create-submit').click();
    await page.getByTestId('created-continue').click();

    await page.getByTestId('broadcast-draft').fill('Cake at nine.');
    await page.getByTestId('broadcast-send').click();
    expect(await seenCounts(page)).toEqual([0]);

    // She takes a seat to look at her own feed (#37) -- and a seat held by a host of this
    // event is excluded from the fold, so this is the same rule as "N already here" not
    // counting her. An announcement reading "seen by 1" the moment its author looks at it
    // is a lie the host would believe.
    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await scrollFeedToEnd(page);

    await switchToHost(page);
    expect(await seenCounts(page)).toEqual([0]);
  });
});

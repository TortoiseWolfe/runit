import { expect, test, type Page } from '@playwright/test';

import { joinAsGuest, open, switchToHost } from './helpers';

/**
 * RUNIT ON A DESKTOP -- and until 2026-09-21 no test here had ever looked at one.
 *
 * Every screenshot and journey ran at 402x874, the phone the canvas was drawn for. The owner
 * opened the live site on a 1920px monitor and found every field and button stretched ~1850px
 * wide, the create-key screen crammed into the top-left corner over an empty void, and the host
 * console's actions reading as faint full-width boxes rather than buttons. "A confusing mess",
 * in their words, and entirely invisible to a suite that only ever rendered a phone.
 *
 * WHAT THIS ASSERTS IS NARROW ON PURPOSE: no text field and no button is wider than the content
 * column. Not that the page "looks right" -- that is Lane D's job, reading the desktop
 * screenshots -- but the one measurable property whose absence produced what the owner saw.
 * `getBoundingClientRect()` is honest here for the reason the gutter gate gives: react-native-web
 * renders layout as real CSS on real elements, so the width is where the pixels actually are.
 */

/** `contentMaxWidth` in src/theme/layout.ts. A spec cannot import from src/, so it is named once. */
const COLUMN = 560;
const DESKTOP = { width: 1280, height: 800 };

test.use({ viewport: DESKTOP });

async function widest(page: Page, selector: string): Promise<{ id: string; width: number }> {
  return page.evaluate((sel) => {
    let best = { id: '(none)', width: 0 };
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      // Hidden and stale screens report zero width; expo-router keeps popped screens mounted.
      if (r.width > best.width && r.height > 0) {
        best = { id: el.getAttribute('data-testid') ?? el.tagName, width: Math.round(r.width) };
      }
    }
    return best;
  }, selector);
}

const FIELDS = 'input, textarea';
const BUTTONS = '[role="button"]';

test.describe('a desktop browser gets a column, not a stretched phone', () => {
  test('the join screen keeps its fields and buttons inside the column', async ({ page }, testInfo) => {
    await open(page, testInfo.project.name as 'dark' | 'light');
    const field = await widest(page, FIELDS);
    const button = await widest(page, BUTTONS);
    expect(field.width, `widest field: ${field.id}`).toBeLessThanOrEqual(COLUMN);
    expect(button.width, `widest button: ${button.id}`).toBeLessThanOrEqual(COLUMN);
  });

  test('the host console keeps its fields and buttons inside the column', async ({ page }, testInfo) => {
    await joinAsGuest(page, testInfo.project.name as 'dark' | 'light');
    await switchToHost(page);
    await page.locator('[data-testid="host-segment-event"]:visible').click();
    // "Who is invited" opens itself while the list is empty, but reach it either way.
    if (!(await page.locator('[data-testid="invitee-email"]:visible').count())) {
      await page.locator('[data-testid="invitees-toggle"]:visible').click();
    }
    await expect(page.locator('[data-testid="invitee-email"]:visible')).toHaveCount(1);
    const field = await widest(page, FIELDS);
    const button = await widest(page, BUTTONS);
    expect(field.width, `widest field: ${field.id}`).toBeLessThanOrEqual(COLUMN);
    expect(button.width, `widest button: ${button.id}`).toBeLessThanOrEqual(COLUMN);
  });
});

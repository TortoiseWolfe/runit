import { expect, type Page } from '@playwright/test';

/** The seeded event, from src/data/memory/fixtures/wedding.ts. */
export const WEDDING = {
  code: 'SR1017',
  name: "Sam & Riley's Wedding",
  /** People in the room. Becomes 173 once you join. */
  present: 172,
  /** People invited. The host broadcasts to this number, not the one above. */
  invited: 180,
} as const;

/**
 * Wait for the app to resolve the colour scheme before asserting anything.
 *
 * The export is a SPA, so the first paint precedes hydration. Without this,
 * fast assertions race the mount. `scheme-probe` renders client-side only and
 * exists solely for this, in EXPO_PUBLIC_FIDELITY builds.
 */
export async function ready(page: Page, scheme: 'dark' | 'light') {
  await expect(page.getByTestId('scheme-probe')).toHaveText(scheme, { timeout: 20_000 });
}

/** Land on the join screen with the app hydrated. */
export async function open(page: Page, scheme: 'dark' | 'light', path = '/join') {
  // `path` is a parameter so a test can arrive the way a guest tapping an invite does,
  // with the code in the query string. Every existing caller keeps the default.
  await page.goto(path);
  await ready(page, scheme);
  await expect(page.getByTestId('join-submit')).toBeVisible();
}

/** Join as a guest and land on Chat. */
export async function joinAsGuest(page: Page, scheme: 'dark' | 'light', nickname = 'Ada') {
  await open(page, scheme);
  await page.getByTestId('join-nickname').fill(nickname);
  await page.getByTestId('join-submit').click();
  await expect(page.getByTestId('chat-feed')).toBeVisible();
}

/** Cross from the guest app into the host console. */
export async function switchToHost(page: Page) {
  await page.getByTestId('role-switch').click();
  await expect(page.getByTestId('host-broadcast')).toBeVisible();
}

/** Read a vote count off a queue row, e.g. voteCount(page, 'req_2') -> 37. */
export async function voteCount(page: Page, requestId: string): Promise<number> {
  const text = await page.getByTestId(`vote-${requestId}`).innerText();
  return Number(text.replace(/[^\d]/g, ''));
}

/**
 * The design's own token values, converted from oklch.
 * Kept here so a spec can assert a painted colour rather than a class name.
 */
export const TOKENS = {
  dark: { base100: 'rgb(26, 26, 46)', primary: 'rgb(168, 178, 193)', secondary: 'rgb(232, 212, 184)' },
  light: { base100: 'rgb(245, 240, 235)', primary: 'rgb(69, 80, 96)', secondary: 'rgb(133, 58, 13)' },
} as const;

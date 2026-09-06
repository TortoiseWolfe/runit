import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the Expo web export.
 *
 * WHAT THIS IS EVIDENCE FOR, AND WHAT IT IS NOT.
 *
 * These run through react-native-web, so they prove layout LOGIC, copy, routing
 * and the state machine. They are NOT evidence about native layout: the album
 * grid once rendered nine tiles here and nothing at all on a device
 * (design/FIDELITY.md note G). Treat a green run accordingly, and use
 * `pnpm android` for anything layout-shaped.
 *
 * The viewport is the design's artboard exactly -- 402x874, iPhone 16 Pro --
 * so assertions about wrapping and truncation mean something.
 *
 * REQUIRES a dist/ built with EXPO_PUBLIC_FIDELITY=1 (`pnpm export:web` sets
 * it). That flag does two things the suite depends on: it injects real iPhone
 * safe-area insets, which the browser otherwise reports as zeros, and it
 * renders the `scheme-probe` element that helpers' ready() waits on. Built
 * without it, every test times out on its first await rather than failing
 * with anything that names the cause.
 */
const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  /**
   * PLAYWRIGHT DELETES ITS OUTPUT DIRECTORY AT THE START OF EVERY RUN, unconditionally --
   * `createRemoveOutputDirsTask` runs in setup regardless of `preserveOutput`. `run-checks.sh`
   * runs `pnpm shots` BEFORE the journeys, so anything the standalone lanes wrote into the
   * default `test-results/` would be wiped before CI could upload it. Giving the journeys
   * their own subtree lets the lanes keep siblings; `.gitignore` already covers the root.
   */
  outputDir: 'test-results/journeys',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 3,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'dark', use: { colorScheme: 'dark' } },
    { name: 'light', use: { colorScheme: 'light' } },
  ],

  webServer: {
    command: `PORT=${PORT} node tools/serve-dist.mjs`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

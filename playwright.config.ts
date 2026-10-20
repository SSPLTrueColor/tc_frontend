import { defineConfig } from '@playwright/test';

/** Settings stress tests (docs/SETTINGS-QA.md). Run the dev server first: `npm run dev`, then `BASE_URL=http://localhost:5173 npx playwright test`. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  workers: 4,
  reporter: [['list'], ['json', { outputFile: 'e2e/results.json' }]],
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:5175', headless: true, screenshot: 'only-on-failure' },
});

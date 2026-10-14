import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:4315', headless: true },
  webServer: { command: 'node tests/fixture.js', url: 'http://127.0.0.1:4315', reuseExistingServer: false },
  workers: 1
});

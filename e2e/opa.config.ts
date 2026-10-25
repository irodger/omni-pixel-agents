import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './opa',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5178',
    channel: process.env.OPA_TEST_BROWSER_CHANNEL || undefined,
  },
  webServer: {
    command: 'npm run dev --workspace webview-ui -- --host 127.0.0.1 --port 5178',
    url: 'http://127.0.0.1:5178',
    reuseExistingServer: false,
  },
  reporter: 'list',
});

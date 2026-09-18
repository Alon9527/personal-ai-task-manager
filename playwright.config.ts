import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  tsconfig: './tests/e2e/tsconfig.json',
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    port: 3000,
    reuseExistingServer: true,
  },
})

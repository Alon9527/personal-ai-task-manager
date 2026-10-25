import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  tsconfig: './tsconfig.json', testDir: '.', testMatch: 'agent-conversation.spec.ts',
  outputDir: '../../test-results/agent-conversation', workers: 1,
  use: { baseURL: 'http://127.0.0.1:51329', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'compact', use: { browserName: 'chromium', viewport: { width:1366, height:768 } } },
    { name: 'full', use: { browserName: 'chromium', viewport: { width:1920, height:1080 } } },
  ],
  webServer: { command:'node tests/e2e/serve-agent-build.mjs', cwd:fileURLToPath(new URL('../..', import.meta.url)), url:'http://127.0.0.1:51329', reuseExistingServer:false },
})

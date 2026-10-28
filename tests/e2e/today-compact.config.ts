import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  tsconfig:'./tsconfig.json', testDir:'.', testMatch:['today-compact.spec.ts','task-delete-entry.spec.ts','core-workspace-actions.spec.ts'],
  outputDir:'../../test-results/today-compact-20261028', workers:1,
  use:{baseURL:'http://127.0.0.1:51329',screenshot:'only-on-failure',trace:'retain-on-failure'},
  projects:[
    {name:'desktop-1536',use:{browserName:'chromium',viewport:{width:1536,height:1024}}},
    {name:'desktop-1920',use:{browserName:'chromium',viewport:{width:1920,height:1080}}},
    {name:'narrow',use:{browserName:'chromium',viewport:{width:1180,height:900}}},
    {name:'default-desktop',use:{browserName:'chromium',viewport:{width:1280,height:720}}},
    {name:'mobile',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  ],
  webServer:{command:'node tests/e2e/serve-agent-build.mjs',cwd:fileURLToPath(new URL('../..',import.meta.url)),url:'http://127.0.0.1:51329',reuseExistingServer:false},
})

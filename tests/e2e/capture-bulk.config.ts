import { defineConfig } from '@playwright/test'
import base from './today-compact.config'
export default defineConfig({ ...base, testMatch: ['capture-bulk.spec.ts', 'today-compact.spec.ts'], outputDir: '../../test-results/capture-bulk-20261028' })

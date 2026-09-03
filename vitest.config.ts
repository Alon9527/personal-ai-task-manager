import { defineVitestConfig } from '@nuxt/test-utils/config'

process.env.RAYON_NUM_THREADS ??= '1'

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    include: ['tests/unit/**/*.spec.ts'],
    globals: true,
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
    hookTimeout: 90_000,
  },
})
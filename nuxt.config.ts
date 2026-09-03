const isDesktop = process.env.NUXT_DESKTOP === 'true' || Boolean(process.env.TAURI_ENV_PLATFORM)

export default defineNuxtConfig({
  compatibilityDate: '2026-07-21',
  ssr: !isDesktop,
  css: ['~/assets/css/main.css'],
  devtools: { enabled: !isDesktop },
  telemetry: false,
  devServer: {
    port: 3000,
  },
  vite: {
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_', 'NUXT_'],
    server: {
      strictPort: isDesktop,
    },
  },
  ignore: ['**/src-tauri/**'],
  modules: ['@nuxt/ui', '@nuxt/icon'],
  runtimeConfig: {
    supabaseUrl: '',
    supabaseServiceRoleKey: '',
    demoOwnerId: '00000000-0000-4000-8000-000000000001',
    public: {
      dataBackend: 'local',
    },
  },
  // `pnpm typecheck` remains the authoritative checker. Disabling the duplicate
  // dev overlay avoids a Volar/vue-router resolver mismatch in Nuxt dev mode.
  typescript: { strict: true, typeCheck: false },
})

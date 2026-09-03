import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const nuxtCli = fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url))
const child = spawn(process.execPath, [nuxtCli, 'generate'], {
  env: {
    ...process.env,
    NUXT_DESKTOP: 'true',
  },
  stdio: 'inherit',
})

child.once('error', (error) => {
  console.error(`Unable to start the Nuxt desktop build: ${error.message}`)
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`Nuxt desktop build stopped by signal ${signal}`)
    process.exitCode = 1
    return
  }

  process.exitCode = code ?? 1
})

import { readFile } from 'node:fs/promises'

describe('development server configuration', () => {
  it('uses the dedicated typecheck script instead of the incompatible dev overlay checker', async () => {
    const [config, packageJsonText] = await Promise.all([
      readFile('nuxt.config.ts', 'utf8'),
      readFile('package.json', 'utf8'),
    ])
    const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> }

    expect(config).toContain('typescript: { strict: true, typeCheck: false }')
    expect(packageJson.scripts?.typecheck).toBe('nuxt typecheck')
  })
})

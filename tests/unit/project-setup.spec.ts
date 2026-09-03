import { readFile } from 'node:fs/promises'

describe('project setup', () => {
  it('generates Nuxt types after installing dependencies', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.postinstall).toBe('nuxt prepare')
  })
})

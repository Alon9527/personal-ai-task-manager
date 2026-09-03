import { readFile } from 'node:fs/promises'

describe('application stylesheet dependencies', () => {
  it('declares Tailwind directly when the application stylesheet imports it', async () => {
    const [stylesheet, packageJsonText] = await Promise.all([
      readFile('app/assets/css/main.css', 'utf8'),
      readFile('package.json', 'utf8'),
    ])
    const packageJson = JSON.parse(packageJsonText) as { dependencies?: Record<string, string> }

    expect(stylesheet).toContain('@import "tailwindcss";')
    expect(packageJson.dependencies?.tailwindcss).toBe('4.3.3')
  })
})

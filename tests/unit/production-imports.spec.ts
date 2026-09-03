import { readFile } from 'node:fs/promises'

describe('production module resolution', () => {
  it('uses the Nuxt shared alias from application and server runtime code', async () => {
    const files = [
      'app/models/workspace-model.ts',
      'app/data/demo-workspace.ts',
      'app/data/local-workspace-gateway.ts',
      'server/utils/supabase-workspace-repository.ts',
    ]
    const sources = await Promise.all(files.map(file => readFile(file, 'utf8')))

    for (const source of sources) {
      expect(source).toContain("from '#shared/workspace'")
      expect(source).not.toContain("from '../../shared/workspace'")
    }
  })
})

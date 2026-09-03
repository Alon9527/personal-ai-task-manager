import { readFile } from 'node:fs/promises'

describe('runtime data backend configuration', () => {
  it('keeps Supabase secrets private and defaults the public backend to local', async () => {
    const config = await readFile('nuxt.config.ts', 'utf8')

    expect(config).toContain("supabaseServiceRoleKey: ''")
    expect(config).toContain("dataBackend: 'local'")
    expect(config).not.toContain('public: { supabaseServiceRoleKey')
  })

  it('selects the API gateway only from the server-resolved mode', async () => {
    const plugin = await readFile('app/plugins/workspace.ts', 'utf8')

    expect(plugin).toContain('ApiWorkspaceGateway')
    expect(plugin).toContain("resolvedBackend.value === 'supabase'")
    expect(plugin).toContain('supabaseServiceRoleKey')
  })
})

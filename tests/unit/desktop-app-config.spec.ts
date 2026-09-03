import { readFile } from 'node:fs/promises'

describe('desktop application configuration', () => {
  it('keeps desktop build scripts explicit and reproducible', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(packageJson.scripts?.['generate:desktop']).toBe('node scripts/generate-desktop.mjs')
    expect(packageJson.scripts?.['desktop:dev']).toBe('tauri dev')
    expect(packageJson.scripts?.['desktop:portable']).toBe('tauri build --no-bundle')
    expect(packageJson.scripts?.['desktop:build']).toBe('tauri build --bundles nsis')
    expect(packageJson.devDependencies?.['@tauri-apps/cli']).toBe('2.11.4')
  })

  it('uses a client-only Nuxt build inside the desktop shell', async () => {
    const config = await readFile('nuxt.config.ts', 'utf8')
    const runner = await readFile('scripts/generate-desktop.mjs', 'utf8')

    expect(config).toContain("process.env.NUXT_DESKTOP === 'true'")
    expect(config).toContain('ssr: !isDesktop')
    expect(config).toContain("ignore: ['**/src-tauri/**']")
    expect(config).toContain('strictPort: isDesktop')
    expect(runner).toContain("NUXT_DESKTOP: 'true'")
    expect(runner).toContain("fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs'")
    expect(runner).not.toContain('shell:')
  })

  it('defines a local-only Windows shell and installer', async () => {
    const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8')) as {
      identifier?: string
      version?: string
      build?: Record<string, unknown>
      app?: {
        windows?: Array<Record<string, unknown>>
        security?: Record<string, unknown>
      }
      bundle?: {
        targets?: string[]
        windows?: {
          nsis?: Record<string, unknown>
        }
      }
    }
    const cargo = await readFile('src-tauri/Cargo.toml', 'utf8')
    const main = await readFile('src-tauri/src/main.rs', 'utf8')

    const cargoConfig = await readFile('src-tauri/.cargo/config.toml', 'utf8')
    expect(config.identifier).toBe('com.focusai.taskmanager')
    expect(config.version).toBe('0.2.1')
    expect(cargo).toContain('version = "0.2.1"')
    expect(config.build?.beforeBuildCommand).toBe('pnpm generate:desktop')
    expect(config.build?.frontendDist).toBe('../.output/public')
    expect(config.app?.windows?.[0]).toMatchObject({
      label: 'main',
      title: 'Focus AI 个人任务管理器',
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
    })
    expect(config.app?.security?.freezePrototype).toBe(true)
    expect(config.bundle?.targets).toEqual(['nsis'])
    expect(config.bundle?.windows?.nsis).toMatchObject({
      installMode: 'currentUser',
    })
    expect(cargo).toContain('tauri = { version = "=2.11.2"')
    expect(cargo).toContain('rusqlite = { version = "=0.40.2"')
    expect(cargo).toContain('tauri-plugin-notification = "=2.3.3"')
    expect(main).toContain('tauri::Builder::default()')
    expect(main).toContain('TrayIconBuilder::new()')
    expect(main).toContain('WindowEvent::CloseRequested')
    expect(main).toContain('api.prevent_close()')
    expect(main).toContain('workspace_store::workspace_save_document')
    expect(main).toContain('notifications::show_task_notification')
    expect(cargoConfig).toContain('jobs = 1')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Tauri updater startup configuration', () => {
  it('enables the signed GitHub Releases channel for Windows', () => {
    const main = readFileSync(resolve(process.cwd(), 'src-tauri/src/main.rs'), 'utf8')
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'))

    expect(main).toContain('tauri_plugin_updater::Builder::new().build()')
    expect(main).not.toContain('FOCUS_AI_UPDATER_ENABLED')
    expect(config.bundle.createUpdaterArtifacts).toBe(true)
    expect(config.plugins.updater.endpoints).toEqual([
      'https://github.com/Alon9527/personal-ai-task-manager/releases/latest/download/latest.json',
    ])
    expect(config.plugins.updater.pubkey.length).toBeGreaterThan(40)
    expect(config.plugins.updater.windows.installMode).toBe('passive')
  })
})
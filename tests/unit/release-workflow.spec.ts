import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('GitHub Windows release workflow', () => {
  it('publishes signed NSIS updater artifacts without AI provider secrets', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release-windows.yml'), 'utf8')

    expect(workflow).toContain('TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}')
    expect(workflow).toContain('TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}')
    expect(workflow).toContain('uploadUpdaterJson: true')
    expect(workflow).toContain('updaterJsonPreferNsis: true')
    expect(workflow).toContain('args: --bundles nsis')
    expect(workflow).not.toContain('MINIMAX')
    expect(workflow).not.toContain('OPENAI_API_KEY')
  })
})

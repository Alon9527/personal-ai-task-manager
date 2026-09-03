import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Windows voice typing bridge', () => {
  it('registers a narrowly scoped Tauri command backed by SendInput', () => {
    const main = readFileSync(resolve(process.cwd(), 'src-tauri/src/main.rs'), 'utf8')
    const voice = readFileSync(resolve(process.cwd(), 'src-tauri/src/voice_typing.rs'), 'utf8')
    const cargo = readFileSync(resolve(process.cwd(), 'src-tauri/Cargo.toml'), 'utf8')

    expect(main).toContain('voice_typing::start_windows_voice_typing')
    expect(voice).toContain('SendInput')
    expect(voice).toContain('VK_LWIN')
    expect(voice).toContain("0x48")
    expect(cargo).toContain('Win32_UI_Input_KeyboardAndMouse')
  })
})

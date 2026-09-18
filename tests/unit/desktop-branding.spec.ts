import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('desktop branding', () => {
  it('uses the requested display name while retaining the data identity', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
    expect(config.productName).toBe('Focus 个人任务管理器')
    expect(config.app.windows[0].title).toBe('Focus 个人任务管理器')
    expect(config.identifier).toBe('com.focusai.taskmanager')
    expect(config.bundle.icon).toContain('icons/focus/icon.ico')
  })
  it('uses the same name in the native tray', () => {
    const main = readFileSync('src-tauri/src/main.rs', 'utf8')
    expect(main).toContain('.tooltip("Focus 个人任务管理器")')
    expect(main).toContain('"打开 Focus 个人任务管理器"')
  })
})

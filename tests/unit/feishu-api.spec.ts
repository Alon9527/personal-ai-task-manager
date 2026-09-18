import { beforeEach, describe, expect, it, vi } from 'vitest'
const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri }))
import { getFeishuStatus, saveFeishuConfig, inspectFeishuTable } from '../../app/services/feishu-api'

describe('Feishu desktop bridge', () => {
  beforeEach(() => { vi.resetAllMocks(); isTauri.mockReturnValue(true) })
  it('does not send credentials from browser preview', async () => {
    isTauri.mockReturnValue(false)
    await expect(saveFeishuConfig({ appId: 'cli_test', appSecret: 'test-only', url: 'https://example.feishu.cn/base/abcdef' })).rejects.toThrow('桌面')
    expect(invoke).not.toHaveBeenCalled()
  })
  it('saves without an automatic API call and strips unknown response fields', async () => {
    invoke.mockResolvedValue({ configured: true, appId: 'cli_test', url: 'https://example.feishu.cn/base/abcdef', appSecret: 'must-not-return' })
    const result = await saveFeishuConfig({ appId: 'cli_test', appSecret: 'test-only', url: 'https://example.feishu.cn/base/abcdef' })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('feishu_save_config', { input: { appId: 'cli_test', appSecret: 'test-only', url: 'https://example.feishu.cn/base/abcdef' } })
    expect(result).not.toHaveProperty('appSecret')
  })
  it('rejects malformed status instead of claiming connection success', async () => {
    invoke.mockResolvedValue({ configured: 'yes' })
    await expect(getFeishuStatus()).rejects.toThrow()
  })
  it('requires valid table ids before any read request', async () => {
    await expect(inspectFeishuTable('../other')).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })
})

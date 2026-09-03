import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const isTauri = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri }))

const profile = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'MiniMax M3',
  baseUrl: 'https://api.example.com/v1',
  modelId: 'MiniMax-M3',
  credentialGeneration: 0,
  hasCredential: false,
  isLocal: false,
  createdAt: '2026-08-17T08:30:45.123Z',
  updatedAt: '2026-08-17T08:30:45.123Z',
}

describe('model provider desktop service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauri.mockReturnValue(true)
  })

  it('uses the exact lifecycle commands and bodies', async () => {
    invoke
      .mockResolvedValueOnce({ profiles: [profile], pendingCredentialDeletes: [] })
      .mockResolvedValueOnce(profile)
      .mockResolvedValueOnce({ ...profile, name: 'Primary' })
      .mockResolvedValueOnce({ ...profile, credentialGeneration: 1, hasCredential: true })
      .mockResolvedValueOnce({ profiles: [], pendingCredentialDeletes: [profile.id] })
      .mockResolvedValueOnce({ profiles: [], pendingCredentialDeletes: [] })
      .mockResolvedValueOnce({ ok: true, modelId: profile.modelId, latencyMs: 12 })
    const service = await import('../../app/services/model-provider')

    await service.listModelProviders()
    await service.createModelProvider({
      name: profile.name,
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
      apiKey: undefined,
    })
    await service.updateModelProvider(profile.id, {
      name: 'Primary',
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
    })
    await service.replaceModelProviderCredential(profile.id, 'synthetic-test-secret')
    await service.deleteModelProvider(profile.id)
    await service.retryModelProviderCredentialCleanup(profile.id)
    await service.testModelProviderConnection(profile.id)

    expect(invoke.mock.calls).toEqual([
      ['model_provider_list'],
      ['model_provider_create', { input: {
        name: profile.name,
        baseUrl: profile.baseUrl,
        modelId: profile.modelId,
      } }],
      ['model_provider_update', { id: profile.id, input: {
        name: 'Primary',
        baseUrl: profile.baseUrl,
        modelId: profile.modelId,
      } }],
      ['model_provider_replace_api_key', { id: profile.id, apiKey: 'synthetic-test-secret' }],
      ['model_provider_delete', { id: profile.id }],
      ['model_provider_retry_credential_cleanup', { id: profile.id }],
      ['model_provider_test_connection', { id: profile.id }],
    ])
  })

  it('propagates an explicit connection-test failure without changing its request body', async () => {
    invoke.mockRejectedValue(new Error('连接被拒绝'))
    const { testModelProviderConnection } = await import('../../app/services/model-provider')

    await expect(testModelProviderConnection(profile.id)).rejects.toThrow('连接被拒绝')
    expect(invoke).toHaveBeenCalledWith('model_provider_test_connection', { id: profile.id })
  })

  it('rejects browser use with a stable Chinese error', async () => {
    isTauri.mockReturnValue(false)
    const { listModelProviders } = await import('../../app/services/model-provider')

    await expect(listModelProviders()).rejects.toThrow('请在 Windows 桌面版中管理模型服务商')
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each(['apiKey', 'credential', 'authorization'])('rejects returned %s secret material', async (field) => {
    invoke.mockResolvedValue({ ...profile, [field]: 'must-not-cross-ipc' })
    const { createModelProvider } = await import('../../app/services/model-provider')

    await expect(createModelProvider({
      name: profile.name,
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
    })).rejects.toThrow()
  })

  it('counts name and model limits as Unicode scalar values and trims nonempty inputs', async () => {
    const service = await import('../../app/services/model-provider')
    const chineseName = '中'.repeat(34)
    const model160 = '模'.repeat(160)
    invoke.mockResolvedValue({ ...profile, name: chineseName, modelId: model160 })

    await service.createModelProvider({
      name: `  ${chineseName}  `,
      baseUrl: profile.baseUrl,
      modelId: `  ${model160}  `,
    })
    expect(invoke).toHaveBeenLastCalledWith('model_provider_create', { input: {
      name: chineseName,
      baseUrl: profile.baseUrl,
      modelId: model160,
    } })

    await expect(service.createModelProvider({
      name: 'a'.repeat(41),
      baseUrl: profile.baseUrl,
      modelId: profile.modelId,
    })).rejects.toThrow()
    await expect(service.createModelProvider({
      name: profile.name,
      baseUrl: profile.baseUrl,
      modelId: 'm'.repeat(161),
    })).rejects.toThrow()
  })

  it('rejects a credential generation outside the JavaScript safe integer range', async () => {
    invoke.mockResolvedValue({
      profiles: [{ ...profile, credentialGeneration: Number.MAX_SAFE_INTEGER + 1 }],
      pendingCredentialDeletes: [],
    })
    const { listModelProviders } = await import('../../app/services/model-provider')

    await expect(listModelProviders()).rejects.toThrow()
  })
})

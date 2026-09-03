import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import ContextPanel from '../../app/components/app/ContextPanel.vue'
import ModelProviderDialog from '../../app/components/app/ModelProviderDialog.vue'

const minimaxMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  saveKey: vi.fn(),
  setRegion: vi.fn(),
  removeKey: vi.fn(),
  generateBrief: vi.fn(),
  ask: vi.fn(),
}))

const providerMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  replaceCredential: vi.fn(),
  remove: vi.fn(),
  retryCleanup: vi.fn(),
  testConnection: vi.fn(),
}))

vi.mock('../../app/services/minimax', async () => {
  const actual = await vi.importActual<typeof import('../../app/services/minimax')>(
    '../../app/services/minimax',
  )
  return {
    ...actual,
    getMiniMaxStatus: minimaxMocks.getStatus,
    saveMiniMaxApiKey: minimaxMocks.saveKey,
    setMiniMaxRegion: minimaxMocks.setRegion,
    removeMiniMaxApiKey: minimaxMocks.removeKey,
    generateAiBrief: minimaxMocks.generateBrief,
    askAi: minimaxMocks.ask,
  }
})

vi.mock('../../app/services/model-provider', async () => {
  const actual = await vi.importActual<typeof import('../../app/services/model-provider')>(
    '../../app/services/model-provider',
  )
  return {
    ...actual,
    listModelProviders: providerMocks.list,
    createModelProvider: providerMocks.create,
    updateModelProvider: providerMocks.update,
    replaceModelProviderCredential: providerMocks.replaceCredential,
    deleteModelProvider: providerMocks.remove,
    retryModelProviderCredentialCleanup: providerMocks.retryCleanup,
    testModelProviderConnection: providerMocks.testConnection,
  }
})

const configuredStatus = {
  available: true,
  configured: true,
  model: 'MiniMax-M2.7',
  credentialStore: 'windows-credential-manager' as const,
  region: 'cn' as const,
}

const PROFILE_ID = '123e4567-e89b-42d3-a456-426614174000'
const LOCAL_PROFILE_ID = '223e4567-e89b-42d3-a456-426614174000'

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    name: '团队网关',
    baseUrl: 'https://ai.example.com/v1',
    modelId: 'qwen3-coder',
    credentialGeneration: 0,
    hasCredential: true,
    isLocal: false,
    createdAt: '2026-08-14T08:00:00.000Z',
    updatedAt: '2026-08-14T08:00:00.000Z',
    ...overrides,
  }
}

describe('MiniMax context panel', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(createDemoWorkspace()))
    vi.clearAllMocks()
    providerMocks.list.mockResolvedValue({ profiles: [], pendingCredentialDeletes: [] })
  })

  it('shows real desktop credential setup instead of a fabricated brief', async () => {
    minimaxMocks.getStatus.mockResolvedValue({ ...configuredStatus, configured: false })
    minimaxMocks.saveKey.mockResolvedValue(configuredStatus)
    const wrapper = await mountSuspended(ContextPanel)

    await vi.waitFor(() => expect(wrapper.find('[data-minimax-setup]').exists()).toBe(true))
    expect(wrapper.text()).not.toContain('先完成产品架构稿')
    expect(wrapper.text()).toContain('Windows 凭据管理器')

    await wrapper.get('[data-minimax-api-key]').setValue('abcdefghijklmnop')
    await wrapper.get('[data-save-minimax-key]').trigger('submit')
    await vi.waitFor(() => expect(minimaxMocks.saveKey).toHaveBeenCalledWith('abcdefghijklmnop', 'cn'))
    expect(wrapper.find('[data-minimax-api-key]').exists()).toBe(false)
    expect(wrapper.text()).toContain('真实调用已就绪')
  })

  it('shows M3 first, separates custom providers, and persists only the selected target', async () => {
    minimaxMocks.getStatus.mockResolvedValue({ ...configuredStatus, configured: false })
    providerMocks.list.mockResolvedValue({ profiles: [profile()], pendingCredentialDeletes: [] })
    const wrapper = await mountSuspended(ContextPanel)

    await vi.waitFor(() => expect(wrapper.find('[data-minimax-setup]').exists()).toBe(true))
    const modelSelect = wrapper.get('[data-minimax-model]')
    const groups = modelSelect.findAll('optgroup')
    expect(groups.map(group => group.attributes('label'))).toEqual(['MiniMax', '自定义 API'])
    expect(groups[0]!.findAll('option')[0]!.text()).toContain('M3')
    expect(groups[1]!.text()).toContain('团队网关')

    await modelSelect.setValue(`custom:${PROFILE_ID}`)
    expect(JSON.parse(localStorage.getItem('personal-ai-model-selection:v2') ?? 'null')).toEqual({
      kind: 'custom',
      profileId: PROFILE_ID,
    })
  })

  it('keeps a valid legacy M2 selection selected after the target upgrade', async () => {
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    localStorage.setItem('personal-ai-minimax-model:v1', 'MiniMax-M2.5')
    const wrapper = await mountSuspended(ContextPanel)

    await vi.waitFor(() => expect(wrapper.find('[data-minimax-model]').exists()).toBe(true))
    expect((wrapper.get('[data-minimax-model]').element as HTMLSelectElement).value).toBe('minimax:MiniMax-M2.5')
    expect(JSON.parse(localStorage.getItem('personal-ai-model-selection:v2') ?? 'null')).toEqual({
      kind: 'minimax',
      modelId: 'MiniMax-M2.5',
    })
  })

  it.each([
    [profile({ id: LOCAL_PROFILE_ID, name: '本机 Ollama', baseUrl: 'http://localhost:11434/v1', hasCredential: false, isLocal: true }), true],
    [profile(), true],
    [profile({ hasCredential: false }), false],
  ] as const)('derives custom readiness from the profile rather than MiniMax setup %#', async (customProfile, expectedReady) => {
    minimaxMocks.getStatus.mockResolvedValue({ ...configuredStatus, configured: false, region: null })
    providerMocks.list.mockResolvedValue({ profiles: [customProfile], pendingCredentialDeletes: [] })
    localStorage.setItem('personal-ai-model-selection:v2', JSON.stringify({ kind: 'custom', profileId: customProfile.id }))
    const wrapper = await mountSuspended(ContextPanel)

    await vi.waitFor(() => expect(wrapper.find('[data-minimax-model]').exists()).toBe(true))
    expect(wrapper.find('[data-minimax-setup]').exists()).toBe(false)
    expect(wrapper.find('.ask-ai').exists()).toBe(expectedReady)
    expect(wrapper.find('[data-generate-minimax-brief]').exists()).toBe(expectedReady)
    if (!expectedReady) expect(wrapper.text()).toContain('需要 API Key')
  })
  it('requires an explicit region for an existing key before any model request', async () => {
    minimaxMocks.getStatus.mockResolvedValue({ ...configuredStatus, region: null })
    minimaxMocks.setRegion.mockResolvedValue({ ...configuredStatus, region: 'global' })
    const wrapper = await mountSuspended(ContextPanel)

    await vi.waitFor(() => expect(wrapper.find('[data-minimax-region-required]').exists()).toBe(true))
    expect(wrapper.find('[data-generate-minimax-brief]').exists()).toBe(false)
    await wrapper.get('[data-minimax-region-required] [data-minimax-region]').setValue('global')
    await wrapper.get('[data-minimax-region-required] button').trigger('click')
    await vi.waitFor(() => expect(minimaxMocks.setRegion).toHaveBeenCalledWith('global'))
    expect(minimaxMocks.generateBrief).not.toHaveBeenCalled()
  })
  it('generates a sourced brief only after an explicit click', async () => {
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    minimaxMocks.generateBrief.mockResolvedValue({
      focus: '先完成真实 MiniMax 调用链。',
      progress: [{ kind: 'progress', text: 'Rust 客户端已经接入。' }],
      suggestion: null,
      sources: [{ taskId: 'task-1', title: 'MiniMax 接入', projectName: '个人效率系统' }],
      model: 'MiniMax-M2.7',
      generatedAt: '2026-08-05T08:00:00.000Z',
      usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
    })
    const wrapper = await mountSuspended(ContextPanel)

    await vi.waitFor(() => expect(wrapper.find('[data-generate-minimax-brief]').exists()).toBe(true))
    expect(wrapper.get('.ask-ai [data-voice-input]').exists()).toBe(true)
    expect(minimaxMocks.generateBrief).not.toHaveBeenCalled()
    await wrapper.get('[data-generate-minimax-brief]').trigger('click')

    await vi.waitFor(() => expect(wrapper.text()).toContain('先完成真实 MiniMax 调用链。'))
    expect(minimaxMocks.generateBrief).toHaveBeenCalledWith(expect.any(Object), {
      kind: 'minimax',
      modelId: 'MiniMax-M3',
    })
    expect(wrapper.text()).toContain('200 tokens')
  })

  it('refreshes provider options through the manager and restores focus on close', async () => {
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    providerMocks.list
      .mockResolvedValueOnce({ profiles: [], pendingCredentialDeletes: [] })
      .mockResolvedValueOnce({ profiles: [profile()], pendingCredentialDeletes: [] })
    const wrapper = await mountSuspended(ContextPanel, { attachTo: document.body })
    await vi.waitFor(() => expect(wrapper.find('[data-manage-model-providers]').exists()).toBe(true))

    const opener = wrapper.get('[data-manage-model-providers]')
    ;(opener.element as HTMLButtonElement).focus()
    await opener.trigger('click')
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
    await vi.waitFor(() => expect(wrapper.get('[data-minimax-model]').text()).toContain('团队网关'))
    ;(document.querySelector('[data-provider-close]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    await vi.waitFor(() => expect(document.activeElement).toBe(opener.element))
  })

  it('does not focus the opener behind a rapidly reopened provider manager', async () => {
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    const wrapper = await mountSuspended(ContextPanel, {
      attachTo: document.body,
      global: {
        stubs: {
          ModelProviderDialog: {
            props: ['open'],
            emits: ['close'],
            template: '<div v-if="open" role="dialog" data-provider-dialog-stub><button data-provider-close @click="$emit(\'close\')">关闭</button></div>',
          },
        },
      },
    })
    const opener = wrapper.get('[data-manage-model-providers]')
    ;(opener.element as HTMLButtonElement).focus()
    await opener.trigger('click')
    const firstClose = wrapper.get('[data-provider-close]')
    ;(firstClose.element as HTMLButtonElement).focus()

    ;(firstClose.element as HTMLButtonElement).click()
    ;(opener.element as HTMLButtonElement).click()
    await vi.waitFor(() => expect(wrapper.find('[role="dialog"]').exists()).toBe(true))

    try {
      expect(document.activeElement).toBe(firstClose.element)
      expect(document.activeElement).not.toBe(opener.element)
    }
    finally {
      ;(wrapper.find('[data-provider-close]').element as HTMLButtonElement | null)?.click()
      await vi.waitFor(() => expect(wrapper.find('[role="dialog"]').exists()).toBe(false))
    }
  })

  it('preserves deliberate parent focus after an externally requested close', async () => {
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    const wrapper = await mountSuspended(ContextPanel, {
      attachTo: document.body,
      global: {
        stubs: {
          ModelProviderDialog: {
            props: ['open'],
            emits: ['close'],
            template: '<div v-if="open" data-provider-dialog-stub><button data-provider-stub-close @click="$emit(\'close\')">关闭</button></div>',
          },
        },
      },
    })
    const opener = wrapper.get('[data-manage-model-providers]')
    ;(opener.element as HTMLButtonElement).focus()
    await opener.trigger('click')
    const deliberateTarget = wrapper.get('[aria-label="MiniMax 设置"]')

    ;(wrapper.get('[data-provider-stub-close]').element as HTMLButtonElement).click()
    ;(deliberateTarget.element as HTMLButtonElement).focus()
    await vi.waitFor(() => expect(wrapper.find('[data-provider-dialog-stub]').exists()).toBe(false))

    expect(document.activeElement).toBe(deliberateTarget.element)
    expect(document.activeElement).not.toBe(opener.element)
  })

  it('keeps a manager refresh when the initial provider read resolves late', async () => {
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    let resolveInitial!: (value: { profiles: never[], pendingCredentialDeletes: never[] }) => void
    providerMocks.list
      .mockReturnValueOnce(new Promise(resolve => { resolveInitial = resolve }))
      .mockResolvedValueOnce({ profiles: [profile()], pendingCredentialDeletes: [] })
    const wrapper = await mountSuspended(ContextPanel)

    await wrapper.get('[data-manage-model-providers]').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-minimax-model]').text()).toContain('团队网关'))
    resolveInitial({ profiles: [], pendingCredentialDeletes: [] })
    await Promise.resolve()
    await Promise.resolve()

    expect(wrapper.get('[data-minimax-model]').text()).toContain('团队网关')
    ;(document.querySelector('[data-provider-close]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  })

  it('falls back from a deleted selected profile, clears stale output, and ignores its late response', async () => {
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    providerMocks.list.mockResolvedValue({ profiles: [profile()], pendingCredentialDeletes: [] })
    providerMocks.remove.mockResolvedValue({ profiles: [], pendingCredentialDeletes: [] })
    localStorage.setItem('personal-ai-model-selection:v2', JSON.stringify({ kind: 'custom', profileId: PROFILE_ID }))
    let resolveBrief!: (value: any) => void
    minimaxMocks.generateBrief.mockReturnValue(new Promise(resolve => { resolveBrief = resolve }))
    const wrapper = await mountSuspended(ContextPanel)
    await vi.waitFor(() => expect(wrapper.find('[data-generate-minimax-brief]').exists()).toBe(true))

    await wrapper.get('[data-generate-minimax-brief]').trigger('click')
    expect(minimaxMocks.generateBrief).toHaveBeenCalledWith(expect.any(Object), {
      kind: 'custom',
      profileId: PROFILE_ID,
    })
    await wrapper.get('[data-manage-model-providers]').trigger('click')
    await vi.waitFor(() => expect(document.querySelector('[data-provider-delete]')).not.toBeNull())
    ;(document.querySelector('[data-provider-delete]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.querySelector('[data-provider-delete-confirm]')).not.toBeNull())
    ;(document.querySelector('[data-provider-delete-confirm]') as HTMLButtonElement).click()

    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('personal-ai-model-selection:v2') ?? 'null')).toEqual({
      kind: 'minimax',
      modelId: 'MiniMax-M3',
    }))
    expect(wrapper.get('[role="status"]').text()).toContain('已切换到 MiniMax M3')
    resolveBrief({
      focus: '不应出现的旧服务商结果', progress: [], suggestion: null, sources: [],
      model: 'qwen3-coder', generatedAt: '2026-08-17T08:00:00.000Z', usage: null,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(wrapper.text()).not.toContain('不应出现的旧服务商结果')
  })

  it('invalidates a deferred brief when the selected profile metadata changes under the same id', async () => {
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    providerMocks.list.mockResolvedValue({ profiles: [profile()], pendingCredentialDeletes: [] })
    localStorage.setItem('personal-ai-model-selection:v2', JSON.stringify({ kind: 'custom', profileId: PROFILE_ID }))
    let resolveBrief!: (value: any) => void
    minimaxMocks.generateBrief.mockReturnValue(new Promise(resolve => { resolveBrief = resolve }))
    const wrapper = await mountSuspended(ContextPanel)
    await vi.waitFor(() => expect(wrapper.find('[data-generate-minimax-brief]').exists()).toBe(true))

    await wrapper.get('[data-generate-minimax-brief]').trigger('click')
    wrapper.findComponent(ModelProviderDialog).vm.$emit('change', {
      profiles: [profile({
        modelId: 'qwen3-coder-next',
        updatedAt: '2026-08-17T09:00:00.000Z',
      })],
      pendingCredentialDeletes: [],
    })
    await Promise.resolve()

    resolveBrief({
      focus: '不应出现的旧元数据结果', progress: [], suggestion: null, sources: [],
      model: 'qwen3-coder', generatedAt: '2026-08-17T08:00:00.000Z', usage: null,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(wrapper.text()).not.toContain('不应出现的旧元数据结果')
  })

  it('invalidates a deferred answer when the selected profile credential metadata changes under the same id', async () => {
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    providerMocks.list.mockResolvedValue({ profiles: [profile()], pendingCredentialDeletes: [] })
    localStorage.setItem('personal-ai-model-selection:v2', JSON.stringify({ kind: 'custom', profileId: PROFILE_ID }))
    let resolveAnswer!: (value: any) => void
    minimaxMocks.ask.mockReturnValue(new Promise(resolve => { resolveAnswer = resolve }))
    const wrapper = await mountSuspended(ContextPanel)
    await vi.waitFor(() => expect(wrapper.find('.ask-ai').exists()).toBe(true))

    await wrapper.get('.ask-ai input').setValue('整理今天的任务')
    await wrapper.get('.ask-ai').trigger('submit')
    await vi.waitFor(() => expect(minimaxMocks.ask).toHaveBeenCalledTimes(1))
    wrapper.findComponent(ModelProviderDialog).vm.$emit('change', {
      profiles: [profile({ hasCredential: false })],
      pendingCredentialDeletes: [],
    })
    await nextTick()

    resolveAnswer({
      answer: '不应出现的旧凭据结果', actions: [], sources: [],
      model: 'qwen3-coder', generatedAt: '2026-08-17T08:00:00.000Z', usage: null,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(wrapper.text()).not.toContain('不应出现的旧凭据结果')
  })

  it('invalidates a deferred answer when a true-to-true rekey advances the credential generation', async () => {
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    providerMocks.list.mockResolvedValue({ profiles: [profile()], pendingCredentialDeletes: [] })
    localStorage.setItem('personal-ai-model-selection:v2', JSON.stringify({ kind: 'custom', profileId: PROFILE_ID }))
    let resolveAnswer!: (value: any) => void
    minimaxMocks.ask.mockReturnValue(new Promise(resolve => { resolveAnswer = resolve }))
    const wrapper = await mountSuspended(ContextPanel)
    await vi.waitFor(() => expect(wrapper.find('.ask-ai').exists()).toBe(true))

    await wrapper.get('.ask-ai input').setValue('整理今天的任务')
    await wrapper.get('.ask-ai').trigger('submit')
    await vi.waitFor(() => expect(minimaxMocks.ask).toHaveBeenCalledTimes(1))
    wrapper.findComponent(ModelProviderDialog).vm.$emit('change', {
      profiles: [profile({ credentialGeneration: 1 })],
      pendingCredentialDeletes: [],
    })
    await nextTick()

    resolveAnswer({
      answer: '不应出现的旧换钥结果', actions: [], sources: [],
      model: 'qwen3-coder', generatedAt: '2026-08-17T08:00:00.000Z', usage: null,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(wrapper.text()).not.toContain('不应出现的旧换钥结果')
  })

  it('contains no legacy direct executor or workspace mutation path', async () => {
    const source = await readFile(resolve(process.cwd(), 'app/components/app/ConnectedContextPanel.vue'), 'utf8')
    expect(source).not.toContain('applyMiniMaxAgentActions')
    expect(source).not.toContain('MiniMaxAgentExecutionError')
    expect(source).not.toContain('executingActions')
    expect(source).not.toContain('确认执行 ${pendingActions.length} 项')
    expect(source).not.toContain('已有 ${agentExecution.completed} 项在出错前完成')
    expect(source).not.toContain('suggestionToTaskInput')
    expect(source.match(/workspace\.(?:create|update|delete|replace|restore|empty|clear|complete|toggle|set)[A-Z]\w*\s*\(/g)).toBeNull()
    expect(source).not.toMatch(/\bfetch\s*\(/)
    const providerNeutralPath = source.slice(
      source.indexOf('async function generateBrief'),
      source.indexOf('async function proposeSuggestedTask'),
    ) + source.slice(
      source.indexOf('async function submitQuestion'),
      source.indexOf('function appendQuestionVoice'),
    )
    expect(providerNeutralPath).not.toContain('baseUrl')
    expect(providerNeutralPath).not.toMatch(/\bapiKey\b/)
    expect(providerNeutralPath).not.toContain('generateMiniMaxBrief')
    expect(providerNeutralPath).not.toContain('askMiniMax')
  })
})

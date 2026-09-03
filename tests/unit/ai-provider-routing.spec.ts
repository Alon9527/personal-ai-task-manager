import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const isTauri = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri }))

const PROFILE_ID = '550e8400-e29b-41d4-a716-446655440000'
const context = {
  generatedAt: '2026-08-17T08:30:45.123Z',
  projects: [],
  milestones: [],
  tasks: [],
  quarterGoals: [],
}

describe('provider-neutral AI routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauri.mockReturnValue(true)
  })

  it('sends only the selected MiniMax target when generating a brief', async () => {
    invoke.mockResolvedValue({
      focus: '今日焦点',
      progress: [],
      suggestion: null,
      sources: [],
      model: 'MiniMax-M3',
      generatedAt: context.generatedAt,
      usage: null,
    })
    const { generateAiBrief } = await import('../../app/services/minimax')

    await generateAiBrief(context, { kind: 'minimax', modelId: 'MiniMax-M3' })

    expect(invoke).toHaveBeenCalledWith('ai_generate_brief', {
      request: { context, target: { kind: 'minimax', modelId: 'MiniMax-M3' } },
    })
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('baseUrl')
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('apiKey')
  })

  it('sends only the stored custom profile id and parses actions through the draft schema', async () => {
    invoke.mockResolvedValue({
      answer: '已整理',
      actions: [],
      sources: [],
      model: 'custom-model',
      generatedAt: context.generatedAt,
      usage: null,
    })
    const { askAi } = await import('../../app/services/minimax')

    await askAi(context, '整理任务', { kind: 'custom', profileId: PROFILE_ID })

    expect(invoke).toHaveBeenCalledWith('ai_ask', {
      request: { context, question: '整理任务', target: { kind: 'custom', profileId: PROFILE_ID } },
    })
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('baseUrl')
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('apiKey')
  })

  it('rejects untrusted target fields before invoke', async () => {
    const { generateAiBrief } = await import('../../app/services/minimax')

    await expect(generateAiBrief(context, {
      kind: 'custom',
      profileId: PROFILE_ID,
      baseUrl: 'https://attacker.example/v1',
      apiKey: 'must-not-cross-ipc',
    } as never)).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([
    ['missing actions', {
      answer: '不能静默补空计划',
      sources: [],
      model: 'custom-model',
      generatedAt: context.generatedAt,
      usage: null,
    }],
    ['unknown top-level field', {
      answer: '不能接受额外顶层数据',
      actions: [],
      sources: [],
      model: 'custom-model',
      generatedAt: context.generatedAt,
      usage: null,
      providerApiKey: 'must-not-survive',
    }],
    ['unknown action field', {
      answer: '不能接受额外 action 数据',
      actions: [{
        actionId: 'create-project',
        type: 'createProject',
        reason: '用户要求',
        selected: true,
        dangerous: false,
        draftRef: 'project-one',
        payload: {
          name: '项目', color: '#6B61DF', description: '', priority: null,
          status: 'planned', targetDate: null,
        },
        credentialValue: 'must-not-survive',
      }],
      sources: [],
      model: 'custom-model',
      generatedAt: context.generatedAt,
      usage: null,
    }],
  ])('rejects a native answer with $0 before it can become a draft', async (_label, response) => {
    invoke.mockResolvedValue(response)
    const { askAi } = await import('../../app/services/minimax')

    await expect(askAi(context, '整理任务', { kind: 'custom', profileId: PROFILE_ID })).rejects.toThrow()
  })
})

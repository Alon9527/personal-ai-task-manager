import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick, ref, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentPlanDraftV1 } from '../../app/services/agent-plan-schema'
import { agentPlanDraftSchema } from '../../app/services/agent-plan-schema'
import { createDemoWorkspace } from '../../app/data/demo-workspace'

const injected = vi.hoisted(() => ({
  controller: null as any,
  workspace: null as any,
}))

const minimaxMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  ask: vi.fn(),
  generateBrief: vi.fn(),
}))

const providerMocks = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock('../../app/composables/useAgentPlan', async (load) => ({
  ...await load<typeof import('../../app/composables/useAgentPlan')>(),
  useAgentPlan: () => injected.controller,
}))

vi.mock('../../app/composables/useWorkspace', () => ({
  useWorkspace: () => injected.workspace,
}))

vi.mock('../../app/services/minimax', async () => {
  const actual = await vi.importActual<typeof import('../../app/services/minimax')>(
    '../../app/services/minimax',
  )
  return {
    ...actual,
    getMiniMaxStatus: minimaxMocks.getStatus,
    askAi: minimaxMocks.ask,
    generateAiBrief: minimaxMocks.generateBrief,
  }
})

vi.mock('../../app/services/model-provider', async () => {
  const actual = await vi.importActual<typeof import('../../app/services/model-provider')>(
    '../../app/services/model-provider',
  )
  return { ...actual, listModelProviders: providerMocks.list }
})

import ContextPanel from '../../app/components/app/ContextPanel.vue'

const GENERATED_AT = '2026-08-13T08:15:00.000Z'
const OLD_UPDATED_AT = '2026-08-12T10:30:00.000Z'
const PROFILE_ID = '123e4567-e89b-42d3-a456-426614174000'
const customProfile = {
  id: PROFILE_ID,
  name: '团队网关',
  baseUrl: 'https://ai.example.com/v1',
  modelId: 'qwen3-coder',
  credentialGeneration: 0,
  hasCredential: true,
  isLocal: false,
  createdAt: '2026-08-14T08:00:00.000Z',
  updatedAt: '2026-08-14T08:00:00.000Z',
}

const configuredStatus = {
  available: true,
  configured: true,
  model: 'MiniMax-M2.7',
  credentialStore: 'windows-credential-manager' as const,
  region: 'cn' as const,
}

function linkedActions() {
  return [
    {
      actionId: 'project-new',
      type: 'createProject' as const,
      reason: '集中管理新版官网工作',
      selected: true,
      dangerous: false as const,
      draftRef: 'project:website',
      payload: {
        name: '新版官网',
        color: '#6C63E8',
        description: '完成官网信息架构与首屏',
        priority: 'high' as const,
        status: 'active' as const,
        targetDate: '2026-09-30',
      },
    },
    {
      actionId: 'milestone-new',
      type: 'createMilestone' as const,
      reason: '先明确可验收的阶段结果',
      selected: true,
      dangerous: false as const,
      draftRef: 'milestone:ia',
      payload: {
        projectId: { kind: 'draft' as const, ref: 'project:website' },
        title: '首页信息架构',
        description: '确认页面层级与内容优先级',
        targetDate: '2026-08-25',
        status: 'planned' as const,
        progressMode: 'auto' as const,
        progress: 0,
      },
    },
    {
      actionId: 'task-new',
      type: 'createTask' as const,
      reason: '形成第一个可以审阅的交付物',
      selected: true,
      dangerous: false as const,
      draftRef: 'task:ia',
      payload: {
        projectId: { kind: 'draft' as const, ref: 'project:website' },
        milestoneId: { kind: 'draft' as const, ref: 'milestone:ia' },
        title: '整理首页信息架构',
        description: '输出页面层级草稿',
        priority: 'high' as const,
        dueDate: '2026-08-16',
        dueTime: '14:00',
        isFocus: true,
        status: 'in_progress' as const,
        importance: 'important' as const,
        estimatedMinutes: 45,
        reminderAt: null,
        snoozedUntil: null,
        lastRemindedAt: null,
      },
    },
  ]
}

function answer(actions: ReturnType<typeof linkedActions> | [] = linkedActions()) {
  return {
    answer: actions.length
      ? '我整理了一个三步计划，请先审阅。'
      : '今天先完成首页结构，再处理零散事项。',
    actions,
    sources: [{ taskId: 'task-1', title: '官网改版', projectName: '个人效率系统' }],
    model: 'MiniMax-M2.7',
    generatedAt: GENERATED_AT,
    usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
  }
}

function briefWithSuggestion() {
  return {
    focus: '今天先完成官网首屏。',
    progress: [{ kind: 'progress' as const, text: '信息架构正在整理。' }],
    suggestion: {
      rationale: '把首页结构拆成一项可以立即推进的任务',
      title: '整理首页信息架构',
      description: '输出页面层级与内容优先级',
      projectId: null,
      priority: 'high' as const,
      dueDate: '2026-08-16',
      dueTime: '14:00',
      isFocus: true,
    },
    sources: [{ taskId: 'task-1', title: '官网改版', projectName: '个人效率系统' }],
    model: 'MiniMax-M2.7',
    generatedAt: GENERATED_AT,
    usage: { promptTokens: 90, completionTokens: 60, totalTokens: 150 },
  }
}

function pendingDraft(status: AgentPlanDraftV1['status'] = 'draft'): AgentPlanDraftV1 {
  const actions = linkedActions()
  return agentPlanDraftSchema.parse({
    version: 1,
    id: '10000000-0000-4000-8000-000000000001',
    question: '上次的官网计划',
    model: 'MiniMax-M2.7',
    createdAt: OLD_UPDATED_AT,
    updatedAt: OLD_UPDATED_AT,
    status,
    actions,
    validation: {
      executable: true,
      selectedCount: 3,
      dangerousCount: 0,
      estimatedMinutes: 45,
      issueCount: 0,
      issues: [],
    },
  })
}

function installHarness(initialDraft: AgentPlanDraftV1 | null = null) {
  const document = createDemoWorkspace()
  const draft = shallowRef<AgentPlanDraftV1 | null>(initialDraft)
  const controllerError = shallowRef<string | null>(null)
  const controller = {
    draft,
    validation: shallowRef(initialDraft?.validation ?? null),
    error: controllerError,
    loadDraft: vi.fn(() => draft.value),
    setDraft: vi.fn((next: AgentPlanDraftV1) => {
      draft.value = structuredClone(next)
      return true
    }),
  }
  const workspace = {
    document: ref(document),
    ready: ref(true),
    projects: ref(document.projects),
    milestones: ref(document.milestones),
    tasks: ref(document.tasks),
    quarterGoals: ref(document.quarterGoals),
    load: vi.fn(),
    createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
    createMilestone: vi.fn(), updateMilestone: vi.fn(), deleteMilestone: vi.fn(),
    createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(),
    replaceWorkspaceDocument: vi.fn(),
  }
  injected.controller = controller
  injected.workspace = workspace
  return { controller, workspace, controllerError }
}

async function mountPanel() {
  const wrapper = await mountSuspended(ContextPanel, {
    route: '/',
    global: { stubs: { UIcon: { template: '<span class="icon-stub" />' } } },
  })
  await vi.waitFor(() => expect(wrapper.find('[data-minimax-model]').exists()).toBe(true))
  return wrapper
}

async function ask(wrapper: Awaited<ReturnType<typeof mountPanel>>, value = '请帮我规划新版官网') {
  await wrapper.get('.ask-ai input').setValue(value)
  await wrapper.get('.ask-ai').trigger('submit')
  await vi.waitFor(() => expect(minimaxMocks.ask).toHaveBeenCalledTimes(1))
  await vi.waitFor(() => expect(wrapper.find('.answer-card').exists()).toBe(true))
  await vi.waitFor(() => expect(wrapper.get('.ask-ai input').attributes('disabled')).toBeUndefined())
  await nextTick()
}

function expectNoWorkspaceWrites(workspace: ReturnType<typeof installHarness>['workspace']) {
  expect(workspace.createProject).not.toHaveBeenCalled()
  expect(workspace.updateProject).not.toHaveBeenCalled()
  expect(workspace.deleteProject).not.toHaveBeenCalled()
  expect(workspace.createMilestone).not.toHaveBeenCalled()
  expect(workspace.updateMilestone).not.toHaveBeenCalled()
  expect(workspace.deleteMilestone).not.toHaveBeenCalled()
  expect(workspace.createTask).not.toHaveBeenCalled()
  expect(workspace.updateTask).not.toHaveBeenCalled()
  expect(workspace.deleteTask).not.toHaveBeenCalled()
  expect(workspace.replaceWorkspaceDocument).not.toHaveBeenCalled()
}

describe('MiniMax Agent plan integration', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    minimaxMocks.getStatus.mockResolvedValue(configuredStatus)
    minimaxMocks.ask.mockResolvedValue(answer())
    minimaxMocks.generateBrief.mockResolvedValue(briefWithSuggestion())
    providerMocks.list.mockResolvedValue({ profiles: [], pendingCredentialDeletes: [] })
    installHarness()
  })

  it('converts the daily brief suggestion into one strict persisted plan without task CRUD', async () => {
    const { controller, workspace } = installHarness()
    const wrapper = await mountPanel()
    await wrapper.get('[data-generate-minimax-brief]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-create-suggestion-plan]').exists()).toBe(true))

    await wrapper.get('[data-create-suggestion-plan]').trigger('click')
    await vi.waitFor(() => expect(controller.setDraft).toHaveBeenCalledTimes(1))
    const saved = controller.setDraft.mock.calls[0]![0]
    expect(agentPlanDraftSchema.safeParse(saved).success).toBe(true)
    expect(saved).toMatchObject({
      question: '采用今日简报建议：整理首页信息架构',
      model: 'MiniMax-M2.7',
      createdAt: GENERATED_AT,
      updatedAt: GENERATED_AT,
      status: 'draft',
      validation: { executable: true, selectedCount: 1 },
      actions: [{
        type: 'createTask',
        reason: '把首页结构拆成一项可以立即推进的任务',
        selected: true,
        dangerous: false,
        payload: {
          projectId: null,
          milestoneId: null,
          title: '整理首页信息架构',
          description: '输出页面层级与内容优先级',
          priority: 'high',
          dueDate: '2026-08-16',
          dueTime: '14:00',
          isFocus: true,
        },
      }],
    })
    expect(wrapper.text()).not.toContain('任务已创建')
    expect(wrapper.text()).toContain('尚未修改任何任务')
    expect(wrapper.find('[data-review-agent-plan]').exists()).toBe(true)
    expectNoWorkspaceWrites(workspace)

    const router = useRouter()
    const push = vi.spyOn(router, 'push')
    await wrapper.get('[data-review-agent-plan]').trigger('click')
    expect(push).toHaveBeenCalledWith('/agent-plan')
  })

  it('protects an existing plan when the daily brief proposes a task and replaces only after explicit choice', async () => {
    const old = pendingDraft('failed')
    const { controller, workspace } = installHarness(old)
    const wrapper = await mountPanel()
    await wrapper.get('[data-generate-minimax-brief]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-create-suggestion-plan]').exists()).toBe(true))

    await wrapper.get('[data-create-suggestion-plan]').trigger('click')
    expect(controller.setDraft).not.toHaveBeenCalled()
    expect(controller.draft.value?.id).toBe(old.id)
    expect(wrapper.find('[data-agent-plan-replacement]').exists()).toBe(true)
    expectNoWorkspaceWrites(workspace)

    await wrapper.get('[data-replace-agent-plan]').trigger('click')
    await vi.waitFor(() => expect(controller.setDraft).toHaveBeenCalledTimes(1))
    expect(controller.setDraft.mock.calls[0]![0].id).not.toBe(old.id)
    expectNoWorkspaceWrites(workspace)
  })

  it('locks rapid daily-suggestion clicks to one persisted plan and keeps dismiss available', async () => {
    const { controller } = installHarness()
    const wrapper = await mountPanel()
    await wrapper.get('[data-generate-minimax-brief]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-create-suggestion-plan]').exists()).toBe(true))

    const button = wrapper.get('[data-create-suggestion-plan]')
    await Promise.all([button.trigger('click'), button.trigger('click')])
    await vi.waitFor(() => expect(controller.setDraft).toHaveBeenCalledTimes(1))

    minimaxMocks.generateBrief.mockResolvedValueOnce(briefWithSuggestion())
    await wrapper.get('.result-meta button').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-ignore-suggestion]').exists()).toBe(true))
    await wrapper.get('[data-ignore-suggestion]').trigger('click')
    expect(wrapper.find('[data-create-suggestion-plan]').exists()).toBe(false)
  })

  it('saves one strict linked draft with the original question and exact answer metadata without workspace writes', async () => {
    const { controller, workspace } = installHarness()
    const wrapper = await mountPanel()
    await ask(wrapper, '  请帮我规划新版官网  ')

    expect(controller.setDraft).toHaveBeenCalledTimes(1)
    const saved = controller.setDraft.mock.calls[0]![0]
    expect(agentPlanDraftSchema.safeParse(saved).success).toBe(true)
    expect(saved).toMatchObject({
      version: 1,
      question: '请帮我规划新版官网',
      model: 'MiniMax-M2.7',
      createdAt: GENERATED_AT,
      updatedAt: GENERATED_AT,
      status: 'draft',
      validation: { executable: true, selectedCount: 3, estimatedMinutes: 45, issueCount: 0 },
    })
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(saved.actions).toEqual(linkedActions())
    expectNoWorkspaceWrites(workspace)
  })

  it('routes custom Agent actions by profile id, preserves the actual returned model, and writes only the draft', async () => {
    const { controller, workspace } = installHarness()
    providerMocks.list.mockResolvedValue({ profiles: [customProfile], pendingCredentialDeletes: [] })
    localStorage.setItem('personal-ai-model-selection:v2', JSON.stringify({ kind: 'custom', profileId: PROFILE_ID }))
    minimaxMocks.ask.mockResolvedValue({ ...answer(), model: 'qwen3-coder-2026-08' })
    const wrapper = await mountPanel()

    await ask(wrapper, '请让自定义模型规划官网')

    expect(minimaxMocks.ask).toHaveBeenCalledWith(expect.any(Object), '请让自定义模型规划官网', {
      kind: 'custom',
      profileId: PROFILE_ID,
    })
    expect(controller.setDraft).toHaveBeenCalledTimes(1)
    expect(controller.setDraft.mock.calls[0]![0].model).toBe('qwen3-coder-2026-08')
    expectNoWorkspaceWrites(workspace)
  })

  it('keeps the proposal in the panel and only the explicit review CTA navigates', async () => {
    installHarness()
    const wrapper = await mountPanel()
    const router = useRouter()
    const push = vi.spyOn(router, 'push')
    await ask(wrapper)

    const card = wrapper.get('[data-agent-plan-proposal]')
    expect(card.text()).toContain('AI 提议的计划')
    expect(card.text()).toContain('3 项操作')
    expect(card.text()).toContain('已选 3 项')
    expect(card.text()).toContain('预计 45 分钟')
    expect(card.text()).toContain('尚未修改任何任务，审阅确认后才会写入')
    expect(card.text()).toContain('整理首页信息架构')
    expect(push).not.toHaveBeenCalled()

    await card.get('[data-review-agent-plan]').trigger('click')
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/agent-plan')
    expect(minimaxMocks.ask).toHaveBeenCalledTimes(1)
  })

  it('renders text-only answers with sources and token usage without saving a draft', async () => {
    const { controller, workspace } = installHarness()
    minimaxMocks.ask.mockResolvedValue(answer([]))
    const wrapper = await mountPanel()
    await ask(wrapper)

    expect(wrapper.text()).toContain('今天先完成首页结构')
    expect(wrapper.text()).toContain('引用 1 条任务')
    expect(wrapper.text()).toContain('200 tokens')
    expect(wrapper.find('[data-agent-plan-proposal]').exists()).toBe(false)
    expect(controller.setDraft).not.toHaveBeenCalled()
    expectNoWorkspaceWrites(workspace)
  })

  it('rejects an invalid generatedAt while preserving the answer and submitted question for retry', async () => {
    const { controller, workspace } = installHarness()
    minimaxMocks.ask.mockResolvedValue({ ...answer(), generatedAt: 'not-a-date' })
    const wrapper = await mountPanel()
    await ask(wrapper)

    expect(wrapper.get('[role="alert"]').text()).toContain('AI 返回的计划格式无效')
    expect(wrapper.text()).toContain('我整理了一个三步计划')
    expect((wrapper.get('.ask-ai input').element as HTMLInputElement).value).toBe('请帮我规划新版官网')
    expect(controller.setDraft).not.toHaveBeenCalled()
    expectNoWorkspaceWrites(workspace)
  })

  it('keeps a valid candidate for retry when draft storage fails', async () => {
    const { controller, controllerError, workspace } = installHarness()
    controller.setDraft.mockImplementationOnce(() => {
      controllerError.value = '本机存储不可用'
      return false
    })
    const wrapper = await mountPanel()
    await ask(wrapper)

    expect(wrapper.get('[role="alert"]').text()).toContain('无法保存 AI 计划草稿')
    expect(wrapper.find('[data-retry-save-agent-plan]').exists()).toBe(true)
    expect(controller.setDraft).toHaveBeenCalledTimes(1)
    expectNoWorkspaceWrites(workspace)
    const retry = wrapper.get('[data-retry-save-agent-plan]')
    expect(retry.attributes('disabled')).toBeUndefined()
    await retry.trigger('click')
    await vi.waitFor(() => expect(controller.setDraft).toHaveBeenCalledTimes(2))
  })

  it.each(['draft', 'conflicted', 'failed'] as const)(
    'loads a %s plan once and recovers it by navigation only',
    async (status) => {
      const { controller, workspace } = installHarness(pendingDraft(status))
      const wrapper = await mountPanel()
      const router = useRouter()
      const push = vi.spyOn(router, 'push')

      const recovery = wrapper.get('[data-agent-plan-recovery]')
      expect(recovery.text()).toContain('继续审阅上次计划')
      expect(recovery.text()).toContain('3 / 3')
      expect(recovery.text()).toContain('8月12日')
      expect(controller.loadDraft).toHaveBeenCalledTimes(1)
      await recovery.get('button').trigger('click')
      expect(push).toHaveBeenCalledWith('/agent-plan')
      expect(minimaxMocks.ask).not.toHaveBeenCalled()
      expect(controller.setDraft).not.toHaveBeenCalled()
      expectNoWorkspaceWrites(workspace)
    },
  )

  it.each([null, 'applied'] as const)('does not show recovery for %s state', async (status) => {
    installHarness(status === null ? null : pendingDraft(status))
    const wrapper = await mountPanel()
    expect(wrapper.find('[data-agent-plan-recovery]').exists()).toBe(false)
  })

  it('does not overwrite an existing pending plan until replacement is explicit', async () => {
    const old = pendingDraft()
    const { controller, workspace } = installHarness(old)
    const wrapper = await mountPanel()
    await ask(wrapper)

    expect(controller.setDraft).not.toHaveBeenCalled()
    expect(controller.draft.value?.id).toBe(old.id)
    const choice = wrapper.get('[data-agent-plan-replacement]')
    expect(choice.text()).toContain('继续审阅上次计划')
    expect(choice.text()).toContain('用新计划替换')
    expectNoWorkspaceWrites(workspace)

    const replace = choice.get('[data-replace-agent-plan]')
    expect(replace.attributes('disabled')).toBeUndefined()
    await replace.trigger('click')
    await vi.waitFor(() => expect(controller.setDraft).toHaveBeenCalledTimes(1))
    expect(controller.setDraft.mock.calls[0]![0].id).not.toBe(old.id)
    expect(wrapper.find('[data-agent-plan-replacement]').exists()).toBe(false)
    expect(wrapper.find('[data-review-agent-plan]').exists()).toBe(true)
  })

  it('continues the old plan without persisting the new in-memory proposal', async () => {
    const { controller, workspace } = installHarness(pendingDraft('failed'))
    const wrapper = await mountPanel()
    const router = useRouter()
    const push = vi.spyOn(router, 'push')
    await ask(wrapper)

    await wrapper.get('[data-continue-existing-agent-plan]').trigger('click')
    expect(push).toHaveBeenCalledWith('/agent-plan')
    expect(controller.setDraft).not.toHaveBeenCalled()
    expectNoWorkspaceWrites(workspace)
  })

  it('never replaces a pending draft for a text-only answer', async () => {
    const old = pendingDraft('conflicted')
    const { controller } = installHarness(old)
    minimaxMocks.ask.mockResolvedValue(answer([]))
    const wrapper = await mountPanel()
    await ask(wrapper)

    expect(controller.setDraft).not.toHaveBeenCalled()
    expect(controller.draft.value?.id).toBe(old.id)
    expect(wrapper.find('[data-agent-plan-recovery]').exists()).toBe(true)
    expect(wrapper.find('[data-agent-plan-replacement]').exists()).toBe(false)
  })

  it('guards rapid model submission and review navigation from duplication', async () => {
    const { controller } = installHarness()
    let resolveAnswer!: (value: ReturnType<typeof answer>) => void
    minimaxMocks.ask.mockReturnValue(new Promise(resolve => { resolveAnswer = resolve }))
    const wrapper = await mountPanel()
    await wrapper.get('.ask-ai input').setValue('请规划官网')
    await Promise.all([
      wrapper.get('.ask-ai').trigger('submit'),
      wrapper.get('.ask-ai').trigger('submit'),
    ])
    expect(minimaxMocks.ask).toHaveBeenCalledTimes(1)
    resolveAnswer(answer())
    await vi.waitFor(() => expect(controller.setDraft).toHaveBeenCalledTimes(1))

    const router = useRouter()
    let resolveNavigation!: () => void
    const push = vi.spyOn(router, 'push').mockReturnValue(new Promise<void>(resolve => { resolveNavigation = resolve }))
    await Promise.all([
      wrapper.get('[data-review-agent-plan]').trigger('click'),
      wrapper.get('[data-review-agent-plan]').trigger('click'),
    ])
    expect(push).toHaveBeenCalledTimes(1)
    resolveNavigation()
  })

  it('keeps proposal controls readable', async () => {
    installHarness()
    const wrapper = await mountPanel()
    await ask(wrapper)
    const card = wrapper.get('[data-agent-plan-proposal]')
    expect(card.classes()).toContain('agent-plan-proposal')
    expect(card.get('[data-review-agent-plan]').classes()).toContain('agent-plan-control')
  })
})

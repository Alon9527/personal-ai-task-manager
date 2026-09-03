import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceDocument } from '../../shared/workspace'
import AgentExecutionResult from '../../app/components/agent/AgentExecutionResult.vue'
import AgentPlanPage from '../../app/pages/agent-plan.vue'
import ContextPanel from '../../app/components/app/ContextPanel.vue'
import { createAgentPlanController } from '../../app/composables/useAgentPlan'
import type { AgentPlanDraftV1 } from '../../app/services/agent-plan-schema'
import type { AgentPlanStorage } from '../../app/services/agent-plan-storage'

const injected = vi.hoisted(() => ({
  controller: null as any,
  workspace: null as any,
}))

const minimaxMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  ask: vi.fn(),
  generateBrief: vi.fn(),
}))

vi.mock('../../app/composables/useAgentPlan', async load => ({
  ...await load<typeof import('../../app/composables/useAgentPlan')>(),
  useAgentPlan: () => injected.controller,
}))

vi.mock('../../app/composables/useWorkspace', () => ({ useWorkspace: () => injected.workspace }))

vi.mock('../../app/services/minimax', async () => {
  const actual = await vi.importActual<typeof import('../../app/services/minimax')>('../../app/services/minimax')
  return {
    ...actual,
    getMiniMaxStatus: minimaxMocks.getStatus,
    askMiniMax: minimaxMocks.ask,
    generateMiniMaxBrief: minimaxMocks.generateBrief,
  }
})

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_OWNER_ID = '00000000-0000-4000-8000-000000000002'
const PLAN_ID = '10000000-0000-4000-8000-000000000001'
const PROJECT_ID = '20000000-0000-4000-8000-000000000001'
const MILESTONE_ID = '30000000-0000-4000-8000-000000000001'
const TASK_ID = '40000000-0000-4000-8000-000000000001'
const CREATED_ID = '50000000-0000-4000-8000-000000000001'
const CREATED_AT = '2026-08-13T08:00:00.000Z'
const CURRENT_AT = '2026-08-14T08:00:00.000Z'
const mountedWrappers: Array<{ unmount: () => void }> = []

function document(overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    version: 3,
    projects: [{
      id: PROJECT_ID, ownerId: OWNER_ID, name: '当前官网项目', color: '#6C63E8', description: '当前项目说明',
      priority: 'high', status: 'active', targetDate: '2026-09-30', sortOrder: 0,
      createdAt: CREATED_AT, updatedAt: CURRENT_AT, deletedAt: null,
    }],
    milestones: [{
      id: MILESTONE_ID, ownerId: OWNER_ID, projectId: PROJECT_ID, title: '当前首页里程碑', description: '当前里程碑说明',
      targetDate: '2026-08-30', status: 'in_progress', progressMode: 'manual', progress: 35, sortOrder: 0,
      createdAt: CREATED_AT, updatedAt: CURRENT_AT, deletedAt: null,
    }],
    tasks: [{
      id: TASK_ID, ownerId: OWNER_ID, projectId: PROJECT_ID, milestoneId: MILESTONE_ID,
      title: '当前首页任务', description: '当前任务说明', priority: 'medium', dueDate: '2026-08-20', dueTime: '10:00',
      isFocus: true, status: 'in_progress', importance: 'important', estimatedMinutes: 45,
      reminderAt: '2026-08-20T01:00:00.000Z', snoozedUntil: null, lastRemindedAt: null,
      sortOrder: 0, completedAt: null, createdAt: CREATED_AT, updatedAt: CURRENT_AT, deletedAt: null,
    }],
    quarterGoals: [],
    ...overrides,
  }
}

function action(type: 'updateTask' | 'setTaskCompleted' | 'deleteTask' = 'updateTask') {
  const payload = type === 'updateTask' ? { title: '旧标题' } : type === 'setTaskCompleted' ? { completed: true } : {}
  return {
    actionId: `${type}-1`, type, reason: '保留原始原因', selected: true,
    dangerous: type === 'deleteTask', targetId: TASK_ID, expectedUpdatedAt: CREATED_AT, payload,
  }
}

function plan(actions: AgentPlanDraftV1['actions'] = [action() as AgentPlanDraftV1['actions'][number]]): AgentPlanDraftV1 {
  return {
    version: 1, id: PLAN_ID, question: '请重新规划官网任务', model: 'MiniMax-M2.7',
    createdAt: CREATED_AT, updatedAt: CREATED_AT, status: 'conflicted', actions,
    validation: { executable: false, selectedCount: 1, dangerousCount: 0, estimatedMinutes: 0, issueCount: 1,
      issues: [{ actionId: actions[0]!.actionId, code: 'conflict', field: 'expectedUpdatedAt', message: '目标记录已发生变化，请按当前数据重新载入。' }] },
  }
}

function harness(options: { draft?: AgentPlanDraftV1, reads?: WorkspaceDocument[], failSave?: boolean, failAppliedSave?: boolean, failReplace?: boolean } = {}) {
  let stored = structuredClone(options.draft ?? plan())
  const storage: AgentPlanStorage = {
    load: vi.fn(() => structuredClone(stored)),
    save: vi.fn((next) => {
      if (options.failSave) throw new Error('草稿磁盘不可用')
      if (options.failAppliedSave && next.status === 'applied') throw new Error('草稿清理失败')
      stored = structuredClone(next)
    }),
    clear: vi.fn(),
  }
  const reads = [...(options.reads ?? [document(), document()])]
  const visible = ref(document())
  const workspace = {
    document: visible,
    readLatestDocument: vi.fn(async () => structuredClone(reads.shift() ?? document())),
    replaceWorkspaceDocument: vi.fn(async (next: WorkspaceDocument) => {
      if (options.failReplace) throw new Error('磁盘写入失败')
      visible.value = structuredClone(next)
      return structuredClone(next)
    }),
  }
  const controller = createAgentPlanController({ storage, workspace, now: () => CURRENT_AT })
  injected.controller = controller
  injected.workspace = {
    ...workspace, ready: ref(true), projects: ref(visible.value.projects), milestones: ref(visible.value.milestones),
    tasks: ref(visible.value.tasks), quarterGoals: ref([]), load: vi.fn(), backendLabel: ref('本机数据'),
  }
  return { controller, workspace, storage, stored: () => stored }
}

async function mountPage() {
  const wrapper = await mountSuspended(AgentPlanPage, {
    route: '/agent-plan', global: { stubs: { UIcon: { template: '<span />' } } },
    attachTo: globalThis.document.body,
  })
  if (!wrapper.element.isConnected) globalThis.document.body.appendChild(wrapper.element)
  mountedWrappers.push(wrapper)
  await nextTick()
  return wrapper
}

describe('Agent execution result and recovery', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    while (mountedWrappers.length) mountedWrappers.pop()?.unmount()
  })

  it('keeps execution-result entity metadata at the 13px readability floor', async () => {
    const css = await readFile(resolve(process.cwd(), 'app/assets/css/main.css'), 'utf8')
    expect(css).toMatch(/\.agent-result-copy code\s*\{\s*color:[^}]*font-size:\s*13px;/s)
  })

  it('groups only actual results in stable order and resolves their current labels', async () => {
    const wrapper = await mountSuspended(AgentExecutionResult, {
      props: {
        results: [
          { actionId: 'u1', type: 'updateTask', entityId: TASK_ID, entityType: 'task', outcome: 'updated' },
          { actionId: 'c1', type: 'createProject', entityId: CREATED_ID, entityType: 'project', outcome: 'created' },
          { actionId: 'u2', type: 'setTaskCompleted', entityId: TASK_ID, entityType: 'task', outcome: 'completed' },
          { actionId: 'd1', type: 'deleteTask', entityId: '60000000-0000-4000-8000-000000000001', entityType: 'task', outcome: 'deleted' },
          { actionId: 'u3', type: 'setTaskCompleted', entityId: TASK_ID, entityType: 'task', outcome: 'reopened' },
        ],
        document: document({ projects: [...document().projects, { ...document().projects[0]!, id: CREATED_ID, name: '真实新项目' }] }),
      },
      global: { stubs: { UIcon: { template: '<span />' } } },
    })
    expect(wrapper.findAll('[data-agent-result]').map(row => row.attributes('data-agent-result'))).toEqual(['c1', 'u1', 'u2', 'u3', 'd1'])
    expect(wrapper.text()).toContain('真实新项目')
    expect(wrapper.text()).toContain(TASK_ID)
    expect(wrapper.text()).not.toContain('proposal-only')
  })

  it('keeps detailed results while the exact-count banner closes at 8 seconds and older timers cannot hide a newer banner', async () => {
    const { controller } = harness()
    const wrapper = await mountPage()
    vi.useFakeTimers()
    controller.executionResult.value = [{ actionId: 'one', type: 'updateTask', entityId: TASK_ID, entityType: 'task', outcome: 'updated' }]
    await nextTick()
    expect(wrapper.get('[data-agent-success-banner]').text()).toContain('已应用 1 项改动')
    await vi.advanceTimersByTimeAsync(7_999)
    expect(wrapper.find('[data-agent-success-banner]').exists()).toBe(true)
    controller.executionResult.value = [
      { actionId: 'two', type: 'updateTask', entityId: TASK_ID, entityType: 'task', outcome: 'updated' },
      { actionId: 'three', type: 'setTaskCompleted', entityId: TASK_ID, entityType: 'task', outcome: 'completed' },
    ]
    await nextTick()
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.get('[data-agent-success-banner]').text()).toContain('已应用 2 项改动')
    await vi.advanceTimersByTimeAsync(7_999)
    expect(wrapper.find('[data-agent-success-banner]').exists()).toBe(false)
    expect(wrapper.findAll('[data-agent-result]')).toHaveLength(2)
    wrapper.unmount()
    mountedWrappers.splice(mountedWrappers.indexOf(wrapper), 1)
  })

  it('supports independent success and error close controls and clears the success timer on unmount', async () => {
    const { controller } = harness()
    const wrapper = await mountPage()
    vi.useFakeTimers()
    controller.executionResult.value = [{ actionId: 'one', type: 'updateTask', entityId: TASK_ID, entityType: 'task', outcome: 'updated' }]
    controller.error.value = '替换失败'
    await nextTick()
    await wrapper.get('[data-close-agent-success]').trigger('click')
    expect(wrapper.find('[data-agent-success-banner]').exists()).toBe(false)
    expect(wrapper.get('[data-agent-error]').text()).toContain('替换失败')
    await wrapper.get('[data-close-agent-error]').trigger('click')
    expect(wrapper.find('[data-agent-error]').exists()).toBe(false)
    expect(wrapper.find('[data-agent-execution-results]').exists()).toBe(true)
    wrapper.unmount()
    mountedWrappers.splice(mountedWrappers.indexOf(wrapper), 1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('truthfully distinguishes durable apply plus cleanup failure and disables repeat execution', async () => {
    const currentPlan = plan([{ ...action(), expectedUpdatedAt: CURRENT_AT } as AgentPlanDraftV1['actions'][number]])
    const { controller, workspace } = harness({ draft: currentPlan, failAppliedSave: true })
    const wrapper = await mountPage()

    const response = await controller.requestExecution()
    await nextTick()

    expect(response.status).toBe('applied-cleanup-failed')
    expect(workspace.replaceWorkspaceDocument).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-agent-cleanup-failed]').text()).toContain('数据已写入，草稿清理失败')
    expect(wrapper.get('[data-confirm-agent-plan]').attributes('disabled')).toBeDefined()
    expect(await controller.requestExecution()).toMatchObject({ status: 'already-applied' })
  })

  it('focuses and scrolls the first conflict once per revision without stealing focus after an ordinary selection', async () => {
    const scroll = vi.fn()
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scroll, configurable: true })
    const actions = [
      action() as AgentPlanDraftV1['actions'][number],
      { ...action(), actionId: 'second-conflict' } as AgentPlanDraftV1['actions'][number],
    ]
    const { controller } = harness({ draft: plan(actions) })
    const wrapper = await mountPage()
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))

    expect(controller.selectedActionId.value).toBe('updateTask-1')
    expect(scroll).toHaveBeenCalledTimes(1)
    const focusCount = focus.mock.calls.length
    await wrapper.get('[data-agent-action="second-conflict"] [data-agent-row-select]').trigger('click')
    await nextTick()
    expect(controller.selectedActionId.value).toBe('second-conflict')
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(focus.mock.calls.length).toBe(focusCount)
    focus.mockRestore()
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    wrapper.unmount()
    mountedWrappers.splice(mountedWrappers.indexOf(wrapper), 1)
  })

  it('reloads exactly one stale update action from two matching current reads without execution', async () => {
    const original = plan([
      action() as AgentPlanDraftV1['actions'][number],
      { ...action('setTaskCompleted'), actionId: 'untouched', expectedUpdatedAt: CURRENT_AT } as AgentPlanDraftV1['actions'][number],
    ])
    const { controller, workspace, storage } = harness({ draft: original })
    controller.loadDraft()
    const untouched = structuredClone(controller.draft.value!.actions[1])
    vi.mocked(storage.save).mockClear()

    const result = await controller.reloadConflictedAction('updateTask-1')

    expect(result.status).toBe('reloaded')
    expect(controller.draft.value!.actions[0]).toMatchObject({
      actionId: 'updateTask-1', type: 'updateTask', reason: '保留原始原因', selected: true,
      expectedUpdatedAt: CURRENT_AT,
      payload: { title: '当前首页任务', projectId: PROJECT_ID, milestoneId: MILESTONE_ID, estimatedMinutes: 45 },
    })
    expect(controller.draft.value!.actions[1]).toEqual(untouched)
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(workspace.readLatestDocument).toHaveBeenCalledTimes(2)
    expect(workspace.replaceWorkspaceDocument).not.toHaveBeenCalled()
  })

  it.each([
    ['project', {
      actionId: 'update-project', type: 'updateProject', reason: '保留项目原因', selected: true, dangerous: false,
      targetId: PROJECT_ID, expectedUpdatedAt: CREATED_AT, payload: { name: '旧项目名' },
    }, { name: '当前官网项目', color: '#6C63E8', description: '当前项目说明', priority: 'high', status: 'active', targetDate: '2026-09-30' }],
    ['milestone', {
      actionId: 'update-milestone', type: 'updateMilestone', reason: '保留里程碑原因', selected: true, dangerous: false,
      targetId: MILESTONE_ID, expectedUpdatedAt: CREATED_AT, payload: { title: '旧里程碑' },
    }, { projectId: PROJECT_ID, title: '当前首页里程碑', description: '当前里程碑说明', targetDate: '2026-08-30', status: 'in_progress', progressMode: 'manual', progress: 35 }],
  ] as const)('maps a stale %s update from the current record with exactly one draft save and no workspace write', async (_kind, source, expectedPayload) => {
    const currentPlan = plan([source as AgentPlanDraftV1['actions'][number]])
    currentPlan.validation.issues = [{ actionId: source.actionId, code: 'conflict', field: 'expectedUpdatedAt', message: '记录已变化' }]
    const { controller, storage, workspace } = harness({ draft: currentPlan })
    controller.loadDraft()
    vi.mocked(storage.save).mockClear()

    expect((await controller.reloadConflictedAction(source.actionId)).status).toBe('reloaded')
    expect(controller.draft.value?.actions[0]).toMatchObject({
      actionId: source.actionId, reason: source.reason, expectedUpdatedAt: CURRENT_AT, payload: expectedPayload,
    })
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(workspace.readLatestDocument).toHaveBeenCalledTimes(2)
    expect(workspace.replaceWorkspaceDocument).not.toHaveBeenCalled()
  })

  it.each([
    ['setTaskCompleted', { completed: false }],
    ['deleteTask', {}],
  ] as const)('maps %s reload to only its allowed payload', async (type, expectedPayload) => {
    const source = plan([action(type) as AgentPlanDraftV1['actions'][number]])
    const { controller } = harness({ draft: source })
    controller.loadDraft()
    await controller.reloadConflictedAction(`${type}-1`)
    expect(controller.draft.value!.actions[0]!.payload).toEqual(expectedPayload)
    expect(controller.draft.value!.actions[0]!.expectedUpdatedAt).toBe(CURRENT_AT)
  })

  it.each([
    ['时间已变化', document(), '记录时间已变化', true],
    ['不存在', document({ tasks: [] }), '目标记录已不存在', false],
    ['已删除', document({ tasks: [{ ...document().tasks[0]!, deletedAt: CURRENT_AT }] }), '目标记录已在回收站', false],
    ['类型错误', document({ tasks: [], projects: [...document().projects, { ...document().projects[0]!, id: TASK_ID }] }), '记录类型已变化', false],
    ['所有者错误', document({ tasks: [{ ...document().tasks[0]!, ownerId: OTHER_OWNER_ID }] }), '记录所有者不匹配', false],
    ['项目关系失效', document({ tasks: [{ ...document().tasks[0]!, projectId: '70000000-0000-4000-8000-000000000001', milestoneId: null }] }), '项目归属已失效', false],
    ['里程碑关系失效', document({ tasks: [{ ...document().tasks[0]!, milestoneId: '70000000-0000-4000-8000-000000000002' }] }), '里程碑归属已失效', false],
  ] as const)('classifies the fresh latest snapshot when the old issue only says conflict: %s', async (_case, latest, label, reloadable) => {
    harness({ reads: [latest as WorkspaceDocument] })
    const wrapper = await mountPage()
    await vi.waitFor(() => expect(wrapper.get('.agent-conflict-recovery').text()).toContain(label))
    expect(wrapper.find('[data-agent-reload-current]').exists()).toBe(reloadable)
  })

  it.each([
    ['missing', document({ tasks: [] })],
    ['deleted', document({ tasks: [{ ...document().tasks[0]!, deletedAt: CURRENT_AT }] })],
    ['wrong owner', document({ tasks: [{ ...document().tasks[0]!, ownerId: OTHER_OWNER_ID }] })],
  ])('blocks reload when the target is %s and preserves the action', async (_label, latest) => {
    const { controller, storage, workspace } = harness({ reads: [latest as WorkspaceDocument] })
    controller.loadDraft()
    const before = structuredClone(controller.draft.value!.actions[0])
    vi.mocked(storage.save).mockClear()
    const result = await controller.reloadConflictedAction('updateTask-1')
    expect(result.status).toBe('blocked')
    expect(controller.draft.value!.actions[0]).toEqual(before)
    expect(controller.error.value).toBeTruthy()
    expect(storage.save).not.toHaveBeenCalled()
    expect(workspace.replaceWorkspaceDocument).not.toHaveBeenCalled()
  })

  it('fails closed when the target changes between read and save or storage rejects the rebase', async () => {
    const changed = document({ tasks: [{ ...document().tasks[0]!, updatedAt: '2026-08-14T09:00:00.000Z' }] })
    const race = harness({ reads: [document(), changed] })
    race.controller.loadDraft()
    const beforeRace = structuredClone(race.controller.draft.value!.actions[0])
    expect((await race.controller.reloadConflictedAction('updateTask-1')).status).toBe('blocked')
    expect(race.controller.draft.value!.actions[0]).toEqual(beforeRace)

    const failed = harness({ failSave: true })
    failed.controller.loadDraft()
    const beforeFailure = structuredClone(failed.controller.draft.value!.actions[0])
    expect((await failed.controller.reloadConflictedAction('updateTask-1')).status).toBe('failed')
    expect(failed.controller.draft.value!.actions[0]).toEqual(beforeFailure)
  })

  it('keeps the exact failed draft, shows no success/results, and never auto-retries replacement', async () => {
    const currentPlan = plan([{ ...action(), expectedUpdatedAt: CURRENT_AT } as AgentPlanDraftV1['actions'][number]])
    const { controller, workspace } = harness({ draft: currentPlan, failReplace: true })
    const wrapper = await mountPage()

    expect((await controller.requestExecution()).status).toBe('failed')
    await nextTick()
    expect(controller.draft.value?.status).toBe('failed')
    expect(controller.draft.value?.actions).toEqual(currentPlan.actions)
    expect(workspace.replaceWorkspaceDocument).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-agent-success-banner]').exists()).toBe(false)
    expect(wrapper.find('[data-agent-execution-results]').exists()).toBe(false)
    await nextTick()
    expect(workspace.replaceWorkspaceDocument).toHaveBeenCalledTimes(1)
  })

  it('uses ephemeral history state for replan, prefills and focuses once, and never submits automatically', async () => {
    const { controller } = harness()
    const page = await mountPage()
    const router = useRouter()
    const push = vi.spyOn(router, 'push')
    await page.get('[data-agent-replan]').trigger('click')
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ path: '/', state: expect.objectContaining({ agentReplanQuestion: '请重新规划官网任务' }) }))
    expect(push.mock.calls[0]![0]).not.toHaveProperty('query')
    expect(localStorage.length).toBe(0)
    expect(controller.draft.value).not.toBeNull()

    window.history.replaceState({ agentReplanQuestion: '请重新规划官网任务', agentReplanNonce: 'nonce-1' }, '', '/')
    minimaxMocks.getStatus.mockResolvedValue({ available: true, configured: true, region: 'cn', model: 'MiniMax-M2.7', credentialStore: 'windows-credential-manager' })
    const panel = await mountSuspended(ContextPanel, { route: '/', attachTo: globalThis.document.body, global: { stubs: { UIcon: { template: '<span />' } } } })
    if (!panel.element.isConnected) globalThis.document.body.appendChild(panel.element)
    mountedWrappers.push(panel)
    await vi.waitFor(() => expect(panel.find('[data-minimax-question]').exists()).toBe(true))
    const input = panel.get('[data-minimax-question]')
    expect((input.element as HTMLInputElement).value).toBe('请重新规划官网任务')
    expect(globalThis.document.activeElement).toBe(input.element)
    expect(minimaxMocks.ask).not.toHaveBeenCalled()
    expect(window.history.state.agentReplanQuestion).toBeUndefined()
    expect(controller.draft.value).not.toBeNull()
    panel.unmount()
    mountedWrappers.splice(mountedWrappers.indexOf(panel), 1)

    const reopened = await mountSuspended(ContextPanel, { route: '/', attachTo: globalThis.document.body, global: { stubs: { UIcon: { template: '<span />' } } } })
    if (!reopened.element.isConnected) globalThis.document.body.appendChild(reopened.element)
    mountedWrappers.push(reopened)
    await nextTick()
    expect((reopened.get('[data-minimax-question]').element as HTMLInputElement).value).toBe('')
    expect(minimaxMocks.ask).not.toHaveBeenCalled()
  })

  it('maps actual result navigation to the real task editor without changing result detail', async () => {
    const { controller } = harness()
    const wrapper = await mountPage()
    const router = useRouter()
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    const ui = useWorkspaceUi()
    controller.executionResult.value = [{ actionId: 'task-result', type: 'updateTask', entityId: TASK_ID, entityType: 'task', outcome: 'updated' }]
    await nextTick()

    await wrapper.get('[data-agent-result="task-result"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/', query: { project: PROJECT_ID } })
    expect(ui.taskEditor.value).toMatchObject({ open: true, taskId: TASK_ID })
    expect(controller.executionResult.value).toHaveLength(1)
  })
})

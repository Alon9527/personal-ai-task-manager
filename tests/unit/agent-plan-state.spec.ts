import { ref, toRaw } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createAgentPlanController } from '../../app/composables/useAgentPlan'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import { createWorkspaceModel } from '../../app/models/workspace-model'
import { simulateAgentPlan } from '../../app/services/agent-plan-executor'
import type { AgentPlanDraftV1 } from '../../app/services/agent-plan-schema'
import {
  AGENT_PLAN_STORAGE_KEY,
  createAgentPlanStorage,
} from '../../app/services/agent-plan-storage'
import type { AgentPlanStorage } from '../../app/services/agent-plan-storage'
import type { Project, WorkspaceDocument } from '../../shared/workspace'

const PLAN_ID = '10000000-0000-4000-8000-000000000001'
const PROJECT_ID = '20000000-0000-4000-8000-000000000001'
const CREATED_PROJECT_ID = '30000000-0000-4000-8000-000000000001'
const CREATED_MILESTONE_ID = '30000000-0000-4000-8000-000000000002'
const CREATED_TASK_ID = '30000000-0000-4000-8000-000000000003'
const CREATED_AT = '2026-08-13T08:00:00.000Z'
const MUTATED_AT = '2026-08-13T09:00:00.000Z'
const APPLIED_AT = '2026-08-13T10:00:00.000Z'

const emptyValidation = {
  executable: false,
  selectedCount: 0,
  dangerousCount: 0,
  estimatedMinutes: 0,
  issueCount: 0,
  issues: [],
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    ownerId: '00000000-0000-4000-8000-000000000011',
    name: '现有项目',
    color: '#6B61DF',
    description: '',
    priority: null,
    status: 'active',
    targetDate: null,
    sortOrder: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function document(overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    version: 3,
    projects: [project()],
    milestones: [],
    tasks: [],
    quarterGoals: [],
    ...overrides,
  }
}

function createProjectAction(actionId = 'create-project', draftRef = 'project:new') {
  return {
    actionId,
    type: 'createProject',
    reason: ' 建立项目 ',
    selected: true,
    dangerous: false,
    draftRef,
    payload: {
      name: ' 新项目 ',
      color: '#7C6BF2',
      description: '',
      priority: 'high',
      status: 'active',
      targetDate: null,
    },
  }
}

function updateProjectAction(expectedUpdatedAt = CREATED_AT) {
  return {
    actionId: 'update-project',
    type: 'updateProject',
    reason: '更新名称',
    selected: true,
    dangerous: false,
    targetId: PROJECT_ID,
    expectedUpdatedAt,
    payload: { name: '更新后的项目' },
  }
}

function deleteProjectAction(selected = true) {
  return {
    actionId: 'delete-project',
    type: 'deleteProject',
    reason: '移入回收站',
    selected,
    dangerous: true,
    targetId: PROJECT_ID,
    expectedUpdatedAt: CREATED_AT,
    payload: {},
  }
}

function linkedActions() {
  return [
    createProjectAction('parent', 'project:new'),
    {
      actionId: 'child',
      type: 'createMilestone',
      reason: '建立里程碑',
      selected: true,
      dangerous: false,
      draftRef: 'milestone:new',
      payload: {
        projectId: { kind: 'draft', ref: 'project:new' },
        title: '里程碑',
        description: '',
        targetDate: null,
        status: 'planned',
        progressMode: 'auto',
        progress: 0,
      },
    },
    {
      actionId: 'grandchild',
      type: 'createTask',
      reason: '建立任务',
      selected: true,
      dangerous: false,
      draftRef: 'task:new',
      payload: {
        projectId: { kind: 'draft', ref: 'project:new' },
        milestoneId: { kind: 'draft', ref: 'milestone:new' },
        title: '任务',
        description: '',
        priority: null,
        dueDate: null,
        dueTime: null,
        isFocus: true,
      },
    },
  ]
}

function draft(
  actions: Array<Record<string, unknown>> = [createProjectAction()],
  status: AgentPlanDraftV1['status'] = 'draft',
): AgentPlanDraftV1 {
  return {
    version: 1,
    id: PLAN_ID,
    question: '请先规划',
    model: 'MiniMax-M2.7',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status,
    actions,
    validation: emptyValidation,
  } as unknown as AgentPlanDraftV1
}

function memoryStorage(initial: AgentPlanDraftV1 | null = null) {
  let value = initial === null ? null : structuredClone(initial)
  let failSave = false
  let failClear = false
  const storage: AgentPlanStorage = {
    load: vi.fn(() => value === null ? null : structuredClone(value)),
    save: vi.fn((next) => {
      if (failSave) throw new Error('storage save unavailable')
      value = structuredClone(next as AgentPlanDraftV1)
      if (value.status === 'applied') {
        if (failClear) throw new Error('storage clear unavailable')
        value = null
      }
    }),
    clear: vi.fn(() => {
      if (failClear) throw new Error('storage clear unavailable')
      value = null
    }),
  }
  return {
    storage,
    current: () => value,
    setFailSave: (next: boolean) => { failSave = next },
    setFailClear: (next: boolean) => { failClear = next },
  }
}

function workspace(initial = document(), latest = initial) {
  const visible = ref(structuredClone(initial))
  return {
    document: visible,
    readLatestDocument: vi.fn(async () => structuredClone(latest)),
    replaceWorkspaceDocument: vi.fn(async (next: WorkspaceDocument) => {
      visible.value = structuredClone(next)
      return structuredClone(next)
    }),
  }
}

function controller(options: {
  stored?: AgentPlanDraftV1 | null
  visible?: WorkspaceDocument
  latest?: WorkspaceDocument
} = {}) {
  const backing = memoryStorage(options.stored)
  const workspaceModel = workspace(options.visible, options.latest ?? options.visible)
  const ids = [CREATED_PROJECT_ID, CREATED_MILESTONE_ID, CREATED_TASK_ID]
  const simulator = vi.fn((plan: AgentPlanDraftV1, current: WorkspaceDocument) =>
    simulateAgentPlan(plan, current, {
      now: () => APPLIED_AT,
      createId: () => ids.shift()!,
    }))
  const state = createAgentPlanController({
    storage: backing.storage,
    workspace: workspaceModel,
    now: () => MUTATED_AT,
    simulate: simulator,
  })
  return { state, backing, workspaceModel, simulator }
}

describe('agent plan state controller', () => {
  it('loads storage once, selects the first selected action, and handles empty storage', () => {
    const populated = controller({ stored: draft([
      { ...createProjectAction('off'), selected: false },
      createProjectAction('on'),
    ]) })

    populated.state.loadDraft()
    populated.state.loadDraft()

    expect(populated.backing.storage.load).toHaveBeenCalledTimes(1)
    expect(populated.state.selectedActionId.value).toBe('on')
    expect(populated.state.validation.value?.selectedCount).toBe(1)

    const empty = controller()
    empty.state.loadDraft()
    expect(empty.state.draft.value).toBeNull()
    expect(empty.state.validation.value).toBeNull()
  })

  it.each(['conflicted', 'failed'] as const)('restores a %s draft without changing its revision', (status) => {
    const source = draft([updateProjectAction()], status)
    const { state, backing } = controller({ stored: source })

    state.loadDraft()

    expect(state.draft.value).toMatchObject({ status, updatedAt: CREATED_AT })
    expect(backing.storage.save).not.toHaveBeenCalled()
  })

  it('refreshes the loaded draft validation summary in memory without writing storage', () => {
    const { state, backing } = controller({ stored: draft() })

    state.loadDraft()

    expect(state.draft.value?.validation).toMatchObject({
      executable: true,
      selectedCount: 1,
      issueCount: 0,
    })
    expect(backing.storage.save).not.toHaveBeenCalled()
  })

  it('canonicalizes set/edit/toggle mutations and saves each mutation exactly once without workspace calls', () => {
    const { state, backing, workspaceModel, simulator } = controller()

    state.setDraft(draft())
    expect(state.draft.value?.actions[0]).toMatchObject({ reason: '建立项目', payload: { name: '新项目' } })
    expect(state.draft.value?.updatedAt).toBe(MUTATED_AT)
    expect(backing.storage.save).toHaveBeenCalledTimes(1)

    state.updateAction('create-project', {
      actionId: 'attempted-identity-change',
      type: 'deleteProject',
      reason: ' 调整原因 ',
      payload: { name: ' 修改后的项目 ' },
    })
    expect(state.draft.value?.actions[0]).toMatchObject({
      actionId: 'create-project',
      type: 'createProject',
      reason: '调整原因',
      payload: { name: '修改后的项目', color: '#7C6BF2' },
    })
    expect(backing.storage.save).toHaveBeenCalledTimes(2)

    state.toggleAction('create-project', false)
    expect(state.draft.value?.actions[0]?.selected).toBe(false)
    expect(backing.storage.save).toHaveBeenCalledTimes(3)
    expect(workspaceModel.readLatestDocument).not.toHaveBeenCalled()
    expect(workspaceModel.replaceWorkspaceDocument).not.toHaveBeenCalled()
    expect(simulator).not.toHaveBeenCalled()
  })

  it('rejects invalid transient edits without corrupting state or persisted canonical data', () => {
    const { state, backing } = controller()
    state.setDraft(draft())
    const before = structuredClone(state.draft.value)
    vi.mocked(backing.storage.save).mockClear()

    const accepted = state.updateAction('create-project', { payload: { name: '' } })

    expect(accepted).toBe(false)
    expect(state.draft.value).toEqual(before)
    expect(backing.storage.save).not.toHaveBeenCalled()
    expect(state.error.value).toContain('无效')
  })

  it('rejects a malformed replacement draft with a stable user-facing message', () => {
    const { state, backing } = controller()
    const malformed = { ...draft(), extra: true }

    expect(state.setDraft(malformed)).toBe(false)
    expect(state.draft.value).toBeNull()
    expect(backing.storage.save).not.toHaveBeenCalled()
    expect(state.error.value).toBe('计划格式无效，无法保存。')
  })

  it('selectAction changes only editor focus and does not persist', () => {
    const { state, backing } = controller()
    state.setDraft(draft([createProjectAction('first'), createProjectAction('second', 'project:second')]))
    vi.mocked(backing.storage.save).mockClear()

    state.selectAction('second')

    expect(state.selectedActionId.value).toBe('second')
    expect(backing.storage.save).not.toHaveBeenCalled()
  })

  it('defers parent deselection and supports cancel, recursive deselection, and keep-and-reassign', () => {
    const cancel = controller()
    cancel.state.setDraft(draft(linkedActions()))
    vi.mocked(cancel.backing.storage.save).mockClear()
    cancel.state.toggleAction('parent', false)
    expect(cancel.state.pendingDependencyDecision.value).toEqual({
      actionId: 'parent',
      dependentActionIds: ['child', 'grandchild'],
    })
    expect(cancel.state.draft.value?.actions.every(action => action.selected)).toBe(true)
    expect(cancel.backing.storage.save).not.toHaveBeenCalled()
    cancel.state.resolveDeselectedDependency('cancel')
    expect(cancel.state.pendingDependencyDecision.value).toBeNull()
    expect(cancel.backing.storage.save).not.toHaveBeenCalled()

    const recursive = controller()
    recursive.state.setDraft(draft(linkedActions()))
    vi.mocked(recursive.backing.storage.save).mockClear()
    recursive.state.toggleAction('parent', false)
    recursive.state.resolveDeselectedDependency('deselect-dependents')
    expect(recursive.state.draft.value?.actions.map(action => action.selected)).toEqual([false, false, false])
    expect(recursive.backing.storage.save).toHaveBeenCalledTimes(1)

    const keep = controller()
    keep.state.setDraft(draft(linkedActions()))
    vi.mocked(keep.backing.storage.save).mockClear()
    keep.state.toggleAction('parent', false)
    keep.state.resolveDeselectedDependency('keep-and-reassign')
    expect(keep.state.draft.value?.actions.map(action => action.selected)).toEqual([false, true, true])
    expect(keep.state.validation.value?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'child', code: 'dependency' }),
    ]))
    expect(keep.backing.storage.save).toHaveBeenCalledTimes(1)
  })

  it('refreshes validation and invalidates an existing dangerous confirmation after every edit', async () => {
    const { state } = controller()
    state.setDraft(draft([deleteProjectAction()]))
    const request = await state.requestExecution()
    expect(state.dangerConfirmationRequested.value).toBe(true)

    state.updateAction('delete-project', { reason: ' 再确认原因 ' })

    expect(state.dangerConfirmationRequested.value).toBe(false)
    expect(state.validation.value?.dangerousCount).toBe(1)
    expect(state.draft.value?.validation.issueCount).toBe(state.validation.value?.issues.length)
    expect(await state.confirmDangerousExecution(request.confirmationToken!)).toMatchObject({ status: 'confirmation-stale' })
  })

  it('re-reads latest workspace, persists a stale conflict, selects it, and performs zero writes', async () => {
    const latest = document({ projects: [project({ updatedAt: MUTATED_AT })] })
    const { state, backing, workspaceModel, simulator } = controller({ latest })
    state.setDraft(draft([updateProjectAction(CREATED_AT)]))
    vi.mocked(backing.storage.save).mockClear()

    const result = await state.requestExecution()

    expect(result).toMatchObject({ status: 'conflicted' })
    expect(workspaceModel.readLatestDocument).toHaveBeenCalledTimes(1)
    expect(workspaceModel.replaceWorkspaceDocument).not.toHaveBeenCalled()
    expect(simulator).not.toHaveBeenCalled()
    expect(state.draft.value?.status).toBe('conflicted')
    expect(state.selectedActionId.value).toBe('update-project')
    expect(backing.current()?.status).toBe('conflicted')
    expect(backing.storage.save).toHaveBeenCalledTimes(1)
  })

  it('returns conflicted when same-model CRUD lands between latest read and Agent replacement', async () => {
    const values = new Map<string, string>()
    const localStore = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    const gateway = new LocalWorkspaceGateway(localStore, () => MUTATED_AT)
    const model = createWorkspaceModel(gateway, null)
    await model.load()
    const backing = memoryStorage()
    let crud: Promise<void> | null = null
    const state = createAgentPlanController({
      storage: backing.storage,
      workspace: model,
      now: () => MUTATED_AT,
      simulate: (plan, current) => {
        crud = model.updateProject(current.projects[0]!.id, { name: '并发 CRUD 保留' })
        return simulateAgentPlan(plan, current, {
          now: () => APPLIED_AT,
          createId: () => '50000000-0000-4000-8000-000000000001',
        })
      },
    })
    state.setDraft(draft())

    const result = await state.requestExecution()
    await crud

    expect(result).toMatchObject({ status: 'conflicted' })
    expect(state.draft.value?.status).toBe('conflicted')
    expect(model.document.value.projects[0]?.name).toBe('并发 CRUD 保留')
    expect(model.document.value.projects.some(item => item.id === '50000000-0000-4000-8000-000000000001')).toBe(false)
    expect(backing.current()?.status).toBe('conflicted')
  })

  it('requires an exact dangerous revision confirmation and then replaces once', async () => {
    const { state, workspaceModel, simulator } = controller()
    state.setDraft(draft([deleteProjectAction()]))

    const request = await state.requestExecution()
    expect(request).toMatchObject({ status: 'confirmation-required', confirmationToken: expect.any(String) })
    expect(simulator).not.toHaveBeenCalled()
    expect(workspaceModel.replaceWorkspaceDocument).not.toHaveBeenCalled()

    const result = await state.confirmDangerousExecution(request.confirmationToken!)

    expect(result).toMatchObject({ status: 'executed' })
    expect(simulator).toHaveBeenCalledTimes(1)
    expect(workspaceModel.replaceWorkspaceDocument).toHaveBeenCalledTimes(1)
  })

  it('requires the explicit returned token at runtime and rejects a different token without reading or writing', async () => {
    const { state, workspaceModel, simulator } = controller()
    state.setDraft(draft([deleteProjectAction()]))
    const request = await state.requestExecution()
    vi.mocked(workspaceModel.readLatestDocument).mockClear()

    const missing = await (state.confirmDangerousExecution as unknown as (token?: string) => Promise<{ status: string }>)()
    const wrong = await state.confirmDangerousExecution(`${request.confirmationToken}-wrong`)

    expect(missing).toMatchObject({ status: 'confirmation-stale' })
    expect(wrong).toMatchObject({ status: 'confirmation-stale' })
    expect(state.dangerConfirmationRequested.value).toBe(true)
    expect(workspaceModel.readLatestDocument).not.toHaveBeenCalled()
    expect(simulator).not.toHaveBeenCalled()
    expect(workspaceModel.replaceWorkspaceDocument).not.toHaveBeenCalled()
  })

  it('invalidates the old confirmation when the latest workspace snapshot gains a cascading child', async () => {
    const latest = document()
    const { state, workspaceModel, simulator } = controller({ latest })
    state.setDraft(draft([deleteProjectAction()]))
    const first = await state.requestExecution()
    const firstToken = first.confirmationToken!
    expect(state.dangerConfirmationDocument.value?.tasks).toHaveLength(0)

    latest.tasks.push({
      id: '40000000-0000-4000-8000-000000000001',
      ownerId: latest.projects[0]!.ownerId,
      projectId: PROJECT_ID,
      milestoneId: null,
      title: '确认后新增的项目任务',
      description: '',
      priority: null,
      dueDate: null,
      dueTime: null,
      isFocus: false,
      status: 'todo',
      importance: 'normal',
      estimatedMinutes: null,
      reminderAt: null,
      snoozedUntil: null,
      lastRemindedAt: null,
      sortOrder: 0,
      completedAt: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      deletedAt: null,
    })

    const stale = await state.confirmDangerousExecution(firstToken)

    expect(stale).toMatchObject({ status: 'confirmation-stale' })
    expect(state.dangerConfirmationRequested.value).toBe(false)
    expect(simulator).not.toHaveBeenCalled()
    expect(workspaceModel.replaceWorkspaceDocument).not.toHaveBeenCalled()

    const second = await state.requestExecution()
    expect(second).toMatchObject({ status: 'confirmation-required', confirmationToken: expect.any(String) })
    expect(second.confirmationToken).not.toBe(firstToken)
    expect(state.dangerConfirmationDocument.value?.tasks.map(item => item.title)).toContain('确认后新增的项目任务')
  })

  it('performs one latest read, one pure simulation, and one replacement for a clean plan', async () => {
    const { state, backing, workspaceModel, simulator } = controller()
    state.setDraft(draft())
    vi.mocked(backing.storage.save).mockClear()

    const result = await state.requestExecution()

    expect(result).toMatchObject({ status: 'executed' })
    expect(workspaceModel.readLatestDocument).toHaveBeenCalledTimes(1)
    expect(simulator).toHaveBeenCalledTimes(1)
    expect(workspaceModel.replaceWorkspaceDocument).toHaveBeenCalledTimes(1)
    expect(backing.storage.save).toHaveBeenCalledTimes(2)
    expect(backing.storage.clear).not.toHaveBeenCalled()
    expect(state.executionResult.value).toEqual([
      expect.objectContaining({ actionId: 'create-project', entityId: CREATED_PROJECT_ID }),
    ])
    expect(state.draft.value).toBeNull()
    expect(workspaceModel.document.value.projects.map(item => item.id)).toContain(CREATED_PROJECT_ID)
  })

  it('rejects rapid duplicate execution before the first latest read resolves', async () => {
    let resolveLatest!: (value: WorkspaceDocument) => void
    const latestPromise = new Promise<WorkspaceDocument>((resolve) => { resolveLatest = resolve })
    const { state, workspaceModel } = controller()
    state.setDraft(draft())
    workspaceModel.readLatestDocument.mockImplementationOnce(() => latestPromise)

    const first = state.requestExecution()
    const second = await state.requestExecution()
    expect(second).toMatchObject({ status: 'busy' })
    resolveLatest(document())
    await first

    expect(workspaceModel.replaceWorkspaceDocument).toHaveBeenCalledTimes(1)
  })

  it('rejects review mutations while an execution snapshot is in flight', async () => {
    let resolveLatest!: (value: WorkspaceDocument) => void
    const latestPromise = new Promise<WorkspaceDocument>((resolve) => { resolveLatest = resolve })
    const { state, backing, workspaceModel } = controller()
    state.setDraft(draft())
    vi.mocked(backing.storage.save).mockClear()
    workspaceModel.readLatestDocument.mockImplementationOnce(() => latestPromise)
    const before = structuredClone(state.draft.value)

    const execution = state.requestExecution()
    expect(state.updateAction('create-project', { reason: '不能穿透执行快照' })).toBe(false)
    expect(state.draft.value).toEqual(before)
    expect(backing.storage.save).not.toHaveBeenCalled()
    resolveLatest(document())
    await execution
  })

  it('keeps the visible workspace and a failed draft when replacement fails', async () => {
    const before = document()
    const { state, backing, workspaceModel } = controller({ visible: before, latest: before })
    workspaceModel.replaceWorkspaceDocument.mockRejectedValueOnce(new Error('disk full'))
    state.setDraft(draft())

    const result = await state.requestExecution()

    expect(result).toMatchObject({ status: 'failed' })
    expect(workspaceModel.document.value).toEqual(before)
    expect(state.draft.value?.status).toBe('failed')
    expect(backing.current()?.status).toBe('failed')
    expect(state.executionResult.value).toEqual([])
    expect(state.error.value).toContain('disk full')
    expect(state.executing.value).toBe(false)
  })

  it('prevents replacement when the pre-apply storage save fails', async () => {
    const { state, backing, workspaceModel, simulator } = controller()
    state.setDraft(draft())
    backing.setFailSave(true)

    const result = await state.requestExecution()

    expect(result).toMatchObject({ status: 'failed' })
    expect(simulator).not.toHaveBeenCalled()
    expect(workspaceModel.replaceWorkspaceDocument).not.toHaveBeenCalled()
    expect(state.executing.value).toBe(false)
    expect(state.error.value).toContain('storage save unavailable')
  })

  it('locks an applied revision when persistent cleanup fails so it cannot be executed twice', async () => {
    const { state, backing, workspaceModel } = controller()
    state.setDraft(draft())
    backing.setFailClear(true)

    const first = await state.requestExecution()
    const second = await state.requestExecution()

    expect(first).toMatchObject({ status: 'applied-cleanup-failed' })
    expect(second).toMatchObject({ status: 'already-applied' })
    expect(workspaceModel.replaceWorkspaceDocument).toHaveBeenCalledTimes(1)
    expect(state.draft.value?.status).toBe('applied')
    expect(state.error.value).toContain('清理')
  })

  it('persists an applied tombstone so a new controller never re-executes after cleanup failure', async () => {
    const values = new Map<string, string>()
    let removalBlocked = true
    const storeLike = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => {
        if (key === AGENT_PLAN_STORAGE_KEY && removalBlocked) throw new Error('remove blocked')
        values.delete(key)
      },
    }
    const firstWorkspace = workspace()
    const ids = [CREATED_PROJECT_ID]
    const first = createAgentPlanController({
      storage: createAgentPlanStorage(storeLike),
      workspace: firstWorkspace,
      now: () => MUTATED_AT,
      simulate: (plan, current) => simulateAgentPlan(plan, current, {
        now: () => APPLIED_AT,
        createId: () => ids.shift()!,
      }),
    })
    first.setDraft(draft())

    expect(await first.requestExecution()).toMatchObject({ status: 'applied-cleanup-failed' })
    expect(JSON.parse(values.get(AGENT_PLAN_STORAGE_KEY)!)).toMatchObject({ status: 'applied' })

    removalBlocked = false
    const appliedDocument = structuredClone(toRaw(firstWorkspace.document.value))
    const restartedWorkspace = workspace(appliedDocument, appliedDocument)
    const restarted = createAgentPlanController({
      storage: createAgentPlanStorage(storeLike),
      workspace: restartedWorkspace,
      now: () => MUTATED_AT,
    })
    expect(restarted.loadDraft()).toBeNull()
    expect(await restarted.requestExecution()).toMatchObject({ status: 'no-draft' })
    expect(restartedWorkspace.replaceWorkspaceDocument).not.toHaveBeenCalled()
  })

  it('treats an applied draft as terminal except for discard or a genuinely new plan ID', async () => {
    const { state, backing, workspaceModel, simulator } = controller()
    state.setDraft(draft(linkedActions()))
    backing.setFailClear(true)
    await state.requestExecution()
    vi.mocked(backing.storage.save).mockClear()
    vi.mocked(workspaceModel.replaceWorkspaceDocument).mockClear()
    simulator.mockClear()

    expect(state.updateAction('parent', { reason: '不能重启' })).toBe(false)
    expect(state.toggleAction('parent', false)).toBe(false)
    expect(state.resolveDeselectedDependency('deselect-dependents')).toBe(false)
    expect(state.setDraft(draft(linkedActions()))).toBe(false)
    expect(backing.storage.save).not.toHaveBeenCalled()
    expect(simulator).not.toHaveBeenCalled()
    expect(workspaceModel.replaceWorkspaceDocument).not.toHaveBeenCalled()

    backing.setFailClear(false)
    expect(state.setDraft({
      ...draft(),
      id: '10000000-0000-4000-8000-000000000099',
    })).toBe(true)
    expect(state.draft.value).toMatchObject({
      id: '10000000-0000-4000-8000-000000000099',
      status: 'draft',
    })
  })

  it('resets executing and exposes a deterministic error when the latest read throws', async () => {
    const { state, workspaceModel } = controller()
    state.setDraft(draft())
    workspaceModel.readLatestDocument.mockRejectedValueOnce(new Error('latest unavailable'))

    const result = await state.requestExecution()

    expect(result).toMatchObject({ status: 'failed' })
    expect(state.executing.value).toBe(false)
    expect(state.error.value).toContain('latest unavailable')
    expect(workspaceModel.replaceWorkspaceDocument).not.toHaveBeenCalled()
  })

  it('reports a latest-read failure as failed even when the loaded draft was previously conflicted', async () => {
    const source = draft([updateProjectAction()], 'conflicted')
    const { state, workspaceModel } = controller({ stored: source })
    state.loadDraft()
    workspaceModel.readLatestDocument.mockRejectedValueOnce(new Error('latest unavailable'))

    const result = await state.requestExecution()

    expect(result).toMatchObject({ status: 'failed' })
    expect(state.draft.value?.status).toBe('failed')
  })

  it('keeps controller instances isolated', () => {
    const first = controller()
    const second = controller()

    first.state.setDraft(draft())

    expect(first.state.draft.value).not.toBeNull()
    expect(second.state.draft.value).toBeNull()
    expect(second.backing.storage.save).not.toHaveBeenCalled()
  })

  it('keeps a visible draft when discard storage cleanup fails', () => {
    const { state, backing } = controller()
    state.setDraft(draft())
    backing.setFailClear(true)

    expect(state.discardDraft()).toBe(false)
    expect(state.draft.value).not.toBeNull()
    expect(state.error.value).toContain('storage clear unavailable')
  })
})

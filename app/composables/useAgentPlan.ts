import { shallowRef, toRaw } from 'vue'
import { workspaceDocumentSchema } from '#shared/workspace'
import type { Milestone, Project, Task, WorkspaceDocument } from '#shared/workspace'
import { useWorkspace } from './useWorkspace'
import { WorkspaceError } from '../data/workspace-gateway'
import type { WorkspaceModel } from '../models/workspace-model'
import { AgentPlanSimulationError, simulateAgentPlan } from '../services/agent-plan-executor'
import type { AgentActionResult } from '../services/agent-plan-executor'
import { agentActionSchema, agentPlanDraftSchema } from '../services/agent-plan-schema'
import type { AgentAction, AgentPlanDraftV1 } from '../services/agent-plan-schema'
import { createAgentPlanStorage } from '../services/agent-plan-storage'
import type { AgentPlanStorage } from '../services/agent-plan-storage'
import { validateAgentPlan } from '../services/agent-plan-validation'
import type { AgentPlanValidation } from '../services/agent-plan-validation'

type AgentPlanWorkspace = Pick<
  WorkspaceModel,
  'document' | 'readLatestDocument' | 'replaceWorkspaceDocument'
>

export type AgentDependencyResolution =
  | 'cancel'
  | 'deselect-dependents'
  | 'keep-and-reassign'

export type PendingDependencyDecision = {
  actionId: string
  dependentActionIds: string[]
}

export type AgentPlanExecutionStatus =
  | 'no-draft'
  | 'busy'
  | 'invalid'
  | 'conflicted'
  | 'confirmation-required'
  | 'confirmation-stale'
  | 'executed'
  | 'failed'
  | 'applied-cleanup-failed'
  | 'already-applied'

export type AgentPlanExecutionResponse = {
  status: AgentPlanExecutionStatus
  results?: AgentActionResult[]
  confirmationToken?: string
}

export type AgentPlanReloadResponse = {
  status: 'reloaded' | 'blocked' | 'failed'
}

export type AgentPlanControllerDependencies = {
  storage: AgentPlanStorage
  workspace: AgentPlanWorkspace
  now?: () => string
  validate?: typeof validateAgentPlan
  simulate?: typeof simulateAgentPlan
}

type ActionPatch = Record<string, unknown> & {
  payload?: Record<string, unknown>
}

const singletonControllers = new WeakMap<object, AgentPlanController>()

export function createAgentPlanController(dependencies: AgentPlanControllerDependencies) {
  const {
    storage,
    workspace,
    now = () => new Date().toISOString(),
    validate = validateAgentPlan,
    simulate = simulateAgentPlan,
  } = dependencies

  const draft = shallowRef<AgentPlanDraftV1 | null>(null)
  const validation = shallowRef<AgentPlanValidation | null>(null)
  const selectedActionId = shallowRef<string | null>(null)
  const executing = shallowRef(false)
  const executionResult = shallowRef<AgentActionResult[]>([])
  const error = shallowRef<string | null>(null)
  const latestConflictDocument = shallowRef<WorkspaceDocument | null>(null)
  const dangerConfirmationRequested = shallowRef(false)
  const dangerConfirmationToken = shallowRef<string | null>(null)
  const dangerConfirmationDocument = shallowRef<WorkspaceDocument | null>(null)
  const pendingDependencyDecision = shallowRef<PendingDependencyDecision | null>(null)
  let loaded = false
  let dangerRevision: string | null = null
  let dangerWorkspaceRevision: string | null = null
  let durablyAppliedRevision: string | null = null

  function visibleDocument(): WorkspaceDocument {
    return structuredClone(workspaceDocumentSchema.parse(toRaw(workspace.document.value)))
  }

  function clearConfirmation() {
    dangerConfirmationRequested.value = false
    dangerConfirmationToken.value = null
    dangerConfirmationDocument.value = null
    dangerRevision = null
    dangerWorkspaceRevision = null
  }

  function chooseInitialAction(plan: AgentPlanDraftV1) {
    return plan.actions.find(action => action.selected)?.actionId
      ?? plan.actions[0]?.actionId
      ?? null
  }

  function applyVisibleDraft(plan: AgentPlanDraftV1) {
    draft.value = structuredClone(plan)
    validation.value = validate(plan, visibleDocument())
    selectedActionId.value = selectedActionId.value !== null
      && plan.actions.some(action => action.actionId === selectedActionId.value)
      ? selectedActionId.value
      : chooseInitialAction(plan)
  }

  function withValidation(
    plan: AgentPlanDraftV1,
    checked: AgentPlanValidation,
    status: AgentPlanDraftV1['status'] = plan.status,
  ): AgentPlanDraftV1 {
    return agentPlanDraftSchema.parse({
      ...plan,
      status,
      validation: {
        ...checked,
        issueCount: checked.issues.length,
      },
    })
  }

  function canonicalizeMutation(
    plan: AgentPlanDraftV1,
    nextStatus: AgentPlanDraftV1['status'] = 'draft',
  ) {
    const stamped = agentPlanDraftSchema.parse({
      ...plan,
      status: nextStatus,
      updatedAt: now(),
    })
    return withValidation(stamped, validate(stamped, visibleDocument()), nextStatus)
  }

  function persistUserMutation(plan: AgentPlanDraftV1) {
    try {
      const next = canonicalizeMutation(plan)
      storage.save(next)
      applyVisibleDraft(next)
      error.value = null
      executionResult.value = []
      pendingDependencyDecision.value = null
      latestConflictDocument.value = null
      clearConfirmation()
      durablyAppliedRevision = null
      loaded = true
      return true
    }
    catch (cause) {
      error.value = userError(cause, '无法保存计划修改。')
      return false
    }
  }

  function loadDraft() {
    if (loaded) return draft.value
    loaded = true
    clearConfirmation()
    pendingDependencyDecision.value = null
    latestConflictDocument.value = null
    executionResult.value = []
    try {
      const saved = storage.load()
      if (saved === null) {
        draft.value = null
        validation.value = null
        selectedActionId.value = null
        return null
      }
      const canonical = agentPlanDraftSchema.parse(saved)
      const checked = validate(canonical, visibleDocument())
      const refreshed = withValidation(canonical, checked, canonical.status)
      draft.value = structuredClone(refreshed)
      validation.value = structuredClone(checked)
      selectedActionId.value = chooseInitialAction(refreshed)
      error.value = null
      return draft.value
    }
    catch (cause) {
      error.value = userError(cause, '无法读取计划草稿。')
      draft.value = null
      validation.value = null
      selectedActionId.value = null
      return null
    }
  }

  function setDraft(input: unknown) {
    if (!canMutate()) return false
    try {
      const parsed = agentPlanDraftSchema.parse(input)
      if (draft.value?.status === 'applied' && draft.value.id === parsed.id) {
        error.value = '该计划已经执行，不能再次修改或执行。'
        return false
      }
      return persistUserMutation({ ...parsed, status: 'draft' })
    }
    catch {
      error.value = '计划格式无效，无法保存。'
      return false
    }
  }

  function selectAction(actionId: string | null) {
    if (actionId === null) {
      selectedActionId.value = null
      return true
    }
    if (!draft.value?.actions.some(action => action.actionId === actionId)) return false
    selectedActionId.value = actionId
    return true
  }

  function updateAction(actionId: string, patch: ActionPatch) {
    if (!canEditDraft()) return false
    const current = draft.value
    if (!current) return false
    const index = current.actions.findIndex(action => action.actionId === actionId)
    if (index < 0) return false
    const original = current.actions[index]!
    try {
      const payloadPatch = patch.payload
      const candidate = {
        ...original,
        ...patch,
        actionId: original.actionId,
        type: original.type,
        payload: payloadPatch === undefined
          ? original.payload
          : { ...original.payload, ...payloadPatch },
      }
      const canonicalAction = agentActionSchema.parse(candidate)
      const next = structuredClone(current)
      next.actions[index] = canonicalAction
      return persistUserMutation(next)
    }
    catch (cause) {
      error.value = '操作内容无效，未保存这次修改。'
      return false
    }
  }

  function toggleAction(actionId: string, selected?: boolean) {
    if (!canEditDraft()) return false
    const current = draft.value
    if (!current) return false
    const target = current.actions.find(action => action.actionId === actionId)
    if (!target) return false
    const nextSelected = selected ?? !target.selected
    if (target.selected === nextSelected) return true

    if (!nextSelected && isCreateAction(target)) {
      const dependents = selectedTransitiveDependents(current.actions, target)
      if (dependents.length > 0) {
        pendingDependencyDecision.value = {
          actionId,
          dependentActionIds: dependents,
        }
        return false
      }
    }

    const next = structuredClone(current)
    const action = next.actions.find(item => item.actionId === actionId)!
    action.selected = nextSelected
    return persistUserMutation(next)
  }

  function resolveDeselectedDependency(resolution: AgentDependencyResolution) {
    if (!canEditDraft()) return false
    const decision = pendingDependencyDecision.value
    const current = draft.value
    if (!decision || !current) return false
    if (resolution === 'cancel') {
      pendingDependencyDecision.value = null
      return true
    }

    const ids = new Set([
      decision.actionId,
      ...(resolution === 'deselect-dependents' ? decision.dependentActionIds : []),
    ])
    const next = structuredClone(current)
    for (const action of next.actions) {
      if (ids.has(action.actionId)) action.selected = false
    }
    return persistUserMutation(next)
  }

  function discardDraft() {
    if (!canMutate()) return false
    try {
      storage.clear()
    }
    catch (cause) {
      error.value = userError(cause, '无法清理计划草稿。')
      return false
    }
    draft.value = null
    validation.value = null
    selectedActionId.value = null
    executionResult.value = []
    pendingDependencyDecision.value = null
    error.value = null
    durablyAppliedRevision = null
    clearConfirmation()
    loaded = true
    return true
  }

  function persistExecutionCheck(
    plan: AgentPlanDraftV1,
    checked: AgentPlanValidation,
    status: AgentPlanDraftV1['status'],
  ) {
    const next = withValidation(plan, checked, status)
    storage.save(next)
    draft.value = structuredClone(next)
    validation.value = structuredClone(checked)
    return next
  }

  async function runExecution(
    confirmedToken: string | null = null,
  ): Promise<AgentPlanExecutionResponse> {
    if (executing.value) return { status: 'busy' }
    const initial = draft.value
    if (!initial) return { status: 'no-draft' }
    if (initial.status === 'applied' || durablyAppliedRevision === revisionOf(initial)) {
      return { status: 'already-applied' }
    }
    if (confirmedToken !== null) {
      if (confirmedToken !== dangerConfirmationToken.value
        || dangerRevision === null
        || dangerRevision !== revisionOf(initial)
        || dangerWorkspaceRevision === null) {
        clearConfirmation()
        return { status: 'confirmation-stale' }
      }
    }

    executing.value = true
    error.value = null
    executionResult.value = []
    try {
      const latest = await workspace.readLatestDocument()
      if (confirmedToken !== null && workspaceRevisionOf(latest) !== dangerWorkspaceRevision) {
        clearConfirmation()
        return { status: 'confirmation-stale' }
      }
      const structural = validate(initial, latest, { dangerousConfirmed: true })
      const conflict = structural.issues.find(issue =>
        issue.code === 'conflict' || issue.code === 'missing-target')
      if (conflict) {
        latestConflictDocument.value = structuredClone(latest)
        persistExecutionCheck(initial, structural, 'conflicted')
        selectedActionId.value = conflict.actionId
        clearConfirmation()
        return { status: 'conflicted' }
      }
      if (!structural.executable) {
        persistExecutionCheck(initial, structural, 'draft')
        const issue = structural.issues[0]
        if (issue) selectedActionId.value = issue.actionId
        clearConfirmation()
        return { status: 'invalid' }
      }

      const currentRevision = revisionOf(initial)
      if (structural.dangerousCount > 0 && confirmedToken === null) {
        const unconfirmed = validate(initial, latest)
        persistExecutionCheck(initial, unconfirmed, 'draft')
        const workspaceRevision = workspaceRevisionOf(latest)
        const token = dangerTokenOf(currentRevision, workspaceRevision)
        dangerRevision = currentRevision
        dangerWorkspaceRevision = workspaceRevision
        dangerConfirmationToken.value = token
        dangerConfirmationDocument.value = structuredClone(latest)
        dangerConfirmationRequested.value = true
        return { status: 'confirmation-required', confirmationToken: token }
      }

      const prepared = persistExecutionCheck(initial, structural, 'draft')
      const simulated = simulate(prepared, latest)
      await workspace.replaceWorkspaceDocument(simulated.document, latest)
      const applied = agentPlanDraftSchema.parse({ ...prepared, status: 'applied' })
      draft.value = structuredClone(applied)
      validation.value = structuredClone(structural)
      executionResult.value = structuredClone(simulated.results)
      durablyAppliedRevision = revisionOf(applied)
      clearConfirmation()
      pendingDependencyDecision.value = null

      try {
        storage.save(applied)
      }
      catch (cause) {
        error.value = `计划已执行，但持久草稿清理失败：${userError(cause, '清理失败')}`
        return { status: 'applied-cleanup-failed', results: executionResult.value }
      }

      draft.value = null
      validation.value = null
      selectedActionId.value = null
      error.value = null
      return { status: 'executed', results: executionResult.value }
    }
    catch (cause) {
      const originalMessage = userError(cause, '计划执行失败。')
      const current = draft.value
      const failureStatus: 'conflicted' | 'failed' = isConflictError(cause) ? 'conflicted' : 'failed'
      if (current && current.status !== 'applied') {
        const failed = agentPlanDraftSchema.parse({ ...current, status: failureStatus })
        draft.value = structuredClone(failed)
        try {
          storage.save(failed)
        }
        catch {
          // Preserve the original execution error; this save is best effort.
        }
      }
      error.value = originalMessage
      executionResult.value = []
      clearConfirmation()
      return { status: failureStatus }
    }
    finally {
      executing.value = false
    }
  }

  function requestExecution() {
    return runExecution()
  }

  function confirmDangerousExecution(confirmationToken: string) {
    const current = draft.value
    if (typeof confirmationToken !== 'string'
      || !current
      || !dangerConfirmationRequested.value
      || dangerRevision === null
      || dangerWorkspaceRevision === null
      || dangerConfirmationToken.value === null) {
      return Promise.resolve<AgentPlanExecutionResponse>({ status: 'confirmation-stale' })
    }
    if (confirmationToken !== dangerConfirmationToken.value) {
      return Promise.resolve<AgentPlanExecutionResponse>({ status: 'confirmation-stale' })
    }
    if (dangerRevision !== revisionOf(current)) {
      clearConfirmation()
      return Promise.resolve<AgentPlanExecutionResponse>({ status: 'confirmation-stale' })
    }
    const confirmed = confirmationToken
    dangerConfirmationRequested.value = false
    return runExecution(confirmed)
  }

  function cancelDangerousConfirmation(confirmationToken?: string) {
    if (!dangerConfirmationRequested.value || dangerConfirmationToken.value === null) return false
    if (confirmationToken !== undefined && confirmationToken !== dangerConfirmationToken.value) return false
    clearConfirmation()
    return true
  }

  async function reloadConflictedAction(actionId: string): Promise<AgentPlanReloadResponse> {
    if (!canMutate()) return { status: 'blocked' }
    const current = draft.value
    const action = current?.actions.find(item => item.actionId === actionId)
    if (!current || !action || isCreateAction(action) || !action.targetId) {
      error.value = '这项改动没有可重新载入的现有记录。'
      return { status: 'blocked' }
    }
    const issue = validation.value?.issues.find(item => item.actionId === actionId
      && (item.code === 'conflict' || item.code === 'missing-target'))
    if (!issue) {
      error.value = '这项改动当前没有需要重新载入的数据冲突。'
      return { status: 'blocked' }
    }

    const before = structuredClone(current)
    try {
      const firstDocument = workspaceDocumentSchema.parse(await workspace.readLatestDocument())
      latestConflictDocument.value = structuredClone(firstDocument)
      const expectedOwnerId = expectedOwnerForReload(action, visibleDocument())
      const firstTarget = reloadTarget(action, firstDocument, expectedOwnerId)
      if (!firstTarget.ok) {
        showReloadIssue(before, actionId, firstTarget.message)
        return { status: 'blocked' }
      }

      // A second read closes the read-to-save window. The draft is never
      // rebased against a record that changed while the user clicked reload.
      const secondDocument = workspaceDocumentSchema.parse(await workspace.readLatestDocument())
      latestConflictDocument.value = structuredClone(secondDocument)
      const secondTarget = reloadTarget(action, secondDocument, expectedOwnerId)
      if (!secondTarget.ok || reloadSnapshot(firstTarget.record, firstDocument) !== reloadSnapshot(secondTarget.record, secondDocument)) {
        showReloadIssue(before, actionId, secondTarget.ok
          ? '目标记录在重新载入期间再次发生变化，请重试。'
          : secondTarget.message)
        return { status: 'blocked' }
      }

      const replacement = agentActionSchema.parse({
        ...action,
        expectedUpdatedAt: secondTarget.record.updatedAt,
        payload: reloadPayload(action, secondTarget.record),
      })
      const revised = structuredClone(before)
      const index = revised.actions.findIndex(item => item.actionId === actionId)
      revised.actions[index] = replacement
      const stamped = agentPlanDraftSchema.parse({ ...revised, updatedAt: now(), status: 'draft' })
      const checked = validate(stamped, secondDocument)
      const stillConflicted = checked.issues.some(issue => issue.code === 'conflict' || issue.code === 'missing-target')
      const next = withValidation(stamped, checked, stillConflicted ? 'conflicted' : 'draft')

      storage.save(next)
      draft.value = structuredClone(next)
      validation.value = structuredClone(checked)
      selectedActionId.value = actionId
      error.value = null
      clearConfirmation()
      pendingDependencyDecision.value = null
      latestConflictDocument.value = stillConflicted ? structuredClone(secondDocument) : null
      loaded = true
      return { status: 'reloaded' }
    }
    catch (cause) {
      // Keep the exact pre-click draft when reads or storage fail.
      draft.value = before
      error.value = userError(cause, '无法按当前数据重新载入，请重试。')
      return { status: 'failed' }
    }
  }

  async function refreshConflictSnapshot() {
    if (draft.value?.status !== 'conflicted') {
      latestConflictDocument.value = null
      return null
    }
    try {
      const latest = workspaceDocumentSchema.parse(await workspace.readLatestDocument())
      latestConflictDocument.value = structuredClone(latest)
      return structuredClone(latest)
    }
    catch (cause) {
      latestConflictDocument.value = null
      error.value = userError(cause, '无法读取当前工作区，冲突操作暂时不可用。')
      return null
    }
  }

  function showReloadIssue(plan: AgentPlanDraftV1, actionId: string, message: string) {
    const existing = validation.value?.issues.filter(issue => issue.actionId !== actionId) ?? []
    const issues = [...existing, { actionId, code: 'missing-target' as const, field: 'targetId', message }]
    validation.value = {
      executable: false,
      selectedCount: validation.value?.selectedCount ?? plan.actions.filter(action => action.selected).length,
      dangerousCount: validation.value?.dangerousCount ?? plan.actions.filter(action => action.selected && action.dangerous).length,
      estimatedMinutes: validation.value?.estimatedMinutes ?? 0,
      issues,
    }
    selectedActionId.value = actionId
    error.value = message
  }

  function clearError() {
    error.value = null
  }

  function clearExecutionResult() {
    executionResult.value = []
  }

  function canMutate() {
    if (!executing.value) return true
    error.value = '计划正在执行，请等待当前操作完成。'
    return false
  }

  function canEditDraft() {
    if (!canMutate()) return false
    if (draft.value?.status !== 'applied') return true
    error.value = '该计划已经执行，不能再次修改或执行。'
    return false
  }

  return {
    draft,
    validation,
    selectedActionId,
    executing,
    executionResult,
    error,
    latestConflictDocument,
    dangerConfirmationRequested,
    dangerConfirmationToken,
    dangerConfirmationDocument,
    pendingDependencyDecision,
    loadDraft,
    setDraft,
    selectAction,
    updateAction,
    toggleAction,
    resolveDeselectedDependency,
    discardDraft,
    requestExecution,
    confirmDangerousExecution,
    cancelDangerousConfirmation,
    reloadConflictedAction,
    refreshConflictSnapshot,
    clearError,
    clearExecutionResult,
  }
}

export type AgentPlanController = ReturnType<typeof createAgentPlanController>

export function useAgentPlan(): AgentPlanController {
  const workspace = useWorkspace()
  const key = workspace as object
  const existing = singletonControllers.get(key)
  if (existing) return existing

  const storage = typeof localStorage === 'undefined'
    ? transientStorage()
    : createAgentPlanStorage(localStorage)
  const controller = createAgentPlanController({ storage, workspace })
  singletonControllers.set(key, controller)
  return controller
}

function selectedTransitiveDependents(actions: AgentAction[], parent: AgentAction) {
  const parentRef = isCreateAction(parent) ? parent.draftRef : undefined
  if (!parentRef) return []
  const selected = actions.filter(action => action.selected)
  const dependents: string[] = []
  const refs = new Set([parentRef])
  let changed = true
  while (changed) {
    changed = false
    for (const action of selected) {
      if (action.actionId === parent.actionId || dependents.includes(action.actionId)) continue
      if (!actionDraftRefs(action).some(ref => refs.has(ref))) continue
      dependents.push(action.actionId)
      if (isCreateAction(action) && action.draftRef) refs.add(action.draftRef)
      changed = true
    }
  }
  return dependents
}

function actionDraftRefs(action: AgentAction) {
  if (action.type === 'createMilestone') {
    return action.payload.projectId.kind === 'draft' ? [action.payload.projectId.ref] : []
  }
  if (action.type === 'createTask') {
    return [action.payload.projectId, action.payload.milestoneId]
      .filter(reference => reference?.kind === 'draft')
      .map(reference => reference!.ref)
  }
  return []
}

function isCreateAction(action: AgentAction): action is Extract<AgentAction, {
  type: 'createProject' | 'createMilestone' | 'createTask'
}> {
  return action.type === 'createProject'
    || action.type === 'createMilestone'
    || action.type === 'createTask'
}

function revisionOf(plan: AgentPlanDraftV1) {
  const selectedDeletes = plan.actions
    .filter(action => action.selected && action.dangerous)
    .map(action => action.actionId)
    .sort()
  return JSON.stringify([plan.id, plan.updatedAt, selectedDeletes])
}

function workspaceRevisionOf(document: WorkspaceDocument) {
  return JSON.stringify(workspaceDocumentSchema.parse(document))
}

function dangerTokenOf(planRevision: string, workspaceRevision: string) {
  return JSON.stringify([planRevision, workspaceRevision])
}

function isConflictError(cause: unknown) {
  return cause instanceof WorkspaceError && cause.code === 'conflict'
    || cause instanceof AgentPlanSimulationError && cause.field === 'expectedUpdatedAt'
}

function userError(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message.trim()) return cause.message
  return fallback
}

type ExistingAction = Exclude<AgentAction, {
  type: 'createProject' | 'createMilestone' | 'createTask'
}>

type ReloadRecord = Project | Milestone | Task

function expectedOwnerForReload(action: ExistingAction, document: WorkspaceDocument) {
  return findReloadRecord(action, document)?.ownerId
    ?? document.projects[0]?.ownerId
    ?? document.milestones[0]?.ownerId
    ?? document.tasks[0]?.ownerId
    ?? null
}

function findReloadRecord(action: ExistingAction, document: WorkspaceDocument): ReloadRecord | undefined {
  if (action.type.endsWith('Project')) return document.projects.find(item => item.id === action.targetId)
  if (action.type.endsWith('Milestone')) return document.milestones.find(item => item.id === action.targetId)
  return document.tasks.find(item => item.id === action.targetId)
}

function reloadTarget(
  action: ExistingAction,
  document: WorkspaceDocument,
  expectedOwnerId: string | null,
): { ok: true, record: ReloadRecord } | { ok: false, message: string } {
  const record = findReloadRecord(action, document)
  if (!record) {
    const existsAsDifferentType = [...document.projects, ...document.milestones, ...document.tasks]
      .some(item => item.id === action.targetId)
    return { ok: false, message: existsAsDifferentType ? '目标记录类型已不匹配，不能重新载入。' : '目标记录已不存在，不能重新载入。' }
  }
  if (record.deletedAt !== null) return { ok: false, message: '目标记录已移入回收站，不能重新载入。' }
  if (expectedOwnerId !== null && record.ownerId !== expectedOwnerId) {
    return { ok: false, message: '目标记录的所有者已不匹配，不能重新载入。' }
  }
  if ('projectId' in record && typeof record.projectId === 'string') {
    const project = document.projects.find(item => item.id === record.projectId)
    if (!project || project.deletedAt !== null || project.ownerId !== record.ownerId) {
      return { ok: false, message: '目标记录的项目关系已失效，请重新归属或让 AI 重新规划。' }
    }
  }
  if ('milestoneId' in record && record.milestoneId !== null) {
    const milestone = document.milestones.find(item => item.id === record.milestoneId)
    if (!milestone || milestone.deletedAt !== null || milestone.ownerId !== record.ownerId || milestone.projectId !== record.projectId) {
      return { ok: false, message: '目标任务的里程碑关系已失效，请重新归属或让 AI 重新规划。' }
    }
  }
  return { ok: true, record }
}

function reloadSnapshot(record: ReloadRecord, document: WorkspaceDocument) {
  const relations: ReloadRecord[] = []
  if ('projectId' in record && typeof record.projectId === 'string') {
    const project = document.projects.find(item => item.id === record.projectId)
    if (project) relations.push(project)
  }
  if ('milestoneId' in record && record.milestoneId !== null) {
    const milestone = document.milestones.find(item => item.id === record.milestoneId)
    if (milestone) relations.push(milestone)
  }
  return JSON.stringify([record, relations])
}

function reloadPayload(action: ExistingAction, record: ReloadRecord): AgentAction['payload'] {
  if (action.type === 'deleteProject' || action.type === 'deleteMilestone' || action.type === 'deleteTask') return {}
  if (action.type === 'setProjectCompleted') return { completed: (record as Project).status === 'completed' }
  if (action.type === 'setMilestoneCompleted') return { completed: (record as Milestone).status === 'completed' }
  if (action.type === 'setTaskCompleted') {
    const task = record as Task
    return { completed: task.completedAt !== null || task.status === 'done' }
  }
  if (action.type === 'updateProject') {
    const project = record as Project
    return {
      name: project.name, color: project.color, description: project.description,
      priority: project.priority, status: project.status, targetDate: project.targetDate,
    }
  }
  if (action.type === 'updateMilestone') {
    const milestone = record as Milestone
    return {
      projectId: milestone.projectId, title: milestone.title, description: milestone.description,
      targetDate: milestone.targetDate, status: milestone.status,
      progressMode: milestone.progressMode, progress: milestone.progress,
    }
  }
  const task = record as Task
  return {
    projectId: task.projectId, milestoneId: task.milestoneId, title: task.title,
    description: task.description, priority: task.priority, dueDate: task.dueDate,
    dueTime: task.dueTime, isFocus: task.isFocus, status: task.status,
    importance: task.importance, estimatedMinutes: task.estimatedMinutes,
    reminderAt: task.reminderAt, snoozedUntil: task.snoozedUntil,
    lastRemindedAt: task.lastRemindedAt,
  }
}

function transientStorage(): AgentPlanStorage {
  let saved: AgentPlanDraftV1 | null = null
  return {
    load: () => saved === null ? null : structuredClone(saved),
    save: (draft) => { saved = structuredClone(agentPlanDraftSchema.parse(draft)) },
    clear: () => { saved = null },
  }
}

import { z } from 'zod'
import { agentActionSchema, agentPlanDraftSchema } from './agent-plan-schema'
import type { AgentPlanDraftV1 } from './agent-plan-schema'
import { workspaceDocumentSchema } from '#shared/workspace'
import type { Milestone, Project, QuarterGoal, Task, WorkspaceDocument } from '#shared/workspace'

export type AgentPlanIssueCode = 'field' | 'missing-target' | 'conflict' | 'dependency' | 'danger-confirmation'

export type AgentPlanIssue = {
  actionId: string
  code: AgentPlanIssueCode
  field?: string
  message: string
}

export type AgentPlanValidationOptions = {
  dangerousConfirmed?: boolean
}

export type AgentPlanValidation = {
  executable: boolean
  selectedCount: number
  dangerousCount: number
  estimatedMinutes: number
  issues: AgentPlanIssue[]
}

type RawAction = Record<string, unknown>
type RawPayload = Record<string, unknown>
type EntityKind = 'project' | 'milestone' | 'task'

type IndexedIssue = AgentPlanIssue & {
  actionIndex: number
  sequence: number
}

const CREATE_TYPES = new Set(['createProject', 'createMilestone', 'createTask'])
const DELETE_TYPES = new Set(['deleteProject', 'deleteMilestone', 'deleteTask'])
const PROJECT_TYPES = new Set(['updateProject', 'setProjectCompleted', 'deleteProject'])
const MILESTONE_TYPES = new Set(['updateMilestone', 'setMilestoneCompleted', 'deleteMilestone'])
const TASK_TYPES = new Set(['updateTask', 'setTaskCompleted', 'deleteTask'])
const PROJECT_STATUSES = new Set(['planned', 'active', 'paused', 'completed'])
const MILESTONE_STATUSES = new Set(['planned', 'in_progress', 'blocked', 'completed'])
const TASK_STATUSES = new Set(['inbox', 'todo', 'in_progress', 'waiting', 'done', 'cancelled'])
const PRIORITIES = new Set(['low', 'medium', 'high'])
const IMPORTANCE = new Set(['normal', 'important'])
const PROGRESS_MODES = new Set(['auto', 'manual'])
const MAX_AGENT_ACTIONS = 30
const agentPlanEnvelopeSchema = agentPlanDraftSchema
  .omit({ actions: true })
  .extend({ actions: z.array(z.unknown()).max(MAX_AGENT_ACTIONS) })
  .strict()
const ACTION_TYPES = new Set([
  'createProject', 'updateProject', 'setProjectCompleted', 'deleteProject',
  'createMilestone', 'updateMilestone', 'setMilestoneCompleted', 'deleteMilestone',
  'createTask', 'updateTask', 'setTaskCompleted', 'deleteTask',
])

const FIELD_PRIORITY = [
  'actionId',
  'type',
  'reason',
  'selected',
  'dangerous',
  'draftRef',
  'targetId',
  'expectedUpdatedAt',
  'payload',
  'payload.name',
  'payload.title',
  'payload.color',
  'payload.description',
  'payload.priority',
  'payload.status',
  'payload.targetDate',
  'payload.projectId',
  'payload.milestoneId',
  'payload.progressMode',
  'payload.progress',
  'payload.dueDate',
  'payload.dueTime',
  'payload.isFocus',
  'payload.importance',
  'payload.estimatedMinutes',
  'payload.reminderAt',
  'payload.snoozedUntil',
  'payload.lastRemindedAt',
  'payload.completed',
] as const

const FIELD_PRIORITY_INDEX = new Map<string, number>(FIELD_PRIORITY.map((field, index) => [field, index]))

/**
 * Performs a read-only validation of a canonical Agent draft against one
 * workspace snapshot. The validator intentionally does not call a gateway or
 * derive time-dependent values.
 */
export function validateAgentPlan(
  draft: AgentPlanDraftV1,
  document: WorkspaceDocument,
  options: AgentPlanValidationOptions = {},
): AgentPlanValidation {
  return safeValidateAgentPlan(draft, document, options)
}

/**
 * Non-throwing boundary for callers that have not parsed persisted or model
 * data yet. Action schema issues are reported only for selected actions;
 * draft-level issues use the stable synthetic actionId `draft`.
 */
export function safeValidateAgentPlan(
  draft: unknown,
  document: unknown,
  options: AgentPlanValidationOptions = {},
): AgentPlanValidation {
  const rawDraft = isObject(draft) ? draft : {}
  const rawDocument = isObject(document) ? document : {}
  const rawActions = Array.isArray(rawDraft.actions) ? rawDraft.actions : []
  if (rawActions.length > MAX_AGENT_ACTIONS) return actionOverflowValidation()

  const envelopeParse = agentPlanEnvelopeSchema.safeParse(draft)
  const actionParses = rawActions.map(action => agentActionSchema.safeParse(action))
  const actions: RawAction[] = actionParses.map((result, index) =>
    result.success
      ? result.data as RawAction
      : isObject(rawActions[index]) ? rawActions[index] : {},
  )

  const documentParse = workspaceDocumentSchema.safeParse(document)
  const canonicalDocument = documentParse.success ? documentParse.data : rawDocument
  const projects = arrayOf<Project>(canonicalDocument.projects)
  const milestones = arrayOf<Milestone>(canonicalDocument.milestones)
  const tasks = arrayOf<Task>(canonicalDocument.tasks)
  const quarterGoals = arrayOf<QuarterGoal>(canonicalDocument.quarterGoals)
  const projectsById = new Map(projects.map(project => [project.id, project]))
  const milestonesById = new Map(milestones.map(milestone => [milestone.id, milestone]))
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const createByRef = new Map<string, { action: RawAction, index: number }>()
  const createCandidatesByRef = new Map<string, Array<{ action: RawAction, index: number }>>()
  const duplicateActionIds = new Set<number>()
  const duplicateDraftRefs = new Set<number>()
  const indexedIssues: IndexedIssue[] = []
  const issueKeys = new Set<string>()
  let sequence = 0

  const addIssue = (
    actionIndex: number,
    action: RawAction,
    code: AgentPlanIssueCode,
    message: string,
    field?: string,
  ) => {
    const actionId = readableActionId(action, actionIndex)
    const issueKey = `${actionIndex}|${actionId}|${code}|${field ?? ''}`
    if (issueKeys.has(issueKey)) return
    issueKeys.add(issueKey)
    indexedIssues.push({
      actionIndex,
      sequence: sequence++,
      actionId,
      code,
      ...(field ? { field } : {}),
      message,
    })
  }

  actions.forEach((action, index) => {
    if (CREATE_TYPES.has(asString(action.type)) && isNonEmptyString(action.draftRef)) {
      const candidates = createCandidatesByRef.get(action.draftRef) ?? []
      candidates.push({ action, index })
      createCandidatesByRef.set(action.draftRef, candidates)
      if (!createByRef.has(action.draftRef)) createByRef.set(action.draftRef, { action, index })
    }
  })

  const relevantIndices = collectRelevantActionIndices(actions, createCandidatesByRef)
  const seenActionIds = new Set<string>()
  const seenDraftRefs = new Set<string>()
  for (const index of [...relevantIndices].sort((left, right) => left - right)) {
    const action = actions[index]!
    if (isNonEmptyString(action.actionId)) {
      if (seenActionIds.has(action.actionId)) duplicateActionIds.add(index)
      else seenActionIds.add(action.actionId)
    }
    if (CREATE_TYPES.has(asString(action.type)) && isNonEmptyString(action.draftRef)) {
      if (seenDraftRefs.has(action.draftRef)) duplicateDraftRefs.add(index)
      else seenDraftRefs.add(action.draftRef)
    }
  }

  addEnvelopeSchemaIssues(envelopeParse, addIssue)
  actionParses.forEach((result, index) => {
    addActionSchemaIssues(result, rawActions[index], actions[index]!, index, addIssue)
  })
  addDocumentSchemaIssues(documentParse, addIssue)

  const expectedOwnerId = findExpectedOwnerId(projects, milestones, tasks, quarterGoals)
  if (expectedOwnerId && [...projects, ...milestones, ...tasks, ...quarterGoals]
    .some(record => record.ownerId !== expectedOwnerId)) {
    addIssue(-1, { actionId: 'draft' }, 'field', '工作区包含不同所有者的数据，计划已被阻止。', 'document.ownerId')
  }

  let selectedCount = 0
  let dangerousCount = 0
  let estimatedMinutes = 0
  const dependencyEdges = new Map<number, number[]>()

  actions.forEach((action, index) => {
    const selectionInvalid = typeof action.selected !== 'boolean'
    const selected = action.selected === true
    if ((selected || selectionInvalid) && !isNonEmptyString(action.actionId)) {
      addIssue(index, action, 'field', '操作缺少有效的 actionId。', 'actionId')
    }
    if (duplicateActionIds.has(index)) {
      addIssue(index, action, 'field', 'actionId 与前面的操作重复。', 'actionId')
    }
    if (selected && CREATE_TYPES.has(asString(action.type)) && !isNonEmptyString(action.draftRef)) {
      addIssue(index, action, 'field', '新建操作必须提供唯一的 draftRef。', 'draftRef')
    }
    if (duplicateDraftRefs.has(index)) {
      addIssue(index, action, 'field', 'draftRef 与前面的新建操作重复。', 'draftRef')
    }

    if (selectionInvalid) {
      addIssue(index, action, 'field', 'selected 必须是布尔值。', 'selected')
    }

    if (!selected) return
    selectedCount += 1

    const type = asString(action.type)
    if (!ACTION_TYPES.has(type)) {
      addIssue(index, action, 'field', '不支持的操作类型。', 'type')
      return
    }
    if (action.dangerous !== DELETE_TYPES.has(type)) {
      addIssue(index, action, 'field', '操作的危险标记与操作类型不一致。', 'dangerous')
    }

    const payload = isObject(action.payload) ? action.payload : null
    if (!payload) addIssue(index, action, 'field', '操作缺少有效的 payload。', 'payload')

    if (CREATE_TYPES.has(type)) {
      validateCreateAction(type, action, payload, index, {
        addIssue,
        createByRef,
        dependencyEdges,
        projectsById,
        milestonesById,
        expectedOwnerId,
      })
    } else {
      const target = validateExistingTarget(
        type,
        action,
        index,
        projectsById,
        milestonesById,
        tasksById,
        expectedOwnerId,
        addIssue,
      )
      validateExistingPayload(type, action, payload, target, index, {
        addIssue,
        projectsById,
        milestonesById,
        expectedOwnerId,
      })
    }

    if (type === 'createTask' || type === 'updateTask') {
      const estimate = payload?.estimatedMinutes
      if (estimate !== null && estimate !== undefined && validEstimatedMinutes(estimate)) {
        estimatedMinutes = Math.min(Number.MAX_SAFE_INTEGER, estimatedMinutes + estimate)
      }
    }

    if (DELETE_TYPES.has(type)) {
      dangerousCount += 1
      if (!options.dangerousConfirmed) {
        addIssue(index, action, 'danger-confirmation', '移入回收站前需要再次确认。')
      }
    }
  })

  const cyclicActions = findCyclicActions(actions, dependencyEdges)
  for (const actionIndex of cyclicActions) {
    addIssue(actionIndex, actions[actionIndex]!, 'dependency', '新建记录之间存在循环依赖。', 'draftRef')
  }

  indexedIssues.sort((left, right) =>
    left.actionIndex - right.actionIndex
    || fieldPriority(left.field) - fieldPriority(right.field)
    || left.sequence - right.sequence,
  )
  const issues = indexedIssues.map(({ actionIndex: _actionIndex, sequence: _sequence, ...issue }) => issue)

  return {
    executable: selectedCount > 0 && issues.length === 0,
    selectedCount,
    dangerousCount,
    estimatedMinutes,
    issues,
  }
}

type ValidationContext = {
  addIssue: (
    actionIndex: number,
    action: RawAction,
    code: AgentPlanIssueCode,
    message: string,
    field?: string,
  ) => void
  createByRef: Map<string, { action: RawAction, index: number }>
  dependencyEdges: Map<number, number[]>
  projectsById: Map<string, Project>
  milestonesById: Map<string, Milestone>
  expectedOwnerId: string | null
}

function validateCreateAction(
  type: string,
  action: RawAction,
  payload: RawPayload | null,
  index: number,
  context: ValidationContext,
) {
  if (!payload) return
  if (type === 'createProject') {
    validateProjectFields(action, payload, index, context.addIssue, false)
    return
  }
  if (type === 'createMilestone') {
    validateMilestoneFields(action, payload, index, context.addIssue, false)
    resolveProjectReference(payload.projectId, action, index, 'payload.projectId', context)
    return
  }

  validateTaskFields(action, payload, index, context.addIssue, false)
  const projectKey = resolveProjectReference(payload.projectId, action, index, 'payload.projectId', context, true)
  const milestoneResolution = resolveMilestoneReference(payload.milestoneId, action, index, context)
  if (projectKey && milestoneResolution.projectKey && projectKey !== milestoneResolution.projectKey) {
    context.addIssue(index, action, 'field', '所选里程碑不属于所选项目。', 'payload.milestoneId')
  }
}

function validateExistingTarget(
  type: string,
  action: RawAction,
  index: number,
  projectsById: Map<string, Project>,
  milestonesById: Map<string, Milestone>,
  tasksById: Map<string, Task>,
  expectedOwnerId: string | null,
  addIssue: ValidationContext['addIssue'],
): Project | Milestone | Task | null {
  if (!isNonEmptyString(action.targetId)) {
    addIssue(index, action, 'field', '现有记录操作缺少有效的 targetId。', 'targetId')
    return null
  }

  const target = PROJECT_TYPES.has(type)
    ? projectsById.get(action.targetId)
    : MILESTONE_TYPES.has(type)
      ? milestonesById.get(action.targetId)
      : TASK_TYPES.has(type)
        ? tasksById.get(action.targetId)
        : undefined
  if (!target || target.deletedAt !== null || !hasExpectedOwner(target, expectedOwnerId)) {
    addIssue(index, action, 'missing-target', '目标记录不存在、类型不匹配或已移入回收站。', 'targetId')
    return null
  }

  if ('projectId' in target && typeof target.projectId === 'string') {
    const parentProject = projectsById.get(target.projectId)
    if (!isActiveProject(parentProject, expectedOwnerId)) {
      addIssue(index, action, 'missing-target', '目标记录的所属项目不存在或所有者不匹配。', 'targetId')
      return null
    }
  }
  if (isTask(target) && target.milestoneId !== null) {
    const parentMilestone = milestonesById.get(target.milestoneId)
    if (!parentMilestone
      || parentMilestone.deletedAt !== null
      || !hasExpectedOwner(parentMilestone, expectedOwnerId)
      || parentMilestone.projectId !== target.projectId) {
      addIssue(index, action, 'missing-target', '目标任务的里程碑关系无效或所有者不匹配。', 'targetId')
      return null
    }
  }

  if (!validIsoTimestamp(action.expectedUpdatedAt)) {
    addIssue(index, action, 'field', 'expectedUpdatedAt 必须是有效的 ISO 时间。', 'expectedUpdatedAt')
  } else if (action.expectedUpdatedAt !== target.updatedAt) {
    addIssue(index, action, 'conflict', '目标记录已发生变化，请按当前数据重新载入。', 'expectedUpdatedAt')
  }
  return target
}

function validateExistingPayload(
  type: string,
  action: RawAction,
  payload: RawPayload | null,
  target: Project | Milestone | Task | null,
  index: number,
  context: Pick<ValidationContext, 'addIssue' | 'projectsById' | 'milestonesById' | 'expectedOwnerId'>,
) {
  if (!payload) return
  if (type === 'updateProject') {
    validateNonEmptyPatch(action, payload, index, context.addIssue)
    validateProjectFields(action, payload, index, context.addIssue, true)
    return
  }
  if (type === 'updateMilestone') {
    validateNonEmptyPatch(action, payload, index, context.addIssue)
    validateMilestoneFields(action, payload, index, context.addIssue, true)
    if (payload.projectId !== undefined) {
      validateExistingProjectId(payload.projectId, action, index, 'payload.projectId', context)
    }
    return
  }
  if (type === 'updateTask') {
    validateNonEmptyPatch(action, payload, index, context.addIssue)
    validateTaskFields(action, payload, index, context.addIssue, true, target && isTask(target) ? target : null)
    validateUpdateTaskRelationships(
      action,
      payload,
      target && isTask(target) ? target : null,
      index,
      context,
    )
    return
  }
  if (type.startsWith('set')) {
    if (typeof payload.completed !== 'boolean') {
      context.addIssue(index, action, 'field', '完成操作必须明确 completed 状态。', 'payload.completed')
    }
    return
  }
  if (DELETE_TYPES.has(type) && Object.keys(payload).length > 0) {
    context.addIssue(index, action, 'field', '移入回收站操作不接受额外字段。', 'payload')
  }
}

function validateProjectFields(
  action: RawAction,
  payload: RawPayload,
  index: number,
  addIssue: ValidationContext['addIssue'],
  patch: boolean,
) {
  validateTrimmedString(payload, 'name', 80, action, index, addIssue, patch)
  validateColor(payload, 'color', action, index, addIssue, patch)
  validateDescription(payload, action, index, addIssue, patch)
  validateNullableEnum(payload, 'priority', PRIORITIES, action, index, addIssue, patch)
  validateEnum(payload, 'status', PROJECT_STATUSES, action, index, addIssue, patch)
  validateNullableDate(payload, 'targetDate', action, index, addIssue, patch)
}

function validateMilestoneFields(
  action: RawAction,
  payload: RawPayload,
  index: number,
  addIssue: ValidationContext['addIssue'],
  patch: boolean,
) {
  validateTrimmedString(payload, 'title', 160, action, index, addIssue, patch)
  validateDescription(payload, action, index, addIssue, patch)
  validateNullableDate(payload, 'targetDate', action, index, addIssue, patch)
  validateEnum(payload, 'status', MILESTONE_STATUSES, action, index, addIssue, patch)
  validateEnum(payload, 'progressMode', PROGRESS_MODES, action, index, addIssue, patch)
  if (shouldValidate(payload, 'progress', patch) && !validIntegerRange(payload.progress, 0, 100)) {
    addIssue(index, action, 'field', '进度必须是 0 到 100 的整数。', 'payload.progress')
  }
}

function validateTaskFields(
  action: RawAction,
  payload: RawPayload,
  index: number,
  addIssue: ValidationContext['addIssue'],
  patch: boolean,
  target: Task | null = null,
) {
  validateTrimmedString(payload, 'title', 160, action, index, addIssue, patch)
  validateDescription(payload, action, index, addIssue, patch)
  validateNullableEnum(payload, 'priority', PRIORITIES, action, index, addIssue, patch)
  validateNullableDate(payload, 'dueDate', action, index, addIssue, patch)
  validateNullableTime(payload, 'dueTime', action, index, addIssue, patch)
  if (shouldValidate(payload, 'isFocus', patch) && typeof payload.isFocus !== 'boolean') {
    addIssue(index, action, 'field', '是否为今日焦点必须是布尔值。', 'payload.isFocus')
  }
  if (payload.status !== undefined && !TASK_STATUSES.has(asString(payload.status))) {
    addIssue(index, action, 'field', '任务状态无效。', 'payload.status')
  }
  if (payload.importance !== undefined && !IMPORTANCE.has(asString(payload.importance))) {
    addIssue(index, action, 'field', '任务重要程度无效。', 'payload.importance')
  }
  if (payload.estimatedMinutes !== undefined
    && payload.estimatedMinutes !== null
    && !validEstimatedMinutes(payload.estimatedMinutes)) {
    addIssue(index, action, 'field', '预计分钟数必须是 5 到 1440 的整数。', 'payload.estimatedMinutes')
  }
  for (const field of ['reminderAt', 'snoozedUntil', 'lastRemindedAt'] as const) {
    if (payload[field] !== undefined && payload[field] !== null && !validIsoTimestamp(payload[field])) {
      addIssue(index, action, 'field', `${field} 必须是 ISO 时间。`, `payload.${field}`)
    }
  }

  const effectiveDueDate = payload.dueDate !== undefined ? payload.dueDate : target?.dueDate
  const effectiveDueTime = payload.dueTime !== undefined ? payload.dueTime : target?.dueTime
  if (effectiveDueTime !== null && effectiveDueTime !== undefined && effectiveDueDate === null) {
    addIssue(index, action, 'field', '设置具体时间前必须先设置到期日期。', 'payload.dueTime')
  }
}

function validateUpdateTaskRelationships(
  action: RawAction,
  payload: RawPayload,
  target: Task | null,
  index: number,
  context: Pick<ValidationContext, 'addIssue' | 'projectsById' | 'milestonesById' | 'expectedOwnerId'>,
) {
  if (payload.projectId !== undefined && payload.projectId !== null) {
    validateExistingProjectId(payload.projectId, action, index, 'payload.projectId', context)
  }
  if (payload.milestoneId !== undefined && payload.milestoneId !== null && !isNonEmptyString(payload.milestoneId)) {
    context.addIssue(index, action, 'field', '里程碑 ID 无效。', 'payload.milestoneId')
    return
  }

  const explicitMilestoneId = payload.milestoneId
  if (typeof explicitMilestoneId === 'string') {
    const milestone = context.milestonesById.get(explicitMilestoneId)
    if (!milestone
      || milestone.deletedAt !== null
      || !hasExpectedOwner(milestone, context.expectedOwnerId)
      || !isActiveProject(context.projectsById.get(milestone.projectId), context.expectedOwnerId)) {
      context.addIssue(index, action, 'missing-target', '所选里程碑不存在或已移入回收站。', 'payload.milestoneId')
      return
    }
    if (typeof payload.projectId === 'string' && payload.projectId !== milestone.projectId) {
      context.addIssue(index, action, 'field', '所选里程碑不属于所选项目。', 'payload.milestoneId')
    }
    return
  }

  if (explicitMilestoneId === undefined
    && typeof payload.projectId === 'string'
    && target?.milestoneId
    && target.projectId === payload.projectId) {
    const milestone = context.milestonesById.get(target.milestoneId)
    if (milestone && milestone.projectId !== payload.projectId) {
      context.addIssue(index, action, 'field', '任务现有里程碑与项目不兼容。', 'payload.milestoneId')
    }
  }
}

function resolveProjectReference(
  value: unknown,
  action: RawAction,
  index: number,
  field: string,
  context: ValidationContext,
  nullable = false,
): string | null {
  if (value === null && nullable) return null
  if (!isObject(value) || (value.kind !== 'existing' && value.kind !== 'draft')) {
    context.addIssue(index, action, 'field', '项目引用格式无效。', field)
    return null
  }
  if (value.kind === 'existing') {
    if (!isNonEmptyString(value.id)) {
      context.addIssue(index, action, 'field', '项目 ID 无效。', field)
      return null
    }
    const project = context.projectsById.get(value.id)
    if (!isActiveProject(project, context.expectedOwnerId)) {
      context.addIssue(index, action, 'missing-target', '所选项目不存在或已移入回收站。', field)
      return null
    }
    return `project:${project.id}`
  }
  return resolveDraftReference(value.ref, 'createProject', action, index, field, context)
}

function resolveMilestoneReference(
  value: unknown,
  action: RawAction,
  index: number,
  context: ValidationContext,
): { key: string | null, projectKey: string | null } {
  if (value === null) return { key: null, projectKey: null }
  if (!isObject(value) || (value.kind !== 'existing' && value.kind !== 'draft')) {
    context.addIssue(index, action, 'field', '里程碑引用格式无效。', 'payload.milestoneId')
    return { key: null, projectKey: null }
  }
  if (value.kind === 'existing') {
    if (!isNonEmptyString(value.id)) {
      context.addIssue(index, action, 'field', '里程碑 ID 无效。', 'payload.milestoneId')
      return { key: null, projectKey: null }
    }
    const milestone = context.milestonesById.get(value.id)
    if (!milestone
      || milestone.deletedAt !== null
      || !hasExpectedOwner(milestone, context.expectedOwnerId)
      || !isActiveProject(context.projectsById.get(milestone.projectId), context.expectedOwnerId)) {
      context.addIssue(index, action, 'missing-target', '所选里程碑不存在或已移入回收站。', 'payload.milestoneId')
      return { key: null, projectKey: null }
    }
    return { key: `milestone:${milestone.id}`, projectKey: `project:${milestone.projectId}` }
  }

  const key = resolveDraftReference(value.ref, 'createMilestone', action, index, 'payload.milestoneId', context)
  if (!key || !isNonEmptyString(value.ref)) return { key: null, projectKey: null }
  const parent = context.createByRef.get(value.ref)
  const parentPayload = parent && isObject(parent.action.payload) ? parent.action.payload : null
  const projectKey = parentPayload
    ? resolveProjectReferenceWithoutIssues(parentPayload.projectId, context)
    : null
  return { key, projectKey }
}

function resolveDraftReference(
  ref: unknown,
  expectedType: string,
  action: RawAction,
  index: number,
  field: string,
  context: ValidationContext,
): string | null {
  if (!isNonEmptyString(ref)) {
    context.addIssue(index, action, 'field', 'draftRef 引用无效。', field)
    return null
  }
  const parent = context.createByRef.get(ref)
  if (!parent) {
    context.addIssue(index, action, 'dependency', '引用的新建记录不存在。', field)
    return null
  }
  const edges = context.dependencyEdges.get(index) ?? []
  edges.push(parent.index)
  context.dependencyEdges.set(index, edges)
  if (parent.action.type !== expectedType) {
    context.addIssue(index, action, 'dependency', '引用的新建记录类型不匹配。', field)
    return null
  }
  if (parent.action.selected !== true) {
    context.addIssue(index, action, 'dependency', '依赖的新建记录未被选中。', field)
    return null
  }
  return `${expectedType}:${ref}`
}

function resolveProjectReferenceWithoutIssues(value: unknown, context: ValidationContext): string | null {
  if (!isObject(value)) return null
  if (value.kind === 'existing' && isNonEmptyString(value.id)) return `project:${value.id}`
  if (value.kind !== 'draft' || !isNonEmptyString(value.ref)) return null
  const parent = context.createByRef.get(value.ref)
  return parent?.action.type === 'createProject' ? `createProject:${value.ref}` : null
}

function validateExistingProjectId(
  value: unknown,
  action: RawAction,
  index: number,
  field: string,
  context: Pick<ValidationContext, 'addIssue' | 'projectsById' | 'expectedOwnerId'>,
) {
  if (!isNonEmptyString(value)) {
    context.addIssue(index, action, 'field', '项目 ID 无效。', field)
    return false
  }
  if (!isActiveProject(context.projectsById.get(value), context.expectedOwnerId)) {
    context.addIssue(index, action, 'missing-target', '所选项目不存在或已移入回收站。', field)
    return false
  }
  return true
}

function validateNonEmptyPatch(
  action: RawAction,
  payload: RawPayload,
  index: number,
  addIssue: ValidationContext['addIssue'],
) {
  if (!Object.values(payload).some(value => value !== undefined)) {
    addIssue(index, action, 'field', '更新操作至少需要一个字段。', 'payload')
  }
}

type SafeParseIssue = {
  code: string
  path: readonly PropertyKey[]
  message: string
  keys?: readonly PropertyKey[]
}

type SafeParseResult = {
  success: boolean
  error?: { issues: readonly SafeParseIssue[] }
}

function addEnvelopeSchemaIssues(
  result: SafeParseResult,
  addIssue: ValidationContext['addIssue'],
) {
  if (result.success || !result.error) return
  for (const issue of result.error.issues) {
    const path = issue.path.map(String)
    const baseField = path.length > 0 ? path.join('.') : 'draft'
    if (issue.code === 'unrecognized_keys' && issue.keys && issue.keys.length > 0) {
      for (const key of issue.keys) {
        const field = baseField === 'draft' ? String(key) : `${baseField}.${String(key)}`
        addIssue(-1, { actionId: 'draft' }, 'field', `不允许未知字段 ${String(key)}。`, field)
      }
    } else {
      addIssue(-1, { actionId: 'draft' }, 'field', issue.message || '计划草稿格式无效。', baseField)
    }
  }
}

function addActionSchemaIssues(
  result: SafeParseResult,
  rawAction: unknown,
  diagnosticAction: RawAction,
  actionIndex: number,
  addIssue: ValidationContext['addIssue'],
) {
  if (result.success || !result.error) return
  if (isObject(rawAction) && rawAction.selected === false) return
  for (const issue of result.error.issues) {
    addZodIssueFields(actionIndex, diagnosticAction, issue.path.map(String), issue, addIssue)
  }
}

function addDocumentSchemaIssues(
  result: SafeParseResult,
  addIssue: ValidationContext['addIssue'],
) {
  if (result.success || !result.error) return
  for (const issue of result.error.issues) {
    const suffix = issue.path.length > 0 ? issue.path.map(String).join('.') : 'schema'
    addIssue(-1, { actionId: 'draft' }, 'field', issue.message || '工作区数据格式无效。', `document.${suffix}`)
  }
}

function addZodIssueFields(
  actionIndex: number,
  action: RawAction,
  path: string[],
  issue: SafeParseIssue,
  addIssue: ValidationContext['addIssue'],
) {
  const baseField = path.length > 0 ? path.join('.') : 'action'
  if (issue.code === 'unrecognized_keys' && issue.keys && issue.keys.length > 0) {
    for (const key of issue.keys) {
      addIssue(actionIndex, action, 'field', `不允许未知字段 ${String(key)}。`, joinField(baseField, String(key)))
    }
    return
  }
  addIssue(actionIndex, action, 'field', issue.message || '操作格式无效。', baseField)
}

function joinField(base: string, key: string) {
  return base === 'action' ? key : `${base}.${key}`
}

function collectRelevantActionIndices(
  actions: RawAction[],
  createCandidatesByRef: Map<string, Array<{ action: RawAction, index: number }>>,
) {
  const relevant = new Set<number>()
  const queue: number[] = []
  actions.forEach((action, index) => {
    if (action.selected === true) {
      relevant.add(index)
      queue.push(index)
    }
  })

  while (queue.length > 0) {
    const index = queue.shift()!
    for (const ref of draftReferences(actions[index]!)) {
      for (const candidate of createCandidatesByRef.get(ref) ?? []) {
        if (relevant.has(candidate.index)) continue
        relevant.add(candidate.index)
        queue.push(candidate.index)
      }
    }
  }
  return relevant
}

function draftReferences(action: RawAction) {
  if (!isObject(action.payload)) return []
  const refs: string[] = []
  for (const value of [action.payload.projectId, action.payload.milestoneId]) {
    if (isObject(value) && value.kind === 'draft' && isNonEmptyString(value.ref)) refs.push(value.ref)
  }
  return refs
}

function findExpectedOwnerId(
  projects: Project[],
  milestones: Milestone[],
  tasks: Task[],
  quarterGoals: QuarterGoal[],
) {
  return [...projects, ...milestones, ...tasks, ...quarterGoals]
    .map(record => record.ownerId)
    .find(validUuid) ?? null
}

function validateTrimmedString(
  payload: RawPayload,
  field: 'name' | 'title',
  maxLength: number,
  action: RawAction,
  index: number,
  addIssue: ValidationContext['addIssue'],
  patch: boolean,
) {
  if (!shouldValidate(payload, field, patch)) return
  const value = payload[field]
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    addIssue(index, action, 'field', `${field === 'name' ? '项目名称' : '标题'}不能为空且不能超过 ${maxLength} 个字符。`, `payload.${field}`)
  }
}

function validateDescription(
  payload: RawPayload,
  action: RawAction,
  index: number,
  addIssue: ValidationContext['addIssue'],
  patch: boolean,
) {
  if (!shouldValidate(payload, 'description', patch)) return
  if (typeof payload.description !== 'string' || payload.description.length > 4000) {
    addIssue(index, action, 'field', '描述必须是 4000 个字符以内的文本。', 'payload.description')
  }
}

function validateColor(
  payload: RawPayload,
  field: string,
  action: RawAction,
  index: number,
  addIssue: ValidationContext['addIssue'],
  patch: boolean,
) {
  if (!shouldValidate(payload, field, patch)) return
  if (typeof payload[field] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(payload[field])) {
    addIssue(index, action, 'field', '项目颜色必须是六位十六进制颜色。', `payload.${field}`)
  }
}

function validateEnum(
  payload: RawPayload,
  field: string,
  allowed: Set<string>,
  action: RawAction,
  index: number,
  addIssue: ValidationContext['addIssue'],
  patch: boolean,
) {
  if (!shouldValidate(payload, field, patch)) return
  if (!allowed.has(asString(payload[field]))) {
    addIssue(index, action, 'field', `${field} 值无效。`, `payload.${field}`)
  }
}

function validateNullableEnum(
  payload: RawPayload,
  field: string,
  allowed: Set<string>,
  action: RawAction,
  index: number,
  addIssue: ValidationContext['addIssue'],
  patch: boolean,
) {
  if (!shouldValidate(payload, field, patch) || payload[field] === null) return
  if (!allowed.has(asString(payload[field]))) {
    addIssue(index, action, 'field', `${field} 值无效。`, `payload.${field}`)
  }
}

function validateNullableDate(
  payload: RawPayload,
  field: string,
  action: RawAction,
  index: number,
  addIssue: ValidationContext['addIssue'],
  patch: boolean,
) {
  if (!shouldValidate(payload, field, patch) || payload[field] === null) return
  if (!validIsoDate(payload[field])) {
    addIssue(index, action, 'field', `${field} 必须是有效的 YYYY-MM-DD 日期。`, `payload.${field}`)
  }
}

function validateNullableTime(
  payload: RawPayload,
  field: string,
  action: RawAction,
  index: number,
  addIssue: ValidationContext['addIssue'],
  patch: boolean,
) {
  if (!shouldValidate(payload, field, patch) || payload[field] === null) return
  if (typeof payload[field] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(payload[field])) {
    addIssue(index, action, 'field', `${field} 必须是有效的 HH:mm 时间。`, `payload.${field}`)
  }
}

function findCyclicActions(actions: RawAction[], edges: Map<number, number[]>): number[] {
  const actionCount = Math.min(actions.length, MAX_AGENT_ACTIONS)
  const state = new Uint8Array(actionCount)
  const cyclic = new Set<number>()
  const positions = new Map<number, number>()

  for (let start = 0; start < actionCount; start += 1) {
    if (state[start] !== 0) continue
    const path: number[] = [start]
    const stack: Array<{ node: number, nextDependency: number }> = [{ node: start, nextDependency: 0 }]
    state[start] = 1
    positions.set(start, 0)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      const dependencies = (edges.get(frame.node) ?? [])
        .filter(dependency => dependency >= 0 && dependency < actionCount)
      if (frame.nextDependency < dependencies.length) {
        const dependency = dependencies[frame.nextDependency]!
        frame.nextDependency += 1
        if (state[dependency] === 0) {
          state[dependency] = 1
          positions.set(dependency, path.length)
          path.push(dependency)
          stack.push({ node: dependency, nextDependency: 0 })
        } else if (state[dependency] === 1) {
          const cycleStart = positions.get(dependency)
          if (cycleStart !== undefined) {
            for (const member of path.slice(cycleStart)) cyclic.add(member)
          }
        }
        continue
      }

      stack.pop()
      path.pop()
      positions.delete(frame.node)
      state[frame.node] = 2
    }
  }
  return [...cyclic].sort((left, right) => left - right)
}

function actionOverflowValidation(): AgentPlanValidation {
  return {
    executable: false,
    selectedCount: 0,
    dangerousCount: 0,
    estimatedMinutes: 0,
    issues: [{
      actionId: 'draft',
      code: 'field',
      field: 'actions',
      message: `计划最多包含 ${MAX_AGENT_ACTIONS} 个操作。`,
    }],
  }
}

function shouldValidate(payload: RawPayload, field: string, patch: boolean) {
  return !patch || Object.prototype.hasOwnProperty.call(payload, field)
}

function fieldPriority(field: string | undefined) {
  if (!field) return FIELD_PRIORITY.length + 1
  return FIELD_PRIORITY_INDEX.get(field) ?? FIELD_PRIORITY.length
}

function readableActionId(action: RawAction, index: number) {
  return typeof action.actionId === 'string' && action.actionId.length > 0
    ? action.actionId
    : `action-${index + 1}`
}

function validIsoDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

function validIsoTimestamp(value: unknown) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
}

function validEstimatedMinutes(value: unknown): value is number {
  return validIntegerRange(value, 5, 1440)
}

function validIntegerRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
}

function isActiveProject(project: Project | undefined, expectedOwnerId: string | null): project is Project {
  return project !== undefined
    && project.deletedAt === null
    && hasExpectedOwner(project, expectedOwnerId)
}

function hasExpectedOwner(record: { ownerId?: unknown }, expectedOwnerId: string | null) {
  return expectedOwnerId === null || record.ownerId === expectedOwnerId
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isTask(value: Project | Milestone | Task): value is Task {
  return 'milestoneId' in value
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter(isObject) as T[] : []
}

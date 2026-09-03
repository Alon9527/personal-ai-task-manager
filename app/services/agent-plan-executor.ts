import { z } from 'zod'
import {
  agentPlanDraftSchema,
} from './agent-plan-schema'
import type {
  AgentAction,
  AgentActionType,
  AgentEntityReference,
  AgentPlanDraftV1,
} from './agent-plan-schema'
import { validateAgentPlan } from './agent-plan-validation'
import {
  DEMO_OWNER_ID,
  workspaceDocumentSchema,
} from '#shared/workspace'
import type {
  Milestone,
  Project,
  Task,
  TaskGroup,
  WorkspaceDocument,
} from '#shared/workspace'

export type AgentActionResult = {
  actionId: string
  type: AgentActionType
  entityId: string
  entityType: 'project' | 'milestone' | 'task'
  outcome: 'created' | 'updated' | 'completed' | 'reopened' | 'deleted'
}

export type AgentPlanSimulationEnvironment = {
  now?: () => string
  createId?: () => string
}

export class AgentPlanSimulationError extends Error {
  constructor(
    message: string,
    public readonly actionId: string,
    public readonly field?: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AgentPlanSimulationError'
  }
}

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime()
const CREATE_TYPES = new Set<AgentActionType>(['createProject', 'createMilestone', 'createTask'])

/**
 * Produces one isolated v3 replacement document. This function deliberately
 * owns no gateway and performs no persistence.
 */
export function simulateAgentPlan(
  draft: AgentPlanDraftV1,
  document: WorkspaceDocument,
  environment: AgentPlanSimulationEnvironment = {},
): { document: WorkspaceDocument, results: AgentActionResult[] } {
  const parsedDraft = parseDraft(draft)
  const parsedDocument = parseDocument(document)
  ensureUniqueWorkspaceIds(parsedDocument)
  const validation = validateAgentPlan(parsedDraft, parsedDocument, { dangerousConfirmed: true })

  if (validation.selectedCount === 0) {
    throw new AgentPlanSimulationError('至少选择一项操作后才能执行。', 'draft', 'actions')
  }
  if (!validation.executable) {
    const issue = validation.issues[0]
    throw new AgentPlanSimulationError(
      issue?.message ?? '计划未通过执行前校验。',
      issue?.actionId ?? 'draft',
      issue?.field,
    )
  }

  ensureWorkspaceInvariants(parsedDocument)
  const selectedActions = parsedDraft.actions.filter(action => action.selected)
  ensureNonOverlappingWriteSets(selectedActions, parsedDocument)
  const orderedActions = topologicallyOrder(selectedActions)

  const nowProvider = environment.now ?? (() => new Date().toISOString())
  const createId = environment.createId ?? (() => globalThis.crypto.randomUUID())
  const timestamp = nowProvider()
  if (!timestampSchema.safeParse(timestamp).success) {
    throw new AgentPlanSimulationError('执行时间必须是有效的 ISO 时间。', 'draft', 'now')
  }

  const nextDocument = structuredClone(parsedDocument)
  const ownerId = workspaceOwner(nextDocument)
  const usedIds = collectEntityIds(nextDocument)
  const createdIdsByRef = new Map<string, string>()
  const results: AgentActionResult[] = []

  for (const action of orderedActions) {
    const result = executeAction({
      action,
      document: nextDocument,
      ownerId,
      timestamp,
      createId,
      usedIds,
      createdIdsByRef,
    })
    results.push(result)
  }

  ensureWorkspaceInvariants(nextDocument)
  const finalDocument = parseDocument(nextDocument)
  return {
    document: structuredClone(finalDocument),
    results: structuredClone(results),
  }
}

function parseDraft(draft: unknown): AgentPlanDraftV1 {
  const parsed = agentPlanDraftSchema.safeParse(draft)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const path = issue?.path.map(String) ?? []
  const actionIndex = path[0] === 'actions' && /^\d+$/.test(path[1] ?? '')
    ? Number(path[1])
    : null
  const rawActions = isObject(draft) && Array.isArray(draft.actions) ? draft.actions : []
  const rawAction = actionIndex === null ? null : rawActions[actionIndex]
  const actionId = isObject(rawAction) && typeof rawAction.actionId === 'string'
    ? rawAction.actionId
    : 'draft'
  const field = actionIndex === null
    ? path.join('.') || 'draft'
    : path.slice(2).join('.') || 'action'
  throw new AgentPlanSimulationError(issue?.message ?? '计划格式无效。', actionId, field)
}

function parseDocument(document: unknown): WorkspaceDocument {
  const parsed = workspaceDocumentSchema.safeParse(document)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new AgentPlanSimulationError(
    issue?.message ?? '工作区必须是有效的 v3 文档。',
    'draft',
    issue ? `document.${issue.path.map(String).join('.')}` : 'document',
  )
}

function ensureWorkspaceInvariants(document: WorkspaceDocument) {
  ensureUniqueWorkspaceIds(document)
  const records = [
    ...document.projects,
    ...document.milestones,
    ...document.tasks,
    ...document.quarterGoals,
  ]
  const ownerIds = new Set(records.map(record => record.ownerId))
  if (ownerIds.size > 1) {
    throw new AgentPlanSimulationError('工作区包含不同所有者的数据。', 'draft', 'document.ownerId')
  }

  const ownerId = records[0]?.ownerId ?? DEMO_OWNER_ID
  const activeProjects = new Map(
    document.projects
      .filter(project => project.deletedAt === null && project.ownerId === ownerId)
      .map(project => [project.id, project]),
  )
  const activeMilestones = new Map(
    document.milestones
      .filter(milestone => milestone.deletedAt === null && milestone.ownerId === ownerId)
      .map(milestone => [milestone.id, milestone]),
  )

  for (const milestone of activeMilestones.values()) {
    if (!activeProjects.has(milestone.projectId)) {
      throw new AgentPlanSimulationError(
        '活动里程碑必须归属于活动项目。',
        'draft',
        'document.milestones.projectId',
      )
    }
  }
  for (const task of document.tasks) {
    if (task.deletedAt !== null) continue
    if (task.projectId !== null && !activeProjects.has(task.projectId)) {
      throw new AgentPlanSimulationError(
        '活动任务必须归属于活动项目。',
        'draft',
        'document.tasks.projectId',
      )
    }
    if (task.milestoneId !== null) {
      const parent = activeMilestones.get(task.milestoneId)
      if (!parent || parent.projectId !== task.projectId) {
        throw new AgentPlanSimulationError(
          '活动任务的里程碑与项目关系无效。',
          'draft',
          'document.tasks.milestoneId',
        )
      }
    }
  }
}

function ensureUniqueWorkspaceIds(document: WorkspaceDocument) {
  const seen = new Set<string>()
  const records = [
    ...document.projects,
    ...document.milestones,
    ...document.tasks,
    ...document.quarterGoals,
  ]
  for (const record of records) {
    const identity = normalizeUuid(record.id)
    if (seen.has(identity)) {
      throw new AgentPlanSimulationError(
        '工作区包含重复的记录 ID。',
        'draft',
        'document.id',
      )
    }
    seen.add(identity)
  }
}

type PlannedWrite = {
  key: string
  field: 'targetId' | 'dependency'
}

function ensureNonOverlappingWriteSets(actions: AgentAction[], document: WorkspaceDocument) {
  const claimedBy = new Map<string, string>()
  const associations = buildSymbolicAssociations(actions, document)
  for (const action of actions) {
    const writes = actionWriteSet(action, document, associations)
    for (const write of writes) {
      const priorActionId = claimedBy.get(write.key)
      if (priorActionId) {
        throw new AgentPlanSimulationError(
          `该操作与“${priorActionId}”将同时修改同一记录。`,
          action.actionId,
          write.field,
        )
      }
      claimedBy.set(write.key, action.actionId)
    }
  }
}

type SymbolicAssociations = {
  milestoneProjects: Map<string, Set<string>>
  taskProjects: Map<string, Set<string>>
  taskMilestones: Map<string, Set<string>>
}

function actionWriteSet(
  action: AgentAction,
  document: WorkspaceDocument,
  associations: SymbolicAssociations,
): PlannedWrite[] {
  const createdEntityKey = createActionEntityKey(action)
  if (createdEntityKey) {
    const writes: PlannedWrite[] = [{ key: createdEntityKey, field: 'dependency' }]
    if (action.type === 'createTask' && action.payload.status === 'in_progress') {
      writes.push({ key: 'resource:task-status:single-in-progress', field: 'dependency' })
    }
    return writes
  }

  const writes = new Map<string, PlannedWrite['field']>()
  const addKey = (key: string, field: PlannedWrite['field']) => {
    if (!writes.has(key)) writes.set(key, field)
  }
  const add = (entityType: AgentActionResult['entityType'], id: string, field: PlannedWrite['field']) => {
    addKey(existingEntityKey(entityType, id), field)
  }

  add(actionEntityType(action.type), action.targetId!, 'targetId')

  if (action.type === 'deleteProject') {
    const projectKey = existingEntityKey('project', action.targetId)
    for (const [milestoneKey, projectKeys] of associations.milestoneProjects) {
      if (projectKeys.has(projectKey)) addKey(milestoneKey, 'dependency')
    }
    for (const [taskKey, projectKeys] of associations.taskProjects) {
      if (projectKeys.has(projectKey)) addKey(taskKey, 'dependency')
    }
  }

  if (action.type === 'updateMilestone') {
    const milestone = document.milestones.find(item => item.id === action.targetId)
    const moving = action.payload.projectId !== undefined
      && milestone !== undefined
      && action.payload.projectId !== milestone.projectId
    if (moving) addLinkedMilestoneTaskWrites(action.targetId, associations, writes)
  }

  if (action.type === 'deleteMilestone') {
    addLinkedMilestoneTaskWrites(action.targetId, associations, writes)
  }

  if (action.type === 'updateTask' && action.payload.status === 'in_progress') {
    addKey('resource:task-status:single-in-progress', 'dependency')
    for (const task of document.tasks) {
      if (
        task.id !== action.targetId
        && task.deletedAt === null
        && task.status === 'in_progress'
      ) {
        add('task', task.id, 'dependency')
      }
    }
  }

  return [...writes].map(([key, field]) => ({ key, field }))
}

function addLinkedMilestoneTaskWrites(
  milestoneId: string,
  associations: SymbolicAssociations,
  writes: Map<string, PlannedWrite['field']>,
) {
  const milestoneKey = existingEntityKey('milestone', milestoneId)
  for (const [taskKey, milestoneKeys] of associations.taskMilestones) {
    if (milestoneKeys.has(milestoneKey) && !writes.has(taskKey)) {
      writes.set(taskKey, 'dependency')
    }
  }
}

function buildSymbolicAssociations(
  actions: AgentAction[],
  document: WorkspaceDocument,
): SymbolicAssociations {
  const associations: SymbolicAssociations = {
    milestoneProjects: new Map(),
    taskProjects: new Map(),
    taskMilestones: new Map(),
  }

  for (const milestone of document.milestones) {
    addAssociation(
      associations.milestoneProjects,
      existingEntityKey('milestone', milestone.id),
      existingEntityKey('project', milestone.projectId),
    )
  }
  for (const task of document.tasks) {
    const taskKey = existingEntityKey('task', task.id)
    if (task.projectId !== null) {
      addAssociation(associations.taskProjects, taskKey, existingEntityKey('project', task.projectId))
    }
    if (task.milestoneId !== null) {
      addAssociation(associations.taskMilestones, taskKey, existingEntityKey('milestone', task.milestoneId))
    }
  }

  for (const action of actions) {
    if (action.type === 'createMilestone') {
      const milestoneKey = createActionEntityKey(action)!
      addAssociation(
        associations.milestoneProjects,
        milestoneKey,
        referenceEntityKey('project', action.payload.projectId),
      )
    }
    if (action.type === 'updateMilestone' && action.payload.projectId !== undefined) {
      addAssociation(
        associations.milestoneProjects,
        existingEntityKey('milestone', action.targetId),
        existingEntityKey('project', action.payload.projectId),
      )
    }
  }

  for (const action of actions) {
    if (action.type === 'createTask') addCreatedTaskAssociations(action, associations)
    if (action.type === 'updateTask') addUpdatedTaskAssociations(action, document, associations)
  }

  return associations
}

function addCreatedTaskAssociations(
  action: ActionOf<'createTask'>,
  associations: SymbolicAssociations,
) {
  const taskKey = createActionEntityKey(action)!
  if (action.payload.milestoneId !== null) {
    const milestoneKey = referenceEntityKey('milestone', action.payload.milestoneId)
    addAssociation(associations.taskMilestones, taskKey, milestoneKey)
    addProjectsFromMilestone(taskKey, milestoneKey, associations)
  } else if (action.payload.projectId !== null) {
    addAssociation(
      associations.taskProjects,
      taskKey,
      referenceEntityKey('project', action.payload.projectId),
    )
  }
}

function addUpdatedTaskAssociations(
  action: ActionOf<'updateTask'>,
  document: WorkspaceDocument,
  associations: SymbolicAssociations,
) {
  const task = document.tasks.find(item => item.id === action.targetId)
  if (!task) return
  const taskKey = existingEntityKey('task', action.targetId)

  if (typeof action.payload.milestoneId === 'string') {
    const milestoneKey = existingEntityKey('milestone', action.payload.milestoneId)
    addAssociation(associations.taskMilestones, taskKey, milestoneKey)
    addProjectsFromMilestone(taskKey, milestoneKey, associations)
    return
  }

  if (action.payload.milestoneId === null) {
    if (typeof action.payload.projectId === 'string') {
      addAssociation(
        associations.taskProjects,
        taskKey,
        existingEntityKey('project', action.payload.projectId),
      )
    } else if (action.payload.projectId === undefined && task.projectId !== null) {
      addAssociation(associations.taskProjects, taskKey, existingEntityKey('project', task.projectId))
    }
    return
  }

  const projectChanged = action.payload.projectId !== undefined
    && action.payload.projectId !== task.projectId
  if (task.milestoneId !== null && !projectChanged) {
    const milestoneKey = existingEntityKey('milestone', task.milestoneId)
    addAssociation(associations.taskMilestones, taskKey, milestoneKey)
    addProjectsFromMilestone(taskKey, milestoneKey, associations)
  } else if (typeof action.payload.projectId === 'string') {
    addAssociation(
      associations.taskProjects,
      taskKey,
      existingEntityKey('project', action.payload.projectId),
    )
  }
}

function addProjectsFromMilestone(
  taskKey: string,
  milestoneKey: string,
  associations: SymbolicAssociations,
) {
  for (const projectKey of associations.milestoneProjects.get(milestoneKey) ?? []) {
    addAssociation(associations.taskProjects, taskKey, projectKey)
  }
}

function addAssociation(map: Map<string, Set<string>>, childKey: string, parentKey: string) {
  const parents = map.get(childKey) ?? new Set<string>()
  parents.add(parentKey)
  map.set(childKey, parents)
}

function existingEntityKey(entityType: AgentActionResult['entityType'], id: string) {
  return `${entityType}:${id}`
}

function createActionEntityKey(action: AgentAction): string | null {
  if (!CREATE_TYPES.has(action.type)) return null
  return `${actionEntityType(action.type)}:draft:${action.draftRef ?? action.actionId}`
}

function referenceEntityKey(
  entityType: 'project' | 'milestone',
  reference: AgentEntityReference,
) {
  return reference.kind === 'existing'
    ? existingEntityKey(entityType, reference.id)
    : `${entityType}:draft:${reference.ref}`
}

function topologicallyOrder(actions: AgentAction[]): AgentAction[] {
  const createByRef = new Map<string, AgentAction>()
  for (const action of actions) {
    if (CREATE_TYPES.has(action.type) && action.draftRef) createByRef.set(action.draftRef, action)
  }

  const dependencies = new Map<string, Set<string>>()
  for (const action of actions) {
    const refs = actionDraftReferences(action)
    dependencies.set(action.actionId, new Set(refs.map(ref => {
      const parent = createByRef.get(ref)
      if (!parent) {
        throw new AgentPlanSimulationError('引用的新建记录不存在或未被选择。', action.actionId, 'payload')
      }
      return parent.actionId
    })))
  }

  const ordered: AgentAction[] = []
  const completed = new Set<string>()
  while (ordered.length < actions.length) {
    const next = actions.find(action =>
      !completed.has(action.actionId)
      && [...(dependencies.get(action.actionId) ?? [])].every(id => completed.has(id)),
    )
    if (!next) {
      const blocked = actions.find(action => !completed.has(action.actionId))!
      throw new AgentPlanSimulationError('新建记录之间存在循环依赖。', blocked.actionId, 'draftRef')
    }
    ordered.push(next)
    completed.add(next.actionId)
  }
  return ordered
}

function actionDraftReferences(action: AgentAction): string[] {
  if (action.type === 'createMilestone') {
    return action.payload.projectId.kind === 'draft' ? [action.payload.projectId.ref] : []
  }
  if (action.type === 'createTask') {
    return [action.payload.projectId, action.payload.milestoneId]
      .filter((reference): reference is Extract<AgentEntityReference, { kind: 'draft' }> =>
        reference !== null && reference.kind === 'draft')
      .map(reference => reference.ref)
  }
  return []
}

type ExecutionContext = {
  action: AgentAction
  document: WorkspaceDocument
  ownerId: string
  timestamp: string
  createId: () => string
  usedIds: Set<string>
  createdIdsByRef: Map<string, string>
}

function executeAction(context: ExecutionContext): AgentActionResult {
  const { action } = context
  switch (action.type) {
    case 'createProject': return createProject(context, action)
    case 'updateProject': return updateProject(context, action)
    case 'setProjectCompleted': return setProjectCompleted(context, action)
    case 'deleteProject': return deleteProject(context, action)
    case 'createMilestone': return createMilestone(context, action)
    case 'updateMilestone': return updateMilestone(context, action)
    case 'setMilestoneCompleted': return setMilestoneCompleted(context, action)
    case 'deleteMilestone': return deleteMilestone(context, action)
    case 'createTask': return createTask(context, action)
    case 'updateTask': return updateTask(context, action)
    case 'setTaskCompleted': return setTaskCompleted(context, action)
    case 'deleteTask': return deleteTask(context, action)
  }
}

type ActionOf<Type extends AgentActionType> = Extract<AgentAction, { type: Type }>

function createProject(context: ExecutionContext, action: ActionOf<'createProject'>): AgentActionResult {
  const id = nextCreatedId(context, action)
  context.document.projects.push({
    id,
    ownerId: context.ownerId,
    ...action.payload,
    sortOrder: nextProjectSortOrder(context.document.projects),
    createdAt: context.timestamp,
    updatedAt: context.timestamp,
    deletedAt: null,
  })
  return createdResult(action, id, 'project')
}

function updateProject(context: ExecutionContext, action: ActionOf<'updateProject'>): AgentActionResult {
  const record = requiredProject(context.document, action)
  Object.assign(record, action.payload, { updatedAt: context.timestamp })
  return changedResult(action, 'project', 'updated')
}

function setProjectCompleted(
  context: ExecutionContext,
  action: ActionOf<'setProjectCompleted'>,
): AgentActionResult {
  const record = requiredProject(context.document, action)
  record.status = action.payload.completed ? 'completed' : 'active'
  record.updatedAt = context.timestamp
  return changedResult(action, 'project', action.payload.completed ? 'completed' : 'reopened')
}

function deleteProject(context: ExecutionContext, action: ActionOf<'deleteProject'>): AgentActionResult {
  const record = requiredProject(context.document, action)
  softDelete(record, context.timestamp)
  for (const milestone of context.document.milestones) {
    if (milestone.projectId === record.id && milestone.deletedAt === null) softDelete(milestone, context.timestamp)
  }
  for (const task of context.document.tasks) {
    if (task.projectId === record.id && task.deletedAt === null) softDelete(task, context.timestamp)
  }
  return changedResult(action, 'project', 'deleted')
}

function createMilestone(
  context: ExecutionContext,
  action: ActionOf<'createMilestone'>,
): AgentActionResult {
  const projectId = resolveReference(action.payload.projectId, context, action, 'payload.projectId')
  requireActiveProject(context.document, projectId, action, 'payload.projectId')
  const id = nextCreatedId(context, action)
  const { projectId: _reference, ...payload } = action.payload
  context.document.milestones.push({
    id,
    ownerId: context.ownerId,
    projectId,
    ...payload,
    sortOrder: nextMilestoneSortOrder(context.document.milestones, projectId),
    createdAt: context.timestamp,
    updatedAt: context.timestamp,
    deletedAt: null,
  })
  return createdResult(action, id, 'milestone')
}

function updateMilestone(
  context: ExecutionContext,
  action: ActionOf<'updateMilestone'>,
): AgentActionResult {
  const record = requiredMilestone(context.document, action)
  const { projectId, ...patch } = action.payload
  if (projectId !== undefined && projectId !== record.projectId) {
    requireActiveProject(context.document, projectId, action, 'payload.projectId')
    record.sortOrder = nextMilestoneSortOrder(context.document.milestones, projectId)
    record.projectId = projectId
    for (const task of context.document.tasks) {
      if (task.milestoneId === record.id) {
        task.projectId = projectId
        task.updatedAt = context.timestamp
      }
    }
  }
  Object.assign(record, patch, { updatedAt: context.timestamp })
  return changedResult(action, 'milestone', 'updated')
}

function setMilestoneCompleted(
  context: ExecutionContext,
  action: ActionOf<'setMilestoneCompleted'>,
): AgentActionResult {
  const record = requiredMilestone(context.document, action)
  record.status = action.payload.completed ? 'completed' : 'in_progress'
  record.updatedAt = context.timestamp
  return changedResult(action, 'milestone', action.payload.completed ? 'completed' : 'reopened')
}

function deleteMilestone(
  context: ExecutionContext,
  action: ActionOf<'deleteMilestone'>,
): AgentActionResult {
  const record = requiredMilestone(context.document, action)
  softDelete(record, context.timestamp)
  for (const task of context.document.tasks) {
    if (task.milestoneId === record.id) {
      task.milestoneId = null
      task.updatedAt = context.timestamp
    }
  }
  return changedResult(action, 'milestone', 'deleted')
}

function createTask(context: ExecutionContext, action: ActionOf<'createTask'>): AgentActionResult {
  let projectId = action.payload.projectId === null
    ? null
    : resolveReference(action.payload.projectId, context, action, 'payload.projectId')
  const milestoneId = action.payload.milestoneId === null
    ? null
    : resolveReference(action.payload.milestoneId, context, action, 'payload.milestoneId')
  if (milestoneId !== null) {
    projectId = requireActiveMilestone(context.document, milestoneId, action, 'payload.milestoneId').projectId
  } else if (projectId !== null) {
    requireActiveProject(context.document, projectId, action, 'payload.projectId')
  }

  const id = nextCreatedId(context, action)
  const { projectId: _projectReference, milestoneId: _milestoneReference, ...payload } = action.payload
  const status = payload.status ?? 'todo'
  const importance = payload.importance ?? (payload.priority === 'high' ? 'important' : 'normal')
  const group: TaskGroup = payload.isFocus ? 'focus' : 'later'
  context.document.tasks.push({
    id,
    ownerId: context.ownerId,
    projectId,
    milestoneId,
    ...payload,
    status,
    importance,
    estimatedMinutes: payload.estimatedMinutes ?? null,
    reminderAt: payload.reminderAt ?? null,
    snoozedUntil: payload.snoozedUntil ?? null,
    lastRemindedAt: payload.lastRemindedAt ?? null,
    attachments: [],
    sortOrder: nextTaskSortOrder(context.document.tasks, group),
    completedAt: null,
    createdAt: context.timestamp,
    updatedAt: context.timestamp,
    deletedAt: null,
  })
  return createdResult(action, id, 'task')
}

function updateTask(context: ExecutionContext, action: ActionOf<'updateTask'>): AgentActionResult {
  const record = requiredTask(context.document, action)
  const previousGroup = taskGroup(record)
  const { projectId, milestoneId, status, ...patch } = action.payload
  const projectChanged = projectId !== undefined && projectId !== record.projectId

  if (milestoneId !== undefined && milestoneId !== null) {
    const parent = requireActiveMilestone(context.document, milestoneId, action, 'payload.milestoneId')
    record.milestoneId = parent.id
    record.projectId = parent.projectId
  } else {
    if (projectId !== undefined && projectId !== null) {
      requireActiveProject(context.document, projectId, action, 'payload.projectId')
    }
    if (projectId !== undefined) record.projectId = projectId
    if (milestoneId === null) record.milestoneId = null
    else if (projectChanged && record.milestoneId !== null) {
      const linked = context.document.milestones.find(item =>
        item.id === record.milestoneId && item.deletedAt === null)
      if (!linked || linked.projectId !== record.projectId) record.milestoneId = null
    }
  }

  Object.assign(record, patch)
  if (status !== undefined) {
    if (status === 'in_progress') {
      for (const other of context.document.tasks) {
        if (other.id !== record.id && other.deletedAt === null && other.status === 'in_progress') {
          other.status = 'todo'
          other.updatedAt = context.timestamp
        }
      }
    }
    record.status = status
    if (status === 'done' || status === 'cancelled') record.completedAt ??= context.timestamp
    else record.completedAt = null
  }

  const nextGroup = taskGroup(record)
  if (previousGroup !== nextGroup) {
    record.sortOrder = nextTaskSortOrder(context.document.tasks, nextGroup)
  }
  record.updatedAt = context.timestamp
  return changedResult(action, 'task', 'updated')
}

function setTaskCompleted(
  context: ExecutionContext,
  action: ActionOf<'setTaskCompleted'>,
): AgentActionResult {
  const record = requiredTask(context.document, action)
  record.completedAt = action.payload.completed ? context.timestamp : null
  record.status = action.payload.completed ? 'done' : 'todo'
  record.isFocus = false
  record.sortOrder = nextTaskSortOrder(
    context.document.tasks,
    action.payload.completed ? 'completed' : 'later',
  )
  record.updatedAt = context.timestamp
  return changedResult(action, 'task', action.payload.completed ? 'completed' : 'reopened')
}

function deleteTask(context: ExecutionContext, action: ActionOf<'deleteTask'>): AgentActionResult {
  softDelete(requiredTask(context.document, action), context.timestamp)
  return changedResult(action, 'task', 'deleted')
}

function resolveReference(
  reference: AgentEntityReference,
  context: ExecutionContext,
  action: AgentAction,
  field: string,
) {
  if (reference.kind === 'existing') return reference.id
  const id = context.createdIdsByRef.get(reference.ref)
  if (!id) {
    throw new AgentPlanSimulationError('引用的新建记录尚未创建。', action.actionId, field)
  }
  return id
}

function nextCreatedId(context: ExecutionContext, action: AgentAction) {
  const id = context.createId()
  if (!uuidSchema.safeParse(id).success) {
    throw new AgentPlanSimulationError('生成的记录 ID 不是有效 UUID。', action.actionId, 'generatedId')
  }
  const normalizedId = normalizeUuid(id)
  if (context.usedIds.has(normalizedId)) {
    throw new AgentPlanSimulationError('生成的记录 ID 与现有或本批记录重复。', action.actionId, 'generatedId')
  }
  context.usedIds.add(normalizedId)
  if (!action.draftRef) {
    throw new AgentPlanSimulationError('新建操作缺少 draftRef。', action.actionId, 'draftRef')
  }
  context.createdIdsByRef.set(action.draftRef, id)
  return id
}

function requiredProject(document: WorkspaceDocument, action: Exclude<AgentAction, { type: 'createProject' | 'createMilestone' | 'createTask' }>) {
  const record = document.projects.find(item => item.id === action.targetId && item.deletedAt === null)
  if (!record) throw new AgentPlanSimulationError('项目不存在或已移入回收站。', action.actionId, 'targetId')
  return record
}

function requiredMilestone(document: WorkspaceDocument, action: Exclude<AgentAction, { type: 'createProject' | 'createMilestone' | 'createTask' }>) {
  const record = document.milestones.find(item => item.id === action.targetId && item.deletedAt === null)
  if (!record) throw new AgentPlanSimulationError('里程碑不存在或已移入回收站。', action.actionId, 'targetId')
  return record
}

function requiredTask(document: WorkspaceDocument, action: Exclude<AgentAction, { type: 'createProject' | 'createMilestone' | 'createTask' }>) {
  const record = document.tasks.find(item => item.id === action.targetId && item.deletedAt === null)
  if (!record) throw new AgentPlanSimulationError('任务不存在或已移入回收站。', action.actionId, 'targetId')
  return record
}

function requireActiveProject(
  document: WorkspaceDocument,
  id: string,
  action: AgentAction,
  field: string,
) {
  const record = document.projects.find(item => item.id === id && item.deletedAt === null)
  if (!record) throw new AgentPlanSimulationError('所选项目不存在或已移入回收站。', action.actionId, field)
  return record
}

function requireActiveMilestone(
  document: WorkspaceDocument,
  id: string,
  action: AgentAction,
  field: string,
) {
  const record = document.milestones.find(item => item.id === id && item.deletedAt === null)
  if (!record) throw new AgentPlanSimulationError('所选里程碑不存在或已移入回收站。', action.actionId, field)
  requireActiveProject(document, record.projectId, action, field)
  return record
}

function nextProjectSortOrder(projects: Project[]) {
  return nextSortOrder(projects.filter(item => item.deletedAt === null))
}

function nextMilestoneSortOrder(milestones: Milestone[], projectId: string) {
  return nextSortOrder(milestones.filter(item => item.deletedAt === null && item.projectId === projectId))
}

function nextTaskSortOrder(tasks: Task[], group: TaskGroup) {
  return nextSortOrder(tasks.filter(task => matchesTaskGroup(task, group)))
}

function nextSortOrder(records: Array<{ sortOrder: number }>) {
  return records.reduce((maximum, record) => Math.max(maximum, record.sortOrder), -1) + 1
}

function taskGroup(task: Pick<Task, 'completedAt' | 'isFocus'>): TaskGroup {
  if (task.completedAt !== null) return 'completed'
  return task.isFocus ? 'focus' : 'later'
}

function matchesTaskGroup(task: Task, group: TaskGroup) {
  return task.deletedAt === null && taskGroup(task) === group
}

function softDelete(record: { deletedAt: string | null, updatedAt: string }, timestamp: string) {
  record.deletedAt = timestamp
  record.updatedAt = timestamp
}

function workspaceOwner(document: WorkspaceDocument) {
  return document.projects[0]?.ownerId
    ?? document.milestones[0]?.ownerId
    ?? document.tasks[0]?.ownerId
    ?? document.quarterGoals[0]?.ownerId
    ?? DEMO_OWNER_ID
}

function collectEntityIds(document: WorkspaceDocument) {
  return new Set([
    ...document.projects.map(item => item.id),
    ...document.milestones.map(item => item.id),
    ...document.tasks.map(item => item.id),
    ...document.quarterGoals.map(item => item.id),
  ].map(normalizeUuid))
}

function normalizeUuid(id: string) {
  return id.toLowerCase()
}

function createdResult(
  action: AgentAction,
  entityId: string,
  entityType: AgentActionResult['entityType'],
): AgentActionResult {
  return { actionId: action.actionId, type: action.type, entityId, entityType, outcome: 'created' }
}

function changedResult(
  action: Exclude<AgentAction, { type: 'createProject' | 'createMilestone' | 'createTask' }>,
  entityType: AgentActionResult['entityType'],
  outcome: AgentActionResult['outcome'],
): AgentActionResult {
  return { actionId: action.actionId, type: action.type, entityId: action.targetId, entityType, outcome }
}

function actionEntityType(type: AgentActionType): AgentActionResult['entityType'] {
  if (type.endsWith('Project')) return 'project'
  if (type.endsWith('Milestone')) return 'milestone'
  return 'task'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

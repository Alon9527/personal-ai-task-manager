import { describe, expect, it, vi } from 'vitest'
import {
  AgentPlanSimulationError,
  simulateAgentPlan,
} from '../../app/services/agent-plan-executor'
import type { AgentPlanDraftV1 } from '../../app/services/agent-plan-schema'
import {
  DEMO_OWNER_ID,
  workspaceDocumentSchema,
} from '../../shared/workspace'
import type {
  Milestone,
  Project,
  Task,
  WorkspaceDocument,
} from '../../shared/workspace'

const PLAN_ID = '10000000-0000-4000-8000-000000000001'
const OWNER_ID = '00000000-0000-4000-8000-000000000011'
const OTHER_OWNER_ID = '00000000-0000-4000-8000-000000000012'
const PROJECT_A = '20000000-0000-4000-8000-000000000001'
const PROJECT_B = '20000000-0000-4000-8000-000000000002'
const PROJECT_C = '20000000-0000-4000-8000-000000000003'
const MILESTONE_A = '30000000-0000-4000-8000-000000000001'
const MILESTONE_B = '30000000-0000-4000-8000-000000000002'
const MILESTONE_C = '30000000-0000-4000-8000-000000000003'
const TASK_A = '40000000-0000-4000-8000-000000000001'
const TASK_B = '40000000-0000-4000-8000-000000000002'
const TASK_C = '40000000-0000-4000-8000-000000000003'
const TASK_D = '40000000-0000-4000-8000-000000000004'
const CREATED_PROJECT = '50000000-0000-4000-8000-000000000001'
const CREATED_MILESTONE = '50000000-0000-4000-8000-000000000002'
const CREATED_TASK = '50000000-0000-4000-8000-000000000003'
const CREATED_TASK_2 = '50000000-0000-4000-8000-000000000004'
const CREATED_AT = '2026-08-13T08:00:00.000Z'
const NOW = '2026-08-13T12:34:56.000Z'
const OLD_DELETED_AT = '2026-08-12T02:00:00.000Z'

const emptyValidation = {
  executable: false,
  selectedCount: 0,
  dangerousCount: 0,
  estimatedMinutes: 0,
  issueCount: 0,
  issues: [],
}

function project(
  id: string,
  sortOrder: number,
  overrides: Partial<Project> = {},
): Project {
  return {
    id,
    ownerId: OWNER_ID,
    name: `Project ${sortOrder}`,
    color: '#6B61DF',
    description: '',
    priority: null,
    status: 'active',
    targetDate: null,
    sortOrder,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function milestone(
  id: string,
  projectId: string,
  sortOrder: number,
  overrides: Partial<Milestone> = {},
): Milestone {
  return {
    id,
    ownerId: OWNER_ID,
    projectId,
    title: `Milestone ${sortOrder}`,
    description: '',
    targetDate: null,
    status: 'planned',
    progressMode: 'auto',
    progress: 0,
    sortOrder,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function task(
  id: string,
  projectId: string | null,
  milestoneId: string | null,
  sortOrder: number,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    ownerId: OWNER_ID,
    projectId,
    milestoneId,
    title: `Task ${sortOrder}`,
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
    sortOrder,
    completedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function document(overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    version: 3,
    projects: [
      project(PROJECT_A, 0),
      project(PROJECT_B, 7),
      project(PROJECT_C, 11),
    ],
    milestones: [
      milestone(MILESTONE_A, PROJECT_A, 0),
      milestone(MILESTONE_B, PROJECT_A, 4),
      milestone(MILESTONE_C, PROJECT_B, 6),
    ],
    tasks: [
      task(TASK_A, PROJECT_A, MILESTONE_A, 2, { isFocus: true }),
      task(TASK_B, PROJECT_A, MILESTONE_A, 8),
      task(TASK_C, PROJECT_B, MILESTONE_C, 5, {
        isFocus: false,
        status: 'done',
        completedAt: CREATED_AT,
      }),
      task(TASK_D, PROJECT_B, null, 10),
    ],
    quarterGoals: [],
    ...overrides,
  }
}

function draft(actions: Array<Record<string, unknown>>): AgentPlanDraftV1 {
  return {
    version: 1,
    id: PLAN_ID,
    question: '请规划并确认这些工作',
    model: 'MiniMax-M2.7',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status: 'draft',
    actions,
    validation: emptyValidation,
  } as unknown as AgentPlanDraftV1
}

function createProjectAction(
  actionId = 'create-project',
  draftRef = 'project:new',
  selected = true,
) {
  return {
    actionId,
    type: 'createProject',
    reason: '建立项目',
    selected,
    dangerous: false,
    draftRef,
    payload: {
      name: '  新项目  ',
      color: '#7C6BF2',
      description: '项目说明',
      priority: 'high',
      status: 'active',
      targetDate: '2026-09-30',
    },
  }
}

function createMilestoneAction(
  actionId = 'create-milestone',
  draftRef = 'milestone:new',
  projectId: unknown = { kind: 'draft', ref: 'project:new' },
) {
  return {
    actionId,
    type: 'createMilestone',
    reason: '建立里程碑',
    selected: true,
    dangerous: false,
    draftRef,
    payload: {
      projectId,
      title: '  首次交付  ',
      description: '里程碑说明',
      targetDate: '2026-08-31',
      status: 'planned',
      progressMode: 'manual',
      progress: 20,
    },
  }
}

function createTaskAction(
  actionId = 'create-task',
  draftRef = 'task:new',
  projectId: unknown = { kind: 'draft', ref: 'project:new' },
  milestoneId: unknown = { kind: 'draft', ref: 'milestone:new' },
  overrides: Record<string, unknown> = {},
) {
  return {
    actionId,
    type: 'createTask',
    reason: '建立任务',
    selected: true,
    dangerous: false,
    draftRef,
    payload: {
      projectId,
      milestoneId,
      title: '  交付任务  ',
      description: '任务说明',
      priority: 'high',
      dueDate: '2026-08-20',
      dueTime: '10:30',
      isFocus: true,
      ...overrides,
    },
  }
}

function existingAction(
  type: string,
  actionId: string,
  targetId: string,
  payload: Record<string, unknown>,
  expectedUpdatedAt = CREATED_AT,
) {
  return {
    actionId,
    type,
    reason: '更新现有记录',
    selected: true,
    dangerous: type.startsWith('delete'),
    targetId,
    expectedUpdatedAt,
    payload,
  }
}

function environment(ids: string[] = []) {
  const now = vi.fn(() => NOW)
  const createId = vi.fn(() => {
    const next = ids.shift()
    if (!next) throw new Error('unexpected createId call')
    return next
  })
  return { now, createId }
}

function expectSimulationError(
  operation: () => unknown,
  actionId: string,
  field?: string,
) {
  try {
    operation()
    throw new Error('expected simulation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(AgentPlanSimulationError)
    expect(error).toMatchObject({ actionId, ...(field ? { field } : {}) })
  }
}

describe('simulateAgentPlan', () => {
  it('topologically resolves a shuffled project → milestone → task create chain', () => {
    const sourceDocument = document()
    const sourceDraft = draft([
      createTaskAction(),
      createProjectAction(),
      createMilestoneAction(),
    ])
    const sourceDocumentBefore = structuredClone(sourceDocument)
    const sourceDraftBefore = structuredClone(sourceDraft)
    const env = environment([CREATED_PROJECT, CREATED_MILESTONE, CREATED_TASK])

    const result = simulateAgentPlan(sourceDraft, sourceDocument, env)

    expect(result.results).toEqual([
      { actionId: 'create-project', type: 'createProject', entityId: CREATED_PROJECT, entityType: 'project', outcome: 'created' },
      { actionId: 'create-milestone', type: 'createMilestone', entityId: CREATED_MILESTONE, entityType: 'milestone', outcome: 'created' },
      { actionId: 'create-task', type: 'createTask', entityId: CREATED_TASK, entityType: 'task', outcome: 'created' },
    ])
    expect(result.document.projects.at(-1)).toMatchObject({
      id: CREATED_PROJECT,
      ownerId: OWNER_ID,
      name: '新项目',
      sortOrder: 12,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    })
    expect(result.document.milestones.at(-1)).toMatchObject({
      id: CREATED_MILESTONE,
      projectId: CREATED_PROJECT,
      title: '首次交付',
      sortOrder: 0,
    })
    expect(result.document.tasks.at(-1)).toMatchObject({
      id: CREATED_TASK,
      projectId: CREATED_PROJECT,
      milestoneId: CREATED_MILESTONE,
      title: '交付任务',
      status: 'todo',
      importance: 'important',
      estimatedMinutes: null,
      reminderAt: null,
      snoozedUntil: null,
      lastRemindedAt: null,
      sortOrder: 3,
      completedAt: null,
    })
    expect(env.now).toHaveBeenCalledTimes(1)
    expect(env.createId).toHaveBeenCalledTimes(3)
    expect(sourceDocument).toEqual(sourceDocumentBefore)
    expect(sourceDraft).toEqual(sourceDraftBefore)
    expect(workspaceDocumentSchema.parse(result.document)).toEqual(result.document)
  })

  it('preserves proposal order among independent actions and consumes no environment calls for unselected actions', () => {
    const env = environment([CREATED_TASK, CREATED_TASK_2])
    const result = simulateAgentPlan(draft([
      createTaskAction('task-existing-a', 'task:a', { kind: 'existing', id: PROJECT_A }, null, { isFocus: false }),
      createProjectAction('project-off', 'project:off', false),
      createTaskAction('task-existing-b', 'task:b', { kind: 'existing', id: PROJECT_B }, null, { isFocus: false }),
    ]), document(), env)

    expect(result.results.map(item => item.actionId)).toEqual(['task-existing-a', 'task-existing-b'])
    expect(result.results.map(item => item.entityId)).toEqual([CREATED_TASK, CREATED_TASK_2])
    expect(env.now).toHaveBeenCalledTimes(1)
    expect(env.createId).toHaveBeenCalledTimes(2)
  })

  it('supports createTask with existing parents and lets the milestone force its project', () => {
    const env = environment([CREATED_TASK])
    const result = simulateAgentPlan(draft([
      createTaskAction(
        'task-existing-parents',
        'task:existing',
        { kind: 'existing', id: PROJECT_A },
        { kind: 'existing', id: MILESTONE_A },
        { priority: null, isFocus: false },
      ),
    ]), document(), env)

    expect(result.document.tasks.at(-1)).toMatchObject({
      id: CREATED_TASK,
      projectId: PROJECT_A,
      milestoneId: MILESTONE_A,
      importance: 'normal',
      sortOrder: 11,
    })
  })

  it('implements project update, complete, reopen, and cascade soft-delete semantics', () => {
    const updated = simulateAgentPlan(draft([
      existingAction('updateProject', 'update-project', PROJECT_A, {
        name: '  改名项目  ',
        description: '新说明',
        priority: 'medium',
        status: 'paused',
        targetDate: '2026-10-01',
      }),
    ]), document(), environment()).document.projects[0]!
    expect(updated).toMatchObject({
      name: '改名项目',
      description: '新说明',
      priority: 'medium',
      status: 'paused',
      targetDate: '2026-10-01',
      updatedAt: NOW,
    })

    const completed = simulateAgentPlan(draft([
      existingAction('setProjectCompleted', 'complete-project', PROJECT_A, { completed: true }),
    ]), document(), environment())
    expect(completed.document.projects[0]).toMatchObject({ status: 'completed', updatedAt: NOW })
    expect(completed.results[0]?.outcome).toBe('completed')

    const reopenSource = document()
    reopenSource.projects[0]!.status = 'completed'
    const reopened = simulateAgentPlan(draft([
      existingAction('setProjectCompleted', 'reopen-project', PROJECT_A, { completed: false }),
    ]), reopenSource, environment())
    expect(reopened.document.projects[0]).toMatchObject({ status: 'active', updatedAt: NOW })
    expect(reopened.results[0]?.outcome).toBe('reopened')

    const deleteSource = document()
    deleteSource.milestones[1]!.deletedAt = OLD_DELETED_AT
    deleteSource.milestones[1]!.updatedAt = OLD_DELETED_AT
    deleteSource.tasks[1]!.deletedAt = OLD_DELETED_AT
    deleteSource.tasks[1]!.updatedAt = OLD_DELETED_AT
    const deleted = simulateAgentPlan(draft([
      existingAction('deleteProject', 'delete-project', PROJECT_A, {}),
    ]), deleteSource, environment()).document
    expect(deleted.projects[0]).toMatchObject({ deletedAt: NOW, updatedAt: NOW })
    expect(deleted.milestones[0]).toMatchObject({ deletedAt: NOW, updatedAt: NOW })
    expect(deleted.tasks[0]).toMatchObject({ deletedAt: NOW, updatedAt: NOW })
    expect(deleted.milestones[1]).toMatchObject({ deletedAt: OLD_DELETED_AT, updatedAt: OLD_DELETED_AT })
    expect(deleted.tasks[1]).toMatchObject({ deletedAt: OLD_DELETED_AT, updatedAt: OLD_DELETED_AT })
  })

  it('implements milestone update/move, complete, reopen, and unlink-on-delete semantics', () => {
    const moveSource = document()
    moveSource.tasks.push(task('40000000-0000-4000-8000-000000000009', PROJECT_A, MILESTONE_A, 99, {
      deletedAt: OLD_DELETED_AT,
      updatedAt: OLD_DELETED_AT,
    }))
    const moved = simulateAgentPlan(draft([
      existingAction('updateMilestone', 'move-milestone', MILESTONE_A, {
        projectId: PROJECT_B,
        title: '  新里程碑  ',
        progressMode: 'manual',
        progress: 75,
      }),
    ]), moveSource, environment()).document
    expect(moved.milestones[0]).toMatchObject({
      projectId: PROJECT_B,
      title: '新里程碑',
      progressMode: 'manual',
      progress: 75,
      sortOrder: 7,
      updatedAt: NOW,
    })
    expect(moved.tasks.filter(item => item.milestoneId === MILESTONE_A)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: PROJECT_B, updatedAt: NOW, deletedAt: null }),
        expect.objectContaining({ projectId: PROJECT_B, updatedAt: NOW, deletedAt: OLD_DELETED_AT }),
      ]),
    )

    const completed = simulateAgentPlan(draft([
      existingAction('setMilestoneCompleted', 'complete-milestone', MILESTONE_A, { completed: true }),
    ]), document(), environment())
    expect(completed.document.milestones[0]).toMatchObject({ status: 'completed', updatedAt: NOW })
    expect(completed.results[0]?.outcome).toBe('completed')

    const reopenSource = document()
    reopenSource.milestones[0]!.status = 'completed'
    const reopened = simulateAgentPlan(draft([
      existingAction('setMilestoneCompleted', 'reopen-milestone', MILESTONE_A, { completed: false }),
    ]), reopenSource, environment())
    expect(reopened.document.milestones[0]).toMatchObject({ status: 'in_progress', updatedAt: NOW })
    expect(reopened.results[0]?.outcome).toBe('reopened')

    const deleteSource = document()
    deleteSource.tasks[1]!.deletedAt = OLD_DELETED_AT
    deleteSource.tasks[1]!.updatedAt = OLD_DELETED_AT
    const deleted = simulateAgentPlan(draft([
      existingAction('deleteMilestone', 'delete-milestone', MILESTONE_A, {}),
    ]), deleteSource, environment()).document
    expect(deleted.milestones[0]).toMatchObject({ deletedAt: NOW, updatedAt: NOW })
    expect(deleted.tasks[0]).toMatchObject({ milestoneId: null, deletedAt: null, updatedAt: NOW })
    expect(deleted.tasks[1]).toMatchObject({ milestoneId: null, deletedAt: OLD_DELETED_AT, updatedAt: NOW })
  })

  it('implements task update and target-group tail semantics', () => {
    const source = document()
    source.tasks.push(task('40000000-0000-4000-8000-000000000010', PROJECT_B, null, 17, {
      isFocus: true,
      status: 'in_progress',
    }))
    const result = simulateAgentPlan(draft([
      existingAction('updateTask', 'update-task', TASK_B, {
        milestoneId: MILESTONE_C,
        projectId: PROJECT_B,
        title: '  修改任务  ',
        isFocus: true,
        status: 'in_progress',
        importance: 'important',
        estimatedMinutes: 45,
      }),
    ]), source, environment()).document

    expect(result.tasks[1]).toMatchObject({
      projectId: PROJECT_B,
      milestoneId: MILESTONE_C,
      title: '修改任务',
      isFocus: true,
      status: 'in_progress',
      importance: 'important',
      estimatedMinutes: 45,
      sortOrder: 18,
      completedAt: null,
      updatedAt: NOW,
    })
    expect(result.tasks.at(-1)).toMatchObject({ status: 'todo', updatedAt: NOW })
  })

  it('completes, reopens, and soft-deletes tasks with the exact lifecycle rules', () => {
    const completed = simulateAgentPlan(draft([
      existingAction('setTaskCompleted', 'complete-task', TASK_A, { completed: true }),
    ]), document(), environment())
    expect(completed.document.tasks[0]).toMatchObject({
      status: 'done',
      completedAt: NOW,
      isFocus: false,
      sortOrder: 6,
      updatedAt: NOW,
    })
    expect(completed.results[0]?.outcome).toBe('completed')

    const reopened = simulateAgentPlan(draft([
      existingAction('setTaskCompleted', 'reopen-task', TASK_C, { completed: false }),
    ]), document(), environment())
    expect(reopened.document.tasks[2]).toMatchObject({
      status: 'todo',
      completedAt: null,
      isFocus: false,
      sortOrder: 11,
      updatedAt: NOW,
    })
    expect(reopened.results[0]?.outcome).toBe('reopened')

    const deleted = simulateAgentPlan(draft([
      existingAction('deleteTask', 'delete-task', TASK_D, {}),
    ]), document(), environment())
    expect(deleted.document.tasks[3]).toMatchObject({ deletedAt: NOW, updatedAt: NOW })
    expect(deleted.results[0]).toMatchObject({ entityType: 'task', outcome: 'deleted' })
  })

  it('places an explicitly reopened focus task at the later tail even when it was already incomplete', () => {
    const reopened = simulateAgentPlan(draft([
      existingAction('setTaskCompleted', 'normalize-open-task', TASK_A, { completed: false }),
    ]), document(), environment())

    expect(reopened.document.tasks[0]).toMatchObject({
      status: 'todo',
      completedAt: null,
      isFocus: false,
      sortOrder: 11,
      updatedAt: NOW,
    })
  })

  it('fails all invalid or stale preflight plans before time or ID generation', () => {
    const deletedSource = document()
    deletedSource.projects[0]!.deletedAt = OLD_DELETED_AT
    const wrongOwnerSource = document()
    wrongOwnerSource.tasks[0]!.ownerId = OTHER_OWNER_ID
    const wrongProjectSource = document()
    wrongProjectSource.tasks[0]!.projectId = PROJECT_B

    const cases: Array<[string, AgentPlanDraftV1, WorkspaceDocument, string]> = [
      ['missing target', draft([existingAction('updateTask', 'missing', '40000000-0000-4000-8000-000000000099', { title: 'X' })]), document(), 'missing'],
      ['deleted parent', draft([createTaskAction('deleted-parent', 'task:deleted', { kind: 'existing', id: PROJECT_A }, null)]), deletedSource, 'deleted-parent'],
      ['mixed owner', draft([existingAction('updateTask', 'wrong-owner', TASK_A, { title: 'X' })]), wrongOwnerSource, 'draft'],
      ['wrong milestone project', draft([existingAction('updateTask', 'wrong-project', TASK_A, { title: 'X' })]), wrongProjectSource, 'wrong-project'],
      ['stale timestamp', draft([existingAction('updateTask', 'stale', TASK_A, { title: 'X' }, NOW)]), document(), 'stale'],
      ['duplicate target', draft([
        existingAction('updateTask', 'duplicate-a', TASK_A, { title: 'A' }),
        existingAction('setTaskCompleted', 'duplicate-b', TASK_A, { completed: true }),
      ]), document(), 'duplicate-b'],
    ]

    for (const [_label, plan, workspace, actionId] of cases) {
      const env = environment([])
      const planBefore = structuredClone(plan)
      const workspaceBefore = structuredClone(workspace)
      expectSimulationError(() => simulateAgentPlan(plan, workspace, env), actionId)
      expect(env.now).not.toHaveBeenCalled()
      expect(env.createId).not.toHaveBeenCalled()
      expect(plan).toEqual(planBefore)
      expect(workspace).toEqual(workspaceBefore)
    }
  })

  it('rejects explicit actions that overlap project cascade writes in either proposal order', () => {
    const cases: Array<[AgentPlanDraftV1, string, string]> = [
      [draft([
        existingAction('deleteProject', 'delete-project-first', PROJECT_A, {}),
        existingAction('updateTask', 'update-child-second', TASK_A, { title: 'Child' }),
      ]), 'update-child-second', 'targetId'],
      [draft([
        existingAction('updateTask', 'update-child-first', TASK_A, { title: 'Child' }),
        existingAction('deleteProject', 'delete-project-second', PROJECT_A, {}),
      ]), 'delete-project-second', 'dependency'],
      [draft([
        existingAction('deleteProject', 'delete-project-before-milestone', PROJECT_A, {}),
        existingAction('updateMilestone', 'update-milestone-after-project', MILESTONE_A, { title: 'Milestone' }),
      ]), 'update-milestone-after-project', 'targetId'],
      [draft([
        existingAction('updateMilestone', 'update-milestone-before-project', MILESTONE_A, { title: 'Milestone' }),
        existingAction('deleteProject', 'delete-project-after-milestone', PROJECT_A, {}),
      ]), 'delete-project-after-milestone', 'dependency'],
    ]

    for (const [plan, actionId, field] of cases) {
      const workspace = document()
      const planBefore = structuredClone(plan)
      const workspaceBefore = structuredClone(workspace)
      const env = environment([])

      expectSimulationError(() => simulateAgentPlan(plan, workspace, env), actionId, field)
      expect(env.now).not.toHaveBeenCalled()
      expect(env.createId).not.toHaveBeenCalled()
      expect(plan).toEqual(planBefore)
      expect(workspace).toEqual(workspaceBefore)
    }
  })

  it('rejects explicit task actions that overlap milestone move/delete writes in either order', () => {
    const cases: Array<[AgentPlanDraftV1, string, string]> = [
      [draft([
        existingAction('updateMilestone', 'move-first', MILESTONE_A, { projectId: PROJECT_B }),
        existingAction('updateTask', 'task-after-move', TASK_A, { title: 'Task' }),
      ]), 'task-after-move', 'targetId'],
      [draft([
        existingAction('updateTask', 'task-before-move', TASK_A, { title: 'Task' }),
        existingAction('updateMilestone', 'move-after-task', MILESTONE_A, { projectId: PROJECT_B }),
      ]), 'move-after-task', 'dependency'],
      [draft([
        existingAction('deleteMilestone', 'delete-milestone-first', MILESTONE_A, {}),
        existingAction('updateTask', 'task-after-delete', TASK_A, { title: 'Task' }),
      ]), 'task-after-delete', 'targetId'],
      [draft([
        existingAction('updateTask', 'task-before-delete', TASK_A, { title: 'Task' }),
        existingAction('deleteMilestone', 'delete-milestone-after-task', MILESTONE_A, {}),
      ]), 'delete-milestone-after-task', 'dependency'],
    ]

    for (const [plan, actionId, field] of cases) {
      const workspace = document()
      const planBefore = structuredClone(plan)
      const workspaceBefore = structuredClone(workspace)
      const env = environment([])

      expectSimulationError(() => simulateAgentPlan(plan, workspace, env), actionId, field)
      expect(env.now).not.toHaveBeenCalled()
      expect(env.createId).not.toHaveBeenCalled()
      expect(plan).toEqual(planBefore)
      expect(workspace).toEqual(workspaceBefore)
    }
  })

  it('rejects a plan whose in-progress transition implicitly writes another explicit target', () => {
    const workspace = document()
    workspace.tasks[1]!.status = 'in_progress'
    const plan = draft([
      existingAction('updateTask', 'start-task-a', TASK_A, { status: 'in_progress' }),
      existingAction('updateTask', 'edit-running-task-b', TASK_B, { title: 'Still running' }),
    ])
    const planBefore = structuredClone(plan)
    const workspaceBefore = structuredClone(workspace)
    const env = environment([])

    expectSimulationError(
      () => simulateAgentPlan(plan, workspace, env),
      'edit-running-task-b',
      'targetId',
    )
    expect(env.now).not.toHaveBeenCalled()
    expect(env.createId).not.toHaveBeenCalled()
    expect(plan).toEqual(planBefore)
    expect(workspace).toEqual(workspaceBefore)
  })

  const symbolicWriteConflictCases: Array<{
    name: string
    first: Record<string, unknown>
    second: Record<string, unknown>
    firstThenSecondField: string
    secondThenFirstField: string
    generatedIds?: string[]
    prepare?: (workspace: WorkspaceDocument) => void
  }> = [
    {
      name: 'two planned in-progress transitions share the single-running logical resource',
      first: existingAction('updateTask', 'start-a', TASK_A, { status: 'in_progress' }),
      second: existingAction('updateTask', 'start-b', TASK_B, { status: 'in_progress' }),
      firstThenSecondField: 'dependency',
      secondThenFirstField: 'dependency',
    },
    {
      name: 'a planned milestone under an existing project overlaps deleting that project',
      first: createMilestoneAction(
        'create-child-milestone',
        'milestone:planned-child',
        { kind: 'existing', id: PROJECT_A },
      ),
      second: existingAction('deleteProject', 'delete-parent-project', PROJECT_A, {}),
      firstThenSecondField: 'dependency',
      secondThenFirstField: 'dependency',
      generatedIds: [CREATED_MILESTONE],
    },
    {
      name: 'a planned task under an existing project overlaps deleting that project',
      first: createTaskAction(
        'create-project-child-task',
        'task:planned-project-child',
        { kind: 'existing', id: PROJECT_A },
        { kind: 'existing', id: MILESTONE_A },
      ),
      second: existingAction('deleteProject', 'delete-task-parent-project', PROJECT_A, {}),
      firstThenSecondField: 'dependency',
      secondThenFirstField: 'dependency',
      generatedIds: [CREATED_TASK],
    },
    {
      name: 'a planned task under an existing milestone overlaps deleting that milestone',
      first: createTaskAction(
        'create-milestone-child-task',
        'task:planned-milestone-child',
        { kind: 'existing', id: PROJECT_A },
        { kind: 'existing', id: MILESTONE_A },
      ),
      second: existingAction('deleteMilestone', 'delete-task-parent-milestone', MILESTONE_A, {}),
      firstThenSecondField: 'dependency',
      secondThenFirstField: 'dependency',
      generatedIds: [CREATED_TASK],
    },
    {
      name: 'assigning a task to a milestone overlaps moving that milestone',
      first: existingAction('updateTask', 'assign-task-to-milestone', TASK_D, { milestoneId: MILESTONE_A }),
      second: existingAction('updateMilestone', 'move-assigned-milestone', MILESTONE_A, { projectId: PROJECT_B }),
      firstThenSecondField: 'dependency',
      secondThenFirstField: 'targetId',
    },
    {
      name: 'assigning a task to a milestone overlaps deleting that milestone',
      first: existingAction('updateTask', 'assign-task-before-delete', TASK_D, { milestoneId: MILESTONE_A }),
      second: existingAction('deleteMilestone', 'delete-assigned-milestone', MILESTONE_A, {}),
      firstThenSecondField: 'dependency',
      secondThenFirstField: 'targetId',
    },
    {
      name: 'moving a task to a project overlaps deleting that project',
      first: existingAction('updateTask', 'move-task-to-project', TASK_D, { projectId: PROJECT_A }),
      second: existingAction('deleteProject', 'delete-task-destination', PROJECT_A, {}),
      firstThenSecondField: 'dependency',
      secondThenFirstField: 'targetId',
    },
    {
      name: 'moving a milestone to a project overlaps deleting that project',
      first: existingAction('updateMilestone', 'move-milestone-to-project', MILESTONE_C, { projectId: PROJECT_A }),
      second: existingAction('deleteProject', 'delete-milestone-destination', PROJECT_A, {}),
      firstThenSecondField: 'dependency',
      secondThenFirstField: 'targetId',
    },
  ]

  it.each(symbolicWriteConflictCases)(
    'rejects symbolic write overlap before environment calls: $name',
    ({ first, second, firstThenSecondField, secondThenFirstField, generatedIds = [], prepare }) => {
      for (const [actions, expectedActionId, expectedField] of [
        [[first, second], String(second.actionId), firstThenSecondField],
        [[second, first], String(first.actionId), secondThenFirstField],
      ] as const) {
        const workspace = document()
        prepare?.(workspace)
        const plan = draft([...actions])
        const planBefore = structuredClone(plan)
        const workspaceBefore = structuredClone(workspace)
        const env = environment([...generatedIds])

        expectSimulationError(
          () => simulateAgentPlan(plan, workspace, env),
          expectedActionId,
          expectedField,
        )
        expect(env.now).not.toHaveBeenCalled()
        expect(env.createId).not.toHaveBeenCalled()
        expect(plan).toEqual(planBefore)
        expect(workspace).toEqual(workspaceBefore)
      }
    },
  )

  it('treats createTask and updateTask in-progress intents as the same singleton resource in either order', () => {
    const createRunning = createTaskAction(
      'create-running-task',
      'task:new-running',
      { kind: 'existing', id: PROJECT_A },
      null,
      { status: 'in_progress' },
    )
    const updateRunning = existingAction(
      'updateTask',
      'start-existing-task',
      TASK_B,
      { status: 'in_progress' },
    )

    for (const [actions, expectedActionId] of [
      [[createRunning, updateRunning], 'start-existing-task'],
      [[updateRunning, createRunning], 'create-running-task'],
    ] as const) {
      const workspace = document()
      const plan = draft([...actions])
      const planBefore = structuredClone(plan)
      const workspaceBefore = structuredClone(workspace)
      const env = environment([CREATED_TASK])

      expectSimulationError(
        () => simulateAgentPlan(plan, workspace, env),
        expectedActionId,
        'dependency',
      )
      expect(env.now).not.toHaveBeenCalled()
      expect(env.createId).not.toHaveBeenCalled()
      expect(plan).toEqual(planBefore)
      expect(workspace).toEqual(workspaceBefore)
    }
  })

  it('fails closed when two created tasks both request in-progress status', () => {
    const workspace = document()
    const plan = draft([
      createTaskAction(
        'create-running-a',
        'task:running-a',
        { kind: 'existing', id: PROJECT_A },
        null,
        { status: 'in_progress' },
      ),
      createTaskAction(
        'create-running-b',
        'task:running-b',
        { kind: 'existing', id: PROJECT_A },
        null,
        { status: 'in_progress' },
      ),
    ])
    const planBefore = structuredClone(plan)
    const workspaceBefore = structuredClone(workspace)
    const env = environment([CREATED_TASK, CREATED_TASK_2])

    expectSimulationError(
      () => simulateAgentPlan(plan, workspace, env),
      'create-running-b',
      'dependency',
    )
    expect(env.now).not.toHaveBeenCalled()
    expect(env.createId).not.toHaveBeenCalled()
    expect(plan).toEqual(planBefore)
    expect(workspace).toEqual(workspaceBefore)
  })

  it('rejects a generated UUID that differs from an existing ID only by letter case', () => {
    const upperId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
    const lowerId = upperId.toLowerCase()
    const workspace = document({
      projects: [project(upperId, 0)],
      milestones: [],
      tasks: [],
      quarterGoals: [],
    })
    const plan = draft([createProjectAction('create-case-collision', 'project:case-collision')])
    const planBefore = structuredClone(plan)
    const workspaceBefore = structuredClone(workspace)
    const env = environment([lowerId])

    expectSimulationError(
      () => simulateAgentPlan(plan, workspace, env),
      'create-case-collision',
      'generatedId',
    )
    expect(env.now).toHaveBeenCalledTimes(1)
    expect(env.createId).toHaveBeenCalledTimes(1)
    expect(plan).toEqual(planBefore)
    expect(workspace).toEqual(workspaceBefore)
  })

  it('rejects same-batch generated UUIDs that differ only by letter case', () => {
    const upperId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB'
    const lowerId = upperId.toLowerCase()
    const workspace = document()
    const plan = draft([
      createProjectAction('create-upper-id', 'project:upper-id'),
      createProjectAction('create-lower-id', 'project:lower-id'),
    ])
    const planBefore = structuredClone(plan)
    const workspaceBefore = structuredClone(workspace)
    const env = environment([upperId, lowerId])

    expectSimulationError(
      () => simulateAgentPlan(plan, workspace, env),
      'create-lower-id',
      'generatedId',
    )
    expect(env.now).toHaveBeenCalledTimes(1)
    expect(env.createId).toHaveBeenCalledTimes(2)
    expect(plan).toEqual(planBefore)
    expect(workspace).toEqual(workspaceBefore)
  })

  const duplicateWorkspaceIdentityCases: Array<{
    name: string
    make: () => { workspace: WorkspaceDocument, plan: AgentPlanDraftV1 }
  }> = [
    {
      name: 'same-type tasks with the exact same ID and divergent timestamps',
      make: () => {
        const workspace = document()
        workspace.tasks.push(task(TASK_A, PROJECT_A, MILESTONE_A, 20, {
          title: 'Duplicate task selected by Map',
          updatedAt: NOW,
        }))
        return {
          workspace,
          plan: draft([
            existingAction('updateTask', 'map-find-divergence', TASK_A, { title: 'Changed' }, NOW),
          ]),
        }
      },
    },
    {
      name: 'a project and task with the exact same ID',
      make: () => {
        const workspace = document()
        workspace.tasks[0]!.id = PROJECT_A
        return {
          workspace,
          plan: draft([
            existingAction('updateTask', 'cross-type-exact-id', PROJECT_A, { title: 'Changed' }),
          ]),
        }
      },
    },
    {
      name: 'same-type task IDs differing only by letter case',
      make: () => {
        const upperId = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC'
        const lowerId = upperId.toLowerCase()
        const workspace = document({
          tasks: [
            task(upperId, PROJECT_A, null, 0),
            task(lowerId, PROJECT_A, null, 1),
          ],
        })
        return {
          workspace,
          plan: draft([
            existingAction('updateTask', 'same-type-case-id', lowerId, { title: 'Changed' }),
          ]),
        }
      },
    },
    {
      name: 'cross-type project and task IDs differing only by letter case',
      make: () => {
        const upperId = 'DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD'
        const lowerId = upperId.toLowerCase()
        const workspace = document()
        workspace.projects.push(project(upperId, 30))
        workspace.tasks.push(task(lowerId, PROJECT_A, null, 30))
        return {
          workspace,
          plan: draft([
            existingAction('updateTask', 'cross-type-case-id', lowerId, { title: 'Changed' }),
          ]),
        }
      },
    },
    {
      name: 'quarter-goal IDs differing only by letter case',
      make: () => {
        const upperId = 'EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE'
        const lowerId = upperId.toLowerCase()
        const workspace = document({
          quarterGoals: [upperId, lowerId].map((id, sortOrder) => ({
            id,
            ownerId: OWNER_ID,
            quarter: '2026-Q3' as const,
            title: `Goal ${sortOrder}`,
            description: '',
            progress: 0,
            status: 'active' as const,
            sortOrder,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            deletedAt: null,
          })),
        })
        return {
          workspace,
          plan: draft([
            existingAction('updateProject', 'quarter-id-guard', PROJECT_A, { name: 'Changed' }),
          ]),
        }
      },
    },
  ]

  it.each(duplicateWorkspaceIdentityCases)(
    'rejects duplicate workspace identity before validation can select one record: $name',
    ({ make }) => {
      const { workspace, plan } = make()
      const planBefore = structuredClone(plan)
      const workspaceBefore = structuredClone(workspace)
      const env = environment([])

      expectSimulationError(
        () => simulateAgentPlan(plan, workspace, env),
        'draft',
        'document.id',
      )
      expect(env.now).not.toHaveBeenCalled()
      expect(env.createId).not.toHaveBeenCalled()
      expect(plan).toEqual(planBefore)
      expect(workspace).toEqual(workspaceBefore)
    },
  )

  it('rejects invalid and duplicate generated UUIDs with the creating action ID without mutating inputs', () => {
    for (const [ids, actionId] of [
      [['not-a-uuid'], 'create-project'],
      [[PROJECT_A], 'create-project'],
      [[CREATED_PROJECT, CREATED_PROJECT], 'create-milestone'],
    ] as const) {
      const plan = draft(ids.length === 1
        ? [createProjectAction()]
        : [createProjectAction(), createMilestoneAction()])
      const workspace = document()
      const planBefore = structuredClone(plan)
      const workspaceBefore = structuredClone(workspace)
      const env = environment([...ids])

      expectSimulationError(
        () => simulateAgentPlan(plan, workspace, env),
        actionId,
        'generatedId',
      )
      expect(env.now).toHaveBeenCalledTimes(1)
      expect(plan).toEqual(planBefore)
      expect(workspace).toEqual(workspaceBefore)
    }
  })

  it('fails closed for zero selection, invalid schema, dependency defects, cycles, and action overflow', () => {
    const zero = draft([createProjectAction('off', 'project:off', false)])
    const invalid = draft([createProjectAction()]) as unknown as Record<string, unknown>
    invalid.extra = true
    const missing = draft([
      createTaskAction('missing-ref', 'task:missing', { kind: 'draft', ref: 'project:absent' }, null),
    ])
    const cycle = draft([
      createMilestoneAction('cycle', 'milestone:cycle', { kind: 'draft', ref: 'milestone:cycle' }),
    ])
    const overflow = draft(Array.from({ length: 31 }, (_, index) =>
      createProjectAction(`project-${index}`, `project:${index}`)))

    for (const [plan, expectedAction] of [
      [zero, 'draft'],
      [invalid, 'draft'],
      [missing, 'missing-ref'],
      [cycle, 'cycle'],
      [overflow, 'draft'],
    ] as const) {
      const env = environment([])
      expectSimulationError(
        () => simulateAgentPlan(plan as AgentPlanDraftV1, document(), env),
        expectedAction,
      )
      expect(env.now).not.toHaveBeenCalled()
      expect(env.createId).not.toHaveBeenCalled()
    }
  })

  it('uses the demo owner only for an entirely empty workspace', () => {
    const emptyDocument: WorkspaceDocument = {
      version: 3,
      projects: [],
      milestones: [],
      tasks: [],
      quarterGoals: [],
    }
    const result = simulateAgentPlan(
      draft([createProjectAction()]),
      emptyDocument,
      environment([CREATED_PROJECT]),
    )
    expect(result.document.projects[0]?.ownerId).toBe(DEMO_OWNER_ID)
  })

  it('is deterministic for deterministic injections and returns isolated output', () => {
    const plan = draft([
      createTaskAction('task-existing', 'task:existing', { kind: 'existing', id: PROJECT_A }, null),
    ])
    const workspace = document()
    const first = simulateAgentPlan(plan, workspace, environment([CREATED_TASK]))
    const second = simulateAgentPlan(plan, workspace, environment([CREATED_TASK]))

    expect(first).toEqual(second)
    first.document.projects[0]!.name = 'mutated output'
    expect(workspace.projects[0]!.name).not.toBe('mutated output')
  })
})

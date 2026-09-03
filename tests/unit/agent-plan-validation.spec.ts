import { describe, expect, it } from 'vitest'
import type { AgentPlanDraftV1 } from '../../app/services/agent-plan-schema'
import { safeValidateAgentPlan, validateAgentPlan } from '../../app/services/agent-plan-validation'
import type { WorkspaceDocument } from '../../shared/workspace'

const PLAN_ID = '10000000-0000-4000-8000-000000000001'
const PROJECT_ID = '20000000-0000-4000-8000-000000000001'
const OTHER_PROJECT_ID = '20000000-0000-4000-8000-000000000002'
const DELETED_PROJECT_ID = '20000000-0000-4000-8000-000000000003'
const MILESTONE_ID = '30000000-0000-4000-8000-000000000001'
const DELETED_MILESTONE_ID = '30000000-0000-4000-8000-000000000002'
const TASK_ID = '40000000-0000-4000-8000-000000000001'
const DELETED_TASK_ID = '40000000-0000-4000-8000-000000000002'
const UPDATED_AT = '2026-08-13T08:00:00.000Z'
const DELETED_AT = '2026-08-13T09:00:00.000Z'
const OTHER_OWNER_ID = '00000000-0000-4000-8000-000000000002'

const emptyValidation = {
  executable: false,
  selectedCount: 0,
  dangerousCount: 0,
  estimatedMinutes: 0,
  issueCount: 0,
  issues: [],
}

function document(): WorkspaceDocument {
  return {
    version: 3,
    projects: [
      project(PROJECT_ID, '当前项目'),
      project(OTHER_PROJECT_ID, '其他项目'),
      { ...project(DELETED_PROJECT_ID, '已删除项目'), deletedAt: DELETED_AT },
    ],
    milestones: [
      milestone(MILESTONE_ID, PROJECT_ID, '当前里程碑'),
      { ...milestone(DELETED_MILESTONE_ID, PROJECT_ID, '已删除里程碑'), deletedAt: DELETED_AT },
    ],
    tasks: [
      task(TASK_ID, PROJECT_ID, MILESTONE_ID, '当前任务'),
      { ...task(DELETED_TASK_ID, PROJECT_ID, null, '已删除任务'), deletedAt: DELETED_AT },
    ],
    quarterGoals: [],
  }
}

function project(id: string, name: string) {
  return {
    id,
    ownerId: '00000000-0000-4000-8000-000000000001',
    name,
    color: '#6B61DF',
    description: '',
    priority: null,
    status: 'active' as const,
    targetDate: null,
    sortOrder: 0,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
  }
}

function milestone(id: string, projectId: string, title: string) {
  return {
    id,
    ownerId: '00000000-0000-4000-8000-000000000001',
    projectId,
    title,
    description: '',
    targetDate: null,
    status: 'planned' as const,
    progressMode: 'auto' as const,
    progress: 0,
    sortOrder: 0,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
  }
}

function task(id: string, projectId: string | null, milestoneId: string | null, title: string) {
  return {
    id,
    ownerId: '00000000-0000-4000-8000-000000000001',
    projectId,
    milestoneId,
    title,
    description: '',
    priority: null,
    dueDate: null,
    dueTime: null,
    isFocus: false,
    status: 'todo' as const,
    importance: 'normal' as const,
    estimatedMinutes: 25,
    reminderAt: null,
    snoozedUntil: null,
    lastRemindedAt: null,
    sortOrder: 0,
    completedAt: null,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
  }
}

function draft(actions: Array<Record<string, unknown>>): AgentPlanDraftV1 {
  return {
    version: 1,
    id: PLAN_ID,
    question: '请规划当前工作',
    model: 'MiniMax-M2.7',
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    status: 'draft',
    actions,
    validation: emptyValidation,
  } as unknown as AgentPlanDraftV1
}

function createProjectAction(actionId = 'project-1', draftRef = 'project:new') {
  return {
    actionId,
    type: 'createProject',
    reason: '建立项目',
    selected: true,
    dangerous: false,
    draftRef,
    payload: {
      name: '网站改版',
      color: '#7C6BF2',
      description: '',
      priority: 'high',
      status: 'active',
      targetDate: '2026-09-30',
    },
  }
}

function createMilestoneAction(
  actionId = 'milestone-1',
  projectId: unknown = { kind: 'draft', ref: 'project:new' },
  draftRef = 'milestone:new',
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
      title: '完成首页评审',
      description: '',
      targetDate: '2026-08-31',
      status: 'planned',
      progressMode: 'auto',
      progress: 0,
    },
  }
}

function createTaskAction(
  actionId = 'task-1',
  projectId: unknown = { kind: 'draft', ref: 'project:new' },
  milestoneId: unknown = { kind: 'draft', ref: 'milestone:new' },
  draftRef = 'task:new',
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
      title: '整理首页信息架构',
      description: '',
      priority: 'high',
      dueDate: '2026-08-20',
      dueTime: '10:30',
      isFocus: true,
      status: 'todo',
      importance: 'important',
      estimatedMinutes: 60,
      reminderAt: null,
      snoozedUntil: null,
      lastRemindedAt: null,
    },
  }
}

function existingAction(
  type: string,
  actionId: string,
  targetId: string,
  payload: Record<string, unknown>,
  selected = true,
) {
  return {
    actionId,
    type,
    reason: '更新现有记录',
    selected,
    dangerous: type.startsWith('delete'),
    targetId,
    expectedUpdatedAt: UPDATED_AT,
    payload,
  }
}

describe('validateAgentPlan', () => {
  it('accepts a clean linked create chain and sums explicit task estimates', () => {
    const result = validateAgentPlan(draft([
      createProjectAction(),
      createMilestoneAction(),
      createTaskAction(),
    ]), document())

    expect(result).toEqual({
      executable: true,
      selectedCount: 3,
      dangerousCount: 0,
      estimatedMinutes: 60,
      issues: [],
    })
  })

  it('detects duplicate action IDs and duplicate create draft references in action order', () => {
    const result = validateAgentPlan(draft([
      createProjectAction('duplicate', 'duplicate-ref'),
      createProjectAction('duplicate', 'duplicate-ref'),
    ]), document())

    expect(result.issues).toEqual([
      expect.objectContaining({ actionId: 'duplicate', code: 'field', field: 'actionId' }),
      expect.objectContaining({ actionId: 'duplicate', code: 'field', field: 'draftRef' }),
    ])
  })

  it('fully ignores unrelated unselected actions even when their schema, IDs, and refs are invalid', () => {
    const valid = existingAction('updateTask', 'selected-update', TASK_ID, { title: '有效更新' })
    const result = validateAgentPlan(draft([
      valid,
      { ...createProjectAction('selected-update', 'project:ignored'), selected: false, reason: '', payload: { unknown: true } },
      { ...createProjectAction('ignored-two', 'project:ignored'), selected: false, payload: { unknown: true } },
      { actionId: 'ignored-three', type: 'createTask', selected: false, dangerous: false, reason: '' },
    ]), document())

    expect(result).toEqual({
      executable: true,
      selectedCount: 1,
      dangerousCount: 0,
      estimatedMinutes: 0,
      issues: [],
    })
  })

  it('reports only the dependency when a selected child references an invalid unselected parent', () => {
    const invalidParent = {
      actionId: 'parent-off',
      type: 'createProject',
      selected: false,
      dangerous: false,
      reason: '',
      draftRef: 'project:off',
      payload: { unknown: true },
    }
    const child = createMilestoneAction('child-on', { kind: 'draft', ref: 'project:off' })

    const result = validateAgentPlan(draft([invalidParent, child]), document())

    expect(result.executable).toBe(false)
    expect(result.selectedCount).toBe(1)
    expect(result.issues).toEqual([
      expect.objectContaining({ actionId: 'child-on', code: 'dependency', field: 'payload.projectId' }),
    ])
  })

  it('rejects selected children whose draft parent is deselected, missing, or the wrong type', () => {
    const deselectedParent = { ...createProjectAction('project-off', 'project:off'), selected: false }
    const result = validateAgentPlan(draft([
      deselectedParent,
      createMilestoneAction('milestone-off', { kind: 'draft', ref: 'project:off' }, 'milestone:off'),
      createMilestoneAction('milestone-missing', { kind: 'draft', ref: 'project:missing' }, 'milestone:missing'),
      createProjectAction('wrong-type', 'task:wrong'),
      createTaskAction('task-wrong', null, { kind: 'draft', ref: 'task:wrong' }, 'task:child'),
    ]), document())

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'milestone-off', code: 'dependency', field: 'payload.projectId' }),
      expect.objectContaining({ actionId: 'milestone-missing', code: 'dependency', field: 'payload.projectId' }),
      expect.objectContaining({ actionId: 'task-wrong', code: 'dependency', field: 'payload.milestoneId' }),
    ]))
  })

  it('detects cycles in malformed draft-reference graphs without recursing forever', () => {
    const first = createMilestoneAction(
      'cycle-a',
      { kind: 'draft', ref: 'milestone:cycle-b' },
      'milestone:cycle-a',
    )
    const second = createMilestoneAction(
      'cycle-b',
      { kind: 'draft', ref: 'milestone:cycle-a' },
      'milestone:cycle-b',
    )

    const result = validateAgentPlan(draft([first, second]), document())

    expect(result.issues.filter(issue => issue.message.includes('循环依赖'))).toEqual([
      expect.objectContaining({ actionId: 'cycle-a', code: 'dependency' }),
      expect.objectContaining({ actionId: 'cycle-b', code: 'dependency' }),
    ])
  })

  it('rejects missing and deleted existing parents and incompatible task project/milestone links', () => {
    const result = validateAgentPlan(draft([
      createMilestoneAction('missing-project', { kind: 'existing', id: '20000000-0000-4000-8000-000000000099' }),
      createMilestoneAction('deleted-project', { kind: 'existing', id: DELETED_PROJECT_ID }),
      createTaskAction(
        'deleted-milestone',
        { kind: 'existing', id: PROJECT_ID },
        { kind: 'existing', id: DELETED_MILESTONE_ID },
      ),
      createTaskAction(
        'wrong-project',
        { kind: 'existing', id: OTHER_PROJECT_ID },
        { kind: 'existing', id: MILESTONE_ID },
      ),
    ]), document())

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'missing-project', code: 'missing-target', field: 'payload.projectId' }),
      expect.objectContaining({ actionId: 'deleted-project', code: 'missing-target', field: 'payload.projectId' }),
      expect.objectContaining({ actionId: 'deleted-milestone', code: 'missing-target', field: 'payload.milestoneId' }),
      expect.objectContaining({ actionId: 'wrong-project', code: 'field', field: 'payload.milestoneId' }),
    ]))
  })

  it('rejects missing, deleted, and wrong-entity existing action targets', () => {
    const result = validateAgentPlan(draft([
      existingAction('updateTask', 'missing', '40000000-0000-4000-8000-000000000099', { title: '有效标题' }),
      existingAction('updateTask', 'deleted', DELETED_TASK_ID, { title: '有效标题' }),
      existingAction('updateTask', 'wrong-entity', PROJECT_ID, { title: '有效标题' }),
    ]), document())

    expect(result.issues).toEqual([
      expect.objectContaining({ actionId: 'missing', code: 'missing-target', field: 'targetId' }),
      expect.objectContaining({ actionId: 'deleted', code: 'missing-target', field: 'targetId' }),
      expect.objectContaining({ actionId: 'wrong-entity', code: 'missing-target', field: 'targetId' }),
    ])
  })

  it('requires an exact expectedUpdatedAt match', () => {
    const stale = existingAction('updateTask', 'stale', TASK_ID, { title: '有效标题' })
    stale.expectedUpdatedAt = '2026-08-13T08:00:00.001Z'

    const result = validateAgentPlan(draft([stale]), document())

    expect(result.issues).toEqual([
      expect.objectContaining({ actionId: 'stale', code: 'conflict', field: 'expectedUpdatedAt' }),
    ])
  })

  it('reports a malformed expectedUpdatedAt as a field issue instead of a stale conflict', () => {
    const malformed = existingAction('updateTask', 'malformed-timestamp', TASK_ID, { title: '有效标题' })
    malformed.expectedUpdatedAt = 'yesterday'

    const result = validateAgentPlan(draft([malformed]), document())

    expect(result.issues).toEqual([
      expect.objectContaining({ actionId: 'malformed-timestamp', code: 'field', field: 'expectedUpdatedAt' }),
    ])
  })

  it('reports schema-bypassing non-object actions and invalid selection flags without throwing', () => {
    const malformed = draft([
      null as unknown as Record<string, unknown>,
      {
        ...createProjectAction('bad-selection', 'project:bad-selection'),
        selected: 'yes',
      },
    ])

    const result = validateAgentPlan(malformed, document())

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'action-1', code: 'field', field: 'actionId' }),
      expect.objectContaining({ actionId: 'bad-selection', code: 'field', field: 'selected' }),
    ]))
  })

  it('strictly reports selected action schema failures including unknown payload fields and empty reasons', () => {
    const invalid = {
      ...existingAction('updateTask', 'strict-invalid', TASK_ID, { title: '有效标题', hidden: true }),
      reason: '   ',
    }

    const result = validateAgentPlan(draft([invalid]), document())

    expect(result.executable).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'strict-invalid', code: 'field', field: 'reason' }),
      expect.objectContaining({ actionId: 'strict-invalid', code: 'field', field: 'payload.hidden' }),
    ]))
  })

  it('uses schema-parsed defaults and trimmed identifiers for valid raw actions', () => {
    const { selected: _createSelected, dangerous: _createDangerous, ...create } = createProjectAction(' duplicate ', 'project:default')
    const duplicateAfterTrim = createProjectAction('duplicate', 'project:second')
    const { selected: _deleteSelected, dangerous: _deleteDangerous, ...deleteAction } = existingAction('deleteTask', 'delete-default', TASK_ID, {})
    const invalidUnselected = {
      actionId: 'ignored-invalid',
      type: 'createTask',
      selected: false,
      dangerous: false,
      reason: '',
      payload: { unknown: true },
    }

    const result = safeValidateAgentPlan(draft([
      create,
      duplicateAfterTrim,
      deleteAction,
      invalidUnselected,
    ]), document())

    expect(result).toEqual(expect.objectContaining({
      executable: false,
      selectedCount: 2,
      dangerousCount: 0,
      issues: [expect.objectContaining({ actionId: 'duplicate', code: 'field', field: 'actionId' })],
    }))
  })

  it('keeps valid action defaults canonical when an unrelated unselected action is invalid', () => {
    const { selected: _selected, dangerous: _dangerous, ...validCreate } = createProjectAction('create-default', 'project:default-only')
    const invalidUnselected = {
      actionId: 'ignored-bad-action',
      type: 'createProject',
      selected: false,
      dangerous: false,
      reason: '',
      draftRef: 'project:ignored-bad',
      payload: { unknown: true },
    }

    expect(safeValidateAgentPlan(draft([validCreate, invalidUnselected]), document())).toEqual({
      executable: true,
      selectedCount: 1,
      dangerousCount: 0,
      estimatedMinutes: 0,
      issues: [],
    })
  })

  it('strictly blocks invalid and unknown draft-envelope fields independently of actions', () => {
    const raw = {
      ...draft([createProjectAction()]),
      question: '   ',
      unexpectedEnvelope: true,
    }

    const result = safeValidateAgentPlan(raw, document())

    expect(result.executable).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'draft', code: 'field', field: 'question' }),
      expect.objectContaining({ actionId: 'draft', code: 'field', field: 'unexpectedEnvelope' }),
    ]))
  })

  it('offers a non-throwing safe path for malformed plan envelopes and action overflow', () => {
    const overflowingActions = Array.from({ length: 31 }, (_, index) =>
      createProjectAction(`project-${index}`, `project:${index}`))

    expect(() => safeValidateAgentPlan(null, null)).not.toThrow()
    expect(safeValidateAgentPlan(null, null)).toEqual(expect.objectContaining({
      executable: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ actionId: 'draft', code: 'field' }),
      ]),
    }))
    expect(safeValidateAgentPlan(draft(overflowingActions), document())).toEqual(expect.objectContaining({
      executable: false,
      selectedCount: 0,
      dangerousCount: 0,
      estimatedMinutes: 0,
      issues: [expect.objectContaining({ actionId: 'draft', code: 'field', field: 'actions' })],
    }))
  })

  it('bounds very large chained raw plans before schema and dependency traversal', () => {
    const actions = Object.freeze(Array.from({ length: 5000 }, (_, index) => Object.freeze({
      actionId: `milestone-${index}`,
      type: 'createMilestone',
      reason: '链式恶意草稿',
      selected: true,
      dangerous: false,
      draftRef: `milestone:${index}`,
      payload: Object.freeze({
        projectId: Object.freeze({ kind: 'draft', ref: `milestone:${(index + 1) % 5000}` }),
        title: `里程碑 ${index}`,
        description: '',
        targetDate: null,
        status: 'planned',
        progressMode: 'auto',
        progress: 0,
      }),
    })))
    const rawDraft = Object.freeze({
      ...draft([]),
      actions,
    })
    const firstAction = actions[0]
    const lastAction = actions.at(-1)

    expect(() => safeValidateAgentPlan(rawDraft, document())).not.toThrow()
    const result = safeValidateAgentPlan(rawDraft, document())

    expect(result).toEqual({
      executable: false,
      selectedCount: 0,
      dangerousCount: 0,
      estimatedMinutes: 0,
      issues: [{
        actionId: 'draft',
        code: 'field',
        field: 'actions',
        message: '计划最多包含 30 个操作。',
      }],
    })
    expect(rawDraft.actions).toBe(actions)
    expect(rawDraft.actions).toHaveLength(5000)
    expect(rawDraft.actions[0]).toBe(firstAction)
    expect(rawDraft.actions.at(-1)).toBe(lastAction)
  })

  it('reports invalid fields, due-time pairing, progress mode, and milestone/project compatibility', () => {
    const badTask = createTaskAction('bad-task', { kind: 'existing', id: PROJECT_ID }, null)
    badTask.payload.title = '   '
    badTask.payload.dueDate = null
    badTask.payload.dueTime = '09:30'
    badTask.payload.estimatedMinutes = 1
    const badMilestone = createMilestoneAction('bad-milestone', { kind: 'existing', id: PROJECT_ID })
    badMilestone.payload.progressMode = 'automatic'
    badMilestone.payload.progress = 101

    const result = validateAgentPlan(draft([badTask, badMilestone]), document())

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'bad-task', code: 'field', field: 'payload.title' }),
      expect.objectContaining({ actionId: 'bad-task', code: 'field', field: 'payload.dueTime' }),
      expect.objectContaining({ actionId: 'bad-task', code: 'field', field: 'payload.estimatedMinutes' }),
      expect.objectContaining({ actionId: 'bad-milestone', code: 'field', field: 'payload.progressMode' }),
      expect.objectContaining({ actionId: 'bad-milestone', code: 'field', field: 'payload.progress' }),
    ]))
  })

  it('validates update patches against the resulting task and milestone relationships', () => {
    const result = validateAgentPlan(draft([
      existingAction('updateTask', 'clear-due-date', TASK_ID, { dueDate: null, dueTime: '09:30' }),
      existingAction('updateTask', 'move-task', TASK_ID, {
        projectId: OTHER_PROJECT_ID,
        milestoneId: MILESTONE_ID,
      }),
      existingAction('updateMilestone', 'move-milestone', MILESTONE_ID, { projectId: DELETED_PROJECT_ID }),
    ]), document())

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'clear-due-date', code: 'field', field: 'payload.dueTime' }),
      expect.objectContaining({ actionId: 'move-task', code: 'field', field: 'payload.milestoneId' }),
      expect.objectContaining({ actionId: 'move-milestone', code: 'missing-target', field: 'payload.projectId' }),
    ]))
  })

  it('fails closed for mixed workspace owners and selected cross-owner targets', () => {
    const workspace = document()
    workspace.tasks[0]!.ownerId = OTHER_OWNER_ID

    const result = validateAgentPlan(draft([
      existingAction('updateTask', 'foreign-target', TASK_ID, { title: '跨所有者更新' }),
    ]), workspace)

    expect(result.executable).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'draft', code: 'field', field: 'document.ownerId' }),
      expect.objectContaining({ actionId: 'foreign-target', code: 'missing-target', field: 'targetId' }),
    ]))
  })

  it('rejects cross-owner existing parents and milestone-to-project owner chains', () => {
    const workspace = document()
    workspace.projects[1]!.ownerId = OTHER_OWNER_ID
    workspace.milestones[0]!.projectId = OTHER_PROJECT_ID

    const result = validateAgentPlan(draft([
      createMilestoneAction('foreign-project', { kind: 'existing', id: OTHER_PROJECT_ID }),
      createTaskAction('foreign-chain', null, { kind: 'existing', id: MILESTONE_ID }),
    ]), workspace)

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'foreign-project', code: 'missing-target', field: 'payload.projectId' }),
      expect.objectContaining({ actionId: 'foreign-chain', code: 'missing-target', field: 'payload.milestoneId' }),
    ]))
  })

  it('ignores an unselected delete and leaves a zero-selection plan non-executable', () => {
    const result = validateAgentPlan(draft([
      existingAction('deleteTask', 'delete-off', TASK_ID, {}, false),
    ]), document())

    expect(result).toEqual({
      executable: false,
      selectedCount: 0,
      dangerousCount: 0,
      estimatedMinutes: 0,
      issues: [],
    })
  })

  it('blocks a selected delete until explicit dangerous confirmation', () => {
    const plan = draft([existingAction('deleteTask', 'delete-on', TASK_ID, {})])

    expect(validateAgentPlan(plan, document())).toEqual(expect.objectContaining({
      executable: false,
      selectedCount: 1,
      dangerousCount: 1,
      issues: [expect.objectContaining({ actionId: 'delete-on', code: 'danger-confirmation' })],
    }))
    expect(validateAgentPlan(plan, document(), { dangerousConfirmed: true })).toEqual({
      executable: true,
      selectedCount: 1,
      dangerousCount: 1,
      estimatedMinutes: 0,
      issues: [],
    })
  })

  it('sums only explicit selected create/update task estimates without reusing target values', () => {
    const create = createTaskAction('create-estimate', null, null)
    create.payload.estimatedMinutes = 30
    const result = validateAgentPlan(draft([
      create,
      existingAction('updateTask', 'update-estimate', TASK_ID, { estimatedMinutes: 45 }),
      existingAction('updateTask', 'update-title-only', TASK_ID, { title: '只改标题' }),
      { ...createTaskAction('unselected-estimate', null, null, 'task:off'), selected: false },
    ]), document())

    expect(result.estimatedMinutes).toBe(75)
  })

  it('does not mutate either input and returns deterministic output', () => {
    const plan = draft([
      createProjectAction(),
      createMilestoneAction(),
      createTaskAction(),
      existingAction('updateTask', 'stale', TASK_ID, { title: '更新标题' }),
    ])
    plan.actions[3]!.expectedUpdatedAt = '2026-08-12T08:00:00.000Z'
    const workspace = document()
    const beforePlan = structuredClone(plan)
    const beforeWorkspace = structuredClone(workspace)

    const first = validateAgentPlan(plan, workspace)
    const second = validateAgentPlan(plan, workspace)

    expect(first).toEqual(second)
    expect(plan).toEqual(beforePlan)
    expect(workspace).toEqual(beforeWorkspace)
  })
})

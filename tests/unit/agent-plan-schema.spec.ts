import { describe, expect, it } from 'vitest'
import {
  agentActionSchema,
  agentActionTypeSchema,
  agentPlanDraftSchema,
} from '../../app/services/agent-plan-schema'

const PLAN_ID = '10000000-0000-4000-8000-000000000001'
const PROJECT_ID = '20000000-0000-4000-8000-000000000001'
const MILESTONE_ID = '30000000-0000-4000-8000-000000000001'
const TASK_ID = '40000000-0000-4000-8000-000000000001'
const CREATED_AT = '2026-08-13T08:00:00.000Z'

const validation = {
  executable: true,
  selectedCount: 0,
  dangerousCount: 0,
  estimatedMinutes: 0,
  issueCount: 0,
  issues: [],
}

function draft(actions: unknown[]) {
  return {
    version: 1,
    id: PLAN_ID,
    question: '请规划网站改版',
    model: 'MiniMax-M2.7',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status: 'draft',
    actions,
    validation,
  }
}

function existingBase(type: string, actionId: string, targetId: string, payload: unknown) {
  return {
    actionId,
    type,
    reason: '需要更新真实记录',
    targetId,
    expectedUpdatedAt: CREATED_AT,
    payload,
  }
}

describe('Agent plan schema', () => {
  it('defaults delete actions to dangerous and unselected while preserving explicit selection', () => {
    const unselected = agentPlanDraftSchema.parse(draft([
      existingBase('deleteTask', 'delete-task-1', TASK_ID, {}),
    ]))
    const selected = agentPlanDraftSchema.parse(draft([{
      ...existingBase('deleteTask', 'delete-task-2', TASK_ID, {}),
      selected: true,
    }]))

    expect(unselected.actions[0]).toMatchObject({ selected: false, dangerous: true })
    expect(selected.actions[0]).toMatchObject({ selected: true, dangerous: true })
  })

  it('rejects a delete action that claims it is not dangerous', () => {
    expect(() => agentActionSchema.parse({
      ...existingBase('deleteTask', 'unsafe-delete-flag', TASK_ID, {}),
      dangerous: false,
    })).toThrow()
  })

  it('rejects a non-delete action that claims it is dangerous', () => {
    expect(() => agentActionSchema.parse({
      ...existingBase('updateTask', 'unsafe-update-flag', TASK_ID, { title: '有效标题' }),
      dangerous: true,
    })).toThrow()
  })

  it('rejects permanent deletion action names', () => {
    expect(() => agentActionSchema.parse({
      ...existingBase('purgeTask', 'purge-task-1', TASK_ID, {}),
    })).toThrow()
    expect(() => agentActionSchema.parse({
      ...existingBase('permanentDeleteProject', 'purge-project-1', PROJECT_ID, {}),
    })).toThrow()
  })

  it('accepts a linked new project, milestone, and task through draft references', () => {
    const parsed = agentPlanDraftSchema.parse(draft([
      {
        actionId: 'project-1',
        type: 'createProject',
        reason: '建立项目容器',
        draftRef: 'project:website-redesign',
        payload: {
          name: '网站改版',
          color: '#6B61DF',
          description: '重新设计官网',
          priority: 'high',
          status: 'active',
          targetDate: '2026-09-30',
        },
      },
      {
        actionId: 'milestone-1',
        type: 'createMilestone',
        reason: '建立首页评审节点',
        draftRef: 'milestone:homepage-review',
        payload: {
          projectId: { kind: 'draft', ref: 'project:website-redesign' },
          title: '首页评审',
          description: '确认信息架构与视觉方向',
          targetDate: '2026-08-31',
          status: 'planned',
          progressMode: 'auto',
          progress: 0,
        },
      },
      {
        actionId: 'task-1',
        type: 'createTask',
        reason: '先整理首页结构',
        draftRef: 'task:information-architecture',
        payload: {
          projectId: { kind: 'draft', ref: 'project:website-redesign' },
          milestoneId: { kind: 'draft', ref: 'milestone:homepage-review' },
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
      },
    ]))

    expect(parsed.actions).toHaveLength(3)
    expect(parsed.actions.every(action => action.selected && !action.dangerous)).toBe(true)
  })

  it('accepts every exact action name with a representative payload', () => {
    const actions = [
      {
        actionId: 'create-project', type: 'createProject', reason: '新项目', draftRef: 'project:new',
        payload: { name: '新项目', color: '#123ABC', description: '', priority: null, status: 'planned', targetDate: null },
      },
      existingBase('updateProject', 'update-project', PROJECT_ID, { name: '项目新名称' }),
      existingBase('setProjectCompleted', 'complete-project', PROJECT_ID, { completed: true }),
      existingBase('deleteProject', 'delete-project', PROJECT_ID, {}),
      {
        actionId: 'create-milestone', type: 'createMilestone', reason: '新里程碑', draftRef: 'milestone:new',
        payload: {
          projectId: { kind: 'existing', id: PROJECT_ID }, title: '新里程碑', description: '',
          targetDate: null, status: 'planned', progressMode: 'manual', progress: 30,
        },
      },
      existingBase('updateMilestone', 'update-milestone', MILESTONE_ID, { status: 'blocked', progress: 40 }),
      existingBase('setMilestoneCompleted', 'complete-milestone', MILESTONE_ID, { completed: true }),
      existingBase('deleteMilestone', 'delete-milestone', MILESTONE_ID, {}),
      {
        actionId: 'create-task', type: 'createTask', reason: '新任务', draftRef: 'task:new',
        payload: {
          projectId: { kind: 'existing', id: PROJECT_ID }, milestoneId: null, title: '新任务', description: '',
          priority: 'medium', dueDate: null, dueTime: null, isFocus: false, status: 'inbox', importance: 'normal',
          estimatedMinutes: null, reminderAt: null, snoozedUntil: null, lastRemindedAt: null,
        },
      },
      existingBase('updateTask', 'update-task', TASK_ID, { title: '任务新标题', estimatedMinutes: 45 }),
      existingBase('setTaskCompleted', 'complete-task', TASK_ID, { completed: false }),
      existingBase('deleteTask', 'delete-task', TASK_ID, {}),
    ]

    const parsed = agentPlanDraftSchema.parse(draft(actions))

    expect(parsed.actions.map(action => action.type)).toEqual(agentActionTypeSchema.options)
  })

  it('accepts a create task without optional lifecycle and reminder fields', () => {
    const parsed = agentActionSchema.parse({
      actionId: 'create-minimal-task',
      type: 'createTask',
      reason: '先记录待办',
      draftRef: 'task:minimal',
      payload: {
        projectId: null,
        milestoneId: null,
        title: '记录一项待办',
        description: '',
        priority: null,
        dueDate: null,
        dueTime: null,
        isFocus: false,
      },
    })

    expect(parsed.payload).toMatchObject({ title: '记录一项待办', projectId: null, milestoneId: null })
  })

  it.each([
    ['unknown action', existingBase('archiveTask', 'bad-type', TASK_ID, {})],
    ['malformed draft relationship', {
      actionId: 'bad-ref', type: 'createMilestone', reason: '错误引用', draftRef: 'milestone:bad',
      payload: {
        projectId: { kind: 'draft', id: PROJECT_ID }, title: '里程碑', description: '', targetDate: null,
        status: 'planned', progressMode: 'auto', progress: 0,
      },
    }],
    ['invalid target UUID', existingBase('updateTask', 'bad-id', 'not-a-uuid', { title: '有效标题' })],
    ['invalid expected date', { ...existingBase('updateTask', 'bad-date', TASK_ID, { title: '有效标题' }), expectedUpdatedAt: 'tomorrow' }],
    ['invalid progress', existingBase('updateMilestone', 'bad-progress', MILESTONE_ID, { progress: 101 })],
    ['invalid status', existingBase('updateProject', 'bad-status', PROJECT_ID, { status: 'archived' })],
    ['invalid priority', existingBase('updateTask', 'bad-priority', TASK_ID, { priority: 'urgent' })],
    ['invalid estimated minutes', existingBase('updateTask', 'bad-estimate', TASK_ID, { estimatedMinutes: 1 })],
    ['invalid due date', existingBase('updateTask', 'bad-due-date', TASK_ID, { dueDate: '2026-13-40' })],
    ['invalid reminder timestamp', existingBase('updateTask', 'bad-reminder', TASK_ID, { reminderAt: 'later' })],
    ['empty title', existingBase('updateTask', 'empty-title', TASK_ID, { title: '   ' })],
    ['empty update payload', existingBase('updateProject', 'empty-update', PROJECT_ID, {})],
    ['undefined-only update payload', existingBase('updateProject', 'undefined-update', PROJECT_ID, { name: undefined })],
  ])('rejects %s', (_label, action) => {
    expect(() => agentActionSchema.parse(action)).toThrow()
  })

  it.each([
    ['draft', { extra: true }],
    ['action', { actions: [{ ...existingBase('updateTask', 'extra-action', TASK_ID, { title: '有效标题' }), extra: true }] }],
    ['payload', { actions: [existingBase('updateTask', 'extra-payload', TASK_ID, { title: '有效标题', extra: true })] }],
  ])('rejects unknown keys at the %s boundary', (_label, override) => {
    expect(() => agentPlanDraftSchema.parse({ ...draft([]), ...override })).toThrow()
  })

  it('rejects unknown validation keys and arbitrary issue codes', () => {
    expect(() => agentPlanDraftSchema.parse({
      ...draft([]),
      validation: { ...validation, credentials: 'must-not-be-stored' },
    })).toThrow()
    expect(() => agentPlanDraftSchema.parse({
      ...draft([]),
      validation: {
        ...validation,
        issueCount: 1,
        issues: [{ actionId: 'task-1', code: 'model-thought', message: 'hidden reasoning' }],
      },
    })).toThrow()
  })
})

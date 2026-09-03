import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import {
  applyMiniMaxAgentActions,
  describeMiniMaxAgentAction,
} from '../../app/services/minimax-agent'
import type { MiniMaxAgentAction } from '../../app/services/minimax'
import { parseMiniMaxAgentActions } from '../../app/services/minimax'

const taskDraft = {
  title: '准备周报',
  description: '汇总本周进展',
  projectId: null,
  priority: 'high' as const,
  dueDate: '2026-08-07',
  dueTime: '17:00',
  isFocus: true,
}

const canonicalTaskPayload = {
  ...taskDraft,
  projectId: null,
  milestoneId: null,
}

describe('MiniMax task agent execution', () => {
  it('describes and executes one compatible task action only when explicitly applied', async () => {
    const actions: MiniMaxAgentAction[] = [
      { actionId: 'create-1', type: 'createTask', reason: '用户要求新增', selected: true, dangerous: false, draftRef: 'task-draft', payload: canonicalTaskPayload },
    ]
    const workspace = {
      createTask: vi.fn().mockResolvedValue(undefined),
      updateTask: vi.fn().mockResolvedValue(undefined),
      setTaskCompleted: vi.fn().mockResolvedValue(undefined),
      deleteTask: vi.fn().mockResolvedValue(undefined),
    }

    expect(describeMiniMaxAgentAction(actions[0]!, new Map())).toBe('创建任务「准备周报」')
    expect(workspace.createTask).not.toHaveBeenCalled()

    const result = await applyMiniMaxAgentActions(actions, workspace)

    expect(result).toEqual({ completed: 1, total: 1 })
    expect(workspace.createTask).toHaveBeenCalledWith({ ...taskDraft, milestoneId: null })
    expect(workspace.updateTask).not.toHaveBeenCalled()
    expect(workspace.setTaskCompleted).not.toHaveBeenCalled()
    expect(workspace.deleteTask).not.toHaveBeenCalled()
  })

  it('rejects multiple compatible task actions before any legacy write', async () => {
    const actions: MiniMaxAgentAction[] = [
      { actionId: 'create-1', type: 'createTask', reason: '新增', selected: true, dangerous: false, draftRef: 'task-draft', payload: canonicalTaskPayload },
      { actionId: 'update-1', type: 'updateTask', reason: '更新', selected: true, dangerous: false, targetId: '20000000-0000-4000-8000-000000000003', expectedUpdatedAt: '2026-08-05T08:00:00.000Z', payload: { title: '新标题' } },
    ]
    const workspace = {
      createTask: vi.fn().mockResolvedValue(undefined),
      updateTask: vi.fn().mockRejectedValue(new Error('写入失败')),
      setTaskCompleted: vi.fn(),
      deleteTask: vi.fn(),
    }

    await expect(applyMiniMaxAgentActions(actions, workspace)).rejects.toMatchObject({
      completed: 0,
      total: 2,
      message: '请在 Agent 计划确认中心审阅多项操作',
    })
    expect(workspace.createTask).not.toHaveBeenCalled()
    expect(workspace.updateTask).not.toHaveBeenCalled()
  })

  it('reports zero completion when the single compatible task write fails', async () => {
    const actions: MiniMaxAgentAction[] = [
      { actionId: 'update-1', type: 'updateTask', reason: '更新', selected: true, dangerous: false, targetId: '20000000-0000-4000-8000-000000000003', expectedUpdatedAt: '2026-08-05T08:00:00.000Z', payload: { title: '新标题' } },
    ]
    const workspace = {
      createTask: vi.fn(),
      updateTask: vi.fn().mockRejectedValue(new Error('写入失败')),
      setTaskCompleted: vi.fn(),
      deleteTask: vi.fn(),
    }

    await expect(applyMiniMaxAgentActions(actions, workspace)).rejects.toMatchObject({
      completed: 0,
      total: 1,
      message: '写入失败',
    })
    expect(workspace.updateTask).toHaveBeenCalledTimes(1)
  })

  it('rejects selected project actions before the legacy task executor writes anything', async () => {
    const actions: MiniMaxAgentAction[] = [
      {
        actionId: 'project-1', type: 'createProject', reason: '创建项目', selected: true, dangerous: false, draftRef: 'project-draft',
        payload: { name: '新项目', color: '#6B61DF', description: '', priority: null, status: 'planned', targetDate: null },
      },
    ]
    const workspace = {
      createTask: vi.fn(), updateTask: vi.fn(), setTaskCompleted: vi.fn(), deleteTask: vi.fn(),
    }

    await expect(applyMiniMaxAgentActions(actions, workspace)).rejects.toMatchObject({
      completed: 0,
      message: '请在 Agent 计划确认中心审阅项目和里程碑操作',
    })
    expect(workspace.createTask).not.toHaveBeenCalled()
  })
})

describe('MiniMax normalized Agent proposal transport', () => {
  it('preserves a linked project, milestone, and task create chain', () => {
    const actions = parseMiniMaxAgentActions([
      {
        actionId: 'create-project-1',
        type: 'createProject',
        reason: ' 建立独立的产品项目 ',
        draftRef: ' project-draft ',
        payload: {
          name: ' 首页改版 ',
          color: '#6B61DF',
          description: '改善首页信息架构',
          priority: 'high',
          status: 'active',
          targetDate: '2026-09-30',
        },
      },
      {
        actionId: 'create-milestone-1',
        type: 'createMilestone',
        reason: '先完成评审',
        draftRef: 'milestone-draft',
        payload: {
          projectId: { kind: 'draft', ref: 'project-draft' },
          title: '完成首页评审',
          description: '',
          targetDate: '2026-08-20',
          status: 'planned',
          progressMode: 'auto',
          progress: 0,
        },
      },
      {
        actionId: 'create-task-1',
        type: 'createTask',
        reason: '将评审拆成可执行任务',
        draftRef: 'task-draft',
        payload: {
          projectId: { kind: 'draft', ref: 'project-draft' },
          milestoneId: { kind: 'draft', ref: 'milestone-draft' },
          title: '整理首页信息架构',
          description: '',
          priority: 'high',
          dueDate: '2026-08-18',
          dueTime: '10:30',
          isFocus: true,
          estimatedMinutes: 45,
        },
      },
    ])

    expect(actions).toHaveLength(3)
    expect(actions[0]).toMatchObject({
      actionId: 'create-project-1',
      reason: '建立独立的产品项目',
      selected: true,
      dangerous: false,
      draftRef: 'project-draft',
    })
    expect(actions[1]?.payload).toMatchObject({
      projectId: { kind: 'draft', ref: 'project-draft' },
    })
    expect(actions[2]?.payload).toMatchObject({
      projectId: { kind: 'draft', ref: 'project-draft' },
      milestoneId: { kind: 'draft', ref: 'milestone-draft' },
      estimatedMinutes: 45,
    })
  })

  it('preserves concurrency and safety metadata for existing records', () => {
    const actions = parseMiniMaxAgentActions([
      {
        actionId: 'update-task-1',
        type: 'updateTask',
        reason: '调整任务截止日期',
        targetId: '20000000-0000-4000-8000-000000000001',
        expectedUpdatedAt: '2026-08-05T08:00:00.000Z',
        payload: { dueDate: '2026-08-10' },
      },
      {
        actionId: 'delete-task-1',
        type: 'deleteTask',
        reason: '移入回收站',
        targetId: '20000000-0000-4000-8000-000000000001',
        expectedUpdatedAt: '2026-08-05T08:00:00.000Z',
        payload: {},
      },
    ])

    expect(actions[0]).toMatchObject({
      actionId: 'update-task-1',
      targetId: '20000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: '2026-08-05T08:00:00.000Z',
      selected: true,
      dangerous: false,
    })
    expect(actions[1]).toMatchObject({
      actionId: 'delete-task-1',
      selected: false,
      dangerous: true,
    })
  })

  it.each([
    ['unknown action', { actionId: 'bad-1', type: 'archiveTask', reason: '不允许', payload: {} }],
    ['permanent deletion', { actionId: 'bad-2', type: 'purgeTask', reason: '不允许', payload: {} }],
    ['invalid target identity', {
      actionId: 'bad-3',
      type: 'updateTask',
      reason: '更新',
      targetId: 'not-a-uuid',
      expectedUpdatedAt: '2026-08-05T08:00:00.000Z',
      payload: { title: '有效标题' },
    }],
  ])('rejects the whole proposal when it contains %s', (_label, unsafeAction) => {
    expect(() => parseMiniMaxAgentActions([
      {
        actionId: 'valid-1',
        type: 'createProject',
        reason: '创建项目',
        draftRef: 'project-draft',
        payload: {
          name: '新项目',
          color: '#6B61DF',
          description: '',
          priority: null,
          status: 'planned',
          targetDate: null,
        },
      },
      unsafeAction,
    ])).toThrowError(ZodError)
  })

  it('rejects the whole proposal when it exceeds the 30 action cap', () => {
    const actions = Array.from({ length: 31 }, (_, index) => ({
      actionId: `create-project-${index}`,
      type: 'createProject',
      reason: '创建项目',
      draftRef: `project-${index}`,
      payload: {
        name: `项目 ${index}`,
        color: '#6B61DF',
        description: '',
        priority: null,
        status: 'planned',
        targetDate: null,
      },
    }))

    expect(() => parseMiniMaxAgentActions(actions)).toThrowError(ZodError)
  })
})

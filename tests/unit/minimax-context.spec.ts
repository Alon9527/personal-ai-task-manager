import { describe, expect, it } from 'vitest'
import type { WorkspaceDocument } from '../../shared/workspace'
import {
  buildMiniMaxWorkspaceContext,
  suggestionToTaskInput,
} from '../../app/services/minimax'

const NOW = '2026-08-05T08:00:00.000Z'
const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const MILESTONE_ID = '30000000-0000-4000-8000-000000000001'

function workspace(): WorkspaceDocument {
  return {
    version: 3,
    projects: [
      {
        id: PROJECT_ID,
        ownerId: '00000000-0000-4000-8000-000000000001',
        name: 'MiniMax 接入',
        color: '#6B61DF',
        description: '验证 MiniMax 与真实任务上下文的连接。',
        priority: 'high',
        status: 'active',
        targetDate: '2026-08-31',
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        ownerId: '00000000-0000-4000-8000-000000000001',
        name: '已软删除项目',
        color: '#999999',
        description: '不应发送给模型',
        priority: null,
        status: 'paused',
        targetDate: null,
        sortOrder: 1,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: NOW,
      },
    ],
    milestones: [
      {
        id: MILESTONE_ID,
        ownerId: '00000000-0000-4000-8000-000000000001',
        projectId: PROJECT_ID,
        title: '完成首页评审',
        description: '确认首页信息架构与任务流程。',
        targetDate: '2026-08-20',
        status: 'planned',
        progressMode: 'auto',
        progress: 35,
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        ownerId: '00000000-0000-4000-8000-000000000001',
        projectId: PROJECT_ID,
        title: '已软删除里程碑',
        description: '不应发送给模型',
        targetDate: null,
        status: 'blocked',
        progressMode: 'manual',
        progress: 10,
        sortOrder: 1,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: NOW,
      },
    ],
    tasks: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        ownerId: '00000000-0000-4000-8000-000000000001',
        projectId: PROJECT_ID,
        milestoneId: MILESTONE_ID,
        title: '接入真实模型',
        description: '通过 Tauri 后端调用 MiniMax。',
        priority: 'high',
        dueDate: '2026-08-05',
        dueTime: '18:00',
        isFocus: true,
        sortOrder: 0,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
      {
        id: '20000000-0000-4000-8000-000000000002',
        ownerId: '00000000-0000-4000-8000-000000000001',
        projectId: null,
        milestoneId: null,
        title: '已软删除任务',
        description: '不应发送给模型',
        priority: null,
        dueDate: null,
        dueTime: null,
        isFocus: false,
        sortOrder: 1,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: NOW,
      },
    ],
    quarterGoals: [],
  }
}

describe('MiniMax workspace context', () => {
  it('sends only active records and keeps source identity', () => {
    const context = buildMiniMaxWorkspaceContext(workspace(), NOW)

    expect(context.generatedAt).toBe(NOW)
    expect(context.projects[0]).toEqual({
      id: PROJECT_ID,
      name: 'MiniMax 接入',
      description: '验证 MiniMax 与真实任务上下文的连接。',
      color: '#6B61DF',
      priority: 'high',
      status: 'active',
      targetDate: '2026-08-31',
      updatedAt: NOW,
    })
    expect(context.milestones).toEqual([
      {
        id: MILESTONE_ID,
        projectId: PROJECT_ID,
        title: '完成首页评审',
        description: '确认首页信息架构与任务流程。',
        targetDate: '2026-08-20',
        status: 'planned',
        progressMode: 'auto',
        progress: 35,
        updatedAt: NOW,
      },
    ])
    expect(context.tasks).toHaveLength(1)
    expect(context.tasks[0]).toMatchObject({
      id: '20000000-0000-4000-8000-000000000001',
      milestoneId: MILESTONE_ID,
      projectName: 'MiniMax 接入',
      title: '接入真实模型',
      completed: false,
      updatedAt: NOW,
    })
    expect(JSON.stringify(context)).not.toContain('已软删除任务')
    expect(JSON.stringify(context)).not.toContain('已软删除里程碑')
    expect(JSON.stringify(context)).not.toContain('已软删除项目')
  })

  it('caps the number of tasks and milestones sent to the model', () => {
    const document = workspace()
    const template = document.tasks[0]!
    document.tasks = Array.from({ length: 100 }, (_, index) => ({
      ...template,
      id: `20000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      title: `任务 ${index + 1}`,
      sortOrder: index,
    }))

    const milestone = document.milestones[0]!
    document.milestones = Array.from({ length: 100 }, (_, index) => ({
      ...milestone,
      id: `30000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      title: `里程碑 ${index + 1}`,
      sortOrder: index,
      deletedAt: null,
    }))

    const context = buildMiniMaxWorkspaceContext(document, NOW)
    expect(context.tasks).toHaveLength(80)
    expect(context.milestones).toHaveLength(80)
  })

  it('converts a validated suggestion into the existing task CRUD input', () => {
    const input = suggestionToTaskInput({
      rationale: '先拆成一个可完成的小步骤',
      title: '验证 MiniMax 返回结构',
      description: '运行本地解析测试，不发送真实请求。',
      projectId: '10000000-0000-4000-8000-000000000001',
      priority: 'high',
      dueDate: '2026-08-05',
      dueTime: null,
      isFocus: true,
    }, new Set(['10000000-0000-4000-8000-000000000001']))

    expect(input).toEqual({
      title: '验证 MiniMax 返回结构',
      description: '运行本地解析测试，不发送真实请求。',
      projectId: '10000000-0000-4000-8000-000000000001',
      milestoneId: null,
      priority: 'high',
      dueDate: '2026-08-05',
      dueTime: null,
      isFocus: true,
    })
  })

  it('drops a suggested project id that is not in the current workspace', () => {
    const input = suggestionToTaskInput({
      rationale: '保持任务可创建',
      title: '检查来源',
      description: '',
      projectId: '99999999-9999-4999-8999-999999999999',
      priority: null,
      dueDate: null,
      dueTime: null,
      isFocus: false,
    }, new Set())

    expect(input.projectId).toBeNull()
  })
})

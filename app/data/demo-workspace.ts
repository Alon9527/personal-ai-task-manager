import { DEMO_OWNER_ID, workspaceDocumentSchema } from '#shared/workspace'
import type { WorkspaceDocument } from '#shared/workspace'

export const DEMO_PROJECT_IDS = {
  inbox: '10000000-0000-4000-8000-000000000001',
  personal: '10000000-0000-4000-8000-000000000002',
  ideas: '10000000-0000-4000-8000-000000000003',
  health: '10000000-0000-4000-8000-000000000004',
} as const

const createdAt = '2026-07-22T00:00:00.000Z'

const demoWorkspace = workspaceDocumentSchema.parse({
  version: 3,
  projects: [
    { id: DEMO_PROJECT_IDS.inbox, ownerId: DEMO_OWNER_ID, name: '收集箱', color: '#9297A1', description: '', priority: null, status: 'active', targetDate: null, sortOrder: 0, createdAt, updatedAt: createdAt, deletedAt: null },
    { id: DEMO_PROJECT_IDS.personal, ownerId: DEMO_OWNER_ID, name: '个人效率系统', color: '#8B7CF6', description: '', priority: null, status: 'active', targetDate: null, sortOrder: 1, createdAt, updatedAt: createdAt, deletedAt: null },
    { id: DEMO_PROJECT_IDS.ideas, ownerId: DEMO_OWNER_ID, name: '产品灵感库', color: '#4DB6AC', description: '', priority: null, status: 'active', targetDate: null, sortOrder: 2, createdAt, updatedAt: createdAt, deletedAt: null },
    { id: DEMO_PROJECT_IDS.health, ownerId: DEMO_OWNER_ID, name: '健康与生活', color: '#F4A261', description: '', priority: null, status: 'active', targetDate: null, sortOrder: 3, createdAt, updatedAt: createdAt, deletedAt: null },
  ],
  milestones: [],
  tasks: [
    { id: '20000000-0000-4000-8000-000000000001', ownerId: DEMO_OWNER_ID, projectId: DEMO_PROJECT_IDS.personal, milestoneId: null, title: '完成个人工作台首页的信息架构', description: '', priority: 'high', dueDate: '2026-07-22', dueTime: '10:30', isFocus: true, sortOrder: 0, completedAt: null, createdAt, updatedAt: createdAt, deletedAt: null },
    { id: '20000000-0000-4000-8000-000000000002', ownerId: DEMO_OWNER_ID, projectId: DEMO_PROJECT_IDS.personal, milestoneId: null, title: '整理 MiniMax API 接入方案', description: '', priority: null, dueDate: '2026-07-22', dueTime: '14:00', isFocus: true, sortOrder: 1, completedAt: null, createdAt, updatedAt: createdAt, deletedAt: null },
    { id: '20000000-0000-4000-8000-000000000003', ownerId: DEMO_OWNER_ID, projectId: DEMO_PROJECT_IDS.ideas, milestoneId: null, title: '把季度目标拆成可追踪的关键结果', description: '', priority: 'medium', dueDate: '2026-07-22', dueTime: null, isFocus: true, sortOrder: 2, completedAt: null, createdAt, updatedAt: createdAt, deletedAt: null },
    { id: '20000000-0000-4000-8000-000000000004', ownerId: DEMO_OWNER_ID, projectId: DEMO_PROJECT_IDS.ideas, milestoneId: null, title: '整理竞品界面截图', description: '', priority: null, dueDate: '2026-07-22', dueTime: null, isFocus: false, sortOrder: 0, completedAt: null, createdAt, updatedAt: createdAt, deletedAt: null },
    { id: '20000000-0000-4000-8000-000000000005', ownerId: DEMO_OWNER_ID, projectId: DEMO_PROJECT_IDS.health, milestoneId: null, title: '30 分钟力量训练', description: '', priority: null, dueDate: '2026-07-22', dueTime: '18:30', isFocus: false, sortOrder: 1, completedAt: null, createdAt, updatedAt: createdAt, deletedAt: null },
    { id: '20000000-0000-4000-8000-000000000006', ownerId: DEMO_OWNER_ID, projectId: DEMO_PROJECT_IDS.personal, milestoneId: null, title: '确认 MVP 功能范围', description: '', priority: null, dueDate: '2026-07-22', dueTime: null, isFocus: true, sortOrder: 0, completedAt: '2026-07-22T01:30:00.000Z', createdAt, updatedAt: createdAt, deletedAt: null },
    { id: '20000000-0000-4000-8000-000000000007', ownerId: DEMO_OWNER_ID, projectId: DEMO_PROJECT_IDS.personal, milestoneId: null, title: '选择 MiniMax 作为首个 AI 模型', description: '', priority: null, dueDate: '2026-07-22', dueTime: null, isFocus: true, sortOrder: 1, completedAt: '2026-07-22T02:00:00.000Z', createdAt, updatedAt: createdAt, deletedAt: null },
  ],
  quarterGoals: [
    { id: '30000000-0000-4000-8000-000000000001', ownerId: DEMO_OWNER_ID, quarter: '2026-Q3', title: '完成个人效率系统 1.0', description: '让任务、项目与复盘形成稳定闭环', progress: 72, status: 'active', sortOrder: 0, createdAt, updatedAt: createdAt, deletedAt: null },
    { id: '30000000-0000-4000-8000-000000000002', ownerId: DEMO_OWNER_ID, quarter: '2026-Q3', title: '建立每周复盘习惯', description: '连续执行并沉淀一套固定复盘模板', progress: 68, status: 'active', sortOrder: 1, createdAt, updatedAt: createdAt, deletedAt: null },
    { id: '30000000-0000-4000-8000-000000000003', ownerId: DEMO_OWNER_ID, quarter: '2026-Q3', title: '恢复稳定训练节奏', description: '每周完成三次力量或有氧训练', progress: 64, status: 'active', sortOrder: 2, createdAt, updatedAt: createdAt, deletedAt: null },
  ],
})

export function createDemoWorkspace(): WorkspaceDocument {
  return structuredClone(demoWorkspace)
}

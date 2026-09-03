import { describe, expect, it } from 'vitest'
import { deriveWorkspace, migrateWorkspaceDocument, workspaceDocumentSchema } from '../../shared/workspace'

const legacyProject = {
  id: '10000000-0000-4000-8000-000000000001',
  ownerId: '00000000-0000-4000-8000-000000000001',
  name: 'Legacy project',
  color: '#112233',
  sortOrder: 0,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  deletedAt: null,
}
const legacyTask = {
  id: '20000000-0000-4000-8000-000000000001',
  ownerId: legacyProject.ownerId,
  projectId: legacyProject.id,
  title: 'Legacy task',
  description: '',
  priority: null,
  dueDate: null,
  dueTime: null,
  isFocus: true,
  status: 'todo' as const,
  importance: 'normal' as const,
  estimatedMinutes: null,
  reminderAt: null,
  snoozedUntil: null,
  lastRemindedAt: null,
  sortOrder: 0,
  completedAt: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  deletedAt: null,
}
const legacyQuarterGoal = {
  id: '30000000-0000-4000-8000-000000000001',
  ownerId: legacyProject.ownerId,
  quarter: '2026-Q3',
  title: 'Milestone-ready quarterly goal',
  description: 'A preserved v2 quarter goal.',
  progress: 72,
  status: 'active' as const,
  sortOrder: 0,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  deletedAt: null,
}
const emptyV3 = {
  version: 3 as const,
  projects: [{ ...legacyProject, description: '', priority: null, status: 'active' as const, targetDate: null }],
  tasks: [{ ...legacyTask, milestoneId: null }],
  milestones: [],
  quarterGoals: [legacyQuarterGoal],
}
const milestone = {
  id: '40000000-0000-4000-8000-000000000001',
  ownerId: legacyProject.ownerId,
  projectId: legacyProject.id,
  title: 'Release milestone',
  description: '',
  targetDate: null,
  status: 'planned' as const,
  progressMode: 'auto' as const,
  progress: 0,
  sortOrder: 0,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  deletedAt: null,
}

describe('workspace domain', () => {
  it('accepts version 3 documents with validated milestones', () => {
    const legacy = { projects: [legacyProject], tasks: [legacyTask] }
    const result = workspaceDocumentSchema.safeParse({
      ...legacy,
      version: 3,
      projects: legacy.projects.map(project => ({ ...project, description: '', priority: null, status: 'active' as const, targetDate: null })),
      tasks: legacy.tasks.map(task => ({ ...task, milestoneId: null })),
      milestones: [milestone],
      quarterGoals: [{
        id: '30000000-0000-4000-8000-000000000001',
        ownerId: legacy.projects[0]!.ownerId,
        quarter: '2026-Q3',
        title: '完成个人效率系统 1.0',
        description: '让任务、项目与复盘形成稳定闭环',
        progress: 72,
        status: 'active',
        sortOrder: 0,
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
        deletedAt: null,
      }],
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.milestones).toEqual([milestone])
  })

  it('migrates v2 to v3 without inventing milestones', () => {
    const migrated = migrateWorkspaceDocument({
      version: 2,
      projects: [legacyProject],
      tasks: [legacyTask],
      quarterGoals: [legacyQuarterGoal],
    })

    expect(migrated).toMatchObject({ version: 3, milestones: [] })
    expect(migrated.projects).toEqual([{
      ...legacyProject,
      description: '',
      priority: null,
      status: 'active',
      targetDate: null,
    }])
    expect(migrated.tasks).toEqual([{ ...legacyTask, milestoneId: null, attachments: [] }])
    expect(migrated.quarterGoals).toEqual([legacyQuarterGoal])
  })

  it('canonicalizes omitted optional task fields while migrating active and completed legacy tasks', () => {
    const active = { ...legacyTask }
    const completed = {
      ...legacyTask,
      id: '20000000-0000-4000-8000-000000000002',
      completedAt: '2026-07-22T01:00:00.000Z',
    }
    for (const task of [active, completed]) {
      for (const field of ['status', 'importance', 'estimatedMinutes', 'reminderAt', 'snoozedUntil', 'lastRemindedAt', 'attachments']) {
        Reflect.deleteProperty(task, field)
      }
    }

    const migrated = migrateWorkspaceDocument({
      version: 2,
      projects: [legacyProject],
      tasks: [active, completed],
      quarterGoals: [],
    })

    expect(migrated.tasks[0]).toMatchObject({
      status: 'todo', importance: 'normal', estimatedMinutes: null,
      reminderAt: null, snoozedUntil: null, lastRemindedAt: null, attachments: [],
    })
    expect(migrated.tasks[1]).toMatchObject({
      status: 'done', importance: 'normal', estimatedMinutes: null,
      reminderAt: null, snoozedUntil: null, lastRemindedAt: null, attachments: [],
    })
  })

  it('rejects an invalid milestone progress value', () => {
    expect(() => workspaceDocumentSchema.parse({
      ...emptyV3,
      milestones: [{ ...milestone, progress: 101 }],
    })).toThrow()
  })

  it('preserves v1 records while upgrading them to v3 defaults', async () => {
    const domain = await import('../../shared/workspace')
    expect(domain.migrateWorkspaceDocument).toBeTypeOf('function')
    if (!domain.migrateWorkspaceDocument) return

    const legacy = {
      version: 1 as const,
      projects: [legacyProject],
      tasks: [legacyTask],
    }
    const migrated = domain.migrateWorkspaceDocument(legacy)

    expect(migrated.version).toBe(3)
    expect(migrated.projects[0]).toMatchObject({ ...legacy.projects[0], description: '', priority: null, status: 'active', targetDate: null })
    expect(migrated.tasks[0]).toMatchObject({ ...legacy.tasks[0], milestoneId: null })
    expect(migrated.milestones).toEqual([])
    expect(migrated.quarterGoals).toEqual([])
  })

  it('seeds active projects and all three task groups', () => {
    const document = workspaceDocumentSchema.parse(emptyV3)
    const view = deriveWorkspace(document)

    expect(view.projects.map(project => project.name)).toContain('Legacy project')
    expect(view.focusTasks).toHaveLength(1)
    expect(view.laterTasks).toHaveLength(0)
    expect(view.completedTasks).toHaveLength(0)
    expect(view.metrics).toEqual({ focus: 1, active: 1, completed: 0 })
  })

  it('excludes soft-deleted records from active views and counts', () => {
    const document = workspaceDocumentSchema.parse(emptyV3)
    const project = document.projects[0]!
    const task = document.tasks[0]!
    project.deletedAt = '2026-07-22T00:00:00.000Z'
    task.deletedAt = '2026-07-22T00:00:00.000Z'

    const view = deriveWorkspace(document)

    expect(view.projects.some(item => item.id === project.id)).toBe(false)
    expect(view.tasks.some(item => item.id === task.id)).toBe(false)
    expect(view.projectCounts[project.id]).toBeUndefined()
  })
})

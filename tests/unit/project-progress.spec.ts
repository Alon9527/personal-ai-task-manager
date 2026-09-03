import { describe, expect, it } from 'vitest'
import type { Milestone, Project, Task, WorkspaceDocument } from '../../shared/workspace'

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const CREATED_AT = '2026-08-01T00:00:00.000Z'

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    ownerId: OWNER_ID,
    name: id,
    description: '',
    color: '#112233',
    priority: null,
    status: 'active',
    targetDate: null,
    sortOrder: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function milestone(id: string, projectId: string, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    ownerId: OWNER_ID,
    projectId,
    title: id,
    description: '',
    targetDate: null,
    status: 'in_progress',
    progressMode: 'auto',
    progress: 0,
    sortOrder: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function task(id: string, projectId: string | null, overrides: Partial<Task> = {}): Task {
  return {
    id,
    ownerId: OWNER_ID,
    projectId,
    milestoneId: null,
    title: id,
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
    sortOrder: 0,
    completedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

describe('project progress derivations', () => {
  it('uses completed linked tasks for automatic milestone progress', async () => {
    const domain = await import('../../shared/workspace')
    const item = milestone('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001')
    const done = task('30000000-0000-4000-8000-000000000001', item.projectId, {
      milestoneId: item.id,
      completedAt: '2026-08-02T00:00:00.000Z',
      status: 'done',
    })
    const open = task('30000000-0000-4000-8000-000000000002', item.projectId, { milestoneId: item.id })

    expect(domain.deriveMilestoneProgress).toBeTypeOf('function')
    expect(domain.deriveMilestoneProgress(item, [done, open])).toBe(50)
  })

  it('does not count cancelled tasks as completed even when they have completedAt', async () => {
    const domain = await import('../../shared/workspace')
    const item = milestone('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001')
    const cancelled = task('30000000-0000-4000-8000-000000000001', item.projectId, {
      milestoneId: item.id,
      completedAt: '2026-08-02T00:00:00.000Z',
      status: 'cancelled',
    })
    const done = task('30000000-0000-4000-8000-000000000002', item.projectId, {
      milestoneId: item.id,
      completedAt: '2026-08-02T00:00:00.000Z',
      status: 'done',
    })

    expect(domain.deriveMilestoneProgress(item, [cancelled, done])).toBe(50)
    expect(domain.deriveProjectProgress(project(item.projectId), [], [cancelled, done])).toBe(50)
  })

  it('ignores soft-deleted tasks and honors manual and completed milestone progress', async () => {
    const domain = await import('../../shared/workspace')
    const item = milestone('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001')
    const deletedDone = task('30000000-0000-4000-8000-000000000001', item.projectId, {
      milestoneId: item.id,
      completedAt: '2026-08-02T00:00:00.000Z',
      status: 'done',
      deletedAt: '2026-08-03T00:00:00.000Z',
    })
    const open = task('30000000-0000-4000-8000-000000000002', item.projectId, { milestoneId: item.id })

    expect(domain.deriveMilestoneProgress(item, [deletedDone, open])).toBe(0)
    expect(domain.deriveMilestoneProgress({ ...item, progressMode: 'manual', progress: 37 }, [deletedDone, open])).toBe(37)
    expect(domain.deriveMilestoneProgress({ ...item, status: 'completed', progress: 37 }, [open])).toBe(100)
  })

  it('uses milestone average before task completion for project progress', async () => {
    const domain = await import('../../shared/workspace')
    const currentProject = project('20000000-0000-4000-8000-000000000001')
    const manual20 = milestone('10000000-0000-4000-8000-000000000001', currentProject.id, { progressMode: 'manual', progress: 20 })
    const manual80 = milestone('10000000-0000-4000-8000-000000000002', currentProject.id, { progressMode: 'manual', progress: 80 })
    const done = task('30000000-0000-4000-8000-000000000001', currentProject.id, { completedAt: '2026-08-02T00:00:00.000Z', status: 'done' })

    expect(domain.deriveProjectProgress).toBeTypeOf('function')
    expect(domain.deriveProjectProgress(currentProject, [manual20, manual80], [done])).toBe(50)
  })

  it('filters deleted and foreign milestones and rounds the project milestone average', async () => {
    const domain = await import('../../shared/workspace')
    const currentProject = project('20000000-0000-4000-8000-000000000001')
    const otherProject = project('20000000-0000-4000-8000-000000000002')
    const first = milestone('10000000-0000-4000-8000-000000000001', currentProject.id, { progressMode: 'manual', progress: 20 })
    const second = milestone('10000000-0000-4000-8000-000000000002', currentProject.id, { progressMode: 'manual', progress: 80 })
    const third = milestone('10000000-0000-4000-8000-000000000003', currentProject.id, { progressMode: 'manual', progress: 1 })
    const deleted = milestone('10000000-0000-4000-8000-000000000004', currentProject.id, { progressMode: 'manual', progress: 100, deletedAt: '2026-08-02T00:00:00.000Z' })
    const foreign = milestone('10000000-0000-4000-8000-000000000005', otherProject.id, { progressMode: 'manual', progress: 100 })

    expect(domain.deriveProjectProgress(currentProject, [first, second, third, deleted, foreign], [])).toBe(34)
  })

  it('falls back to active project tasks and returns 100 for completed projects', async () => {
    const domain = await import('../../shared/workspace')
    const currentProject = project('20000000-0000-4000-8000-000000000001')
    const done = task('30000000-0000-4000-8000-000000000001', currentProject.id, { completedAt: '2026-08-02T00:00:00.000Z', status: 'done' })
    const open = task('30000000-0000-4000-8000-000000000002', currentProject.id)
    const deletedDone = task('30000000-0000-4000-8000-000000000003', currentProject.id, { completedAt: '2026-08-02T00:00:00.000Z', status: 'done', deletedAt: '2026-08-03T00:00:00.000Z' })

    expect(domain.deriveProjectProgress(currentProject, [], [done, open, deletedDone])).toBe(50)
    expect(domain.deriveProjectProgress({ ...currentProject, status: 'completed' }, [], [open])).toBe(100)
    expect(domain.deriveProjectProgress(currentProject, [], [])).toBe(0)
  })

  it('marks overdue and upcoming milestones by local calendar days', async () => {
    const domain = await import('../../shared/workspace')
    const currentProject = project('20000000-0000-4000-8000-000000000001')
    const completedProject = project('20000000-0000-4000-8000-000000000002', { status: 'completed' })
    const deletedProject = project('20000000-0000-4000-8000-000000000003', { deletedAt: '2026-08-12T00:00:00.000Z' })
    const document: WorkspaceDocument = {
      version: 3,
      projects: [currentProject, completedProject, deletedProject],
      tasks: [],
      quarterGoals: [],
      milestones: [
        milestone('overdue-id', currentProject.id, { targetDate: '2026-08-12' }),
        milestone('soon-id', currentProject.id, { targetDate: '2026-08-20' }),
        milestone('today-id', currentProject.id, { targetDate: '2026-08-13' }),
        milestone('completed-id', currentProject.id, { targetDate: '2026-08-11', status: 'completed' }),
        milestone('deleted-id', currentProject.id, { targetDate: '2026-08-14', deletedAt: '2026-08-12T00:00:00.000Z' }),
        milestone('no-date-id', currentProject.id),
        milestone('outside-window-id', currentProject.id, { targetDate: '2026-08-21' }),
        milestone('completed-project-id', completedProject.id, { targetDate: '2026-08-14' }),
        milestone('deleted-project-id', deletedProject.id, { targetDate: '2026-08-14' }),
      ],
    }

    expect(domain.deriveUpcomingMilestones).toBeTypeOf('function')
    const upcoming = domain.deriveUpcomingMilestones(document, new Date('2026-08-13T08:00:00+08:00'), 7)

    expect(upcoming.map(item => item.milestone.id).sort()).toEqual(['overdue-id', 'soon-id', 'today-id'])
    expect(upcoming).toEqual(expect.arrayContaining([
      expect.objectContaining({ milestone: expect.objectContaining({ id: 'overdue-id' }), project: currentProject, timing: 'overdue', days: -1 }),
      expect.objectContaining({ milestone: expect.objectContaining({ id: 'soon-id' }), project: currentProject, timing: 'upcoming', days: 7 }),
      expect.objectContaining({ milestone: expect.objectContaining({ id: 'today-id' }), project: currentProject, timing: 'upcoming', days: 0 }),
    ]))
  })

  it('keeps local calendar-day boundaries across years and ignores malformed dates', async () => {
    const domain = await import('../../shared/workspace')
    const currentProject = project('20000000-0000-4000-8000-000000000001')
    const document: WorkspaceDocument = {
      version: 3,
      projects: [currentProject],
      tasks: [],
      quarterGoals: [],
      milestones: [
        milestone('previous-year-id', currentProject.id, { targetDate: '2026-12-31' }),
        milestone('new-year-id', currentProject.id, { targetDate: '2027-01-01' }),
        milestone('next-day-id', currentProject.id, { targetDate: '2027-01-02' }),
        milestone('malformed-id', currentProject.id, { targetDate: 'not-a-date' as never }),
      ],
    }

    expect(domain.deriveUpcomingMilestones(document, new Date('2027-01-01T23:00:00+08:00'), 1))
      .toEqual([
        expect.objectContaining({ milestone: expect.objectContaining({ id: 'previous-year-id' }), days: -1 }),
        expect.objectContaining({ milestone: expect.objectContaining({ id: 'new-year-id' }), days: 0 }),
        expect.objectContaining({ milestone: expect.objectContaining({ id: 'next-day-id' }), days: 1 }),
      ])
  })
})

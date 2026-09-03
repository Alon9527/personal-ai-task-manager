import { beforeEach, describe, expect, it } from 'vitest'
import {
  LOCAL_WORKSPACE_STORAGE_KEY,
  LocalWorkspaceGateway,
} from '../../app/data/local-workspace-gateway'

const CREATED_AT = '2026-08-13T01:00:00.000Z'
const INDEPENDENT_DELETE_AT = '2026-08-13T02:00:00.000Z'
const CASCADE_DELETE_AT = '2026-08-13T03:00:00.000Z'
const RESTORE_AT = '2026-08-13T04:00:00.000Z'

function projectInput(name: string) {
  return {
    name,
    color: '#3366FF',
    description: '',
    priority: null,
    status: 'active' as const,
    targetDate: null,
  }
}

function milestoneInput(projectId: string, title: string) {
  return {
    projectId,
    title,
    description: '',
    targetDate: null,
    status: 'planned' as const,
    progressMode: 'auto' as const,
    progress: 0,
  }
}

function taskInput(projectId: string | null, milestoneId: string | null, title: string) {
  return {
    title,
    description: '',
    projectId,
    milestoneId,
    priority: null,
    dueDate: null,
    dueTime: null,
    isFocus: false,
  }
}

describe('LocalWorkspaceGateway milestones', () => {
  beforeEach(() => localStorage.clear())

  it('creates, updates, and reorders active milestones within a project', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => CREATED_AT)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput('Launch'))
    const first = await gateway.createMilestone(milestoneInput(project.id, 'Alpha'))
    const second = await gateway.createMilestone(milestoneInput(project.id, 'Beta'))

    expect(first).toMatchObject({ title: 'Alpha', sortOrder: 0, deletedAt: null })
    expect(second).toMatchObject({ title: 'Beta', sortOrder: 1, deletedAt: null })

    const updated = await gateway.updateMilestone(second.id, {
      title: ' Beta ready ',
      description: 'Ready for review',
      targetDate: '2026-08-31',
      status: 'in_progress',
      progressMode: 'manual',
      progress: 45,
    })
    expect(updated).toMatchObject({
      title: 'Beta ready',
      description: 'Ready for review',
      targetDate: '2026-08-31',
      status: 'in_progress',
      progressMode: 'manual',
      progress: 45,
    })

    await gateway.reorderMilestones(project.id, [second.id, first.id])
    const saved = await gateway.loadWorkspace()
    expect(saved.version).toBe(3)
    expect(saved.milestones.find(item => item.id === second.id)?.sortOrder).toBe(0)
    expect(saved.milestones.find(item => item.id === first.id)?.sortOrder).toBe(1)
  })

  it('soft-deletes and restores a milestone without relinking its tasks', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => CREATED_AT)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput('Launch'))
    const milestone = await gateway.createMilestone(milestoneInput(project.id, 'Alpha'))
    const task = await gateway.createTask(taskInput(project.id, milestone.id, 'Ship alpha'))

    await gateway.deleteMilestone(milestone.id)

    expect((await gateway.loadWorkspace()).milestones).toEqual([])
    const deleted = await gateway.loadWorkspace({ includeDeleted: true })
    expect(deleted.milestones.find(item => item.id === milestone.id)?.deletedAt).toBe(CREATED_AT)
    expect(deleted.tasks.find(item => item.id === task.id)).toMatchObject({
      deletedAt: null,
      milestoneId: null,
    })

    await gateway.restoreMilestone(milestone.id)
    const restored = await gateway.loadWorkspace()
    expect(restored.milestones.find(item => item.id === milestone.id)?.deletedAt).toBeNull()
    expect(restored.tasks.find(item => item.id === task.id)?.milestoneId).toBeNull()
  })

  it('moves linked tasks when a milestone moves to another active project', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => CREATED_AT)
    await gateway.clearWorkspaceData()
    const firstProject = await gateway.createProject(projectInput('First'))
    const secondProject = await gateway.createProject(projectInput('Second'))
    const milestone = await gateway.createMilestone(milestoneInput(firstProject.id, 'Move me'))
    const task = await gateway.createTask(taskInput(firstProject.id, milestone.id, 'Linked task'))

    await gateway.updateMilestone(milestone.id, { projectId: secondProject.id })

    expect((await gateway.loadWorkspace()).tasks.find(item => item.id === task.id)).toMatchObject({
      projectId: secondProject.id,
      milestoneId: milestone.id,
    })
  })

  it('appends a moved milestone after existing milestones in the target project', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => CREATED_AT)
    await gateway.clearWorkspaceData()
    const firstProject = await gateway.createProject(projectInput('First'))
    const secondProject = await gateway.createProject(projectInput('Second'))
    const moved = await gateway.createMilestone(milestoneInput(firstProject.id, 'Move me'))
    const existingFirst = await gateway.createMilestone(milestoneInput(secondProject.id, 'Existing first'))
    const existingSecond = await gateway.createMilestone(milestoneInput(secondProject.id, 'Existing second'))

    const updated = await gateway.updateMilestone(moved.id, { projectId: secondProject.id })

    expect(updated.sortOrder).toBe(2)
    const targetMilestones = (await gateway.loadWorkspace()).milestones
      .filter(item => item.projectId === secondProject.id)
    expect(targetMilestones.map(item => item.sortOrder).sort((left, right) => left - right)).toEqual([
      existingFirst.sortOrder,
      existingSecond.sortOrder,
      2,
    ])
  })

  it('appends a restored milestone after the current active project tail', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => CREATED_AT)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput('Launch'))
    const restored = await gateway.createMilestone(milestoneInput(project.id, 'Restore later'))
    await gateway.deleteMilestone(restored.id)
    const active = await gateway.createMilestone(milestoneInput(project.id, 'Created while deleted'))

    const result = await gateway.restoreMilestone(restored.id)

    expect(active.sortOrder).toBe(0)
    expect(result.sortOrder).toBe(1)
  })

  it('restores only milestones and tasks deleted by the same project cascade', async () => {
    let now = CREATED_AT
    const gateway = new LocalWorkspaceGateway(localStorage, () => now)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput('Launch'))
    const independentlyDeletedMilestone = await gateway.createMilestone(milestoneInput(project.id, 'Old'))
    const cascadeMilestone = await gateway.createMilestone(milestoneInput(project.id, 'Current'))
    const independentlyDeletedTask = await gateway.createTask(taskInput(project.id, null, 'Old task'))
    const cascadeTask = await gateway.createTask(taskInput(project.id, cascadeMilestone.id, 'Current task'))

    now = INDEPENDENT_DELETE_AT
    await gateway.deleteMilestone(independentlyDeletedMilestone.id)
    await gateway.deleteTask(independentlyDeletedTask.id)

    now = CASCADE_DELETE_AT
    await gateway.deleteProject(project.id)
    let saved = await gateway.loadWorkspace({ includeDeleted: true })
    expect(saved.projects.find(item => item.id === project.id)?.deletedAt).toBe(CASCADE_DELETE_AT)
    expect(saved.milestones.find(item => item.id === cascadeMilestone.id)?.deletedAt).toBe(CASCADE_DELETE_AT)
    expect(saved.tasks.find(item => item.id === cascadeTask.id)?.deletedAt).toBe(CASCADE_DELETE_AT)

    now = RESTORE_AT
    await gateway.restoreProject(project.id)
    saved = await gateway.loadWorkspace({ includeDeleted: true })
    expect(saved.milestones.find(item => item.id === independentlyDeletedMilestone.id)?.deletedAt).toBe(INDEPENDENT_DELETE_AT)
    expect(saved.tasks.find(item => item.id === independentlyDeletedTask.id)?.deletedAt).toBe(INDEPENDENT_DELETE_AT)
    expect(saved.milestones.find(item => item.id === cascadeMilestone.id)?.deletedAt).toBeNull()
    expect(saved.tasks.find(item => item.id === cascadeTask.id)?.deletedAt).toBeNull()
  })

  it('includes milestones in trash emptying and workspace clearing', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => CREATED_AT)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput('Launch'))
    const milestone = await gateway.createMilestone(milestoneInput(project.id, 'Alpha'))

    await gateway.deleteMilestone(milestone.id)
    await gateway.emptyTrash()
    expect((await gateway.loadWorkspace({ includeDeleted: true })).milestones).toEqual([])

    await gateway.createMilestone(milestoneInput(project.id, 'Beta'))
    await gateway.clearWorkspaceData()
    expect(JSON.parse(localStorage.getItem(LOCAL_WORKSPACE_STORAGE_KEY)!)).toEqual({
      version: 3,
      projects: [],
      milestones: [],
      tasks: [],
      quarterGoals: [],
    })
  })
})

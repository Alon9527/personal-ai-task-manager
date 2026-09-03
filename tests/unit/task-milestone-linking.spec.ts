import { beforeEach, describe, expect, it } from 'vitest'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import { WorkspaceError } from '../../app/data/workspace-gateway'

const NOW = '2026-08-13T08:00:00.000Z'
const TASK_DELETE_AT = '2026-08-13T09:00:00.000Z'
const PROJECT_DELETE_AT = '2026-08-13T10:00:00.000Z'
const TASK_RESTORE_AT = '2026-08-13T11:00:00.000Z'

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

describe('task milestone linking', () => {
  beforeEach(() => localStorage.clear())

  it('links a created task to the milestone project', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput('Launch'))
    const milestone = await gateway.createMilestone(milestoneInput(project.id, 'Alpha'))

    const task = await gateway.createTask(taskInput(null, milestone.id, 'Ship alpha'))

    expect(task).toMatchObject({ projectId: project.id, milestoneId: milestone.id })
  })

  it('lets the milestone project override a different project on create and update', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    await gateway.clearWorkspaceData()
    const firstProject = await gateway.createProject(projectInput('First'))
    const secondProject = await gateway.createProject(projectInput('Second'))
    const milestone = await gateway.createMilestone(milestoneInput(secondProject.id, 'Second milestone'))

    const created = await gateway.createTask(taskInput(firstProject.id, milestone.id, 'Create linked'))
    expect(created.projectId).toBe(secondProject.id)

    const unlinked = await gateway.createTask(taskInput(firstProject.id, null, 'Update linked'))
    const updated = await gateway.updateTask(unlinked.id, { milestoneId: milestone.id })
    expect(updated).toMatchObject({ projectId: secondProject.id, milestoneId: milestone.id })
  })

  it('clears a milestone link when the task moves to another project', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    await gateway.clearWorkspaceData()
    const firstProject = await gateway.createProject(projectInput('First'))
    const secondProject = await gateway.createProject(projectInput('Second'))
    const milestone = await gateway.createMilestone(milestoneInput(firstProject.id, 'First milestone'))
    const task = await gateway.createTask(taskInput(firstProject.id, milestone.id, 'Move task'))

    const moved = await gateway.updateTask(task.id, { projectId: secondProject.id })

    expect(moved).toMatchObject({ projectId: secondProject.id, milestoneId: null })
  })

  it('detaches a milestone without changing the task project', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput('Launch'))
    const milestone = await gateway.createMilestone(milestoneInput(project.id, 'Alpha'))
    const task = await gateway.createTask(taskInput(project.id, milestone.id, 'Detach me'))

    const detached = await gateway.updateTask(task.id, { milestoneId: null })

    expect(detached).toMatchObject({ projectId: project.id, milestoneId: null })
  })

  it('rejects links to missing or deleted milestones', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput('Launch'))
    const milestone = await gateway.createMilestone(milestoneInput(project.id, 'Alpha'))
    await gateway.deleteMilestone(milestone.id)

    const createAttempt = gateway.createTask(taskInput(project.id, milestone.id, 'Invalid link'))
    await expect(createAttempt).rejects.toMatchObject<Partial<WorkspaceError>>({ code: 'validation' })

    const task = await gateway.createTask(taskInput(project.id, null, 'Existing task'))
    const updateAttempt = gateway.updateTask(task.id, {
      milestoneId: '40000000-0000-4000-8000-000000000099',
    })
    await expect(updateAttempt).rejects.toMatchObject<Partial<WorkspaceError>>({ code: 'validation' })
  })

  it('clears an invalid milestone link when independently restoring a task after project deletion', async () => {
    let now = NOW
    const gateway = new LocalWorkspaceGateway(localStorage, () => now)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput('Launch'))
    const milestone = await gateway.createMilestone(milestoneInput(project.id, 'Alpha'))
    const task = await gateway.createTask(taskInput(project.id, milestone.id, 'Restore later'))

    now = TASK_DELETE_AT
    await gateway.deleteTask(task.id)
    now = PROJECT_DELETE_AT
    await gateway.deleteProject(project.id)
    now = TASK_RESTORE_AT
    const restored = await gateway.restoreTask(task.id)

    expect(restored).toMatchObject({
      projectId: null,
      milestoneId: null,
      deletedAt: null,
    })
    const storedMilestone = (await gateway.loadWorkspace({ includeDeleted: true })).milestones
      .find(item => item.id === milestone.id)
    expect(storedMilestone?.deletedAt).toBe(PROJECT_DELETE_AT)
  })
})

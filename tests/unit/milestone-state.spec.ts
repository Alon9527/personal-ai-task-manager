import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import { createWorkspaceModel } from '../../app/models/workspace-model'

const projectInput = {
  name: 'Milestone project',
  color: '#3366FF',
  description: '',
  priority: null,
  status: 'active' as const,
  targetDate: null,
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

function rejectRefreshAfterNextLocalMutation(gateway: LocalWorkspaceGateway) {
  vi.spyOn(gateway, 'loadWorkspace')
    .mockRejectedValueOnce(new Error('refresh unavailable'))
}

describe('workspace model milestone state', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.useRealTimers())

  it('exposes milestone state and all five milestone actions', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput)
    const model = createWorkspaceModel(gateway)
    await model.load()

    expect(model.createMilestone).toBeTypeOf('function')
    expect(model.updateMilestone).toBeTypeOf('function')
    expect(model.deleteMilestone).toBeTypeOf('function')
    expect(model.restoreMilestone).toBeTypeOf('function')
    expect(model.reorderMilestones).toBeTypeOf('function')

    await model.createMilestone(milestoneInput(project.id, 'First'))
    await model.createMilestone(milestoneInput(project.id, 'Second'))
    const first = model.milestones.value.find(item => item.title === 'First')!
    const second = model.milestones.value.find(item => item.title === 'Second')!
    expect(model.milestones.value.map(item => item.id)).toEqual([first.id, second.id])

    await model.updateMilestone(second.id, { title: 'Second updated' })
    await model.reorderMilestones(project.id, [second.id, first.id])
    expect(model.milestones.value.map(item => item.title)).toEqual(['Second updated', 'First'])

    await model.deleteMilestone(first.id)
    expect(model.milestones.value.map(item => item.id)).not.toContain(first.id)
    expect(model.trashedMilestones.value.map(item => item.id)).toContain(first.id)
    expect(model.trashCount.value).toBe(1)

    await model.restoreMilestone(first.id)
    expect(model.milestones.value.map(item => item.id)).toContain(first.id)
    expect(model.trashedMilestones.value).toEqual([])
    expect(model.trashCount.value).toBe(0)
  })

  it('offers milestone undo and dismisses it only after 8,000 milliseconds', async () => {
    vi.useFakeTimers()
    const gateway = new LocalWorkspaceGateway(localStorage)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput)
    const milestone = await gateway.createMilestone(milestoneInput(project.id, 'Undo milestone'))
    const model = createWorkspaceModel(gateway)
    await model.load()

    await model.deleteMilestone(milestone.id)
    expect(model.lastDeleted.value).toEqual({
      kind: 'milestone',
      id: milestone.id,
      label: milestone.title,
    })

    vi.advanceTimersByTime(7_999)
    expect(model.lastDeleted.value?.kind).toBe('milestone')
    vi.advanceTimersByTime(1)
    expect(model.lastDeleted.value).toBeNull()
  })

  it('undoes the latest milestone deletion through restore', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput)
    const milestone = await gateway.createMilestone(milestoneInput(project.id, 'Restore milestone'))
    const model = createWorkspaceModel(gateway)
    await model.load()

    await model.deleteMilestone(milestone.id)
    await model.undoLastDelete()

    expect(model.milestones.value.map(item => item.id)).toContain(milestone.id)
    expect(model.trashedMilestones.value).toEqual([])
    expect(model.lastDeleted.value).toBeNull()
  })

  it('offers milestone undo when deletion persists but the following refresh fails', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput)
    const milestone = await gateway.createMilestone(milestoneInput(project.id, 'Persisted deletion'))
    const model = createWorkspaceModel(gateway)
    await model.load()
    rejectRefreshAfterNextLocalMutation(gateway)

    let thrown: unknown
    try {
      await model.deleteMilestone(milestone.id)
    }
    catch (cause) {
      thrown = cause
    }

    expect(model.lastDeleted.value).toEqual({
      kind: 'milestone',
      id: milestone.id,
      label: milestone.title,
    })
    expect(model.error.value).toBe('refresh unavailable')
    expect(thrown).toBeUndefined()
    expect(model.milestones.value.map(item => item.id)).not.toContain(milestone.id)
    expect(model.trashedMilestones.value.map(item => item.id)).toContain(milestone.id)
    expect((await gateway.loadWorkspace({ includeDeleted: true })).milestones
      .find(item => item.id === milestone.id)?.deletedAt).not.toBeNull()
  })

  it('keeps milestone optimistic order when reorder persists but the following refresh fails', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    await gateway.clearWorkspaceData()
    const project = await gateway.createProject(projectInput)
    const first = await gateway.createMilestone(milestoneInput(project.id, 'First'))
    const second = await gateway.createMilestone(milestoneInput(project.id, 'Second'))
    const model = createWorkspaceModel(gateway)
    await model.load()
    rejectRefreshAfterNextLocalMutation(gateway)

    let thrown: unknown
    try {
      await model.reorderMilestones(project.id, [second.id, first.id])
    }
    catch (cause) {
      thrown = cause
    }

    expect(model.milestones.value.map(item => item.id)).toEqual([second.id, first.id])
    expect(model.error.value).toBe('refresh unavailable')
    expect(thrown).toBeUndefined()
    const persisted = await gateway.loadWorkspace()
    expect(persisted.milestones.find(item => item.id === second.id)?.sortOrder).toBe(0)
    expect(persisted.milestones.find(item => item.id === first.id)?.sortOrder).toBe(1)
  })
})

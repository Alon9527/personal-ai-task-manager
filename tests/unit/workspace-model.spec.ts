import { toRaw } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import { createWorkspaceModel } from '../../app/models/workspace-model'

describe('workspace model', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.useRealTimers())

  it('loads derived metrics, groups, and backend label', async () => {
    const model = createWorkspaceModel(new LocalWorkspaceGateway(localStorage))

    await model.load()

    expect(model.ready.value).toBe(true)
    expect(model.metrics.value.active).toBe(5)
    expect(model.focusTasks.value).toHaveLength(3)
    expect(model.backendLabel.value).toBe('本机数据')
  })

  it('rolls back an optimistic reorder when persistence fails', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()
    const before = model.focusTasks.value.map(task => task.id)
    gateway.reorderTasks = async () => {
      throw new Error('storage unavailable')
    }

    await expect(model.reorderTasks('focus', [...before].reverse())).rejects.toThrow('storage unavailable')

    expect(model.focusTasks.value.map(task => task.id)).toEqual(before)
    expect(model.error.value).toBe('storage unavailable')
  })

  it('reads a validated isolated latest document without mutating visible state', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()
    const visibleBefore = structuredClone(toRaw(model.document.value))
    const persisted = await gateway.loadWorkspace({ includeDeleted: true })
    persisted.projects[0]!.name = '持久层新名称'
    await gateway.replaceWorkspaceDocument(persisted)

    const latest = await model.readLatestDocument()

    expect(latest.projects[0]?.name).toBe('持久层新名称')
    expect(model.document.value).toEqual(visibleBefore)
    latest.projects[0]!.name = '调用方修改'
    expect(model.document.value).toEqual(visibleBefore)
  })

  it('replaces once and makes the returned document the truthful visible state', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()
    const next = structuredClone(toRaw(model.document.value))
    next.projects[0]!.name = '原子替换后的名称'
    const replace = vi.spyOn(gateway, 'replaceWorkspaceDocument')

    const returned = await model.replaceWorkspaceDocument(next)

    expect(replace).toHaveBeenCalledTimes(1)
    expect(returned.projects[0]?.name).toBe('原子替换后的名称')
    expect(model.document.value.projects[0]?.name).toBe('原子替换后的名称')
    returned.projects[0]!.name = '调用方修改'
    expect(model.document.value.projects[0]?.name).toBe('原子替换后的名称')
  })

  it('keeps visible state unchanged when atomic replacement persistence fails', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()
    const before = structuredClone(toRaw(model.document.value))
    const next = structuredClone(before)
    next.projects[0]!.name = '不应显示'
    vi.spyOn(gateway, 'replaceWorkspaceDocument').mockRejectedValueOnce(new Error('replace unavailable'))

    await expect(model.replaceWorkspaceDocument(next)).rejects.toThrow('replace unavailable')

    expect(model.document.value).toEqual(before)
    expect(model.error.value).toBe('replace unavailable')
  })

  it('rejects an Agent replacement when queued CRUD changes its exact base', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()
    const base = await model.readLatestDocument()
    const agentReplacement = structuredClone(base)
    agentReplacement.projects[0]!.description = 'Agent 不应覆盖 CRUD'
    const originalUpdate = gateway.updateProject.bind(gateway)
    let releaseCrud!: () => void
    const crudGate = new Promise<void>((resolve) => { releaseCrud = resolve })
    let crudStarted!: () => void
    const started = new Promise<void>((resolve) => { crudStarted = resolve })
    vi.spyOn(gateway, 'updateProject').mockImplementationOnce(async (id, patch) => {
      crudStarted()
      await crudGate
      return originalUpdate(id, patch)
    })

    const crud = model.updateProject(base.projects[0]!.id, { name: '用户并发修改' })
    await started
    const agent = model.replaceWorkspaceDocument(agentReplacement, base)
    releaseCrud()
    await crud

    await expect(agent).rejects.toMatchObject({ code: 'conflict' })
    const persisted = await gateway.loadWorkspace({ includeDeleted: true })
    expect(persisted.projects[0]).toMatchObject({
      name: '用户并发修改',
      description: base.projects[0]!.description,
    })
    expect(model.document.value.projects[0]?.name).toBe('用户并发修改')
  })

  it('does not poison the shared mutation queue after a failed operation', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()
    vi.spyOn(gateway, 'updateProject').mockRejectedValueOnce(new Error('first write failed'))

    await expect(model.updateProject(model.projects.value[0]!.id, { name: '失败写入' }))
      .rejects.toThrow('first write failed')
    await model.updateProject(model.projects.value[0]!.id, { name: '后续写入成功' })

    expect(model.projects.value[0]?.name).toBe('后续写入成功')
  })

  it('keeps deleted tasks in trash and can undo the latest deletion', async () => {
    const model = createWorkspaceModel(new LocalWorkspaceGateway(localStorage, () => '2026-08-09T08:00:00.000Z'))
    await model.load()
    const task = model.tasks.value[0]!

    await model.deleteTask(task.id)
    expect(model.tasks.value.some(item => item.id === task.id)).toBe(false)
    expect(model.trashedTasks.value.map(item => item.id)).toContain(task.id)
    expect(model.lastDeleted.value?.label).toBe(task.title)

    await model.undoLastDelete()
    expect(model.tasks.value.map(item => item.id)).toContain(task.id)
    expect(model.trashedTasks.value.map(item => item.id)).not.toContain(task.id)
    expect(model.lastDeleted.value).toBeNull()
  })

  it('keeps a restored task visible and clears undo when restore persists but refresh fails', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => '2026-08-13T08:00:00.000Z')
    const model = createWorkspaceModel(gateway)
    await model.load()
    const task = model.tasks.value[0]!
    await model.deleteTask(task.id)
    vi.spyOn(gateway, 'loadWorkspace').mockRejectedValueOnce(new Error('restore refresh unavailable'))

    await model.undoLastDelete()

    expect(model.tasks.value.map(item => item.id)).toContain(task.id)
    expect(model.trashedTasks.value.map(item => item.id)).not.toContain(task.id)
    expect(model.lastDeleted.value).toBeNull()
    expect(model.error.value).toBe('restore refresh unavailable')
    expect((await gateway.loadWorkspace()).tasks.map(item => item.id)).toContain(task.id)
  })

  it('rolls back optimistic restore and retains undo when restore persistence fails', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()
    const task = model.tasks.value[0]!
    await model.deleteTask(task.id)
    vi.spyOn(gateway, 'restoreTask').mockRejectedValueOnce(new Error('restore persist unavailable'))

    await expect(model.undoLastDelete()).rejects.toThrow('restore persist unavailable')

    expect(model.tasks.value.map(item => item.id)).not.toContain(task.id)
    expect(model.trashedTasks.value.map(item => item.id)).toContain(task.id)
    expect(model.lastDeleted.value).toMatchObject({ kind: 'task', id: task.id })
  })

  it('automatically dismisses the undo action after eight seconds', async () => {
    vi.useFakeTimers()
    const model = createWorkspaceModel(new LocalWorkspaceGateway(localStorage))
    await model.load()

    await model.deleteTask(model.tasks.value[0]!.id)
    expect(model.lastDeleted.value).not.toBeNull()

    vi.advanceTimersByTime(7_999)
    expect(model.lastDeleted.value).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(model.lastDeleted.value).toBeNull()
  })

  it('empties the trash permanently and clears a stale undo action', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()
    const taskId = model.tasks.value[0]!.id

    await model.deleteTask(taskId)
    await model.emptyTrash()

    expect(model.trashCount.value).toBe(0)
    expect(model.lastDeleted.value).toBeNull()
    expect((await gateway.loadWorkspace({ includeDeleted: true })).tasks.some(task => task.id === taskId)).toBe(false)
  })

  it('clears active and trashed workspace records together with the undo state', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()
    await model.deleteTask(model.tasks.value[0]!.id)
    expect(model.lastDeleted.value).not.toBeNull()
    expect(model.trashCount.value).toBeGreaterThan(0)

    await model.clearWorkspaceData()

    expect(model.projects.value).toEqual([])
    expect(model.tasks.value).toEqual([])
    expect(model.quarterGoals.value).toEqual([])
    expect(model.trashedProjects.value).toEqual([])
    expect(model.trashedTasks.value).toEqual([])
    expect(model.trashedQuarterGoals.value).toEqual([])
    expect(model.trashCount.value).toBe(0)
    expect(model.lastDeleted.value).toBeNull()
  })
})

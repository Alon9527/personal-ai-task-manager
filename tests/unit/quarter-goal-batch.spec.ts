import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { LocalWorkspaceGateway, LOCAL_WORKSPACE_STORAGE_KEY as KEY } from '../../app/data/local-workspace-gateway'
import { DesktopWorkspaceGateway } from '../../app/data/desktop-workspace-gateway'
import type { CreateQuarterGoalInput, WorkspaceGateway } from '../../app/data/workspace-gateway'
import { createWorkspaceModel } from '../../app/models/workspace-model'

const goal = (title = 'New goal', quarter = '2026-Q1'): CreateQuarterGoalInput => ({ title, quarter, description: 'Confirmed plan', progress: 0, status: 'active' })
function storage() {
  let raw = JSON.stringify(createDemoWorkspace())
  return { getItem: () => raw, setItem: vi.fn((_key: string, value: string) => { raw = value }) }
}

describe('atomic quarterly goal batches', () => {
  beforeEach(() => localStorage.clear())

  it('writes once, deduplicates within the batch and existing active goals, and preserves unrelated data', async () => {
    const store = storage()
    const gateway = new LocalWorkspaceGateway(store)
    const before = await gateway.loadWorkspace({ includeDeleted: true })
    const existing = before.quarterGoals[0]!
    const result = await gateway.createQuarterGoals([
      goal(` ${existing.title} `, existing.quarter), goal(), goal(' new GOAL '), goal('New goal', '2026-Q2'),
    ])
    expect(store.setItem).toHaveBeenCalledTimes(1)
    expect(result.createdGoalIds).toHaveLength(2)
    expect(result.skippedCount).toBe(2)
    expect(result.document.tasks).toEqual(before.tasks)
    expect(result.document.projects).toEqual(before.projects)
    expect(result.document.milestones).toEqual(before.milestones)
    expect(result.document.quarterGoals.slice(0, before.quarterGoals.length)).toEqual(before.quarterGoals)
  })

  it('does not resurrect trash, and assigns sequential order after existing goals', async () => {
    const store = storage()
    const gateway = new LocalWorkspaceGateway(store)
    const old = await gateway.createQuarterGoal(goal('Deleted title'))
    await gateway.deleteQuarterGoal(old.id)
    const first = await gateway.createQuarterGoal(goal('Active'))
    const result = await gateway.createQuarterGoals([goal('Deleted title'), goal('Another')])
    expect(result.createdGoalIds).toHaveLength(2)
    expect(result.document.quarterGoals.find(g => g.id === old.id)?.deletedAt).not.toBeNull()
    const added = result.document.quarterGoals.filter(g => result.createdGoalIds.includes(g.id))
    expect(added.map(g => g.sortOrder)).toEqual([first.sortOrder + 1, first.sortOrder + 2])
  })

  it.each([
    [], Array.from({ length: 17 }, () => goal()), [goal(), goal('')],
    [goal(), { ...goal(), description: 'x'.repeat(4001) }], [goal(), goal('Invalid quarter', '2026-Q5')],
  ])('rejects the entire invalid batch before writing: %j', async inputs => {
    const store = storage()
    const before = store.getItem()
    const gateway = new LocalWorkspaceGateway(store)
    await expect(gateway.createQuarterGoals(inputs)).rejects.toMatchObject({ code: 'validation' })
    expect(store.setItem).not.toHaveBeenCalled()
    expect(store.getItem()).toBe(before)
  })

  it('captures input before awaiting the queue and serializes adjacent edits', async () => {
    const gateway = new LocalWorkspaceGateway(storage())
    const inputs = [goal('Original')]
    const batch = gateway.createQuarterGoals(inputs)
    inputs[0]!.title = 'Changed after click'
    const adjacent = gateway.createQuarterGoal(goal('Adjacent'))
    const result = await batch
    await adjacent
    expect(result.document.quarterGoals.at(-1)?.title).toBe('Original')
    const final = await gateway.loadWorkspace()
    expect(final.quarterGoals.slice(-2).map(g => g.title)).toEqual(['Original', 'Adjacent'])
  })

  it('keeps persisted and visible state unchanged on storage failure', async () => {
    const store = storage()
    const model = createWorkspaceModel(new LocalWorkspaceGateway(store))
    await model.load()
    const before = JSON.stringify(model.document.value)
    const persisted = store.getItem()
    store.setItem.mockImplementation(() => { throw new Error('quota exceeded') })
    await expect(model.createQuarterGoals([goal(), goal('Second')])).rejects.toThrow()
    expect(store.getItem()).toBe(persisted)
    expect(JSON.stringify(model.document.value)).toBe(before)
    expect(model.saving.value).toBe(false)
  })

  it('refreshes the native base, commits once, and publishes the returned canonical snapshot without rereading', async () => {
    let raw = JSON.stringify(createDemoWorkspace())
    const loadDocument = vi.fn(async () => raw)
    const saveDocument = vi.fn(async (next: string) => { raw = next; return next })
    const applyPlan = vi.fn(async (next: string, expected: string) => {
      expect(JSON.parse(expected)).toEqual(JSON.parse(raw))
      const canonical = JSON.parse(next)
      canonical.tasks[0].title = 'Canonical response'
      raw = JSON.stringify(canonical)
      return raw
    })
    const model = createWorkspaceModel(new DesktopWorkspaceGateway(localStorage, { loadDocument, saveDocument, applyPlan }))
    await model.load()
    const external = JSON.parse(raw)
    external.projects[0].description = 'External change before batch'
    raw = JSON.stringify(external)
    loadDocument.mockClear(); saveDocument.mockClear()
    const result = await model.createQuarterGoals([goal(), goal('Second')])
    expect(result).toEqual({ addedCount: 2, skippedCount: 0 })
    expect(loadDocument).toHaveBeenCalledTimes(1)
    expect(saveDocument).not.toHaveBeenCalled()
    expect(applyPlan).toHaveBeenCalledTimes(1)
    expect(model.document.value.projects[0]?.description).toBe('External change before batch')
    expect(model.document.value.tasks[0]?.title).toBe('Canonical response')
  })

  it('fails closed on native conflict instead of falling back to unconditional save', async () => {
    const raw = JSON.stringify(createDemoWorkspace())
    const saveDocument = vi.fn(async (next: string) => next)
    const gateway = new DesktopWorkspaceGateway(localStorage, {
      loadDocument: async () => raw, saveDocument,
      applyPlan: async () => { throw 'WORKSPACE_CONFLICT' },
    })
    await gateway.loadWorkspace(); saveDocument.mockClear()
    await expect(gateway.createQuarterGoals([goal(), goal('Second')])).rejects.toMatchObject({ code: 'conflict' })
    expect(saveDocument).not.toHaveBeenCalled()
    expect((await gateway.loadWorkspace()).quarterGoals.some(g => g.title === 'New goal')).toBe(false)
  })

  it('deduplicates against committed data when retrying a lost acknowledgement', async () => {
    let raw = JSON.stringify(createDemoWorkspace())
    const applyPlan = vi.fn(async (next: string) => { raw = next; throw new Error('IPC reply lost') })
    const model = createWorkspaceModel(new DesktopWorkspaceGateway(localStorage, {
      loadDocument: async () => raw, saveDocument: async next => { raw = next; return next }, applyPlan,
    }))
    await model.load()
    const inputs = [goal(), goal('Second')]
    await expect(model.createQuarterGoals(inputs)).rejects.toThrow('IPC reply lost')
    expect(JSON.parse(raw).quarterGoals.filter((g: { title: string }) => g.title === 'New goal')).toHaveLength(1)
    expect(await model.createQuarterGoals(inputs)).toEqual({ addedCount: 0, skippedCount: 2 })
    expect(applyPlan).toHaveBeenCalledTimes(1)
    expect(model.document.value.quarterGoals.filter(g => g.title === 'New goal')).toHaveLength(1)
    expect(model.error.value).toBeNull()
  })

  it('rejects unsupported adapters without using their single-create method', async () => {
    const local = new LocalWorkspaceGateway(storage())
    const single = vi.spyOn(local, 'createQuarterGoal')
    const gateway: WorkspaceGateway = Object.assign(local, { createQuarterGoals: undefined })
    const model = createWorkspaceModel(gateway)
    await expect(model.createQuarterGoals([goal()])).rejects.toThrow('不支持安全批量保存')
    expect(single).not.toHaveBeenCalled()
  })

  it.each(['lost acknowledgement', 'conflict'])('refreshes before queued ordinary edits after %s', async failure => {
    let raw = JSON.stringify(createDemoWorkspace())
    const gateway = new DesktopWorkspaceGateway(localStorage, {
      loadDocument: async () => raw,
      saveDocument: async next => { raw = next; return next },
      applyPlan: async next => {
        raw = next // A committed batch, or an equivalent external writer's update.
        throw new Error(failure === 'conflict' ? 'WORKSPACE_CONFLICT' : 'IPC reply lost')
      },
    })
    await gateway.loadWorkspace()
    const batch = gateway.createQuarterGoals([goal(), goal('Second')])
    const rejected = expect(batch).rejects.toThrow()
    const adjacent = gateway.createQuarterGoal(goal('Adjacent'))
    await rejected; await adjacent
    expect(JSON.parse(raw).quarterGoals.slice(-3).map((g: { title: string }) => g.title)).toEqual(['New goal', 'Second', 'Adjacent'])
    expect((await gateway.createQuarterGoals([goal(), goal('Second')])).skippedCount).toBe(2)
  })

  it('blocks ordinary edits when refresh after an uncertain commit fails', async () => {
    let raw = JSON.stringify(createDemoWorkspace())
    let unavailable = false
    const saveDocument = vi.fn(async (next: string) => { raw = next; return next })
    const gateway = new DesktopWorkspaceGateway(localStorage, {
      loadDocument: async () => { if (unavailable) throw new Error('read unavailable'); return raw }, saveDocument,
      applyPlan: async next => { raw = next; unavailable = true; throw new Error('IPC reply lost') },
    })
    await gateway.loadWorkspace(); saveDocument.mockClear()
    await expect(gateway.createQuarterGoals([goal()])).rejects.toThrow()
    await expect(gateway.createQuarterGoal(goal('Must not write'))).rejects.toThrow()
    expect(saveDocument).not.toHaveBeenCalled()
    expect(JSON.parse(raw).quarterGoals.at(-1).title).toBe('New goal')
  })

  it('rejects an older desktop bridge without writing', async () => {
    const saveDocument = vi.fn(async (next: string) => next)
    const gateway = new DesktopWorkspaceGateway(localStorage, { loadDocument: async () => null, saveDocument })
    await expect(gateway.createQuarterGoals([goal()])).rejects.toThrow('更新')
    expect(saveDocument).not.toHaveBeenCalled()
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { DesktopWorkspaceGateway } from '../../app/data/desktop-workspace-gateway'
import { workspaceDocumentSchema } from '../../shared/workspace'

describe('DesktopWorkspaceGateway', () => {
  beforeEach(() => localStorage.clear())

  it('restores portable files with fresh IDs so damaged existing content cannot block recovery', async () => {
    const id = '40000000-0000-4000-8000-000000000001'
    const portable = createDemoWorkspace()
    portable.tasks[0]!.attachments = [{ id, name: 'fixed.png', mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,AQID' }]
    const saveDocument = vi.fn(async (raw: string) => {
      if (JSON.parse(raw).tasks[0]?.attachments[0]?.id === id) throw new Error('immutable ID conflict with damaged row')
      return raw
    })
    const gateway = new DesktopWorkspaceGateway(localStorage, {
      loadDocument: async () => { throw new Error('attachment is corrupt') },
      loadRawDocument: async () => '{retained raw source', backupDocument: async () => undefined, saveDocument,
    })
    const restored = await gateway.recoverWorkspaceDocument(portable)
    expect(restored.tasks[0]!.attachments[0]!.id).not.toBe(id)
    expect(restored.tasks[0]!.attachments[0]!.dataUrl).toBe('data:image/png;base64,AQID')
    expect(portable.tasks[0]!.attachments[0]!.id).toBe(id)
  })

  it('offers explicit recovery when native attachment migration fails and backs up the raw source', async () => {
    const original = JSON.stringify(createDemoWorkspace())
    const backupDocument = vi.fn(async () => undefined)
    const gateway = new DesktopWorkspaceGateway(localStorage, {
      loadDocument: async () => { throw new Error('附件迁移失败') },
      loadRawDocument: async () => original,
      saveDocument: async (json: string) => json,
      backupDocument,
    })
    await expect(gateway.loadWorkspace()).rejects.toMatchObject({ code: 'recovery-required' })
    await gateway.recoverWorkspaceDocument({ version: 3, tasks: [], projects: [], milestones: [], quarterGoals: [] })
    expect(backupDocument).toHaveBeenCalledWith(original)
    expect((await gateway.loadWorkspace()).tasks).toEqual([])
  })

  it('uses the committed native attachment references for its cache and returned task', async () => {
    const id = '40000000-0000-4000-8000-000000000001'
    let saved: string | null = null
    const writes: string[] = []
    const gateway = new DesktopWorkspaceGateway(localStorage, {
      loadDocument: async () => saved,
      saveDocument: async (raw: string) => {
        writes.push(raw)
        const doc = JSON.parse(raw)
        for (const task of doc.tasks) for (const a of task.attachments ?? []) a.dataUrl = `attachment:${a.id}`
        saved = JSON.stringify(doc)
        return saved
      },
    })
    const task = await gateway.createTask({ title: 'test file', description: '', projectId: null, milestoneId: null, priority: null, dueDate: null, dueTime: null, isFocus: false,
      attachments: [{ id, name: 'photo.png', mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,AQID' }],
    })
    expect(task.attachments[0]?.dataUrl).toBe(`attachment:${id}`)
    await gateway.updateTask(task.id, { title: 'updated without file bytes' })
    expect(writes.at(-1)).not.toContain('base64')
    expect((await gateway.loadWorkspace()).tasks[0]?.attachments[0]?.dataUrl).toBe(`attachment:${id}`)
  })

  it('provides a native v3 demo document with no synthetic test titles', async () => {
    const document = createDemoWorkspace()
    const source = await readFile(resolve(process.cwd(), 'app/data/demo-workspace.ts'), 'utf8')
    const titles = [
      ...document.tasks.map(task => task.title),
      ...document.milestones.map(milestone => milestone.title),
      ...document.quarterGoals.map(goal => goal.title),
    ]

    expect(workspaceDocumentSchema.parse(document)).toEqual(document)
    expect(document.version).toBe(3)
    expect(source).toContain('version: 3')
    expect(source).not.toContain('migrateWorkspaceDocument')
    expect(titles.some(title => /test/i.test(title))).toBe(false)
  })

  it('imports the existing local workspace when SQLite is empty', async () => {
    const current = createDemoWorkspace()
    const legacy = {
      version: 2 as const,
      projects: current.projects.map(({ description: _description, priority: _priority, status: _status, targetDate: _targetDate, ...project }) => project),
      tasks: current.tasks.map(({ milestoneId: _milestoneId, ...task }) => task),
      quarterGoals: current.quarterGoals,
    }
    legacy.tasks[0]!.title = '保留原有任务'
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(legacy))
    let sqliteDocument: string | null = null
    const bridge = {
      loadDocument: vi.fn(async () => sqliteDocument),
      saveDocument: vi.fn(async (value: string) => { sqliteDocument = value }),
    }

    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    const loaded = await gateway.loadWorkspace()

    expect(loaded.tasks[0]?.title).toBe('保留原有任务')
    expect(bridge.saveDocument).toHaveBeenCalledOnce()
    expect(sqliteDocument).toContain('保留原有任务')
    expect(JSON.parse(sqliteDocument!).version).toBe(3)
    expect(JSON.parse(sqliteDocument!).milestones).toEqual([])
  })

  it('normalizes imported workspace data before SQLite persistence so provider material cannot travel with it', async () => {
    const imported = {
      ...createDemoWorkspace(),
      providerRegistry: {
        profiles: [{
          id: '550e8400-e29b-41d4-a716-446655440000',
          endpoint: 'https://api.example.invalid/v1',
          credential: 'synthetic-workspace-secret',
        }],
      },
      endpoint: 'https://api.example.invalid/v1',
      region: 'global',
      apiKey: 'synthetic-workspace-secret',
    }
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(imported))
    let sqliteDocument: string | null = null
    const bridge = {
      loadDocument: vi.fn(async () => sqliteDocument),
      saveDocument: vi.fn(async (value: string) => { sqliteDocument = value }),
      backupDocument: vi.fn(async () => undefined),
    }

    const loaded = await new DesktopWorkspaceGateway(localStorage, bridge).loadWorkspace({ includeDeleted: true })
    const serialized = JSON.stringify(loaded)

    expect(bridge.backupDocument).not.toHaveBeenCalled()
    for (const material of [
      'providerRegistry',
      'https://api.example.invalid/v1',
      'synthetic-workspace-secret',
      '"region":"global"',
    ]) {
      expect(serialized).not.toContain(material)
      expect(sqliteDocument).not.toContain(material)
    }
  })

  it('persists CRUD to SQLite and reloads it in another gateway instance', async () => {
    let sqliteDocument: string | null = null
    const bridge = {
      loadDocument: async () => sqliteDocument,
      saveDocument: async (value: string) => { sqliteDocument = value },
    }
    const first = new DesktopWorkspaceGateway(localStorage, bridge)
    const task = await first.createTask({
      title: 'SQLite 任务', description: '', projectId: null, priority: null,
      dueDate: null, dueTime: null, isFocus: false, importance: 'important',
    })
    await first.updateTask(task.id, { status: 'in_progress' })

    const second = new DesktopWorkspaceGateway(localStorage, bridge)
    const reloaded = await second.loadWorkspace()
    expect(reloaded.tasks.find(item => item.id === task.id)).toMatchObject({
      title: 'SQLite 任务',
      status: 'in_progress',
      importance: 'important',
    })
  })

  it('rolls back in-memory changes when the SQLite transaction fails', async () => {
    let sqliteDocument: string | null = null
    let failWrites = false
    const bridge = {
      loadDocument: async () => sqliteDocument,
      saveDocument: async (value: string) => {
        if (failWrites) throw new Error('sqlite unavailable')
        sqliteDocument = value
      },
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    await gateway.loadWorkspace()
    const before = await gateway.loadWorkspace()
    failWrites = true

    await expect(gateway.createProject({ name: '不应保留', color: '#112233' }))
      .rejects.toThrow('sqlite unavailable')

    expect((await gateway.loadWorkspace()).projects).toEqual(before.projects)
  })

  it('serializes concurrent writes so an older save cannot overwrite a newer task', async () => {
    let sqliteDocument: string | null = JSON.stringify(createDemoWorkspace())
    let releaseFirstSave!: () => void
    let markFirstSaveStarted!: () => void
    const firstSaveStarted = new Promise<void>((resolve) => { markFirstSaveStarted = resolve })
    const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve })
    const bridge = {
      loadDocument: async () => sqliteDocument,
      saveDocument: async (value: string) => {
        if (value.includes('第一个并发任务') && !value.includes('第二个并发任务')) {
          markFirstSaveStarted()
          await firstSaveGate
        }
        sqliteDocument = value
      },
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    await gateway.loadWorkspace()

    const first = gateway.createTask({
      title: '第一个并发任务', description: '', projectId: null, priority: null,
      dueDate: null, dueTime: null, isFocus: false, importance: 'normal',
    })
    await firstSaveStarted
    const second = gateway.createTask({
      title: '第二个并发任务', description: '', projectId: null, priority: null,
      dueDate: null, dueTime: null, isFocus: false, importance: 'normal',
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    releaseFirstSave()
    await Promise.all([first, second])

    const reloaded = await new DesktopWorkspaceGateway(localStorage, bridge).loadWorkspace()
    expect(reloaded.tasks.map(task => task.title)).toEqual(expect.arrayContaining([
      '第一个并发任务',
      '第二个并发任务',
    ]))
  })

  it('rolls back a full workspace clear when SQLite rejects the save', async () => {
    let sqliteDocument: string | null = JSON.stringify(createDemoWorkspace())
    let rejectWrites = false
    const bridge = {
      loadDocument: async () => sqliteDocument,
      saveDocument: async (value: string) => {
        if (rejectWrites) throw new Error('sqlite clear failed')
        sqliteDocument = value
      },
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    const before = await gateway.loadWorkspace({ includeDeleted: true })
    rejectWrites = true

    await expect(gateway.clearWorkspaceData()).rejects.toThrow('sqlite clear failed')

    expect(await gateway.loadWorkspace({ includeDeleted: true })).toEqual(before)
    expect(sqliteDocument).toContain(before.tasks[0]!.title)
  })

  it('exposes milestone mutations and persists each one exactly once', async () => {
    let sqliteDocument: string | null = JSON.stringify(createDemoWorkspace())
    const bridge = {
      loadDocument: vi.fn(async () => sqliteDocument),
      saveDocument: vi.fn(async (value: string) => { sqliteDocument = value }),
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    await gateway.loadWorkspace()
    bridge.saveDocument.mockClear()

    expect(gateway.createMilestone).toBeTypeOf('function')
    expect(gateway.updateMilestone).toBeTypeOf('function')
    expect(gateway.deleteMilestone).toBeTypeOf('function')
    expect(gateway.restoreMilestone).toBeTypeOf('function')
    expect(gateway.reorderMilestones).toBeTypeOf('function')

    const projectId = (await gateway.loadWorkspace()).projects[0]!.id
    const milestone = await gateway.createMilestone({
      projectId,
      title: 'Desktop milestone',
      description: '',
      targetDate: null,
      status: 'planned',
      progressMode: 'auto',
      progress: 0,
    })
    expect(bridge.saveDocument).toHaveBeenCalledTimes(1)

    await gateway.updateMilestone(milestone.id, { title: 'Updated milestone' })
    expect(bridge.saveDocument).toHaveBeenCalledTimes(2)

    await gateway.reorderMilestones(projectId, [milestone.id])
    expect(bridge.saveDocument).toHaveBeenCalledTimes(3)

    await gateway.deleteMilestone(milestone.id)
    expect(bridge.saveDocument).toHaveBeenCalledTimes(4)

    await gateway.restoreMilestone(milestone.id)
    expect(bridge.saveDocument).toHaveBeenCalledTimes(5)
    expect((await gateway.loadWorkspace()).milestones[0]).toMatchObject({
      id: milestone.id,
      title: 'Updated milestone',
      deletedAt: null,
    })
  })

  it('rolls back a milestone mutation when SQLite rejects the save', async () => {
    let sqliteDocument: string | null = JSON.stringify(createDemoWorkspace())
    let rejectWrites = false
    const bridge = {
      loadDocument: async () => sqliteDocument,
      saveDocument: async (value: string) => {
        if (rejectWrites) throw new Error('sqlite milestone failed')
        sqliteDocument = value
      },
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    const before = await gateway.loadWorkspace({ includeDeleted: true })
    rejectWrites = true

    await expect(gateway.createMilestone({
      projectId: before.projects[0]!.id,
      title: 'Must roll back',
      description: '',
      targetDate: null,
      status: 'planned',
      progressMode: 'auto',
      progress: 0,
    })).rejects.toThrow('sqlite milestone failed')

    expect(await gateway.loadWorkspace({ includeDeleted: true })).toEqual(before)
  })

  it('retains corrupt SQLite JSON and blocks all writes until explicit recovery', async () => {
    let sqliteDocument: string | null = '{corrupt-sqlite'
    let latestBackup: string | null = null
    const calls: string[] = []
    const bridge = {
      loadDocument: vi.fn(async () => sqliteDocument),
      saveDocument: vi.fn(async (value: string) => {
        calls.push('save')
        sqliteDocument = value
      }),
      backupDocument: vi.fn(async (value: string) => {
        calls.push('backup')
        latestBackup = value
      }),
      loadLatestBackup: vi.fn(async () => latestBackup),
    }

    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    await expect(gateway.loadWorkspace()).rejects.toThrow('恢复')
    await expect(gateway.clearWorkspaceData()).rejects.toThrow('恢复')
    expect(calls).toEqual([])
    expect(sqliteDocument).toBe('{corrupt-sqlite')
    expect(latestBackup).toBeNull()
  })

  it('fails closed and retains corrupt SQLite JSON when durable backup fails', async () => {
    let sqliteDocument: string | null = '{corrupt-sqlite'
    const bridge = {
      loadDocument: vi.fn(async () => sqliteDocument),
      saveDocument: vi.fn(async (value: string) => { sqliteDocument = value }),
      backupDocument: vi.fn(async () => { throw new Error('backup unavailable') }),
      loadLatestBackup: vi.fn(async () => null),
    }

    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)

    await expect(gateway.loadWorkspace()).rejects.toThrow('恢复')
    expect(sqliteDocument).toBe('{corrupt-sqlite')
    expect(bridge.saveDocument).not.toHaveBeenCalled()
  })

  it('starts a new desktop workspace empty instead of inserting sample tasks', async () => {
    const bridge = { loadDocument: async () => null, saveDocument: vi.fn(async () => undefined) }
    const loaded = await new DesktopWorkspaceGateway(localStorage, bridge).loadWorkspace()
    expect(loaded).toEqual({ version: 3, projects: [], milestones: [], tasks: [], quarterGoals: [] })
  })

  it('treats an existing empty SQLite document as corruption, not a new workspace', async () => {
    const bridge = { loadDocument: async () => '', saveDocument: vi.fn(async () => undefined) }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    await expect(gateway.loadWorkspace()).rejects.toThrow('恢复')
    await expect(gateway.clearWorkspaceData()).rejects.toThrow('恢复')
    expect(bridge.saveDocument).not.toHaveBeenCalled()
  })

  it('restores only an explicitly supplied valid backup and preserves the corrupt original first', async () => {
    let saved = '{broken'
    const backups: string[] = []
    const bridge = {
      loadDocument: async () => saved,
      saveDocument: async (value: string) => { saved = value },
      backupDocument: async (value: string) => { backups.push(value) },
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    await expect(gateway.loadWorkspace()).rejects.toThrow('恢复')
    expect(gateway.recoverWorkspaceDocument).toBeTypeOf('function')
    const backup = createDemoWorkspace()
    await gateway.recoverWorkspaceDocument(backup)
    expect(backups).toEqual(['{broken'])
    expect(await gateway.loadWorkspace({ includeDeleted: true })).toEqual(backup)
  })

  it('never overwrites the original when recovery backup fails', async () => {
    let saved = '{broken'
    const gateway = new DesktopWorkspaceGateway(localStorage, {
      loadDocument: async () => saved,
      saveDocument: async value => { saved = value },
      backupDocument: async () => { throw new Error('backup failed') },
    })
    expect(gateway.recoverWorkspaceDocument).toBeTypeOf('function')
    await expect(gateway.recoverWorkspaceDocument(createDemoWorkspace())).rejects.toThrow('backup failed')
    expect(saved).toBe('{broken')
  })

  it('uses a native atomic plan commit instead of an ordinary document save', async () => {
    let saved = JSON.stringify(createDemoWorkspace())
    const commits: string[] = []
    const bridge = {
      loadDocument: async () => saved,
      saveDocument: vi.fn(async (value: string) => { saved = value }),
      hasAppliedPlan: async (id: string) => commits.includes(id),
      applyPlan: async (value: string, expected: string, id: string) => {
        if (commits.includes(id)) throw 'PLAN_ALREADY_APPLIED'
        expect(JSON.parse(expected)).toEqual(JSON.parse(saved))
        saved = value
        commits.push(id)
      },
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    const base = await gateway.loadWorkspace({ includeDeleted: true })
    bridge.saveDocument.mockClear()
    const next = structuredClone(base)
    next.projects[0]!.name = '只执行一次'
    expect(gateway.applyAgentPlan).toBeTypeOf('function')
    await gateway.applyAgentPlan(next, base, 'plan-1')
    expect(bridge.saveDocument).not.toHaveBeenCalled()
    const restarted = new DesktopWorkspaceGateway(localStorage, bridge)
    expect(await restarted.hasAppliedPlan('plan-1')).toBe(true)
    await expect(restarted.applyAgentPlan(next, next, 'plan-1')).rejects.toMatchObject({ code: 'already-applied' })
    expect(commits).toEqual(['plan-1'])
  })
})

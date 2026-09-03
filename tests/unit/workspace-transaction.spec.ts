import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiWorkspaceGateway } from '../../app/data/api-workspace-gateway'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { DesktopWorkspaceGateway } from '../../app/data/desktop-workspace-gateway'
import { LOCAL_WORKSPACE_STORAGE_KEY, LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import type { WorkspaceGateway } from '../../app/data/workspace-gateway'
import { WorkspaceTransaction } from '../../app/data/workspace-transaction'
import { SupabaseWorkspaceRepository } from '../../server/utils/supabase-workspace-repository'
import { DEMO_OWNER_ID } from '../../shared/workspace'
import type { WorkspaceDocument } from '../../shared/workspace'

const NOW = '2026-08-13T08:00:00.000Z'
const CREATED_PROJECT_ID = '50000000-0000-4000-8000-000000000001'

const repositoryHandlers = vi.hoisted(() => ({
  replaceWorkspaceDocument: vi.fn(),
}))
const workspaceApiMocks = vi.hoisted(() => ({
  getWorkspaceRepository: vi.fn(() => repositoryHandlers),
}))

vi.mock('../../server/utils/workspace-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/workspace-api')>()
  return { ...actual, getWorkspaceRepository: workspaceApiMocks.getWorkspaceRepository }
})

type TestEvent = { body?: unknown }

function nextDocument(): WorkspaceDocument {
  const document = createDemoWorkspace()
  document.tasks[0]!.title = 'Atomic replacement'
  document.tasks[0]!.updatedAt = NOW
  return document
}

const OPTIONAL_TASK_FIELDS = [
  'status', 'importance', 'estimatedMinutes', 'reminderAt', 'snoozedUntil', 'lastRemindedAt', 'attachments',
] as const

function documentWithoutOptionalTaskFields(completed = false) {
  const raw = structuredClone(createDemoWorkspace()) as unknown as {
    version: 3
    projects: unknown[]
    milestones: unknown[]
    tasks: Array<Record<string, unknown>>
    quarterGoals: unknown[]
  }
  const task = raw.tasks[0]!
  task.priority = 'high'
  task.completedAt = completed ? NOW : null
  for (const field of OPTIONAL_TASK_FIELDS) Reflect.deleteProperty(task, field)
  return raw
}

function expectedTaskDefaults(completed = false) {
  return {
    status: completed ? 'done' : 'todo',
    importance: 'important',
    estimatedMinutes: null,
    reminderAt: null,
    snoozedUntil: null,
    lastRemindedAt: null,
    attachments: [],
  }
}

function createStorage(document: WorkspaceDocument) {
  const values = new Map([[LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(document)]])
  return {
    values,
    storage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
  vi.stubGlobal('readValidatedBody', async (event: TestEvent, validate: (body: unknown) => unknown) => validate(event.body))
})

describe('WorkspaceTransaction', () => {
  it('validates, delegates exactly once, and isolates input and output', async () => {
    const next = nextDocument()
    const saved = structuredClone(next)
    const replaceWorkspaceDocument = vi.fn(async () => saved)
    const gateway = { replaceWorkspaceDocument } as unknown as WorkspaceGateway
    const transaction = new WorkspaceTransaction(gateway)

    const result = await transaction.replace(next)

    expect(replaceWorkspaceDocument).toHaveBeenCalledExactlyOnceWith(next)
    expect(result).toEqual(next)
    expect(result).not.toBe(next)
    result.tasks[0]!.title = 'caller mutation'
    expect(saved.tasks[0]!.title).toBe('Atomic replacement')
  })

  it('rejects malformed v3 input without delegating', async () => {
    const replaceWorkspaceDocument = vi.fn()
    const transaction = new WorkspaceTransaction({ replaceWorkspaceDocument } as unknown as WorkspaceGateway)

    await expect(transaction.replace({ ...nextDocument(), version: 2 } as never)).rejects.toThrow()
    expect(replaceWorkspaceDocument).not.toHaveBeenCalled()
  })

  it('rejects a malformed gateway response', async () => {
    const replaceWorkspaceDocument = vi.fn().mockResolvedValue({ version: 3, projects: [] })
    const transaction = new WorkspaceTransaction({ replaceWorkspaceDocument } as unknown as WorkspaceGateway)

    await expect(transaction.replace(nextDocument())).rejects.toThrow()
    expect(replaceWorkspaceDocument).toHaveBeenCalledOnce()
  })

  it('canonicalizes all optional task fields before delegating', async () => {
    const replaceWorkspaceDocument = vi.fn(async (document: WorkspaceDocument) => document)
    const transaction = new WorkspaceTransaction({ replaceWorkspaceDocument } as unknown as WorkspaceGateway)

    const result = await transaction.replace(documentWithoutOptionalTaskFields(true) as never)

    expect(replaceWorkspaceDocument.mock.calls[0]![0].tasks[0]).toMatchObject(expectedTaskDefaults(true))
    expect(result.tasks[0]).toMatchObject(expectedTaskDefaults(true))
  })
})

describe('LocalWorkspaceGateway replacement', () => {
  it('persists a valid document with one storage write', async () => {
    const before = createDemoWorkspace()
    const { storage } = createStorage(before)
    const gateway = new LocalWorkspaceGateway(storage)
    const next = nextDocument()

    const result = await gateway.replaceWorkspaceDocument(next)

    expect(storage.setItem).toHaveBeenCalledOnce()
    expect(result).toEqual(next)
    expect(await gateway.loadWorkspace({ includeDeleted: true })).toEqual(next)
  })

  it('does not write invalid input and preserves prior storage on write failure', async () => {
    const before = createDemoWorkspace()
    const { values, storage } = createStorage(before)
    const gateway = new LocalWorkspaceGateway(storage)

    await expect(gateway.replaceWorkspaceDocument({ ...nextDocument(), version: 1 } as never)).rejects.toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()

    storage.setItem.mockImplementationOnce(() => { throw new Error('disk full') })
    await expect(gateway.replaceWorkspaceDocument(nextDocument())).rejects.toThrow()
    expect(JSON.parse(values.get(LOCAL_WORKSPACE_STORAGE_KEY)!)).toEqual(before)
  })

  it('serializes replacement before an adjacent create without losing either change', async () => {
    const before = createDemoWorkspace()
    const { storage } = createStorage(before)
    const gateway = new LocalWorkspaceGateway(storage, () => NOW, () => CREATED_PROJECT_ID)
    const next = nextDocument()

    const [replaced, created] = await Promise.all([
      gateway.replaceWorkspaceDocument(next),
      gateway.createProject({ name: 'After replace', color: '#123456' }),
    ])

    const final = await gateway.loadWorkspace({ includeDeleted: true })
    expect(replaced).toEqual(next)
    expect(created.id).toBe(CREATED_PROJECT_ID)
    expect(final.tasks[0]!.title).toBe('Atomic replacement')
    expect(final.projects.some(project => project.id === CREATED_PROJECT_ID)).toBe(true)
  })

  it('stores a complete canonical task when legal optional fields are absent', async () => {
    const { values, storage } = createStorage(createDemoWorkspace())
    const gateway = new LocalWorkspaceGateway(storage)

    const result = await gateway.replaceWorkspaceDocument(documentWithoutOptionalTaskFields() as never)

    expect(result.tasks[0]).toMatchObject(expectedTaskDefaults())
    expect(JSON.parse(values.get(LOCAL_WORKSPACE_STORAGE_KEY)!).tasks[0]).toMatchObject(expectedTaskDefaults())
  })
})

describe('DesktopWorkspaceGateway replacement', () => {
  it('hydrates then saves one replacement exactly once', async () => {
    let sqliteDocument: string | null = JSON.stringify(createDemoWorkspace())
    const bridge = {
      loadDocument: vi.fn(async () => sqliteDocument),
      saveDocument: vi.fn(async (value: string) => { sqliteDocument = value }),
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    await gateway.loadWorkspace({ includeDeleted: true })
    bridge.saveDocument.mockClear()

    await expect(gateway.replaceWorkspaceDocument(nextDocument())).resolves.toEqual(nextDocument())

    expect(bridge.saveDocument).toHaveBeenCalledOnce()
    expect(JSON.parse(sqliteDocument!).tasks[0].title).toBe('Atomic replacement')
  })

  it('restores the exact prior in-memory document when the bridge save fails', async () => {
    let sqliteDocument: string | null = JSON.stringify(createDemoWorkspace())
    const bridge = {
      loadDocument: vi.fn(async () => sqliteDocument),
      saveDocument: vi.fn(async (value: string) => { sqliteDocument = value }),
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    const before = await gateway.loadWorkspace({ includeDeleted: true })
    bridge.saveDocument.mockRejectedValueOnce(new Error('disk full'))

    await expect(gateway.replaceWorkspaceDocument(nextDocument())).rejects.toThrow('disk full')

    expect(await gateway.loadWorkspace({ includeDeleted: true })).toEqual(before)
    expect(JSON.parse(sqliteDocument!)).toEqual(before)
  })

  it('keeps an adjacent mutation behind an in-flight replacement save', async () => {
    let sqliteDocument: string | null = JSON.stringify(createDemoWorkspace())
    let releaseReplacement!: () => void
    let markReplacementStarted!: () => void
    const replacementStarted = new Promise<void>(resolve => { markReplacementStarted = resolve })
    const replacementGate = new Promise<void>(resolve => { releaseReplacement = resolve })
    const bridge = {
      loadDocument: vi.fn(async () => sqliteDocument),
      saveDocument: vi.fn(async (value: string) => {
        if (value.includes('Atomic replacement') && !value.includes('After desktop replace')) {
          markReplacementStarted()
          await replacementGate
        }
        sqliteDocument = value
      }),
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    await gateway.loadWorkspace({ includeDeleted: true })
    bridge.saveDocument.mockClear()

    const replacing = gateway.replaceWorkspaceDocument(nextDocument())
    await replacementStarted
    const creating = gateway.createProject({ name: 'After desktop replace', color: '#123456' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(bridge.saveDocument).toHaveBeenCalledTimes(1)
    releaseReplacement()
    await Promise.all([replacing, creating])

    const final = await gateway.loadWorkspace({ includeDeleted: true })
    expect(final.tasks[0]!.title).toBe('Atomic replacement')
    expect(final.projects.some(project => project.name === 'After desktop replace')).toBe(true)
  })

  it('saves a complete canonical task when legal optional fields are absent', async () => {
    let sqliteDocument: string | null = JSON.stringify(createDemoWorkspace())
    const bridge = {
      loadDocument: vi.fn(async () => sqliteDocument),
      saveDocument: vi.fn(async (value: string) => { sqliteDocument = value }),
    }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    await gateway.loadWorkspace({ includeDeleted: true })

    const result = await gateway.replaceWorkspaceDocument(documentWithoutOptionalTaskFields() as never)

    expect(result.tasks[0]).toMatchObject(expectedTaskDefaults())
    expect(JSON.parse(sqliteDocument!).tasks[0]).toMatchObject(expectedTaskDefaults())
  })
})

describe('API and server replacement', () => {
  it('uses one exact PUT request and strictly parses the v3 response', async () => {
    const next = nextDocument()
    const fetcher = vi.fn().mockResolvedValue(structuredClone(next))
    const gateway = new ApiWorkspaceGateway(fetcher)

    await expect(gateway.replaceWorkspaceDocument(next)).resolves.toEqual(next)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/workspace', { method: 'PUT', body: next })

    fetcher.mockResolvedValueOnce({ version: 3, projects: [] })
    await expect(gateway.replaceWorkspaceDocument(next)).rejects.toThrow()
  })

  it('validates the real PUT handler before repository lookup', async () => {
    repositoryHandlers.replaceWorkspaceDocument.mockImplementation(async (document: WorkspaceDocument) => document)
    const handler = (await import('../../server/api/workspace.put')).default
    const next = nextDocument()

    await expect(handler({ body: next } as never)).resolves.toEqual(next)
    expect(repositoryHandlers.replaceWorkspaceDocument).toHaveBeenCalledExactlyOnceWith(next)

    vi.clearAllMocks()
    await expect(handler({ ...({ body: { ...next, version: 2 } }) } as never)).rejects.toThrow()
    expect(workspaceApiMocks.getWorkspaceRepository).not.toHaveBeenCalled()
    expect(repositoryHandlers.replaceWorkspaceDocument).not.toHaveBeenCalled()

    await expect(handler({ body: { ...next, unexpected: true } } as never)).rejects.toThrow()
    expect(workspaceApiMocks.getWorkspaceRepository).not.toHaveBeenCalled()
  })

  it('sends and returns a complete canonical task for legal omitted fields', async () => {
    const fetcher = vi.fn(async (_request: string, options?: { body?: unknown }) => options?.body)
    const gateway = new ApiWorkspaceGateway(fetcher)

    const result = await gateway.replaceWorkspaceDocument(documentWithoutOptionalTaskFields() as never)

    expect((fetcher.mock.calls[0]![1]!.body as WorkspaceDocument).tasks[0]).toMatchObject(expectedTaskDefaults())
    expect(result.tasks[0]).toMatchObject(expectedTaskDefaults())
  })
})

describe('SupabaseWorkspaceRepository replacement', () => {
  it('uses one owner-scoped RPC without preloading', async () => {
    const next = nextDocument()
    const transport = vi.fn().mockResolvedValue(structuredClone(next))
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'secret', ownerId: DEMO_OWNER_ID, transport,
    })

    await expect(repository.replaceWorkspaceDocument(next)).resolves.toEqual(next)

    expect(transport).toHaveBeenCalledExactlyOnceWith(
      'https://example.supabase.co/rest/v1/rpc/replace_workspace_document',
      expect.objectContaining({
        method: 'POST',
        body: { target_owner_id: DEMO_OWNER_ID, payload: next },
      }),
    )
  })

  it('rejects any owner mismatch before transport', async () => {
    const next = nextDocument()
    next.tasks[0]!.ownerId = '60000000-0000-4000-8000-000000000001'
    const transport = vi.fn()
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'secret', ownerId: DEMO_OWNER_ID, transport,
    })

    await expect(repository.replaceWorkspaceDocument(next)).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
  })

  it('sends and returns a complete canonical task for legal omitted fields', async () => {
    const transport = vi.fn(async (_url: string, options?: { body?: unknown }) => {
      return (options?.body as { payload: WorkspaceDocument }).payload
    })
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'secret', ownerId: DEMO_OWNER_ID, transport,
    })

    const result = await repository.replaceWorkspaceDocument(documentWithoutOptionalTaskFields() as never)

    const body = transport.mock.calls[0]![1]!.body as { payload: WorkspaceDocument }
    expect(body.payload.tasks[0]).toMatchObject(expectedTaskDefaults())
    expect(result.tasks[0]).toMatchObject(expectedTaskDefaults())
  })
})

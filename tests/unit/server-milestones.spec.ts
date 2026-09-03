import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_OWNER_ID } from '../../shared/workspace'
import { SupabaseWorkspaceRepository } from '../../server/utils/supabase-workspace-repository'

const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const MILESTONE_ID = '40000000-0000-4000-8000-000000000001'
const NOW = '2026-08-13T08:00:00.000Z'
const MILESTONE_ROW = {
  id: MILESTONE_ID,
  owner_id: DEMO_OWNER_ID,
  project_id: PROJECT_ID,
  title: 'Complete homepage review',
  description: '',
  target_date: '2026-08-16',
  status: 'planned',
  progress_mode: 'auto',
  progress: 0,
  sort_order: 0,
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
}

const repositoryHandlers = vi.hoisted(() => ({
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  restoreMilestone: vi.fn(),
  reorderMilestones: vi.fn(),
}))
const workspaceApiMocks = vi.hoisted(() => ({
  getWorkspaceRepository: vi.fn(() => repositoryHandlers),
}))

vi.mock('../../server/utils/workspace-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/workspace-api')>()
  return { ...actual, getWorkspaceRepository: workspaceApiMocks.getWorkspaceRepository }
})

type TestEvent = { body?: unknown, params?: Record<string, string> }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
  vi.stubGlobal('readValidatedBody', async (event: TestEvent, validate: (body: unknown) => unknown) => validate(event.body))
  vi.stubGlobal('getRouterParam', (event: TestEvent, name: string) => event.params?.[name])
})

function createRepository(transport: ReturnType<typeof vi.fn>) {
  return new SupabaseWorkspaceRepository({
    url: 'https://example.supabase.co',
    key: 'server-secret',
    ownerId: DEMO_OWNER_ID,
    transport,
  })
}

describe('server milestones', () => {
  it('executes every milestone route handler with validated repository arguments', async () => {
    const createInput = {
      projectId: PROJECT_ID,
      title: 'Complete homepage review',
      description: '',
      targetDate: '2026-08-16',
      status: 'planned' as const,
      progressMode: 'auto' as const,
      progress: 0,
    }
    const updateInput = { title: 'Reviewed homepage', progress: 40 }
    const createResult = { id: MILESTONE_ID, ...createInput }
    const updateResult = { ...createResult, ...updateInput }
    const restoreResult = { ...updateResult, deletedAt: null }
    repositoryHandlers.createMilestone.mockResolvedValue(createResult)
    repositoryHandlers.updateMilestone.mockResolvedValue(updateResult)
    repositoryHandlers.deleteMilestone.mockResolvedValue(undefined)
    repositoryHandlers.restoreMilestone.mockResolvedValue(restoreResult)
    repositoryHandlers.reorderMilestones.mockResolvedValue(undefined)

    const createHandler = (await import('../../server/api/milestones/index.post')).default
    const updateHandler = (await import('../../server/api/milestones/[id].patch')).default
    const deleteHandler = (await import('../../server/api/milestones/[id].delete')).default
    const restoreHandler = (await import('../../server/api/milestones/[id]/restore.post')).default
    const reorderHandler = (await import('../../server/api/milestones/reorder.post')).default

    await expect(createHandler({ body: createInput } as never)).resolves.toEqual(createResult)
    await expect(updateHandler({ body: updateInput, params: { id: MILESTONE_ID } } as never)).resolves.toEqual(updateResult)
    await expect(deleteHandler({ params: { id: MILESTONE_ID } } as never)).resolves.toEqual({ ok: true })
    await expect(restoreHandler({ params: { id: MILESTONE_ID } } as never)).resolves.toEqual(restoreResult)
    await expect(reorderHandler({ body: { projectId: PROJECT_ID, orderedIds: [MILESTONE_ID] } } as never)).resolves.toEqual({ ok: true })

    expect(repositoryHandlers.createMilestone).toHaveBeenCalledExactlyOnceWith(createInput)
    expect(repositoryHandlers.updateMilestone).toHaveBeenCalledExactlyOnceWith(MILESTONE_ID, updateInput)
    expect(repositoryHandlers.deleteMilestone).toHaveBeenCalledExactlyOnceWith(MILESTONE_ID)
    expect(repositoryHandlers.restoreMilestone).toHaveBeenCalledExactlyOnceWith(MILESTONE_ID)
    expect(repositoryHandlers.reorderMilestones).toHaveBeenCalledExactlyOnceWith(PROJECT_ID, [MILESTONE_ID])
  })

  it('rejects an invalid route id before calling the repository', async () => {
    const updateHandler = (await import('../../server/api/milestones/[id].patch')).default

    await expect(updateHandler({ body: { progress: 40 }, params: { id: 'not-a-uuid' } } as never)).rejects.toThrow()
    expect(repositoryHandlers.updateMilestone).not.toHaveBeenCalled()
    expect(workspaceApiMocks.getWorkspaceRepository).not.toHaveBeenCalled()
  })

  it('rejects an empty route patch before calling the repository', async () => {
    const updateHandler = (await import('../../server/api/milestones/[id].patch')).default

    await expect(updateHandler({ body: {}, params: { id: MILESTONE_ID } } as never)).rejects.toThrow()
    expect(repositoryHandlers.updateMilestone).not.toHaveBeenCalled()
    expect(workspaceApiMocks.getWorkspaceRepository).not.toHaveBeenCalled()
  })

  it('validates create, update, and reorder inputs before persistence', async () => {
    const api = await import('../../server/utils/workspace-api')

    expect(api.createMilestoneInputSchema.safeParse({
      projectId: PROJECT_ID,
      title: 'Complete homepage review',
      description: '',
      targetDate: '2026-08-16',
      status: 'planned',
      progressMode: 'auto',
      progress: 0,
    }).success).toBe(true)
    expect(api.createMilestoneInputSchema.safeParse({
      projectId: PROJECT_ID,
      title: 'Invalid progress',
      description: '',
      targetDate: null,
      status: 'planned',
      progressMode: 'manual',
      progress: 101,
    }).success).toBe(false)
    expect(api.updateMilestoneInputSchema.safeParse({}).success).toBe(false)
    expect(api.reorderMilestonesInputSchema.safeParse({
      projectId: PROJECT_ID,
      orderedIds: [MILESTONE_ID, MILESTONE_ID],
    }).success).toBe(false)
  })

  it('preserves project v3 fields and task milestone links in request schemas', async () => {
    const api = await import('../../server/utils/workspace-api')

    expect(api.createProjectInputSchema.parse({
      name: 'Launch',
      color: '#3366FF',
      description: 'Ship the release',
      priority: 'high',
      status: 'active',
      targetDate: '2026-08-31',
    })).toMatchObject({
      description: 'Ship the release',
      priority: 'high',
      status: 'active',
      targetDate: '2026-08-31',
    })
    expect(api.createTaskInputSchema.parse({
      title: 'Ship release',
      description: '',
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      priority: null,
      dueDate: null,
      dueTime: null,
      isFocus: false,
    })).toMatchObject({ milestoneId: MILESTONE_ID })
  })

  it('uses owner-scoped milestone CRUD requests and reorder RPC', async () => {
    const transport = vi.fn(async (url: string) => {
      if (url.includes('?select=')) return []
      if (url.endsWith('/rest/v1/milestones')) return [MILESTONE_ROW]
      if (url.includes('/rest/v1/milestones?id=')) return [{ ...MILESTONE_ROW, progress: 40 }]
      if (url.endsWith('/rest/v1/rpc/restore_milestone')) return [MILESTONE_ROW]
      return null
    })
    const repository = createRepository(transport)

    await repository.createMilestone({
      projectId: PROJECT_ID,
      title: ' Complete homepage review ',
      description: '',
      targetDate: '2026-08-16',
      status: 'planned',
      progressMode: 'auto',
      progress: 0,
    })
    await repository.updateMilestone(MILESTONE_ID, {
      projectId: PROJECT_ID,
      title: ' Reviewed homepage ',
      description: 'Ready to ship',
      targetDate: null,
      status: 'in_progress',
      progressMode: 'manual',
      progress: 40,
    })
    await repository.deleteMilestone(MILESTONE_ID)
    await repository.restoreMilestone(MILESTONE_ID)
    await repository.reorderMilestones(PROJECT_ID, [MILESTONE_ID])

    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/milestones',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          owner_id: DEMO_OWNER_ID,
          project_id: PROJECT_ID,
          title: 'Complete homepage review',
          progress_mode: 'auto',
        }),
      }),
    )
    const createCall = transport.mock.calls.find(([url]) => url === 'https://example.supabase.co/rest/v1/milestones')
    expect(createCall?.[1]?.body).not.toHaveProperty('sort_order')
    expect(transport.mock.calls.filter(([url]) => url.includes('?select='))).toHaveLength(0)
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(`/rest/v1/milestones?id=eq.${MILESTONE_ID}&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
      expect.objectContaining({
        method: 'PATCH',
        body: {
          project_id: PROJECT_ID,
          title: 'Reviewed homepage',
          description: 'Ready to ship',
          target_date: null,
          status: 'in_progress',
          progress_mode: 'manual',
          progress: 40,
        },
      }),
    )
    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/soft_delete_milestone',
      expect.objectContaining({
        method: 'POST',
        body: { p_milestone_id: MILESTONE_ID, p_owner_id: DEMO_OWNER_ID },
      }),
    )
    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/restore_milestone',
      expect.objectContaining({
        method: 'POST',
        body: { p_milestone_id: MILESTONE_ID, p_owner_id: DEMO_OWNER_ID },
      }),
    )
    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/reorder_milestones',
      expect.objectContaining({
        method: 'POST',
        body: {
          p_owner_id: DEMO_OWNER_ID,
          p_project_id: PROJECT_ID,
          p_ordered_ids: [MILESTONE_ID],
        },
      }),
    )
  })
})

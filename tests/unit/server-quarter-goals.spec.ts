import { describe, expect, it, vi } from 'vitest'
import { DEMO_OWNER_ID } from '../../shared/workspace'
import { SupabaseWorkspaceRepository } from '../../server/utils/supabase-workspace-repository'

const GOAL_ID = '30000000-0000-4000-8000-000000000001'
const NOW = '2026-07-29T08:00:00.000Z'
const GOAL_ROW = {
  id: GOAL_ID,
  owner_id: DEMO_OWNER_ID,
  quarter: '2026-Q3',
  title: '季度目标',
  description: '形成稳定闭环',
  progress: 68,
  status: 'active',
  sort_order: 0,
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
}

function createRepository(transport: ReturnType<typeof vi.fn>) {
  return new SupabaseWorkspaceRepository({
    url: 'https://example.supabase.co',
    key: 'server-secret',
    ownerId: DEMO_OWNER_ID,
    transport,
  })
}

describe('server quarter goals', () => {
  it('loads and maps owner-scoped active quarter goals into workspace v3', async () => {
    const transport = vi.fn(async (url: string) => {
      if (url.includes('/projects?') || url.includes('/tasks?')) return []
      if (url.includes('/quarter_goals?')) return [GOAL_ROW]
      if (url.includes('/milestones?') && url.includes('deleted_at=is.null')) return []
      if (url.includes('/milestones?')) return []
      throw new Error(`Unexpected request: ${url}`)
    })
    const repository = createRepository(transport)

    const document = await repository.loadWorkspace()

    expect(document.version).toBe(3)
    expect(document.milestones).toEqual([])
    expect(document.quarterGoals).toEqual([{
      id: GOAL_ID,
      ownerId: DEMO_OWNER_ID,
      quarter: '2026-Q3',
      title: '季度目标',
      description: '形成稳定闭环',
      progress: 68,
      status: 'active',
      sortOrder: 0,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    }])
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(`/rest/v1/quarter_goals?select=*&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
      expect.any(Object),
    )
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(`/rest/v1/milestones?select=*&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
      expect.any(Object),
    )
  })

  it('validates quarter goal input before persistence', async () => {
    const api = await import('../../server/utils/workspace-api')

    expect(api.createQuarterGoalInputSchema).toBeDefined()
    expect(api.updateQuarterGoalInputSchema).toBeDefined()
    expect(api.reorderQuarterGoalsInputSchema).toBeDefined()
    if (!api.createQuarterGoalInputSchema) return

    expect(api.createQuarterGoalInputSchema.safeParse({
      quarter: '2026-Q5',
      title: '目标',
      description: '',
      progress: 20,
      status: 'active',
    }).success).toBe(false)
    expect(api.createQuarterGoalInputSchema.safeParse({
      quarter: '2026-Q3',
      title: '目标',
      description: '',
      progress: 101,
      status: 'active',
    }).success).toBe(false)
    expect(api.updateQuarterGoalInputSchema.safeParse({}).success).toBe(false)
    expect(api.reorderQuarterGoalsInputSchema.safeParse({
      quarter: '2026-Q3',
      orderedIds: [GOAL_ID, GOAL_ID],
    }).success).toBe(false)
  })

  it('uses owner-scoped CRUD writes and the quarter reorder RPC', async () => {
    const transport = vi.fn(async (url: string, options: { method?: string } = {}) => {
      if (url.includes('/projects?') || url.includes('/tasks?')) return []
      if (url.includes('/quarter_goals?select=')) return []
      if (url.includes('/milestones?') && url.includes('deleted_at=is.null')) return []
      if (url.includes('/milestones?')) return []
      if (url.endsWith('/rest/v1/quarter_goals')) return [GOAL_ROW]
      if (url.includes('/rest/v1/quarter_goals?id=')) return [{ ...GOAL_ROW, progress: 80 }]
      return null
    })
    const repository = createRepository(transport)
    const candidate = repository as unknown as Record<string, (...args: any[]) => Promise<any>>

    expect(candidate.createQuarterGoal).toBeTypeOf('function')
    if (!candidate.createQuarterGoal) return

    await candidate.createQuarterGoal({
      quarter: '2026-Q3',
      title: '季度目标',
      description: '形成稳定闭环',
      progress: 68,
      status: 'active',
    })
    await candidate.updateQuarterGoal(GOAL_ID, { progress: 80 })
    await candidate.deleteQuarterGoal(GOAL_ID)
    await candidate.reorderQuarterGoals('2026-Q3', [GOAL_ID])

    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/quarter_goals',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          owner_id: DEMO_OWNER_ID,
          quarter: '2026-Q3',
          progress: 68,
          sort_order: 0,
        }),
      }),
    )
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(`quarter_goals?id=eq.${GOAL_ID}&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
      expect.objectContaining({ method: 'PATCH', body: { progress: 80 } }),
    )
    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/reorder_quarter_goals',
      expect.objectContaining({
        method: 'POST',
        body: {
          p_owner_id: DEMO_OWNER_ID,
          p_quarter: '2026-Q3',
          p_ordered_ids: [GOAL_ID],
        },
      }),
    )
  })
})

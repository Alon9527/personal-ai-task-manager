import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiWorkspaceGateway } from '../../app/data/api-workspace-gateway'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import { createWorkspaceModel } from '../../app/models/workspace-model'

const GOAL_ID = '30000000-0000-4000-8000-000000000099'

describe('quarter goal state adapters', () => {
  beforeEach(() => localStorage.clear())

  it('maps quarter goal writes to Nuxt resource routes', async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: GOAL_ID })
    const gateway = new ApiWorkspaceGateway(fetcher)
    const candidate = gateway as unknown as Record<string, (...args: any[]) => Promise<unknown>>

    expect(candidate.createQuarterGoal).toBeTypeOf('function')
    if (!candidate.createQuarterGoal) return

    await candidate.createQuarterGoal({
      quarter: '2026-Q3',
      title: '目标',
      description: '',
      progress: 20,
      status: 'active',
    })
    await candidate.updateQuarterGoal(GOAL_ID, { progress: 80 })
    await candidate.deleteQuarterGoal(GOAL_ID)
    await candidate.reorderQuarterGoals('2026-Q3', [GOAL_ID])

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/quarter-goals', {
      method: 'POST',
      body: {
        quarter: '2026-Q3',
        title: '目标',
        description: '',
        progress: 20,
        status: 'active',
      },
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, `/api/quarter-goals/${GOAL_ID}`, {
      method: 'PATCH',
      body: { progress: 80 },
    })
    expect(fetcher).toHaveBeenNthCalledWith(3, `/api/quarter-goals/${GOAL_ID}`, {
      method: 'DELETE',
    })
    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/quarter-goals/reorder', {
      method: 'POST',
      body: { quarter: '2026-Q3', orderedIds: [GOAL_ID] },
    })
  })

  it('refreshes goals after create and rolls back a failed optimistic reorder', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, undefined, () => GOAL_ID)
    const model = createWorkspaceModel(gateway)
    const candidate = model as unknown as Record<string, any>
    await model.load()

    expect(candidate.quarterGoals).toBeDefined()
    expect(candidate.createQuarterGoal).toBeTypeOf('function')
    if (!candidate.createQuarterGoal) return

    await candidate.createQuarterGoal({
      quarter: '2026-Q3',
      title: '新目标',
      description: '',
      progress: 0,
      status: 'active',
    })
    expect(candidate.quarterGoals.value.some((goal: { title: string }) => goal.title === '新目标'))
      .toBe(true)

    const before = candidate.quarterGoals.value.map((goal: { id: string }) => goal.id)
    gateway.reorderQuarterGoals = async () => {
      throw new Error('goal order unavailable')
    }
    await expect(candidate.reorderQuarterGoals('2026-Q3', [...before].reverse()))
      .rejects.toThrow('goal order unavailable')

    expect(candidate.quarterGoals.value.map((goal: { id: string }) => goal.id)).toEqual(before)
    expect(model.error.value).toBe('goal order unavailable')
  })
})

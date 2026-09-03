import { describe, expect, it } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import type { QuarterGoal, WorkspaceDocument } from '../../shared/workspace'

const CREATED_AT = '2026-07-22T00:00:00.000Z'

function makeGoal(
  id: string,
  progress: number,
  status: QuarterGoal['status'] = 'active',
): QuarterGoal {
  return {
    id,
    ownerId: '00000000-0000-4000-8000-000000000001',
    quarter: '2026-Q3',
    title: `目标 ${id.slice(-1)}`,
    description: '',
    progress,
    status,
    sortOrder: Number(id.slice(-1)) - 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  }
}

function withGoals(): WorkspaceDocument {
  const document = createDemoWorkspace()
  document.quarterGoals = [
    makeGoal('30000000-0000-4000-8000-000000000001', 10),
    makeGoal('30000000-0000-4000-8000-000000000002', 40),
    makeGoal('30000000-0000-4000-8000-000000000003', 40, 'paused'),
  ]
  return document
}

describe('workspace analytics', () => {
  it('marks only active goals more than twenty points behind quarter time as risk', async () => {
    const domain = await import('../../shared/workspace')
    expect(domain.deriveQuarterMetrics).toBeTypeOf('function')
    if (!domain.deriveQuarterMetrics) return

    const metrics = domain.deriveQuarterMetrics(
      withGoals(),
      '2026-Q3',
      new Date('2026-08-15T00:00:00.000Z'),
    )

    expect(metrics.averageProgress).toBe(30)
    expect(metrics.totalGoals).toBe(3)
    expect(metrics.completedGoals).toBe(0)
    expect(metrics.riskGoalIds).toEqual(['30000000-0000-4000-8000-000000000001'])
    expect(metrics.remainingDays).toBe(47)
  })

  it('derives annual metrics from due year with created year fallback', async () => {
    const domain = await import('../../shared/workspace')
    expect(domain.deriveAnnualReview).toBeTypeOf('function')
    if (!domain.deriveAnnualReview) return

    const document = createDemoWorkspace()
    document.quarterGoals = [
      makeGoal('30000000-0000-4000-8000-000000000001', 72, 'completed'),
      makeGoal('30000000-0000-4000-8000-000000000002', 68),
      makeGoal('30000000-0000-4000-8000-000000000003', 64),
    ]
    document.tasks.push({
      ...document.tasks[0]!,
      id: '20000000-0000-4000-8000-000000000099',
      dueDate: null,
      createdAt: '2025-12-31T23:00:00.000Z',
      completedAt: '2026-01-02T08:00:00.000Z',
    })

    const review = domain.deriveAnnualReview(document, 2026)

    expect(review.annualTaskCount).toBe(7)
    expect(review.completedTaskCount).toBe(2)
    expect(review.completionRate).toBe(29)
    expect(review.averageGoalProgress).toBe(68)
    expect(review.milestoneCount).toBe(3)
    expect(review.quarterTrend).toEqual([
      { quarter: '2026-Q1', progress: 0 },
      { quarter: '2026-Q2', progress: 0 },
      { quarter: '2026-Q3', progress: 68 },
      { quarter: '2026-Q4', progress: 0 },
    ])
    expect(review.projectDistribution).toHaveLength(3)
    expect(review.milestones[0]).toMatchObject({ kind: 'task' })
  })
})

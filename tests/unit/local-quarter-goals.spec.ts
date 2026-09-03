import { beforeEach, describe, expect, it } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'

const NOW = '2026-07-29T08:00:00.000Z'
const GOAL_ID = '30000000-0000-4000-8000-000000000099'

describe('local quarter goals', () => {
  beforeEach(() => localStorage.clear())

  it('seeds three Q3 goals with an average progress of 68', () => {
    const goals = createDemoWorkspace().quarterGoals

    expect(goals).toHaveLength(3)
    expect(goals.map(goal => goal.quarter)).toEqual(['2026-Q3', '2026-Q3', '2026-Q3'])
    expect(goals.reduce((sum, goal) => sum + goal.progress, 0) / goals.length).toBe(68)
  })

  it('persists version 1 data as version 3 without replacing user records', async () => {
    const current = createDemoWorkspace()
    current.projects[0]!.name = '旧版收集箱'
    current.tasks[0]!.title = '旧版用户任务'
    const legacy = {
      version: 1,
      projects: current.projects.slice(0, 1),
      tasks: current.tasks.slice(0, 1),
    }
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(legacy))

    const document = await new LocalWorkspaceGateway(localStorage, () => NOW).loadWorkspace()
    const persisted = JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!)

    expect(document.version).toBe(3)
    expect(document.projects[0]?.name).toBe('旧版收集箱')
    expect(document.tasks[0]?.title).toBe('旧版用户任务')
    expect(document.milestones).toEqual([])
    expect(document.quarterGoals).toEqual([])
    expect(persisted).toMatchObject({ version: 3, milestones: [], quarterGoals: [] })
  })

  it('persists create, update, reorder, and soft delete for quarter goals', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW, () => GOAL_ID)
    expect('createQuarterGoal' in gateway).toBe(true)
    if (!('createQuarterGoal' in gateway)) return

    const created = await gateway.createQuarterGoal({
      quarter: '2026-Q3',
      title: '  完成季度复盘  ',
      description: '形成模板',
      progress: 20,
      status: 'active',
    })
    await gateway.updateQuarterGoal(created.id, { progress: 55, status: 'paused' })

    const ids = (await gateway.loadWorkspace()).quarterGoals
      .filter(goal => goal.quarter === '2026-Q3')
      .map(goal => goal.id)
      .reverse()
    await gateway.reorderQuarterGoals('2026-Q3', ids)
    const reordered = (await gateway.loadWorkspace()).quarterGoals
      .filter(goal => goal.quarter === '2026-Q3')
      .sort((left, right) => left.sortOrder - right.sortOrder)
    expect(reordered.map(goal => goal.id)).toEqual(ids)

    await gateway.deleteQuarterGoal(created.id)

    expect((await gateway.loadWorkspace()).quarterGoals.some(goal => goal.id === created.id)).toBe(false)
    const deleted = (await gateway.loadWorkspace({ includeDeleted: true })).quarterGoals
      .find(goal => goal.id === created.id)
    expect(deleted).toMatchObject({
      title: '完成季度复盘',
      progress: 55,
      status: 'paused',
      deletedAt: NOW,
    })
  })
})

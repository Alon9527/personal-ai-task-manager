import { beforeEach, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import { createWorkspaceModel } from '../../app/models/workspace-model'
import QuarterPage from '../../app/pages/quarter.vue'

describe('secondary dashboard pages', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(createDemoWorkspace()))
  })

  it('renders 2026-Q3 metrics and supports goal actions', async () => {
    const wrapper = await mountSuspended(QuarterPage)
    await vi.waitFor(() => expect(wrapper.find('[data-quarter-dashboard]').exists()).toBe(true))
    await vi.waitFor(() => expect(wrapper.findAll('[data-quarter-goal]')).toHaveLength(3))

    expect((wrapper.get('[data-quarter-select]').element as HTMLSelectElement).value).toBe('2026-Q3')
    expect(wrapper.get('[data-metric="quarter-progress"]').text()).toContain('68%')
    expect(wrapper.get('[data-metric="total-goals"]').text()).toContain('3')

    const firstGoal = wrapper.get('[data-quarter-goal]')
    await firstGoal.get('[data-goal-menu-toggle]').trigger('click')
    expect(firstGoal.find('[data-action="edit"]').exists()).toBe(true)
    expect(firstGoal.find('[data-action="complete"]').exists()).toBe(true)

    await firstGoal.get('[data-action="complete"]').trigger('click')
    await vi.waitFor(() =>
      expect(wrapper.get('[data-metric="completed-goals"]').text()).toContain('1'),
    )
  })

  it('persists status changes and keeps soft-deleted goals recoverable', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()

    const goal = model.quarterGoals.value[0]!
    await model.updateQuarterGoal(goal.id, { status: 'completed' })
    expect(model.quarterGoals.value[0]!.status).toBe('completed')

    await model.deleteQuarterGoal(goal.id)
    expect(model.quarterGoals.value.some(item => item.id === goal.id)).toBe(false)

    const deleted = (await gateway.loadWorkspace({ includeDeleted: true }))
      .quarterGoals.find(item => item.id === goal.id)
    expect(deleted?.deletedAt).not.toBeNull()
  })
})

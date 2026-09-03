import { beforeEach, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { createWorkspaceModel } from '../../app/models/workspace-model'
import { useWorkspaceUi } from '../../app/composables/useWorkspaceUi'
import ReviewPage from '../../app/pages/review.vue'

describe('annual review dashboard', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(createDemoWorkspace()))
  })

  it('renders annual metrics, four-quarter trend, distribution, and milestones', async () => {
    const wrapper = await mountSuspended(ReviewPage)
    await vi.waitFor(() => expect(wrapper.find('[data-review-dashboard]').exists()).toBe(true))
    await vi.waitFor(() =>
      expect(wrapper.get('[data-metric="completed-tasks"]').text()).toContain('2'),
    )

    expect((wrapper.get('[data-year-select]').element as HTMLSelectElement).value).toBe('2026')
    expect(wrapper.findAll('[data-quarter-trend-point]')).toHaveLength(4)
    expect(wrapper.findAll('[data-project-distribution]').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-milestone-timeline]').exists()).toBe(true)
  })

  it('updates the annual summary after workspace data changes', async () => {
    const wrapper = await mountSuspended(ReviewPage)
    await vi.waitFor(() =>
      expect(wrapper.get('[data-metric="completed-tasks"]').text()).toContain('2'),
    )
    const page = wrapper.vm as unknown as {
      workspace: ReturnType<typeof createWorkspaceModel>
    }
    const task = page.workspace.tasks.value.find(item =>
      item.completedAt === null && item.dueDate?.startsWith('2026'),
    )!

    await page.workspace.setTaskCompleted(task.id, true)

    await vi.waitFor(() =>
      expect(wrapper.get('[data-metric="completed-tasks"]').text()).toContain('3'),
    )
  })

  it('offers existing task and goal creation commands for an empty year', async () => {
    const empty = createDemoWorkspace()
    empty.tasks = []
    empty.quarterGoals = []
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(empty))

    const wrapper = await mountSuspended(ReviewPage)
    await vi.waitFor(() => expect(wrapper.find('[data-empty-review-tasks]').exists()).toBe(true))
    expect(wrapper.find('[data-empty-review-goals]').exists()).toBe(true)

    await wrapper.get('[data-create-review-task]').trigger('click')
    await wrapper.get('[data-create-review-goal]').trigger('click')
    const page = wrapper.vm as unknown as {
      ui: ReturnType<typeof useWorkspaceUi>
    }
    expect(page.ui.taskEditor.value.open).toBe(true)
    expect(page.ui.quarterGoalEditor.value).toMatchObject({
      open: true,
      defaultQuarter: '2026-Q3',
    })
  })
})

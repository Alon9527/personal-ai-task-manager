import { beforeEach, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import TodayPage from '../../app/pages/index.vue'

describe('Today functional interactions', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(createDemoWorkspace()))
  })

  it('filters real tasks and switches to a working agenda view', async () => {
    const wrapper = await mountSuspended(TodayPage)
    await vi.waitFor(() => expect(wrapper.findAll('[data-task-row]')).toHaveLength(7))

    await wrapper.get('[aria-label="筛选任务"]').trigger('click')
    await wrapper.get('[data-today-search]').setValue('MiniMax')
    await wrapper.get('[data-today-status]').setValue('active')
    expect(wrapper.findAll('[data-task-row]')).toHaveLength(1)
    expect(wrapper.get('[data-task-row]').text()).toContain('整理 MiniMax API 接入方案')

    await wrapper.get('.view-tabs button:nth-child(2)').trigger('click')
    expect(wrapper.find('[data-agenda-view]').exists()).toBe(true)
    expect(wrapper.findAll('.agenda-task')).toHaveLength(1)
  })

  it('persists collapsed task groups in local storage', async () => {
    const wrapper = await mountSuspended(TodayPage)
    await vi.waitFor(() => expect(wrapper.findAll('[data-task-row]').length).toBeGreaterThan(0))
    await wrapper.get('[aria-label="收起接下来"]').trigger('click')

    await vi.waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('personal-ai-today-groups:v1') ?? '{}')
      expect(saved.next).toBe(true)
    })
  })
})

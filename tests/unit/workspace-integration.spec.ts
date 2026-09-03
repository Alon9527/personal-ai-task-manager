import { beforeEach, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TodayPage from '../../app/pages/index.vue'
import ProjectSidebar from '../../app/components/app/ProjectSidebar.vue'

describe('workspace UI integration', () => {
  beforeEach(() => localStorage.clear())

  it('loads local tasks and persists quick capture', async () => {
    const wrapper = await mountSuspended(TodayPage)

    await vi.waitFor(() => expect(wrapper.find('[data-backend-mode]').exists()).toBe(true))
    expect(wrapper.get('[data-backend-mode]').text()).toContain('本机数据')
    expect(wrapper.findAll('[data-task-row]')).toHaveLength(7)

    await wrapper.get('[data-quick-add] input').setValue('整理本周复盘')
    await wrapper.get('[data-quick-add]').trigger('submit')

    await vi.waitFor(() => expect(wrapper.text()).toContain('整理本周复盘'))
    expect(localStorage.getItem('personal-ai-workspace:v1')).toContain('整理本周复盘')
  })

  it('renders dynamic projects, counts, and project actions', async () => {
    const wrapper = await mountSuspended(ProjectSidebar)

    await vi.waitFor(() => expect(wrapper.findAll('[data-project-row]')).toHaveLength(3))
    expect(wrapper.text()).toContain('个人效率系统')
    expect(wrapper.get('[data-inbox-count]').text()).toMatch(/^[0-9]+$/)

    await wrapper.get('[data-project-menu-toggle]').trigger('click')
    expect(wrapper.get('[aria-label="项目操作"]').text()).toContain('编辑项目')
  })
})

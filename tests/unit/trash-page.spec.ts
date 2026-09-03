import { beforeEach, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import TrashPage from '../../app/pages/trash.vue'

describe('trash page', () => {
  beforeEach(() => {
    localStorage.clear()
    const document = createDemoWorkspace()
    document.tasks[0]!.deletedAt = '2026-08-09T08:00:00.000Z'
    document.milestones.push({
      id: '40000000-0000-4000-8000-000000000001',
      ownerId: document.projects[0]!.ownerId,
      projectId: document.projects[0]!.id,
      title: '准备首个公开版本',
      description: '',
      targetDate: '2026-08-31',
      status: 'planned',
      progressMode: 'auto',
      progress: 0,
      sortOrder: 0,
      createdAt: '2026-08-01T08:00:00.000Z',
      updatedAt: '2026-08-09T08:00:00.000Z',
      deletedAt: '2026-08-09T08:00:00.000Z',
    })
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(document))
  })

  it('lists soft-deleted tasks and restores them', async () => {
    const wrapper = await mountSuspended(TrashPage)
    await vi.waitFor(() => expect(wrapper.findAll('[data-trash-task]')).toHaveLength(1))

    expect(wrapper.text()).toContain('完成个人工作台首页的信息架构')
    await wrapper.get('[data-restore-task]').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[data-trash-task]')).toHaveLength(0))
  })

  it('lists soft-deleted milestones and restores them', async () => {
    const wrapper = await mountSuspended(TrashPage)
    await vi.waitFor(() => expect(wrapper.findAll('[data-trash-milestone]')).toHaveLength(1))

    expect(wrapper.get('[data-trash-milestone]').text()).toContain('准备首个公开版本')
    await wrapper.get('[data-restore-milestone]').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[data-trash-milestone]')).toHaveLength(0))
  })

  it('requires confirmation before permanently emptying the trash', async () => {
    const wrapper = await mountSuspended(TrashPage, {
      global: { stubs: { Teleport: true } },
    })
    await vi.waitFor(() => expect(wrapper.findAll('[data-trash-task]')).toHaveLength(1))

    await wrapper.get('[data-empty-trash]').trigger('click')
    expect(wrapper.get('[data-empty-trash-dialog]').text()).toContain('永久删除 2 项')
    await wrapper.get('[data-confirm-empty-trash]').trigger('click')

    await vi.waitFor(() => expect(wrapper.findAll('[data-trash-task]')).toHaveLength(0))
    expect(wrapper.find('[data-empty-trash]').exists()).toBe(false)
  })
})

import { mountSuspended } from '@nuxt/test-utils/runtime'
import TaskActionsMenu from '../../app/components/workspace/TaskActionsMenu.vue'
import ProjectActionsMenu from '../../app/components/workspace/ProjectActionsMenu.vue'
import { createDemoWorkspace } from '../../app/data/demo-workspace'

describe('workspace action menus', () => {
  it('offers task edit, group move, ordering, and deletion', async () => {
    const task = createDemoWorkspace().tasks.find(item => item.isFocus && item.completedAt === null)!
    const wrapper = await mountSuspended(TaskActionsMenu, {
      props: { task, first: false, last: false },
    })

    expect(wrapper.text()).toContain('移到稍后处理')
    await wrapper.get('[data-action="edit"]').trigger('click')
    await wrapper.get('[data-action="move-down"]').trigger('click')
    await wrapper.get('[data-action="delete"]').trigger('click')

    expect(wrapper.emitted('edit')).toHaveLength(1)
    expect(wrapper.emitted('move-down')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })

  it('disables project movement at list boundaries', async () => {
    const project = createDemoWorkspace().projects[0]!
    const wrapper = await mountSuspended(ProjectActionsMenu, {
      props: { project, first: true, last: false },
    })

    expect(wrapper.get('[data-action="move-up"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-action="move-down"]').attributes('disabled')).toBeUndefined()
  })
})

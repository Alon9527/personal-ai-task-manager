import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import DeleteConfirmDialog from '../../app/components/workspace/DeleteConfirmDialog.vue'
import QuarterGoalActionsMenu from '../../app/components/workspace/QuarterGoalActionsMenu.vue'
import QuarterGoalEditorDialog from '../../app/components/workspace/QuarterGoalEditorDialog.vue'

describe('quarter goal dialogs', () => {
  it('normalizes and submits a quarter goal', async () => {
    const wrapper = await mountSuspended(QuarterGoalEditorDialog, {
      props: { open: true, goal: null, defaultQuarter: '2026-Q3', saving: false },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.get('[name="title"]').setValue('  完成季度复盘  ')
    await wrapper.get('[name="description"]').setValue('形成模板')
    await wrapper.get('[name="progress"]').setValue('68')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      quarter: '2026-Q3',
      title: '完成季度复盘',
      description: '形成模板',
      progress: 68,
      status: 'active',
    })
  })

  it('rejects progress outside zero to one hundred', async () => {
    const wrapper = await mountSuspended(QuarterGoalEditorDialog, {
      props: { open: true, goal: null, defaultQuarter: '2026-Q3', saving: false },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.get('[name="title"]').setValue('目标')
    await wrapper.get('[name="progress"]').setValue('101')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('0 到 100')
  })

  it('offers state, ordering, edit, and soft-delete actions', async () => {
    const wrapper = await mountSuspended(QuarterGoalActionsMenu, {
      props: {
        goal: createDemoWorkspace().quarterGoals[0]!,
        first: false,
        last: false,
      },
    })

    expect(wrapper.find('[data-action="edit"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="complete"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="pause"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="move-up"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="delete"]').exists()).toBe(true)
  })

  it('describes quarter goal deletion as recoverable', async () => {
    const wrapper = await mountSuspended(DeleteConfirmDialog, {
      props: {
        open: true,
        kind: 'quarter-goal',
        name: '完成个人效率系统 1.0',
        affectedTaskCount: 0,
      },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('底层数据仍可恢复')
    expect(wrapper.text()).toContain('季度目标')
  })
})

import { beforeEach, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createDemoWorkspace, DEMO_PROJECT_IDS } from '../../app/data/demo-workspace'
import InboxPage from '../../app/pages/inbox.vue'
import TaskEditorDialog from '../../app/components/workspace/TaskEditorDialog.vue'

describe('inbox dashboard', () => {
  beforeEach(() => {
    localStorage.clear()
    const seed = createDemoWorkspace()
    seed.tasks.find(task => task.title.includes('MiniMax'))!.projectId = DEMO_PROJECT_IDS.inbox
    localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(seed))
  })

  it('derives inbox metrics and filters the real task table', async () => {
    const wrapper = await mountSuspended(InboxPage)
    await vi.waitFor(() => expect(wrapper.findAll('[data-inbox-task]')).toHaveLength(1))

    expect(wrapper.get('[data-metric="unorganized"]').text()).toContain('1')
    expect(wrapper.get('[data-metric="no-project"]').text()).toContain('0')
    expect(wrapper.get('[data-organize-suggestion]').text()).toContain('设置优先级')

    await wrapper.get('[data-filter="search"]').setValue('不存在')
    expect(wrapper.findAll('[data-inbox-task]')).toHaveLength(0)

    await wrapper.get('[data-filter="search"]').setValue('')
    await wrapper.get('[data-filter="priority"]').setValue('high')
    expect(wrapper.findAll('[data-inbox-task]')).toHaveLength(0)
  })

  it('selects all filtered tasks and moves them to the trash after confirmation', async () => {
    const wrapper = await mountSuspended(InboxPage, {
      global: { stubs: { Teleport: true } },
    })

    await vi.waitFor(() => expect(wrapper.findAll('[data-inbox-task]')).toHaveLength(1))
    const taskId = createDemoWorkspace().tasks.find(task => task.title.includes('MiniMax'))!.id

    await wrapper.get('[data-select-all]').setValue(true)
    expect(wrapper.get('[data-inbox-task]').classes()).toContain('selected')
    expect(wrapper.get('[data-bulk-delete]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-bulk-delete]').text()).toContain('(1)')

    await wrapper.get('[data-bulk-delete]').trigger('click')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('之后仍可恢复')
    await wrapper.get('[data-confirm-bulk-delete]').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[data-inbox-task]')).toHaveLength(0))

    const saved = JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!)
    expect(saved.tasks.find((task: { id: string }) => task.id === taskId).deletedAt).toBeTruthy()
  })

  it('defaults task creation to the inbox project', async () => {
    const wrapper = await mountSuspended(TaskEditorDialog, {
      props: {
        open: true,
        task: null,
        projects: createDemoWorkspace().projects,
        defaultProjectId: DEMO_PROJECT_IDS.inbox,
      },
      global: { stubs: { Teleport: true } },
    })

    expect((wrapper.get('[name="projectId"]').element as HTMLSelectElement).value)
      .toBe(DEMO_PROJECT_IDS.inbox)
  })
})

import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceInfoDialog from '../../app/components/workspace/WorkspaceInfoDialog.vue'
import { useWorkspaceUi } from '../../app/composables/useWorkspaceUi'
import { createWorkspaceModel } from '../../app/models/workspace-model'
import { DesktopWorkspaceGateway } from '../../app/data/desktop-workspace-gateway'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import CalendarPage from '../../app/pages/calendar.vue'

const mocks = vi.hoisted(() => ({ workspace: null as any, install: vi.fn(), check: vi.fn() }))
mockNuxtImport('useWorkspace', () => () => mocks.workspace)
vi.mock('../../app/services/app-updater', () => ({ currentAppVersion: async () => '0.3.17', checkDesktopUpdate: mocks.check }))

let ui: ReturnType<typeof useWorkspaceUi>
const Harness = defineComponent({
  components: { WorkspaceInfoDialog, CalendarPage },
  props: { withCalendar: Boolean },
  setup() {
    ui = useWorkspaceUi()
    ui.closeTaskEditor()
    ui.closeProjectEditor()
    ui.closeMilestoneEditor()
    ui.closeQuarterGoalEditor()
    ui.closeDataBridge()
    return { showCalendar: ref(true) }
  },
  template: '<CalendarPage v-if="withCalendar && showCalendar" /><button v-if="withCalendar" data-leave-calendar @click="showCalendar = false">离开日历</button><WorkspaceInfoDialog embedded section="updates" />',
})

describe('workspace update preflight', () => {
  let backupDocument: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    localStorage.clear()
    vi.clearAllMocks()
    let stored = JSON.stringify(createDemoWorkspace())
    backupDocument = vi.fn(async () => undefined)
    mocks.workspace = createWorkspaceModel(new DesktopWorkspaceGateway(localStorage, {
      loadDocument: async () => stored, saveDocument: async next => { stored = next }, backupDocument,
    }))
    await mocks.workspace.load()
    mocks.install.mockResolvedValue(undefined)
    mocks.check.mockResolvedValue({ status: 'available', currentVersion: '0.3.17', version: '0.3.18', date: null, body: null, install: mocks.install })
  })

  it.each(['taskEditor', 'projectEditor', 'milestoneEditor', 'quarterGoalEditor', 'dataBridgeDialog'] as const)('requires saving and closing an open %s before installing', async (editor) => {
    const wrapper = await mountSuspended(Harness, { global: { stubs: { Teleport: true, UIcon: true } } })
    await wrapper.get('[data-update-card] .update-button').trigger('click')
    await flushPromises()
    ui[editor].value.open = true
    await wrapper.get('[data-update-card] .update-button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('请先保存并关闭')
    expect(backupDocument).not.toHaveBeenCalled()
    expect(mocks.install).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('creates a recovery snapshot before invoking the signed installer and retains the write lock', async () => {
    const wrapper = await mountSuspended(Harness, { global: { stubs: { Teleport: true, UIcon: true } } })
    await wrapper.get('[data-update-card] .update-button').trigger('click')
    await flushPromises()
    await wrapper.get('[data-update-card] .update-button').trigger('click')
    await flushPromises()
    expect(backupDocument).toHaveBeenCalledOnce()
    expect(backupDocument.mock.invocationCallOrder[0]).toBeLessThan(mocks.install.mock.invocationCallOrder[0]!)
    expect(mocks.workspace.updateLocked.value).toBe(true)
    wrapper.unmount()
  })

  it('shows a backup failure, never installs, and permits a later retry', async () => {
    backupDocument.mockRejectedValueOnce(new Error('disk full'))
    const wrapper = await mountSuspended(Harness, { global: { stubs: { Teleport: true, UIcon: true } } })
    await wrapper.get('[data-update-card] .update-button').trigger('click')
    await flushPromises()
    await wrapper.get('[data-update-card] .update-button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('备份')
    expect(mocks.install).not.toHaveBeenCalled()
    expect(wrapper.get('[data-update-card] .update-button').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-update-card] .update-button').trigger('click')
    await flushPromises()
    expect(mocks.install).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it.each(['new', 'existing'] as const)('blocks an unsaved %s calendar draft until the inline editor is closed', async mode => {
    const wrapper = await mountSuspended(Harness, { props: { withCalendar: true }, global: { stubs: { Teleport: true, UIcon: true } } })
    try {
      if (mode === 'new') await wrapper.get('.suite-heading .suite-primary').trigger('click')
      else {
        await wrapper.findAll('.suite-segments button').find(button => button.text() === '看板')!.trigger('click')
        await wrapper.get('.suite-kanban button').trigger('click')
      }
      await wrapper.get('.suite-task-detail [name=title]').setValue('日历内尚未保存的草稿')
      expect(ui.taskEditor.value.open).toBe(false)
      await wrapper.get('[data-update-card] .update-button').trigger('click')
      await flushPromises()
      await wrapper.get('[data-update-card] .update-button').trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('请先保存并关闭')
      expect(mocks.install).not.toHaveBeenCalled()
      expect(backupDocument).not.toHaveBeenCalled()
      expect((wrapper.get('.suite-task-detail [name=title]').element as HTMLInputElement).value).toBe('日历内尚未保存的草稿')
      await wrapper.get('.suite-task-detail [aria-label=关闭]').trigger('click')
      await wrapper.get('[data-update-card] .update-button').trigger('click')
      await flushPromises()
      expect(mocks.install).toHaveBeenCalledOnce()
    }
    finally { wrapper.unmount() }
  })

  it.each(['new', 'existing'] as const)('unregisters an active %s calendar editor when its page unmounts', async mode => {
    const wrapper = await mountSuspended(Harness, { props: { withCalendar: true }, global: { stubs: { Teleport: true, UIcon: true } } })
    try {
      if (mode === 'new') await wrapper.get('.suite-heading .suite-primary').trigger('click')
      else {
        await wrapper.findAll('.suite-segments button').find(button => button.text() === '看板')!.trigger('click')
        await wrapper.get('.suite-kanban button').trigger('click')
      }
      await wrapper.get('.suite-task-detail [name=title]').setValue('离开前的内嵌草稿')
      await wrapper.get('[data-update-card] .update-button').trigger('click')
      await flushPromises()
      await wrapper.get('[data-update-card] .update-button').trigger('click')
      await flushPromises()
      expect(mocks.install).not.toHaveBeenCalled()

      await wrapper.get('[data-leave-calendar]').trigger('click')
      expect(wrapper.find('.suite-task-detail').exists()).toBe(false)
      await wrapper.get('[data-update-card] .update-button').trigger('click')
      await flushPromises()
      expect(mocks.install).toHaveBeenCalledOnce()
    }
    finally { wrapper.unmount() }
  })

  it('allows update after saving and closing the calendar draft, and backs up its new content', async () => {
    const wrapper = await mountSuspended(Harness, { props: { withCalendar: true }, global: { stubs: { Teleport: true, UIcon: true } } })
    try {
      await wrapper.get('.suite-heading .suite-primary').trigger('click')
      await wrapper.get('.suite-task-detail [name=title]').setValue('更新前保存的日历草稿')
      await wrapper.get('[data-update-card] .update-button').trigger('click')
      await flushPromises()
      await wrapper.get('[data-update-card] .update-button').trigger('click')
      await flushPromises()
      expect(mocks.install).not.toHaveBeenCalled()

      await wrapper.get('.suite-task-detail form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('.suite-task-detail').exists()).toBe(false)
      await wrapper.get('[data-update-card] .update-button').trigger('click')
      await flushPromises()
      expect(mocks.install).toHaveBeenCalledOnce()
      expect(JSON.parse(backupDocument.mock.calls[0]![0]).tasks.some((task: { title: string }) => task.title === '更新前保存的日历草稿')).toBe(true)
    }
    finally { wrapper.unmount() }
  })
})

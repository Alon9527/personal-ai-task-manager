import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, nextTick } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createWorkspaceModel } from '../../app/models/workspace-model'
import { LocalWorkspaceGateway, LOCAL_WORKSPACE_STORAGE_KEY } from '../../app/data/local-workspace-gateway'
import { useWorkspaceUi } from '../../app/composables/useWorkspaceUi'
const injected = vi.hoisted(() => ({ workspace: null as ReturnType<typeof createWorkspaceModel> | null }))
mockNuxtImport('useWorkspace', () => () => injected.workspace)
import WorkspaceOverlays from '../../app/components/workspace/WorkspaceOverlays.vue'
import TaskEditorDialog from '../../app/components/workspace/TaskEditorDialog.vue'
import CalendarPage from '../../app/pages/calendar.vue'

const wrappers: Array<{ unmount(): void }> = []
let gateway: LocalWorkspaceGateway
beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify({ version: 3, projects: [], tasks: [], milestones: [], quarterGoals: [] }))
  gateway = new LocalWorkspaceGateway(localStorage)
  injected.workspace = createWorkspaceModel(gateway)
  await injected.workspace.load()
  useWorkspaceUi().openNewTask()
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); vi.useRealTimers() })

async function mountEditor() {
  const wrapper = await mountSuspended(WorkspaceOverlays, { global: { stubs: {
    Teleport: true, ProjectEditorDialog: true, MilestoneEditorDialog: true, QuarterGoalEditorDialog: true,
    DeleteConfirmDialog: true, DataBridgeDialog: true, WorkspaceCommandPalette: true, WorkspaceInfoDialog: true,
  }, config: { errorHandler: () => { /* The assertions check visible failure and retry. */ } } } })
  wrappers.push(wrapper)
  await wrapper.get('[name=title]').setValue('只能创建一次')
  return wrapper
}

it.each([false, true])('keeps the focus toggle in the fixed header (embedded=%s)', async embedded => {
  const saving = ref(false)
  const Host = defineComponent({ setup: () => () => h(TaskEditorDialog, { open: true, task: null, projects: [], milestones: [], embedded, saving: saving.value }) })
  const wrapper = await mountSuspended(Host, { global: { stubs: { Teleport: true } } })
  wrappers.push(wrapper)
  expect(wrapper.findAll('[name=isFocus]')).toHaveLength(1)
  const focus = wrapper.get('.dialog-header [name=isFocus]')
  await focus.setValue(true)
  await wrapper.get('[name=title]').setValue('置顶测试')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.findComponent(TaskEditorDialog).emitted('save')?.[0]?.[0]).toMatchObject({ isFocus: true })
  saving.value = true; await nextTick()
  expect(wrapper.findComponent(TaskEditorDialog).props('saving')).toBe(true)
  expect(wrapper.get('.dialog-header [name=isFocus]').attributes('disabled')).toBeDefined()
})

it('coalesces two immediate editor submissions into one persisted task', async () => {
  const wrapper = await mountEditor()
  const create = vi.spyOn(gateway, 'createTask')
  const form = wrapper.get('form').element
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await flushPromises()
  expect(create).toHaveBeenCalledTimes(1)
  expect((await gateway.loadWorkspace()).tasks.map(t => t.title)).toEqual(['只能创建一次'])
})

it('shows saving and locks form, close and duplicate save until persistence completes', async () => {
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const original = gateway.createTask.bind(gateway)
  vi.spyOn(gateway, 'createTask').mockImplementation(async input => { await pending; return original(input) })
  const wrapper = await mountEditor()
  await wrapper.get('form').trigger('submit')
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('button[type=submit]').text()).toBe('保存中…')
  expect(wrapper.get('form').attributes('inert')).toBeDefined()
  await wrapper.get('[aria-label=关闭]').trigger('click')
  expect(useWorkspaceUi().taskEditor.value.open).toBe(true)
  finish(); await flushPromises()
  expect(useWorkspaceUi().taskEditor.value.open).toBe(false)
})

it('retains the draft after failure and permits an explicit retry', async () => {
  const wrapper = await mountEditor()
  const original = gateway.createTask.bind(gateway)
  vi.spyOn(gateway, 'createTask').mockRejectedValueOnce(new Error('测试保存失败')).mockImplementation(original)
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(useWorkspaceUi().taskEditor.value.open).toBe(true)
  expect((wrapper.get('[name=title]').element as HTMLInputElement).value).toBe('只能创建一次')
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  expect(wrapper.findComponent(TaskEditorDialog).text()).toContain('测试保存失败')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect((await gateway.loadWorkspace()).tasks).toHaveLength(1)
})

it('loads the newly selected task after an earlier editor save finishes', async () => {
  const fields = { description: '', projectId: null, milestoneId: null, priority: null, dueDate: null, dueTime: null, isFocus: false }
  const taskA = await gateway.createTask({ ...fields, title: '任务 A' })
  const taskB = await gateway.createTask({ ...fields, title: '任务 B' })
  await injected.workspace!.load()
  useWorkspaceUi().openEditTask(taskA.id)
  const wrapper = await mountEditor()
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const original = gateway.updateTask.bind(gateway)
  vi.spyOn(gateway, 'updateTask').mockImplementationOnce(async (id, input) => { await pending; return original(id, input) })
  await wrapper.get('form').trigger('submit')
  useWorkspaceUi().openEditTask(taskB.id)
  await flushPromises()
  finish(); await flushPromises()
  expect(useWorkspaceUi().taskEditor.value.taskId).toBe(taskB.id)
  expect((wrapper.get('[name=title]').element as HTMLInputElement).value).toBe('任务 B')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect((await gateway.loadWorkspace()).tasks.find(task => task.id === taskB.id)?.title).toBe('任务 B')
})

it('starts a fresh draft when another new-task session opens during a slow create', async () => {
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const original = gateway.createTask.bind(gateway)
  vi.spyOn(gateway, 'createTask').mockImplementationOnce(async input => { await pending; return original(input) })
  const wrapper = await mountEditor()
  await wrapper.get('form').trigger('submit')
  useWorkspaceUi().openNewTask()
  await flushPromises()
  finish(); await flushPromises()
  expect(useWorkspaceUi().taskEditor.value.open).toBe(true)
  expect((wrapper.get('[name=title]').element as HTMLInputElement).value).toBe('')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect((await gateway.loadWorkspace()).tasks).toHaveLength(1)
})

it.each([false, true])('does not emit save or close while saving (embedded=%s)', async embedded => {
  const wrapper = await mountSuspended(TaskEditorDialog, {
    props: { open: true, task: null, projects: [], embedded, saving: true },
    global: { stubs: { Teleport: true } },
  })
  wrappers.push(wrapper)
  await wrapper.get('[name=title]').setValue('草稿')
  await wrapper.get('form').trigger('submit')
  await wrapper.get('[aria-label=关闭]').trigger('click')
  expect(wrapper.emitted('save')).toBeUndefined()
  expect(wrapper.emitted('close')).toBeUndefined()
  expect(wrapper.get('form').attributes('inert')).toBeDefined()
})

it('calendar new-task default follows the current local day after resume', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 28, 23, 59, 50))
  const wrapper = await mountSuspended(CalendarPage)
  wrappers.push(wrapper)
  vi.setSystemTime(new Date(2026, 9, 29, 8, 0, 0))
  window.dispatchEvent(new Event('focus'))
  await wrapper.get('.suite-heading .suite-primary').trigger('click')
  expect((wrapper.get('[name=dueDate]').element as HTMLInputElement).value).toBe('2026-10-29')
})

it('calendar passes its pending save state into the inline task editor', async () => {
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const original = gateway.createTask.bind(gateway)
  vi.spyOn(gateway, 'createTask').mockImplementation(async input => { await pending; return original(input) })
  const wrapper = await mountSuspended(CalendarPage)
  wrappers.push(wrapper)
  await wrapper.get('.suite-heading .suite-primary').trigger('click')
  await wrapper.get('[name=title]').setValue('日历任务')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('button[type=submit]').text()).toBe('保存中…')
  finish(); await flushPromises()
  expect((await gateway.loadWorkspace()).tasks).toHaveLength(1)
})

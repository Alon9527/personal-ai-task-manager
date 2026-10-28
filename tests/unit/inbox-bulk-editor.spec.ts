import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { createWorkspaceModel } from '../../app/models/workspace-model'
import { LocalWorkspaceGateway, LOCAL_WORKSPACE_STORAGE_KEY } from '../../app/data/local-workspace-gateway'
const injected = vi.hoisted(() => ({ workspace: null as any }))
mockNuxtImport('useWorkspace', () => () => injected.workspace)
import InboxPage from '../../app/pages/inbox.vue'
const wrappers: Array<{ unmount(): void }> = []
let gateway: LocalWorkspaceGateway, ids: string[], project: string
beforeEach(async () => {
  localStorage.clear()
  const doc = createDemoWorkspace(); doc.tasks = doc.tasks.slice(0, 4)
  for (const task of doc.tasks) { task.projectId = null; task.milestoneId = null }
  ids = doc.tasks.map(t => t.id); project = doc.projects.find(p => p.name !== '收集箱')!.id
  localStorage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, JSON.stringify(doc))
  gateway = new LocalWorkspaceGateway(localStorage)
  injected.workspace = createWorkspaceModel(gateway); await injected.workspace.load()
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks() })
async function openSelected() {
  const wrapper = await mountSuspended(InboxPage, { global: { stubs: { Teleport: true, VoiceInputButton: true } } })
  wrappers.push(wrapper)
  for (const checkbox of wrapper.findAll('[data-task-select]').slice(0, 3)) await checkbox.setValue(true)
  await wrapper.get('[data-organize-suggestion]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-bulk-editor]').text()).toContain('统一编辑 3 项任务')
  await wrapper.get('[data-enable-field="projectId"]').setValue(true)
  await wrapper.get('[data-bulk-project]').setValue(project)
  return wrapper
}
it('applies a selected row organize action to every selected task, even after they leave the inbox', async () => {
  const wrapper = await openSelected()
  const replace = vi.spyOn(injected.workspace, 'replaceWorkspaceDocument')
  await wrapper.get('[data-bulk-editor] form').trigger('submit'); await flushPromises()
  const saved = await gateway.loadWorkspace()
  expect(saved.tasks.filter(t => t.projectId === project).map(t => t.id)).toEqual(ids.slice(0, 3))
  expect(saved.tasks.find(t => t.id === ids[3])?.projectId).toBeNull()
  expect(replace).toHaveBeenCalledTimes(1)
  expect(wrapper.find('[data-bulk-editor]').exists()).toBe(false)
  expect(wrapper.findAll('[data-inbox-task]')).toHaveLength(1)
})
it('retains the dialog and all tasks when another edit makes the snapshot stale', async () => {
  const wrapper = await openSelected()
  await injected.workspace.updateTask(ids[0], { title: '另一处已更新' })
  await wrapper.get('[data-bulk-editor] form').trigger('submit'); await flushPromises()
  expect(wrapper.get('[data-bulk-editor] [role=alert]').text()).toContain('变化')
  expect((await gateway.loadWorkspace()).tasks.every(t => t.projectId === null)).toBe(true)
})

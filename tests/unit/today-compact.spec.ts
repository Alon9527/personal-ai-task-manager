import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createDenseToday } from '../fixtures/today-dense'
import { createWorkspaceModel } from '../../app/models/workspace-model'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
const injected = vi.hoisted(() => ({ workspace:null as ReturnType<typeof createWorkspaceModel> | null }))
vi.mock('../../app/composables/useWorkspace', () => ({ useWorkspace:() => injected.workspace }))
import SuiteToday from '../../app/components/suite/SuiteToday.vue'
import SuiteTaskRow from '../../app/components/suite/SuiteTaskRow.vue'
const wrappers: Array<{unmount:()=>void}> = []
async function mountToday() {
  const wrapper = await mountSuspended(SuiteToday)
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(createDenseToday()))
  injected.workspace = createWorkspaceModel(new LocalWorkspaceGateway(localStorage))
  await injected.workspace.load()
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks() })
it('shows all 24 active tasks and defaults 29 completed tasks to collapsed', async () => {
  const w = await mountToday()
  expect(w.findAll('[data-today-section="next"] [data-task-row]')).toHaveLength(1)
  expect(w.findAll('[data-today-section="other"] [data-task-row]')).toHaveLength(23)
  expect(w.get('[data-today-section="completed"] header').text()).toContain('29')
  expect(w.findAll('[data-today-section="completed"] [data-task-row]')).toHaveLength(0)
  expect(w.get('[aria-label="展开已完成"]').attributes('aria-expanded')).toBe('false')
})
it('places one quick capture before the task groups, after controls', async () => {
  const w = await mountToday()
  expect(w.findAll('[data-quick-add]')).toHaveLength(1)
  const markup = w.html()
  expect(markup.indexOf('today-controls')).toBeLessThan(markup.indexOf('data-quick-add'))
  expect(markup.indexOf('data-quick-add')).toBeLessThan(markup.indexOf('data-today-section'))
})
it('retains independent saved group choices and supports all completed rows', async () => {
  const w = await mountToday()
  await w.get('[aria-label="展开已完成"]').trigger('click')
  await w.get('[aria-label="收起其他待办"]').trigger('click')
  expect(w.findAll('[data-today-section="completed"] [data-task-row]')).toHaveLength(29)
  expect(w.findAll('[data-today-section="next"] [data-task-row]')).toHaveLength(1)
  expect(JSON.parse(localStorage.getItem('personal-ai-today-groups:v2')!)).toEqual({next:false,other:true,completed:false})
  w.unmount()
  const again = await mountToday()
  expect(again.get('[aria-label="展开其他待办"]').exists()).toBe(true)
  expect(again.findAll('[data-today-section="completed"] [data-task-row]')).toHaveLength(29)
})
it('completes and restores the same task ID through the existing workspace', async () => {
  const w = await mountToday()
  const id = createDenseToday().tasks[1]!.id
  await w.get('[aria-label="完成 碳棉三维视频"]').trigger('click'); await flushPromises()
  expect(injected.workspace!.tasks.value.find(t=>t.id===id)?.status).toBe('done')
  expect(w.get('[data-today-section="completed"] header').text()).toContain('30')
  await w.get('[aria-label="展开已完成"]').trigger('click')
  await w.get('[aria-label="恢复 碳棉三维视频"]').trigger('click'); await flushPromises()
  expect(injected.workspace!.tasks.value.find(t=>t.id===id)?.status).toBe('todo')
})
it('uses compact rows only outside focus and hides empty metadata with a usable action disclosure', async () => {
  const w = await mountToday()
  const row = w.get('[data-today-section="other"] [data-task-row]')
  expect(row.classes()).toContain('is-compact')
  expect(row.text()).not.toContain('未安排日期')
  expect(row.get('.suite-task-title').attributes('title')).toContain('碳棉三维视频')
  expect(row.get('summary').attributes('aria-label')).toBe('更多操作 碳棉三维视频')
  expect(row.find('[data-task-delete]').exists()).toBe(true)
  expect(w.get('[data-today-section="next"] [data-task-row]').classes()).not.toContain('is-compact')
})
it('does not change shared row default controls used by other pages', async () => {
  const w = await mountSuspended(SuiteTaskRow,{props:{task:createDenseToday().tasks[1]!}}); wrappers.push(w)
  expect(w.find('summary').exists()).toBe(false)
  expect(w.get('[aria-label="删除 碳棉三维视频"]').exists()).toBe(true)
})
it('migrates valid legacy choices without sharing future writes with the old page', async () => {
  localStorage.setItem('personal-ai-today-groups:v1',JSON.stringify({next:true,other:false,completed:false}))
  const w=await mountToday()
  expect(w.get('[aria-label="展开今日重点"]').exists()).toBe(true)
  expect(w.findAll('[data-today-section="completed"] [data-task-row]')).toHaveLength(29)
  await w.get('[aria-label="收起已完成"]').trigger('click')
  expect(JSON.parse(localStorage.getItem('personal-ai-today-groups:v1')!).completed).toBe(false)
  expect(JSON.parse(localStorage.getItem('personal-ai-today-groups:v2')!).completed).toBe(true)
})
it('ignores corrupted group preferences and still renders all pending tasks', async () => {
  localStorage.setItem('personal-ai-today-groups:v2','not JSON')
  const w=await mountToday()
  expect(w.findAll('[data-today-section="other"] [data-task-row]')).toHaveLength(23)
  expect(w.get('[aria-label="展开已完成"]').exists()).toBe(true)
})

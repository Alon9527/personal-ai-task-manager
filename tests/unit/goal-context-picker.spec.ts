import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ chat: null as any, workspace: null as any }))
vi.mock('../../app/composables/useAgentConversation', () => ({ useAgentConversation: () => state.chat }))
vi.mock('../../app/composables/useWorkspace', () => ({ useWorkspace: () => state.workspace }))
import GoalContextPicker from '../../app/components/agent/GoalContextPicker.vue'
beforeEach(() => {
  state.chat = { goalIds: ref(['q1']), year: ref(2026), busy: ref(false), plan: { executing: ref(false) } }
  state.workspace = { quarterGoals: ref([
    { id:'q1', quarter:'2026-Q1', title:'同名目标', description:'试点', progress:10, deletedAt:null },
    { id:'q4', quarter:'2026-Q4', title:'同名目标', description:'推广', progress:20, deletedAt:null },
    { id:'next', quarter:'2027-Q1', title:'明年目标', description:'', progress:0, deletedAt:null },
    { id:'deleted', quarter:'2026-Q2', title:'已删除', deletedAt:'2026-01-01' },
  ]) }
})
async function open() {
  const w = await mountSuspended(GoalContextPicker, { attachTo: document.body })
  await w.get('[data-goal-picker]').trigger('click'); await flushPromises()
  return w
}
function dialog() { return document.querySelector('dialog')! }
function click(name: string) { const b = [...dialog().querySelectorAll('button')].find(b => b.textContent?.trim() === name)!; b.click() }
function check(id: string) { const el = dialog().querySelector<HTMLInputElement>(`input[value="${id}"]`)!; el.click() }
it('stages selection, cancels without mutation and commits by exact ID', async () => {
  const w = await open(); check('q4'); await flushPromises()
  expect(state.chat.goalIds.value).toEqual(['q1']); click('取消'); await flushPromises()
  await w.get('[data-goal-picker]').trigger('click'); await flushPromises()
  expect(dialog().querySelector<HTMLInputElement>('input[value="q4"]')!.checked).toBe(false)
  check('q4'); await flushPromises(); click('确认引用'); await flushPromises()
  expect(state.chat.goalIds.value).toEqual(['q1','q4']); w.unmount()
})
it('filters by year/quarter/title without dropping selected IDs and hides technical IDs', async () => {
  const w = await open(); click('Q4'); await flushPromises()
  expect(dialog().querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
  check('q4'); await flushPromises()
  const year = dialog().querySelector('input[type="number"]') as HTMLInputElement
  year.value = '2027'; year.dispatchEvent(new Event('input')); click('全部'); await flushPromises()
  expect(dialog().textContent).toContain('明年目标'); expect(dialog().textContent).not.toContain('已删除')
  expect(dialog().textContent).not.toContain('q4')
  check('next'); await flushPromises(); click('确认引用'); await flushPromises()
  expect(state.chat.goalIds.value).toEqual(['q1','q4','next']); expect(state.chat.year.value).toBe(2027); w.unmount()
})
it('blocks in-flight changes and removes a deleted reference with a notice', async () => {
  const w = await open(); check('q4'); await flushPromises()
  state.chat.busy.value = true; await flushPromises()
  expect([...dialog().querySelectorAll('button')].find(b=>b.textContent==='确认引用')!.disabled).toBe(true)
  state.chat.busy.value=false; state.workspace.quarterGoals.value[1].deletedAt='now'; await flushPromises()
  click('确认引用'); await flushPromises()
  expect(state.chat.goalIds.value).toEqual(['q1']); expect(w.text()).toContain('失效'); w.unmount()
})
it('native Escape cancellation preserves selection and returns focus', async () => {
  const w = await open(); check('q4'); await flushPromises()
  dialog().dispatchEvent(new Event('cancel', {cancelable:true})); await flushPromises()
  expect(state.chat.goalIds.value).toEqual(['q1'])
  expect(document.activeElement).toBe(w.get('[data-goal-picker]').element); w.unmount()
})
it('blocks invalid years and more than 80 selected references without changing confirmed context',async()=>{
  state.chat.goalIds.value=Array.from({length:81},(_,i)=>`reference-${i}`)
  const w=await open();await flushPromises()
  const confirm=[...dialog().querySelectorAll('button')].find(b=>b.textContent==='确认引用')!
  expect(confirm.disabled).toBe(true);expect(dialog().textContent).toContain('最多优先引用 80 项')
  click('取消');await flushPromises();state.chat.goalIds.value=['q1']
  await w.get('[data-goal-picker]').trigger('click');await flushPromises()
  const year=dialog().querySelector<HTMLInputElement>('input[type=number]')!
  year.value='1900';year.dispatchEvent(new Event('input'));await flushPromises()
  expect(confirm.disabled).toBe(true);expect(state.chat.year.value).toBe(2026)
  w.unmount()
})

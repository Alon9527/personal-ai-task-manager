import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDenseToday } from '../fixtures/today-dense'
import { createWorkspaceModel } from '../../app/models/workspace-model'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'
import { deriveTodayLanes, filterAndSortTasks, type TodayFilters } from '../../app/utils/today-view'
import type { Task } from '../../shared/workspace'

const injected = vi.hoisted(() => ({ workspace: null as ReturnType<typeof createWorkspaceModel> | null }))
vi.mock('../../app/composables/useWorkspace', () => ({ useWorkspace: () => injected.workspace }))
import SuiteToday from '../../app/components/suite/SuiteToday.vue'

const filters: TodayFilters = { query: '', projectId: null, priority: 'all', status: 'all' }
const wrappers: Array<{ unmount: () => void }> = []
function task(index: number, overrides: Partial<Task> = {}): Task {
  return { ...createDenseToday().tasks[index]!, isFocus: false, importance: 'normal', status: 'todo', completedAt: null, dueDate: null, ...overrides }
}
async function mountToday(tasks: Task[]) {
  const document = { ...createDenseToday(), tasks }
  localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(document))
  injected.workspace = createWorkspaceModel(new LocalWorkspaceGateway(localStorage))
  await injected.workspace.load()
  const wrapper = await mountSuspended(SuiteToday)
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date(2026, 9, 28, 23, 59, 59))
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Today saved ordering and terminal states', () => {
  it('sorts manual order by saved sortOrder, preserves ties, and does not mutate input', () => {
    const tasks = [task(0, { sortOrder: 7 }), task(1, { sortOrder: 1 }), task(2, { sortOrder: 1 })]
    expect(filterAndSortTasks(tasks, filters, 'manual').map(item => item.id)).toEqual([tasks[1]!.id, tasks[2]!.id, tasks[0]!.id])
    expect(tasks.map(item => item.sortOrder)).toEqual([7, 1, 1])
  })

  it('keeps cancelled and done-without-timestamp tasks out of active filtering', () => {
    const tasks = [task(0), task(1, { status: 'cancelled' }), task(2, { status: 'done' })]
    expect(filterAndSortTasks(tasks, { ...filters, status: 'active' }, 'manual').map(item => item.id)).toEqual([tasks[0]!.id])
  })

  it('counts explicit and legacy completions, excluding cancelled and deleted tasks', () => {
    const stamp = '2026-10-28T08:00:00.000Z'
    const tasks = [task(0, { status: 'done' }), task(1, { completedAt: stamp }), task(2, { status: 'cancelled', completedAt: stamp }), task(3, { status: 'done', completedAt: stamp, deletedAt: stamp })]
    expect(filterAndSortTasks(tasks, { ...filters, status: 'completed' }, 'manual').map(item => item.id)).toEqual([tasks[0]!.id, tasks[1]!.id])
    expect(deriveTodayLanes(tasks).completedTasks.map(item => item.id)).toEqual([tasks[0]!.id, tasks[1]!.id])
  })

  it('supports a cancelled-only filter without removing cancelled task data', () => {
    const tasks = [task(0), task(1, { status: 'cancelled' }), task(2, { status: 'done' })]
    expect(filterAndSortTasks(tasks, { ...filters, status: 'cancelled' }, 'manual').map(item => item.id)).toEqual([tasks[1]!.id])
    expect(tasks).toHaveLength(3)
  })

  it('renders the saved manual order after loading persisted tasks', async () => {
    const first = task(0, { title: 'A', sortOrder: 1 })
    const second = task(1, { title: 'B', sortOrder: 0 })
    const wrapper = await mountToday([first, second])
    expect(wrapper.findAll('[data-task-row]').map(row => row.attributes('data-task-id'))).toEqual([second.id, first.id])
  })

  it('excludes cancellation from completed counts and provides an editable cancelled filter', async () => {
    const done = task(0, { title: '完成任务', status: 'done', completedAt: '2026-10-28T08:00:00.000Z' })
    const cancelled = task(1, { title: '取消任务', status: 'cancelled' })
    const wrapper = await mountToday([done, cancelled])
    expect(wrapper.get('[data-today-section="completed"] header small').text()).toBe('1')
    await wrapper.get('[aria-label="筛选任务"]').trigger('click')
    expect(wrapper.get('[data-today-status] option[value="cancelled"]').text()).toBe('已取消')
    await wrapper.get('[data-today-status]').setValue('cancelled')
    await wrapper.get('[aria-label="展开已取消"]').trigger('click')
    expect(wrapper.findAll('[data-task-row]')).toHaveLength(1)
    expect(wrapper.get('[data-task-row]').attributes('data-task-id')).toBe(cancelled.id)
    expect(wrapper.get('[aria-label="编辑 取消任务"]').exists()).toBe(true)
    expect(injected.workspace!.tasks.value).toHaveLength(2)
  })
})

describe('Today local clock', () => {
  it('updates heading, agenda, daily overview and quick-add date across local midnight', async () => {
    const tomorrow = task(0, { title: '翌日任务', dueDate: '2026-10-29' })
    const wrapper = await mountToday([tomorrow])
    await wrapper.get('.view-tabs button:nth-child(2)').trigger('click')
    expect(wrapper.get('[data-agenda-view] h2').text()).not.toBe('今天')
    expect(wrapper.get('.focus-overview').text()).not.toContain(tomorrow.title)

    await vi.advanceTimersByTimeAsync(1_000)
    await nextTick()
    expect(wrapper.get('.suite-today-title time').text()).toBe(new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }))
    expect(wrapper.get('[data-agenda-view] h2').text()).toBe('今天')
    expect(wrapper.get('.focus-overview').text()).toContain(tomorrow.title)
    await wrapper.get('[aria-label="快速添加任务"]').setValue('跨日新增')
    await wrapper.get('[data-quick-add]').trigger('submit')
    await flushPromises()
    expect(injected.workspace!.tasks.value.find(item => item.title === '跨日新增')?.dueDate).toBe('2026-10-29')
  })

  it('refreshes the local date immediately on window focus after suspension', async () => {
    const wrapper = await mountToday([task(0, { dueDate: '2026-10-30' })])
    await wrapper.get('.view-tabs button:nth-child(2)').trigger('click')
    vi.setSystemTime(new Date(2026, 9, 30, 9))
    window.dispatchEvent(new Event('focus'))
    await nextTick()
    expect(wrapper.get('[data-agenda-view] h2').text()).toBe('今天')
  })

  it('refreshes date and pending reminders when the document becomes visible again', async () => {
    const wrapper = await mountToday([task(0, { dueDate: '2026-10-30', reminderAt: new Date(2026, 9, 29, 8).toISOString() })])
    expect(wrapper.get('.suite-metrics article:nth-child(2) strong').text()).toBe('1')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.setSystemTime(new Date(2026, 9, 30, 9))
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    expect(wrapper.get('.suite-metrics article:nth-child(2) strong').text()).toBe('1')
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    expect(wrapper.get('.suite-metrics article:nth-child(2) strong').text()).toBe('0')
  })

  it('refreshes pending reminder counts while the page stays open', async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 12))
    const wrapper = await mountToday([task(0, { reminderAt: new Date(2026, 9, 28, 12, 0, 1).toISOString() })])
    expect(wrapper.get('.suite-metrics article:nth-child(2) strong').text()).toBe('1')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(wrapper.get('.suite-metrics article:nth-child(2) strong').text()).toBe('0')
  })

  it('uses the actual date for quick-add even before a timer or resume event runs', async () => {
    const wrapper = await mountToday([])
    vi.setSystemTime(new Date(2026, 9, 29, 0, 0, 1))
    await wrapper.get('[aria-label="快速添加任务"]').setValue('即时日期')
    await wrapper.get('[data-quick-add]').trigger('submit')
    await flushPromises()
    expect(injected.workspace!.tasks.value[0]?.dueDate).toBe('2026-10-29')
  })

  it('releases its refresh timer and resume listeners when unmounted', async () => {
    const addWindow = vi.spyOn(window, 'addEventListener')
    const addDocument = vi.spyOn(document, 'addEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    const setTimer = vi.spyOn(globalThis, 'setTimeout')
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout')
    const wrapper = await mountToday([])
    const focusListener = addWindow.mock.calls.find(([name]) => name === 'focus')?.[1]
    const visibilityListener = addDocument.mock.calls.find(([name]) => name === 'visibilitychange')?.[1]
    expect(focusListener).toBeTypeOf('function')
    expect(visibilityListener).toBeTypeOf('function')
    const refreshTimerIndex = setTimer.mock.calls.findIndex(([callback]) => callback === focusListener)
    expect(refreshTimerIndex).toBeGreaterThanOrEqual(0)
    const refreshTimer = setTimer.mock.results[refreshTimerIndex]!.value
    wrapper.unmount()
    expect(removeWindow).toHaveBeenCalledWith('focus', focusListener)
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', visibilityListener)
    expect(clearTimer).toHaveBeenCalledWith(refreshTimer)
    const scheduledRefreshes = () => setTimer.mock.calls.filter(([callback]) => callback === focusListener).length
    const scheduledBefore = scheduledRefreshes()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(scheduledRefreshes()).toBe(scheduledBefore)
  })
})

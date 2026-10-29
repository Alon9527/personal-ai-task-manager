import { createDemoWorkspace, DEMO_PROJECT_IDS } from '../../app/data/demo-workspace'
import { createDenseToday } from '../fixtures/today-dense'
import { deriveTodayLanes, filterAndSortTasks, getCurrentQuarter, getTodayDateInput, type TodayFilters } from '../../app/utils/today-view'

const emptyFilters: TodayFilters = {
  query: '',
  projectId: null,
  priority: 'all',
  status: 'all',
}

describe('Today functional view helpers', () => {
  it('groups arbitrary project IDs in supplied sidebar order without changing manual task order', () => {
    const base = createDenseToday().tasks[1]!
    const tasks = [
      { ...base, id: 'a-late', projectId: 'a', sortOrder: 5 },
      { ...base, id: 'none', projectId: null, sortOrder: 0 },
      { ...base, id: 'b-late', projectId: 'b', sortOrder: 4 },
      { ...base, id: 'a-early', projectId: 'a', sortOrder: 2 },
      { ...base, id: 'b-early', projectId: 'b', sortOrder: 1 },
      { ...base, id: 'missing', projectId: 'removed', sortOrder: 3 },
    ]
    const before = JSON.stringify(tasks)
    const projects = [{ id: 'b' }, { id: 'a' }]
    expect(filterAndSortTasks(tasks, emptyFilters, 'project', projects).map(t => t.id))
      .toEqual(['b-early', 'b-late', 'a-early', 'a-late', 'none', 'missing'])
    expect(JSON.stringify(tasks)).toBe(before)
    expect(filterAndSortTasks(tasks, emptyFilters, 'manual').map(t => t.id))
      .toEqual(['none', 'b-early', 'a-early', 'missing', 'b-late', 'a-late'])
    expect(filterAndSortTasks(tasks, { ...emptyFilters, projectId: 'a' }, 'project', projects).map(t => t.id))
      .toEqual(['a-early', 'a-late'])
  })

  it('falls back to manual order when no project is available, rather than sorting by due date', () => {
    const base = createDenseToday().tasks[1]!
    const tasks = [
      { ...base, id: 'first', projectId: null, sortOrder: 0, dueDate: null },
      { ...base, id: 'second', projectId: 'missing', sortOrder: 1, dueDate: '2026-01-01' },
    ]
    expect(filterAndSortTasks(tasks, emptyFilters, 'project').map(t => t.id)).toEqual(['first', 'second'])
    expect(filterAndSortTasks([], emptyFilters, 'project', [{ id: 'a' }])).toEqual([])
  })

  it('filters by project, text, priority, and completion state', () => {
    const document = createDemoWorkspace()
    const result = filterAndSortTasks(document.tasks, {
      ...emptyFilters,
      query: 'MiniMax',
      projectId: DEMO_PROJECT_IDS.personal,
      status: 'active',
    }, 'manual')

    expect(result.map(task => task.title)).toEqual(['整理 MiniMax API 接入方案'])
  })

  it('supports deterministic priority and title sorting', () => {
    const tasks = createDemoWorkspace().tasks.filter(task => task.deletedAt === null && task.completedAt === null)
    const prioritySorted = filterAndSortTasks(tasks, emptyFilters, 'priority')
    const titleSorted = filterAndSortTasks(tasks, emptyFilters, 'title')

    expect(prioritySorted[0]?.priority).toBe('high')
    expect(titleSorted.map(task => task.title)).toEqual(
      [...tasks].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')).map(task => task.title),
    )
  })

  it('derives the current date and quarter instead of shipping fixed demo values', () => {
    const now = new Date('2026-08-05T08:00:00+08:00')
    expect(getTodayDateInput(now)).toBe('2026-08-05')
    expect(getCurrentQuarter(now)).toBe('2026-Q3')
  })

  it('selects one current task, three next tasks, and keeps the remaining work visible', () => {
    const document = createDemoWorkspace()
    document.tasks[1]!.status = 'in_progress'
    document.tasks[0]!.importance = 'important'

    const lanes = deriveTodayLanes(document.tasks, new Date('2026-07-22T09:00:00+08:00'))

    expect(lanes.nowTask?.id).toBe(document.tasks[1]!.id)
    expect(lanes.nextTasks.length).toBeLessThanOrEqual(3)
    expect(lanes.nextTasks.some(task => task.id === lanes.nowTask?.id)).toBe(false)
    expect([
      lanes.nowTask,
      ...lanes.nextTasks,
      ...lanes.laterTodayTasks,
      ...lanes.backlogTasks,
      ...lanes.completedTasks,
    ].filter(Boolean)).toHaveLength(document.tasks.length)
  })
})

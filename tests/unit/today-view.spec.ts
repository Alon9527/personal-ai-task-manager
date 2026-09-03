import { createDemoWorkspace, DEMO_PROJECT_IDS } from '../../app/data/demo-workspace'
import { deriveTodayLanes, filterAndSortTasks, getCurrentQuarter, getTodayDateInput, type TodayFilters } from '../../app/utils/today-view'

const emptyFilters: TodayFilters = {
  query: '',
  projectId: null,
  priority: 'all',
  status: 'all',
}

describe('Today functional view helpers', () => {
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

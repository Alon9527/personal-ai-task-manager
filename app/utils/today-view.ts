import { getTaskImportance, getTaskStatus, isTaskActive } from '#shared/workspace'
import type { QuarterKey, Task } from '#shared/workspace'

export type TodaySort = 'manual' | 'due' | 'priority' | 'title'
export type TodayStatusFilter = 'all' | 'active' | 'completed'
export type TodayPriorityFilter = 'all' | NonNullable<Task['priority']> | 'none'

export type TodayFilters = {
  query: string
  projectId: string | null
  priority: TodayPriorityFilter
  status: TodayStatusFilter
}

const priorityRank: Record<NonNullable<Task['priority']>, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export type TodayLanes = {
  nowTask: Task | null
  nextTasks: Task[]
  laterTodayTasks: Task[]
  backlogTasks: Task[]
  completedTasks: Task[]
}

export function deriveTodayLanes(tasks: Task[], now = new Date()): TodayLanes {
  const today = getTodayDateInput(now)
  const active = tasks.filter(isTaskActive)
  const completedTasks = tasks
    .filter(task => task.deletedAt === null && !isTaskActive(task))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const ranked = [...active].sort((left, right) => {
    const status = Number(getTaskStatus(left) !== 'in_progress') - Number(getTaskStatus(right) !== 'in_progress')
    if (status) return status
    const importance = Number(getTaskImportance(left) !== 'important') - Number(getTaskImportance(right) !== 'important')
    if (importance) return importance
    const leftDue = `${left.dueDate ?? '9999-12-31'}T${left.dueTime ?? '23:59'}`
    const rightDue = `${right.dueDate ?? '9999-12-31'}T${right.dueTime ?? '23:59'}`
    return leftDue.localeCompare(rightDue) || left.sortOrder - right.sortOrder
  })
  const todayCandidates = ranked.filter(task => task.isFocus || Boolean(task.dueDate && task.dueDate <= today))
  const nowTask = ranked.find(task => getTaskStatus(task) === 'in_progress') ?? todayCandidates[0] ?? ranked[0] ?? null
  const withoutNow = todayCandidates.filter(task => task.id !== nowTask?.id)
  const nextTasks = withoutNow.slice(0, 3)
  const laterTodayTasks = withoutNow.slice(3)
  const plannedIds = new Set([nowTask?.id, ...nextTasks.map(task => task.id), ...laterTodayTasks.map(task => task.id)])
  const backlogTasks = ranked.filter(task => !plannedIds.has(task.id))

  return { nowTask, nextTasks, laterTodayTasks, backlogTasks, completedTasks }
}

export function filterAndSortTasks(tasks: Task[], filters: TodayFilters, sort: TodaySort): Task[] {
  const query = filters.query.trim().toLocaleLowerCase('zh-CN')
  const result = tasks.filter((task) => {
    if (task.deletedAt !== null) return false
    if (filters.projectId && task.projectId !== filters.projectId) return false
    if (filters.priority === 'none' && task.priority !== null) return false
    if (filters.priority !== 'all' && filters.priority !== 'none' && task.priority !== filters.priority) return false
    if (filters.status === 'active' && task.completedAt !== null) return false
    if (filters.status === 'completed' && task.completedAt === null) return false
    if (query && !`${task.title} ${task.description}`.toLocaleLowerCase('zh-CN').includes(query)) return false
    return true
  })

  if (sort === 'manual') return [...result]
  return [...result].sort((left, right) => {
    if (sort === 'title') return left.title.localeCompare(right.title, 'zh-CN')
    if (sort === 'priority') {
      const leftRank = left.priority ? priorityRank[left.priority] : 3
      const rightRank = right.priority ? priorityRank[right.priority] : 3
      return leftRank - rightRank || left.sortOrder - right.sortOrder
    }
    const leftDue = `${left.dueDate ?? '9999-12-31'}T${left.dueTime ?? '23:59'}`
    const rightDue = `${right.dueDate ?? '9999-12-31'}T${right.dueTime ?? '23:59'}`
    return leftDue.localeCompare(rightDue) || left.sortOrder - right.sortOrder
  })
}

export function getTodayDateInput(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getCurrentQuarter(now = new Date()): QuarterKey {
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}` as QuarterKey
}

export function formatTodayHeading(now = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now)
}

export function formatAgendaDate(date: string | null, today: string): string {
  if (!date) return '未安排日期'
  if (date === today) return '今天'
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(parsed)
}

import type {
  Project,
  QuarterGoal,
  QuarterKey,
  Task,
  WorkspaceDocument,
} from './workspace'

const DAY_MS = 24 * 60 * 60 * 1000

export type QuarterMetrics = {
  averageProgress: number
  totalGoals: number
  completedGoals: number
  riskGoalIds: string[]
  remainingDays: number
}

export type AnnualReview = {
  year: number
  annualTaskCount: number
  completedTaskCount: number
  completionRate: number
  averageGoalProgress: number
  milestoneCount: number
  quarterTrend: Array<{ quarter: QuarterKey, progress: number }>
  projectDistribution: Array<{
    projectId: string
    name: string
    color: string
    total: number
    completed: number
    completionRate: number
  }>
  milestones: Array<{
    id: string
    kind: 'task' | 'goal'
    title: string
    date: string
  }>
}

export function goalsForQuarter(
  document: WorkspaceDocument,
  quarter: QuarterKey,
): QuarterGoal[] {
  return document.quarterGoals
    .filter(goal => goal.deletedAt === null && goal.quarter === quarter)
    .sort((left, right) =>
      left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt),
    )
}

export function quarterElapsedPercent(quarter: QuarterKey, now: Date): number {
  const { start, end } = quarterRange(quarter)
  const elapsed = clamp(now.getTime() - start, 0, end - start)
  return Math.round((elapsed / (end - start)) * 100)
}

export function deriveQuarterMetrics(
  document: WorkspaceDocument,
  quarter: QuarterKey,
  now: Date,
): QuarterMetrics {
  const goals = goalsForQuarter(document, quarter)
  const elapsedPercent = quarterElapsedPercent(quarter, now)
  const { end } = quarterRange(quarter)

  return {
    averageProgress: average(goals.map(goal => goal.progress)),
    totalGoals: goals.length,
    completedGoals: goals.filter(goal => goal.status === 'completed').length,
    riskGoalIds: goals
      .filter(goal => goal.status === 'active' && goal.progress < elapsedPercent - 20)
      .map(goal => goal.id),
    remainingDays: Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS)),
  }
}

export function deriveAnnualReview(
  document: WorkspaceDocument,
  year: number,
): AnnualReview {
  const tasks = document.tasks.filter(task => task.deletedAt === null)
  const projects = document.projects.filter(project => project.deletedAt === null)
  const goals = document.quarterGoals.filter(goal =>
    goal.deletedAt === null && Number(goal.quarter.slice(0, 4)) === year,
  )
  const annualTasks = tasks.filter(task => taskYear(task) === year)
  const completedTasks = annualTasks.filter(task =>
    task.completedAt !== null && new Date(task.completedAt).getUTCFullYear() === year,
  )

  const quarterTrend = ([1, 2, 3, 4] as const).map((quarterNumber) => {
    const quarter = `${year}-Q${quarterNumber}` as QuarterKey
    return {
      quarter,
      progress: average(goals
        .filter(goal => goal.quarter === quarter)
        .map(goal => goal.progress)),
    }
  })

  const projectDistribution = projects
    .map(project => projectCompletion(project, annualTasks))
    .filter(item => item.total > 0)

  const milestones: AnnualReview['milestones'] = [
    ...completedTasks.map(task => ({
      id: task.id,
      kind: 'task' as const,
      title: task.title,
      date: task.completedAt!,
    })),
    ...goals
      .filter(goal => goal.status === 'completed')
      .map(goal => ({
        id: goal.id,
        kind: 'goal' as const,
        title: goal.title,
        date: goal.updatedAt,
      })),
  ].sort((left, right) => right.date.localeCompare(left.date))

  return {
    year,
    annualTaskCount: annualTasks.length,
    completedTaskCount: completedTasks.length,
    completionRate: percentage(completedTasks.length, annualTasks.length),
    averageGoalProgress: average(goals.map(goal => goal.progress)),
    milestoneCount: milestones.length,
    quarterTrend,
    projectDistribution,
    milestones,
  }
}

function quarterRange(quarter: QuarterKey) {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter)
  if (!match) throw new Error('季度格式无效')
  const year = Number(match[1])
  const quarterNumber = Number(match[2])
  const startMonth = (quarterNumber - 1) * 3
  return {
    start: Date.UTC(year, startMonth, 1),
    end: Date.UTC(year, startMonth + 3, 1),
  }
}

function taskYear(task: Task) {
  return Number(task.dueDate?.slice(0, 4) ?? task.createdAt.slice(0, 4))
}

function projectCompletion(project: Project, tasks: Task[]) {
  const projectTasks = tasks.filter(task => task.projectId === project.id)
  const completed = projectTasks.filter(task => task.completedAt !== null).length
  return {
    projectId: project.id,
    name: project.name,
    color: project.color,
    total: projectTasks.length,
    completed,
    completionRate: percentage(completed, projectTasks.length),
  }
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function percentage(part: number, total: number) {
  return total === 0 ? 0 : Math.round((part / total) * 100)
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

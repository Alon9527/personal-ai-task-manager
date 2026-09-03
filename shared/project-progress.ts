import type { Milestone, Project, Task, WorkspaceDocument } from './workspace'

const DAY_MS = 24 * 60 * 60 * 1000

export function deriveMilestoneProgress(milestone: Milestone, tasks: Task[]): number {
  if (milestone.status === 'completed') return 100
  if (milestone.progressMode === 'manual') return milestone.progress

  const linkedTasks = tasks.filter(task =>
    task.deletedAt === null && task.milestoneId === milestone.id,
  )
  return percentage(completedCount(linkedTasks), linkedTasks.length)
}

export function deriveProjectProgress(
  project: Project,
  milestones: Milestone[],
  tasks: Task[],
): number {
  if (project.status === 'completed') return 100

  const projectMilestones = milestones.filter(milestone =>
    milestone.deletedAt === null && milestone.projectId === project.id,
  )
  if (projectMilestones.length > 0) {
    return Math.round(
      projectMilestones.reduce(
        (sum, milestone) => sum + deriveMilestoneProgress(milestone, tasks),
        0,
      ) / projectMilestones.length,
    )
  }

  const projectTasks = tasks.filter(task =>
    task.deletedAt === null && task.projectId === project.id,
  )
  return percentage(completedCount(projectTasks), projectTasks.length)
}

export function deriveUpcomingMilestones(
  document: WorkspaceDocument,
  now: Date,
  upcomingDays = 7,
): Array<{
  milestone: Milestone
  project: Project
  timing: 'overdue' | 'upcoming'
  days: number
}> {
  const projects = new Map(document.projects
    .filter(project => project.deletedAt === null && project.status !== 'completed')
    .map(project => [project.id, project]))
  const today = localDayStart(now)

  return document.milestones
    .filter(milestone =>
      milestone.deletedAt === null
      && milestone.status !== 'completed'
      && milestone.targetDate !== null
      && projects.has(milestone.projectId),
    )
    .map((milestone) => {
      const days = Math.round((localDayStart(milestone.targetDate!).getTime() - today.getTime()) / DAY_MS)
      return {
        milestone,
        project: projects.get(milestone.projectId)!,
        timing: days < 0 ? 'overdue' as const : 'upcoming' as const,
        days,
      }
    })
    .filter(item => item.timing === 'overdue' || item.days <= upcomingDays)
    .sort((left, right) =>
      (left.timing === right.timing ? left.days - right.days : left.timing === 'overdue' ? -1 : 1)
      || left.milestone.sortOrder - right.milestone.sortOrder
      || left.milestone.createdAt.localeCompare(right.milestone.createdAt),
    )
}

function completedCount(tasks: Task[]) {
  return tasks.filter(task => task.status === 'done').length
}

function percentage(part: number, total: number) {
  return total === 0 ? 0 : Math.round((part / total) * 100)
}

function localDayStart(value: Date | string) {
  if (typeof value === 'string') {
    const [yearText, monthText, dayText] = value.split('-')
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)
    return new Date(year, month - 1, day)
  }
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

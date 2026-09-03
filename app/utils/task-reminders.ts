import { getTaskStatus } from '#shared/workspace'
import type { Task } from '#shared/workspace'

export function effectiveReminderAt(task: Pick<Task, 'reminderAt' | 'snoozedUntil'>) {
  if (!task.reminderAt) return null
  if (!task.snoozedUntil) return task.reminderAt
  return task.snoozedUntil > task.reminderAt ? task.snoozedUntil : task.reminderAt
}

export function dueTaskReminders(tasks: Task[], now = new Date()) {
  const nowIso = now.toISOString()
  return tasks.filter((task) => {
    if (task.deletedAt !== null || task.completedAt !== null) return false
    const status = getTaskStatus(task)
    if (status === 'done' || status === 'cancelled') return false
    const effectiveAt = effectiveReminderAt(task)
    if (!effectiveAt || effectiveAt > nowIso) return false
    return !task.lastRemindedAt || task.lastRemindedAt < effectiveAt
  })
}

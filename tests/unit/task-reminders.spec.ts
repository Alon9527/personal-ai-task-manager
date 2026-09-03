import { describe, expect, it } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { dueTaskReminders, effectiveReminderAt } from '../../app/utils/task-reminders'

describe('task reminders', () => {
  it('uses a later snooze time as the effective reminder', () => {
    const task = createDemoWorkspace().tasks[0]!
    task.reminderAt = '2026-08-09T08:00:00.000Z'
    task.snoozedUntil = '2026-08-09T09:00:00.000Z'

    expect(effectiveReminderAt(task)).toBe('2026-08-09T09:00:00.000Z')
  })

  it('returns only active reminders that have not fired for the current schedule', () => {
    const [due, completed, deleted] = createDemoWorkspace().tasks
    due!.reminderAt = '2026-08-09T08:00:00.000Z'
    completed!.reminderAt = '2026-08-09T08:00:00.000Z'
    completed!.completedAt = '2026-08-09T07:00:00.000Z'
    deleted!.reminderAt = '2026-08-09T08:00:00.000Z'
    deleted!.deletedAt = '2026-08-09T07:00:00.000Z'

    expect(dueTaskReminders([due!, completed!, deleted!], new Date('2026-08-09T08:30:00.000Z')))
      .toEqual([due])

    due!.lastRemindedAt = '2026-08-09T08:01:00.000Z'
    expect(dueTaskReminders([due!], new Date('2026-08-09T08:30:00.000Z'))).toEqual([])
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'

const NOW = '2026-08-09T08:00:00.000Z'

describe('task lifecycle', () => {
  beforeEach(() => localStorage.clear())

  it('stores status, importance, estimate, and reminder fields', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    const task = await gateway.createTask({
      title: '准备周会',
      description: '',
      projectId: null,
      priority: null,
      dueDate: '2026-08-10',
      dueTime: '09:00',
      isFocus: true,
      status: 'todo',
      importance: 'important',
      estimatedMinutes: 45,
      reminderAt: '2026-08-10T00:30:00.000Z',
    })

    expect(task).toMatchObject({
      status: 'todo',
      importance: 'important',
      estimatedMinutes: 45,
      reminderAt: '2026-08-10T00:30:00.000Z',
      snoozedUntil: null,
      lastRemindedAt: null,
    })
  })

  it('keeps only one task in progress', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    const [first, second] = (await gateway.loadWorkspace()).tasks

    await gateway.startTask(first!.id)
    await gateway.startTask(second!.id)

    const active = (await gateway.loadWorkspace()).tasks.filter(task => task.status === 'in_progress')
    expect(active.map(task => task.id)).toEqual([second!.id])
  })

  it('restores a soft-deleted task and supports reminder snoozing', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => NOW)
    const task = (await gateway.loadWorkspace()).tasks[0]!

    await gateway.deleteTask(task.id)
    expect((await gateway.loadWorkspace()).tasks.some(item => item.id === task.id)).toBe(false)

    await gateway.restoreTask(task.id)
    await gateway.snoozeTask(task.id, '2026-08-09T09:00:00.000Z')

    const restored = (await gateway.loadWorkspace()).tasks.find(item => item.id === task.id)
    expect(restored?.deletedAt).toBeNull()
    expect(restored?.snoozedUntil).toBe('2026-08-09T09:00:00.000Z')
  })
})

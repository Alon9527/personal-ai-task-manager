import { describe, expect, it } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { softDeleteTasks } from '../../app/services/inbox-bulk-delete'

describe('inbox bulk soft delete', () => {
  it('soft deletes only the selected tasks without mutating the source document', () => {
    const source = createDemoWorkspace()
    const selectedIds = [source.tasks[0]!.id, source.tasks[2]!.id]
    const deletedAt = '2026-09-03T08:00:00.000Z'

    const result = softDeleteTasks(source, selectedIds, () => deletedAt)

    expect(result.tasks.filter(task => selectedIds.includes(task.id))).toEqual(
      expect.arrayContaining(selectedIds.map(id => expect.objectContaining({ id, deletedAt, updatedAt: deletedAt }))),
    )
    expect(result.tasks.find(task => task.id === source.tasks[1]!.id)?.deletedAt).toBeNull()
    expect(source.tasks.every(task => task.deletedAt === null)).toBe(true)
  })

  it('rejects the whole operation when any selected task is unavailable', () => {
    const source = createDemoWorkspace()

    expect(() => softDeleteTasks(source, [source.tasks[0]!.id, 'missing-task-id']))
      .toThrow('部分任务不存在或已被删除')
    expect(source.tasks.every(task => task.deletedAt === null)).toBe(true)
  })

  it('requires at least one selected task', () => {
    expect(() => softDeleteTasks(createDemoWorkspace(), [])).toThrow('请至少选择一项任务')
  })
})

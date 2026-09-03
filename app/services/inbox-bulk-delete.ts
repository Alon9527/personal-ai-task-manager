import { workspaceDocumentSchema } from '#shared/workspace'
import type { WorkspaceDocument } from '#shared/workspace'

export function softDeleteTasks(
  document: WorkspaceDocument,
  taskIds: Iterable<string>,
  now: () => string = () => new Date().toISOString(),
): WorkspaceDocument {
  const selectedIds = new Set(taskIds)
  if (selectedIds.size === 0) {
    throw new Error('请至少选择一项任务')
  }

  const next = structuredClone(workspaceDocumentSchema.parse(document))
  const deletedAt = now()
  let deletedCount = 0

  for (const task of next.tasks) {
    if (!selectedIds.has(task.id) || task.deletedAt !== null) continue
    task.deletedAt = deletedAt
    task.updatedAt = deletedAt
    deletedCount += 1
  }

  if (deletedCount !== selectedIds.size) {
    throw new Error('部分任务不存在或已被删除，请刷新后重试')
  }

  return workspaceDocumentSchema.parse(next)
}

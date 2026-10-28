import { taskSchema, workspaceDocumentSchema } from '#shared/workspace'
import type { WorkspaceDocument } from '#shared/workspace'
import { z } from 'zod'

export const bulkTaskPatchSchema = taskSchema.pick({ projectId: true, priority: true, importance: true, startDate: true, dueDate: true, completionDate: true, isFocus: true }).partial().strict()
export type BulkTaskPatch = z.infer<typeof bulkTaskPatchSchema>

/** Prepare one detached document; the caller persists it with an expected-base transaction. */
export function editSelectedTasks(document: WorkspaceDocument, ids: readonly string[], input: BulkTaskPatch, now = () => new Date().toISOString()): WorkspaceDocument {
  const patch = bulkTaskPatchSchema.parse(input)
  const selected = new Set(ids)
  if (!selected.size || !Object.values(patch).some(value => value !== undefined)) throw new Error('请选择任务并勾选至少一个要修改的字段')
  const next = workspaceDocumentSchema.parse(document)
  const tasks = next.tasks.filter(t => selected.has(t.id) && !t.deletedAt)
  if (tasks.length !== selected.size) throw new Error('部分任务不存在或已被删除，请重新选择')
  if (patch.projectId && !next.projects.some(p => p.id === patch.projectId && !p.deletedAt)) throw new Error('所选项目不存在或已删除')
  const stamp = now()
  for (const task of tasks) {
    Object.assign(task, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), { updatedAt: stamp })
    if (patch.projectId !== undefined && task.milestoneId && !next.milestones.some(m => m.id === task.milestoneId && !m.deletedAt && m.projectId === task.projectId)) task.milestoneId = null
    if (patch.dueDate === null) task.dueTime = null
    if (task.startDate && task.dueDate && task.startDate > task.dueDate) throw new Error(`“${task.title}”的截止日期不能早于开始日期`)
  }
  return workspaceDocumentSchema.parse(next)
}

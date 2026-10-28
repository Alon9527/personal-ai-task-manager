import { describe, expect, it } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { editSelectedTasks } from '../../app/services/inbox-bulk-edit'

describe('inbox bulk edits', () => {
  it('changes all selected records in one detached document and preserves other fields', () => {
    const base = createDemoWorkspace()
    const ids = base.tasks.slice(0, 3).map(t => t.id)
    const before = JSON.stringify(base)
    const projectId = base.projects[0]!.id
    const next = editSelectedTasks(base, ids, { projectId, priority: 'high' })
    expect(JSON.stringify(base)).toBe(before)
    for (const [i, task] of next.tasks.entries()) {
      const original = base.tasks[i]!
      if (ids.includes(task.id)) {
        expect(task.projectId).toBe(projectId)
        expect(task.priority).toBe('high')
        expect(task.title).toBe(original.title)
        expect(task.description).toBe(original.description)
        expect(task.attachments).toEqual(original.attachments)
        expect(task.dueDate).toBe(original.dueDate)
      } else expect(task).toEqual(original)
    }
  })
  it('clears a milestone only if incompatible with the new project', () => {
    const base = createDemoWorkspace(), task = base.tasks[0]!
    const milestone = { id: crypto.randomUUID(), ownerId: task.ownerId, projectId: base.projects[0]!.id, title: '验收', description: '', targetDate: null, status: 'planned' as const, progressMode: 'manual' as const, progress: 0, sortOrder: 0, createdAt: task.createdAt, updatedAt: task.updatedAt, deletedAt: null }
    base.milestones.push(milestone)
    task.projectId = milestone.projectId; task.milestoneId = milestone.id
    expect(editSelectedTasks(base, [task.id], { projectId: milestone.projectId }).tasks[0]?.milestoneId).toBe(milestone.id)
    expect(editSelectedTasks(base, [task.id], { projectId: null }).tasks[0]?.milestoneId).toBeNull()
  })
  it('rejects empty, missing, deleted, invalid dates and unknown fields atomically', () => {
    const base = createDemoWorkspace(), id = base.tasks[0]!.id
    expect(() => editSelectedTasks(base, [], { priority: 'low' })).toThrow()
    expect(() => editSelectedTasks(base, [id, crypto.randomUUID()], { priority: 'low' })).toThrow()
    expect(() => editSelectedTasks(base, [id], {})).toThrow()
    expect(() => editSelectedTasks(base, [id], { dueDate: '2026-02-31' })).toThrow()
    expect(() => editSelectedTasks(base, [id], { projectId: crypto.randomUUID() })).toThrow()
    expect(() => editSelectedTasks(base, [id], { title: '不可批改' } as any)).toThrow()
    base.tasks[0]!.deletedAt = new Date().toISOString()
    expect(() => editSelectedTasks(base, [id], { priority: 'low' })).toThrow()
  })
})

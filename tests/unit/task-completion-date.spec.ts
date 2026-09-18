import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { normalizeTaskDateInput } from '../../app/utils/task-date-input'
import { createTaskInputSchema, updateTaskInputSchema } from '../../server/utils/workspace-api'
import { DesktopWorkspaceGateway } from '../../app/data/desktop-workspace-gateway'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { workspaceDocumentSchema, DEMO_OWNER_ID } from '../../shared/workspace'
import { SupabaseWorkspaceRepository } from '../../server/utils/supabase-workspace-repository'

describe('task completion date', () => {
  it.each([
    ['260918', '2026-09-18'], [' 260918 ', '2026-09-18'], ['000101', '2000-01-01'],
    ['991231', '2099-12-31'], ['20260918', '2026-09-18'], ['2026/9/8', '2026-09-08'],
    ['2026-9-8', '2026-09-08'], ['', ''], ['  ', ''], ['260231', '2026-02-31'], ['hello', 'hello'],
  ])('normalizes %s without rolling invalid dates forward', (input, expected) => {
    expect(normalizeTaskDateInput(input)).toBe(expected)
  })

  it('validates real dates and permits clearing or omitting the field', () => {
    const task = createDemoWorkspace().tasks[0]!
    expect(createTaskInputSchema.parse({ ...task, completionDate: '2026-09-18' }).completionDate).toBe('2026-09-18')
    expect(createTaskInputSchema.safeParse(task).success).toBe(true)
    expect(updateTaskInputSchema.parse({ completionDate: null })).toEqual({ completionDate: null })
    for (const date of ['260918', '2026-02-29', '2026-13-01', '2026-09-00', '']) {
      expect(updateTaskInputSchema.safeParse({ completionDate: date }).success).toBe(false)
    }
    expect(updateTaskInputSchema.safeParse({ completionDate: '2028-02-29' }).success).toBe(true)
  })

  it('retains the date through desktop storage and backup restoration without changing status', async () => {
    let disk = JSON.stringify(createDemoWorkspace())
    const bridge = { loadDocument: async () => disk, saveDocument: async (json: string) => { disk = json } }
    const gateway = new DesktopWorkspaceGateway(localStorage, bridge)
    const task = (await gateway.loadWorkspace()).tasks[0]!
    await gateway.updateTask(task.id, { completionDate: '2026-09-18' })
    const reopened = new DesktopWorkspaceGateway(localStorage, bridge)
    const document = await reopened.loadWorkspace()
    expect(document.tasks.find(item => item.id === task.id)).toMatchObject({ completionDate: '2026-09-18', status: task.status, completedAt: task.completedAt })
    const backup = workspaceDocumentSchema.parse(JSON.parse(JSON.stringify(document)))
    await reopened.replaceWorkspaceDocument(backup)
    expect(JSON.parse(disk).tasks.find((item: { id: string }) => item.id === task.id).completionDate).toBe('2026-09-18')
  })

  it('maps remote create, read and clear operations without changing completion status', async () => {
    const row = { id: '20000000-0000-4000-8000-000000000001', owner_id: DEMO_OWNER_ID, project_id: null, milestone_id: null, title: '日期', description: '', priority: null, due_date: null, due_time: null, is_focus: false, status: 'todo', sort_order: 0, completed_at: null, completion_date: '2026-09-18', created_at: '2026-09-18T00:00:00.000Z', updated_at: '2026-09-18T00:00:00.000Z', deleted_at: null }
    const transport = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([row]).mockResolvedValueOnce([{ ...row, completion_date: null }])
    const repository = new SupabaseWorkspaceRepository({ url: 'https://example.invalid', key: 'synthetic-test', ownerId: DEMO_OWNER_ID, transport })
    const task = createDemoWorkspace().tasks[0]!
    expect(await repository.createTask({ ...task, completionDate: '2026-09-18' })).toMatchObject({ completionDate: '2026-09-18', completedAt: null, status: 'todo' })
    expect(transport.mock.calls[4]?.[1].body.completion_date).toBe('2026-09-18')
    expect(await repository.updateTask(row.id, { completionDate: null })).toMatchObject({ completionDate: null })
    expect(transport.mock.calls[5]?.[1].body).toEqual({ completion_date: null })
  })

  it('includes the optional column in the owner-scoped restore migration', () => {
    const sql = readFileSync('supabase/migrations/202609180001_task_completion_date.sql', 'utf8')
    expect(sql).toContain('add column if not exists completion_date date')
    expect(sql).toContain('priority, start_date, due_date, completion_date,')
    expect(sql).toContain("(value->>'completionDate')::date")
    expect(sql).toContain('workspace owner mismatch')
    expect(sql).toContain('to service_role')
  })
})

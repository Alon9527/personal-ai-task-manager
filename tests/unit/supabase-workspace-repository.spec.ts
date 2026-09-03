import { describe, expect, it, vi } from 'vitest'
import { DEMO_OWNER_ID } from '../../shared/workspace'
import { SupabaseWorkspaceRepository } from '../../server/utils/supabase-workspace-repository'
import { WorkspaceError } from '../../app/data/workspace-gateway'

describe('SupabaseWorkspaceRepository', () => {
  it('filters active workspace reads by the fixed owner', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co',
      key: 'server-secret',
      ownerId: DEMO_OWNER_ID,
      transport,
    })

    await repository.loadWorkspace()

    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(`/rest/v1/projects?select=*&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
      expect.any(Object),
    )
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(`/rest/v1/tasks?select=*&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
      expect.any(Object),
    )
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(`/rest/v1/quarter_goals?select=*&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
      expect.any(Object),
    )
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(`/rest/v1/milestones?select=*&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
      expect.any(Object),
    )
  })

  it('loads all four owner-scoped entity types without an active filter when deleted records are included', async () => {
    const transport = vi.fn().mockResolvedValue([])
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co',
      key: 'server-secret',
      ownerId: DEMO_OWNER_ID,
      transport,
    })

    await repository.loadWorkspace({ includeDeleted: true })

    expect(transport).toHaveBeenCalledTimes(4)
    for (const entity of ['projects', 'tasks', 'quarter_goals', 'milestones']) {
      expect(transport).toHaveBeenCalledWith(
        expect.stringContaining(`/rest/v1/${entity}?select=*&owner_id=eq.${DEMO_OWNER_ID}&order=sort_order.asc`),
        expect.any(Object),
      )
    }
    for (const [url] of transport.mock.calls) {
      expect(url).not.toContain('deleted_at=is.null')
    }
  })

  it('maps database rows to the shared domain contract', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce([{
        id: '10000000-0000-4000-8000-000000000001', owner_id: DEMO_OWNER_ID,
        name: '收集箱', color: '#9297A1', description: 'Project description', priority: 'high',
        status: 'active', target_date: '2026-08-31', sort_order: 0,
        created_at: '2026-07-22T00:00:00.000Z', updated_at: '2026-07-22T00:00:00.000Z', deleted_at: null,
      }])
      .mockResolvedValueOnce([{
        id: '20000000-0000-4000-8000-000000000001', owner_id: DEMO_OWNER_ID,
        project_id: '10000000-0000-4000-8000-000000000001', milestone_id: '40000000-0000-4000-8000-000000000001', title: '任务', description: '', priority: null,
        due_date: '2026-07-22', due_time: '10:30:00', is_focus: false, sort_order: 0,
        completed_at: null, created_at: '2026-07-22T00:00:00.000Z', updated_at: '2026-07-22T00:00:00.000Z', deleted_at: null,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: '40000000-0000-4000-8000-000000000001', owner_id: DEMO_OWNER_ID,
        project_id: '10000000-0000-4000-8000-000000000001', title: 'Milestone', description: '',
        target_date: '2026-08-16', status: 'in_progress', progress_mode: 'manual', progress: 40,
        sort_order: 0, created_at: '2026-07-22T00:00:00.000Z', updated_at: '2026-07-22T00:00:00.000Z', deleted_at: null,
      }])
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'server-secret', ownerId: DEMO_OWNER_ID, transport,
    })

    const document = await repository.loadWorkspace()

    expect(document.version).toBe(3)
    expect(document.projects[0]).toMatchObject({
      ownerId: DEMO_OWNER_ID,
      description: 'Project description',
      priority: 'high',
      status: 'active',
      targetDate: '2026-08-31',
      sortOrder: 0,
    })
    expect(document.tasks[0]).toMatchObject({
      projectId: document.projects[0]!.id,
      milestoneId: '40000000-0000-4000-8000-000000000001',
      dueTime: '10:30',
      isFocus: false,
    })
    expect(document.milestones[0]).toMatchObject({
      ownerId: DEMO_OWNER_ID,
      projectId: document.projects[0]!.id,
      targetDate: '2026-08-16',
      progressMode: 'manual',
      progress: 40,
    })
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(`/rest/v1/milestones?select=*&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
      expect.any(Object),
    )
  })

  it('uses the project soft-delete RPC with the fixed owner', async () => {
    const transport = vi.fn().mockResolvedValue(null)
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'server-secret', ownerId: DEMO_OWNER_ID, transport,
    })

    await repository.deleteProject('10000000-0000-4000-8000-000000000001')

    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/soft_delete_project',
      expect.objectContaining({
        method: 'POST',
        body: { p_project_id: '10000000-0000-4000-8000-000000000001', p_owner_id: DEMO_OWNER_ID },
      }),
    )
  })

  it('uses one owner-scoped RPC to empty the trash atomically', async () => {
    const transport = vi.fn().mockResolvedValue(null)
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'server-secret', ownerId: DEMO_OWNER_ID, transport,
    })

    await repository.emptyTrash()

    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/empty_workspace_trash',
      expect.objectContaining({ method: 'POST', body: { p_owner_id: DEMO_OWNER_ID } }),
    )
  })

  it('uses a separate owner-scoped RPC to clear all workspace data atomically', async () => {
    const transport = vi.fn().mockResolvedValue(null)
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'server-secret', ownerId: DEMO_OWNER_ID, transport,
    })

    await repository.clearWorkspaceData()

    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/clear_workspace_data',
      expect.objectContaining({ method: 'POST', body: { p_owner_id: DEMO_OWNER_ID } }),
    )
  })

  it('uses the owner-scoped restore RPC so stale task links are repaired atomically', async () => {
    const taskId = '20000000-0000-4000-8000-000000000001'
    const transport = vi.fn().mockResolvedValue([{
      id: taskId,
      owner_id: DEMO_OWNER_ID,
      project_id: null,
      milestone_id: null,
      title: '恢复任务',
      description: '',
      priority: null,
      due_date: null,
      due_time: null,
      is_focus: false,
      status: 'todo',
      importance: 'normal',
      estimated_minutes: null,
      reminder_at: null,
      snoozed_until: null,
      last_reminded_at: null,
      sort_order: 0,
      completed_at: null,
      created_at: '2026-07-22T00:00:00.000Z',
      updated_at: '2026-08-13T00:00:00.000Z',
      deleted_at: null,
    }])
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'server-secret', ownerId: DEMO_OWNER_ID, transport,
    })

    await expect(repository.restoreTask(taskId)).resolves.toMatchObject({
      id: taskId,
      projectId: null,
      milestoneId: null,
      deletedAt: null,
    })
    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/restore_task',
      expect.objectContaining({
        method: 'POST',
        body: { p_task_id: taskId, p_owner_id: DEMO_OWNER_ID },
      }),
    )
  })

  it('keeps explicit project-only task associations in create and update requests', async () => {
    const projectId = '10000000-0000-4000-8000-000000000001'
    const taskId = '20000000-0000-4000-8000-000000000001'
    const taskRow = {
      id: taskId, owner_id: DEMO_OWNER_ID, project_id: projectId, milestone_id: null,
      title: '项目任务', description: '', priority: null, due_date: null, due_time: null,
      is_focus: false, status: 'todo', importance: 'normal', sort_order: 0,
      completed_at: null, created_at: '2026-07-22T00:00:00.000Z',
      updated_at: '2026-07-22T00:00:00.000Z', deleted_at: null,
    }
    const transport = vi.fn(async (url: string) => {
      if (url.includes('?select=')) return []
      return [taskRow]
    })
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'server-secret', ownerId: DEMO_OWNER_ID, transport,
    })

    await repository.createTask({
      title: '项目任务', description: '', projectId, milestoneId: null, priority: null,
      dueDate: null, dueTime: null, isFocus: false,
    })
    await repository.updateTask(taskId, { projectId, milestoneId: null })

    expect(transport).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/tasks',
      expect.objectContaining({ body: expect.objectContaining({ project_id: projectId, milestone_id: null }) }),
    )
    expect(transport).toHaveBeenCalledWith(
      expect.stringContaining(`/rest/v1/tasks?id=eq.${taskId}`),
      expect.objectContaining({ body: { project_id: projectId, milestone_id: null } }),
    )
  })

  it('converts transport failures to application errors', async () => {
    const transport = vi.fn().mockRejectedValue({ statusCode: 409, message: 'duplicate' })
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'server-secret', ownerId: DEMO_OWNER_ID, transport,
    })

    await expect(repository.loadWorkspace()).rejects.toMatchObject<WorkspaceError>({ code: 'conflict' })
  })
})

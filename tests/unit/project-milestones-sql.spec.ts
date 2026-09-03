import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/202608130001_project_milestones.sql'

async function readMigration() {
  return (await readFile(migrationPath, 'utf8')).toLowerCase()
}

function functionBody(sql: string, name: string) {
  const signature = `create or replace function public.${name}`
  const functionStart = sql.indexOf(signature)
  expect(functionStart, `${name} must be defined`).toBeGreaterThanOrEqual(0)

  const nextFunctionStart = sql.indexOf('create or replace function public.', functionStart + signature.length)
  const functionSql = sql.slice(functionStart, nextFunctionStart < 0 ? sql.length : nextFunctionStart)
  const bodyStart = functionSql.indexOf('as $$')
  expect(bodyStart, `${name} must have a dollar-quoted body`).toBeGreaterThanOrEqual(0)

  const bodyEnd = functionSql.indexOf('$$;', bodyStart)
  expect(bodyEnd, `${name} body must terminate`).toBeGreaterThan(bodyStart)
  return functionSql.slice(bodyStart + 'as $$'.length, bodyEnd)
}

function mutationStatement(body: string, verb: 'delete from' | 'update', table: string) {
  const start = body.indexOf(`${verb} public.${table}`)
  expect(start, `${verb} public.${table} must exist in this function`).toBeGreaterThanOrEqual(0)
  const end = body.indexOf(';', start)
  expect(end, `${verb} public.${table} must terminate`).toBeGreaterThan(start)
  return body.slice(start, end)
}

function expectFragmentsInOrder(text: string, fragments: string[]) {
  let previous = -1
  for (const fragment of fragments) {
    const current = text.indexOf(fragment)
    expect(current, `expected "${fragment}" after index ${previous}`).toBeGreaterThan(previous)
    previous = current
  }
}

describe('project milestones migration SQL contract', () => {
  it('adds constrained project fields, milestones, task linkage, indexes, and owner RLS', async () => {
    const sql = await readMigration()

    expect(sql).toContain('alter table public.projects')
    expect(sql).toContain('add column if not exists description text')
    expect(sql).toContain('add column if not exists priority text')
    expect(sql).toContain("priority in ('low', 'medium', 'high')")
    expect(sql).toContain('add column if not exists status text')
    expect(sql).toContain("status in ('planned', 'active', 'paused', 'completed')")
    expect(sql).toContain('add column if not exists target_date date')

    expect(sql).toContain('create table if not exists public.milestones')
    expect(sql).toContain('owner_id uuid not null')
    expect(sql).toContain('project_id uuid not null')
    expect(sql).toContain('foreign key (project_id, owner_id)')
    expect(sql).toContain('references public.projects (id, owner_id)')
    expect(sql).toContain("status in ('planned', 'in_progress', 'blocked', 'completed')")
    expect(sql).toContain("progress_mode in ('auto', 'manual')")
    expect(sql).toContain('progress between 0 and 100')
    expect(sql).toContain('sort_order integer not null default 0 check (sort_order >= 0)')
    expect(sql).toContain('deleted_at timestamptz')

    expect(sql).toContain('milestone_id uuid')
    expect(sql).toContain('references public.milestones(id) on delete set null')
    expect(sql).toContain('milestones_owner_active_idx')
    expect(sql).toContain('milestones_project_active_idx')
    expect(sql).toContain('milestones_owner_deleted_idx')
    expect(sql).toContain('tasks_milestone_active_idx')
    expect(sql).toContain('alter table public.milestones enable row level security')
    expect(sql).toContain('create policy milestones_owner_policy')
    expect(sql).toContain('using (owner_id = auth.uid())')
    expect(sql).toContain('with check (owner_id = auth.uid())')
    expect(sql).toContain('create trigger tasks_enforce_milestone_link')
    expect(sql).toContain('create trigger milestones_enforce_active_project')
    expect(sql).toContain('create trigger milestones_sync_task_project')
  })

  it('detaches tasks without deleting them before soft-deleting a milestone and never reattaches on restore', async () => {
    const sql = await readMigration()
    const softDelete = functionBody(sql, 'soft_delete_milestone')
    const restore = functionBody(sql, 'restore_milestone')
    const detachTasks = mutationStatement(softDelete, 'update', 'tasks')
    const deleteMilestone = mutationStatement(softDelete, 'update', 'milestones')

    expect(sql).toContain('soft_delete_milestone(p_milestone_id uuid, p_owner_id uuid)')
    expect(sql).toContain('restore_milestone(p_milestone_id uuid, p_owner_id uuid)')
    expectFragmentsInOrder(softDelete, ['update public.tasks', 'update public.milestones'])
    expect(detachTasks).toContain('set milestone_id = null, updated_at = now()')
    expect(detachTasks).toContain('where milestone_id = p_milestone_id')
    expect(detachTasks).toContain('and owner_id = p_owner_id')
    expect(detachTasks).not.toContain('deleted_at =')
    expect(deleteMilestone).toContain('where id = p_milestone_id')
    expect(deleteMilestone).toContain('and owner_id = p_owner_id')
    expect(deleteMilestone).toContain('and deleted_at is null')
    expect(restore).not.toContain('update public.tasks')
  })

  it('enforces active same-owner milestone links and canonicalizes task project ids', async () => {
    const sql = await readMigration()
    const enforceLink = functionBody(sql, 'enforce_task_milestone_link')

    expect(enforceLink).toContain('if new.deleted_at is not null then')
    expect(enforceLink).toContain('from public.milestones milestone')
    expect(enforceLink).toContain('join public.projects project')
    expect(enforceLink).toContain('project.id = milestone.project_id')
    expect(enforceLink).toContain('project.owner_id = milestone.owner_id')
    expect(enforceLink).toContain('project.deleted_at is null')
    expect(enforceLink).toContain('milestone.id = new.milestone_id')
    expect(enforceLink).toContain('milestone.owner_id = new.owner_id')
    expect(enforceLink).toContain('milestone.deleted_at is null')
    expect(enforceLink).toContain('for share of milestone, project')
    expect(enforceLink).toContain('raise exception \'active milestone not found for task owner\'')
    expect(enforceLink).toContain('new.project_id := linked_project_id')
    expect(sql).toContain('before insert or update of milestone_id, owner_id, project_id, deleted_at on public.tasks')
    expect(sql).toContain('for each row execute function public.enforce_task_milestone_link()')
  })

  it('also enforces active same-owner project-only task links with row locking', async () => {
    const sql = await readMigration()
    const enforceLink = functionBody(sql, 'enforce_task_milestone_link')

    expect(enforceLink).toContain('elsif new.project_id is not null then')
    expect(enforceLink).toContain('from public.projects project')
    expect(enforceLink).toContain('project.id = new.project_id')
    expect(enforceLink).toContain('project.owner_id = new.owner_id')
    expect(enforceLink).toContain('project.deleted_at is null')
    expect(enforceLink).toContain('for share')
    expect(enforceLink).toContain("raise exception 'active project not found for task owner'")
  })

  it('repairs only active tasks with invalid project parents before enabling the invariant trigger', async () => {
    const sql = await readMigration()
    const backfillStart = sql.indexOf('update public.tasks task\nset project_id = null, milestone_id = null')
    const triggerStart = sql.indexOf('create trigger tasks_enforce_milestone_link')
    expect(backfillStart, 'invalid task-parent backfill must exist').toBeGreaterThanOrEqual(0)
    expect(triggerStart, 'task invariant trigger must exist').toBeGreaterThan(backfillStart)
    const backfillEnd = sql.indexOf(';', backfillStart)
    const backfill = sql.slice(backfillStart, backfillEnd)

    expect(backfill).toContain('task.deleted_at is null')
    expect(backfill).toContain('task.project_id is not null')
    expect(backfill).toContain('not exists')
    expect(backfill).toContain('from public.projects project')
    expect(backfill).toContain('project.id = task.project_id')
    expect(backfill).toContain('project.owner_id = task.owner_id')
    expect(backfill).toContain('project.deleted_at is null')
    expect(backfill).not.toContain('task.deleted_at is not null')
  })

  it('restores tasks atomically while sanitizing stale parent links', async () => {
    const sql = await readMigration()
    const restore = functionBody(sql, 'restore_task')
    const restoreTask = mutationStatement(restore, 'update', 'tasks')

    expect(sql).toContain('restore_task(p_task_id uuid, p_owner_id uuid)')
    expect(restore).toContain('where task.id = p_task_id')
    expect(restore).toContain('and task.owner_id = p_owner_id')
    expect(restore).toContain('and task.deleted_at is not null')
    expect(restore).toContain('for update of task')
    expect(restore).toContain('milestone.owner_id = p_owner_id')
    expect(restore).toContain('milestone.deleted_at is null')
    expect(restore).toContain('project.deleted_at is null')
    expect(restore).toContain('restored_project_id := milestone_project_id')
    expect(restore).toContain('restored_milestone_id := null')
    expect(restore).toContain('restored_project_id := null')
    expect(restoreTask).toContain('project_id = restored_project_id')
    expect(restoreTask).toContain('milestone_id = restored_milestone_id')
    expect(restoreTask).toContain('deleted_at = null')
    expect(restoreTask).toContain('owner_id = p_owner_id')
    expect(sql).toContain('grant execute on function public.restore_task(uuid, uuid) to service_role')
  })

  it('requires every milestone insert or move to target an active same-owner project and forbids owner changes', async () => {
    const sql = await readMigration()
    const enforceProject = functionBody(sql, 'enforce_milestone_active_project')

    expect(enforceProject).toContain("if tg_op = 'update' and new.owner_id is distinct from old.owner_id then")
    expect(enforceProject).toContain("raise exception 'milestone owner cannot change'")
    expect(enforceProject).toContain('if new.deleted_at is not null then')
    expect(enforceProject).toContain('from public.projects project')
    expect(enforceProject).toContain('where project.id = new.project_id')
    expect(enforceProject).toContain('and project.owner_id = new.owner_id')
    expect(enforceProject).toContain('and project.deleted_at is null')
    expect(enforceProject).toContain('for update')
    expect(enforceProject).toContain("raise exception 'active project not found for milestone owner'")
    expect(sql).toContain('before insert or update of project_id, owner_id, deleted_at on public.milestones')
    expect(sql).toContain('for each row execute function public.enforce_milestone_active_project()')
  })

  it('appends moved and restored milestones to the active target tail deterministically', async () => {
    const sql = await readMigration()
    const enforceProject = functionBody(sql, 'enforce_milestone_active_project')

    expect(enforceProject).toContain('new.project_id is distinct from old.project_id')
    expect(enforceProject).toContain('old.deleted_at is not null and new.deleted_at is null')
    expect(enforceProject).toContain('coalesce(max(milestone.sort_order), -1) + 1')
    expect(enforceProject).toContain('milestone.project_id = new.project_id')
    expect(enforceProject).toContain('milestone.owner_id = new.owner_id')
    expect(enforceProject).toContain('milestone.deleted_at is null')
    expect(enforceProject).toContain('milestone.id <> new.id')
    expect(sql).toContain('before insert or update of project_id, owner_id, deleted_at on public.milestones')
  })

  it('serializes milestone inserts on the parent row and assigns the active tail in the database', async () => {
    const sql = await readMigration()
    const enforceProject = functionBody(sql, 'enforce_milestone_active_project')

    expect(enforceProject).toContain("tg_op = 'insert'")
    expectFragmentsInOrder(enforceProject, [
      'from public.projects project',
      'for update',
      "tg_op = 'insert'",
      'coalesce(max(milestone.sort_order), -1) + 1',
      'new.sort_order := next_sort_order',
    ])
    expect(enforceProject).toContain('milestone.project_id = new.project_id')
    expect(enforceProject).toContain('milestone.owner_id = new.owner_id')
    expect(enforceProject).toContain('milestone.deleted_at is null')
  })

  it('synchronizes all linked task projects, including deleted tasks, when a milestone moves', async () => {
    const sql = await readMigration()
    const syncProject = functionBody(sql, 'sync_milestone_task_project')
    const taskUpdate = mutationStatement(syncProject, 'update', 'tasks')

    expect(syncProject).toContain('new.project_id is distinct from old.project_id')
    expect(taskUpdate).toContain('set project_id = new.project_id, updated_at = now()')
    expect(taskUpdate).toContain('where milestone_id = new.id')
    expect(taskUpdate).toContain('and owner_id = new.owner_id')
    expect(taskUpdate).not.toContain('deleted_at')
    expect(sql).toContain('after update of project_id on public.milestones')
    expect(sql).toContain('for each row execute function public.sync_milestone_task_project()')
  })

  it('refuses to restore a milestone while its same-owner parent project is deleted', async () => {
    const sql = await readMigration()
    const restore = functionBody(sql, 'restore_milestone')
    const restoreMilestone = mutationStatement(restore, 'update', 'milestones')

    expect(restore).toContain('join public.projects project')
    expect(restore).toContain('project.id = milestone.project_id')
    expect(restore).toContain('project.owner_id = p_owner_id')
    expect(restore).toContain('if project_deleted_timestamp is not null then')
    expect(restore).toContain("raise exception 'cannot restore milestone into deleted project'")
    expect(restoreMilestone).toContain('owner_id = p_owner_id')
    expect(restoreMilestone).toContain('deleted_at = deleted_timestamp')
  })

  it('validates milestone reorder duplicates, ownership, project membership, and the complete active set', async () => {
    const sql = await readMigration()
    const reorder = functionBody(sql, 'reorder_milestones')

    expect(sql).toContain('reorder_milestones(p_owner_id uuid, p_project_id uuid, p_ordered_ids uuid[])')
    expect(reorder).toContain('coalesce(cardinality(p_ordered_ids), 0) = 0')
    expect(reorder).toContain('count(distinct id)')
    expect(reorder).toContain('active_count <> cardinality(p_ordered_ids)')
    expect(reorder).toContain('distinct_count <> cardinality(p_ordered_ids)')
    expect(reorder).toContain('milestone order does not match active milestones')
    expect(reorder).toContain('milestone order contains inaccessible ids')
    expect(reorder).toContain('milestone.owner_id = p_owner_id')
    expect(reorder).toContain('milestone.project_id = p_project_id')
    expect(reorder).toContain('milestone.deleted_at is null')
    const reorderUpdate = mutationStatement(reorder, 'update', 'milestones')
    expect(reorderUpdate).toContain('set sort_order = ordered.ordinality - 1')
    expect(reorderUpdate).toContain('from unnest(p_ordered_ids) with ordinality')
    expect(reorderUpdate).toContain('milestone.owner_id = p_owner_id')
    expect(reorderUpdate).toContain('milestone.project_id = p_project_id')
    expect(reorderUpdate).toContain('milestone.deleted_at is null')
    expect(sql).toContain('create trigger milestones_set_updated_at')
    expect(sql).toContain('before update on public.milestones')
    expect(sql).toContain('execute function public.set_workspace_updated_at()')
  })

  it('replaces project deletion and restoration so milestone timestamps cascade with tasks', async () => {
    const sql = await readMigration()
    const softDeleteProject = functionBody(sql, 'soft_delete_project')
    const restoreProject = functionBody(sql, 'restore_project')
    const deleteProject = mutationStatement(softDeleteProject, 'update', 'projects')
    const deleteMilestones = mutationStatement(softDeleteProject, 'update', 'milestones')
    const deleteTasks = mutationStatement(softDeleteProject, 'update', 'tasks')
    const restoreTasks = mutationStatement(restoreProject, 'update', 'tasks')
    const restoreMilestones = mutationStatement(restoreProject, 'update', 'milestones')
    const restoreParent = mutationStatement(restoreProject, 'update', 'projects')

    expectFragmentsInOrder(softDeleteProject, [
      'update public.projects',
      'update public.milestones',
      'update public.tasks',
    ])
    for (const statement of [deleteProject, deleteMilestones, deleteTasks]) {
      expect(statement).toContain('set deleted_at = deleted_timestamp')
      expect(statement).toContain('owner_id = p_owner_id')
      expect(statement).toContain('deleted_at is null')
    }
    expect(deleteProject).toContain('id = p_project_id')
    expect(deleteMilestones).toContain('project_id = p_project_id')
    expect(deleteTasks).toContain('project_id = p_project_id')

    expectFragmentsInOrder(restoreProject, [
      'update public.projects',
      'update public.milestones',
      'update public.tasks',
    ])
    for (const statement of [restoreTasks, restoreMilestones, restoreParent]) {
      expect(statement).toContain('set deleted_at = null')
      expect(statement).toContain('owner_id = p_owner_id')
      expect(statement).toContain('deleted_at = deleted_timestamp')
    }
    expect(restoreTasks).toContain('project_id = p_project_id')
    expect(restoreMilestones).toContain('project_id = p_project_id')
    expect(restoreParent).toContain('id = p_project_id')
  })
})

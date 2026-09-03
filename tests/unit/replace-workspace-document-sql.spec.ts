import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/202608130002_replace_workspace_document.sql'

async function functionSql() {
  const sql = (await readFile(migrationPath, 'utf8')).toLowerCase()
  const start = sql.indexOf('create or replace function public.replace_workspace_document')
  expect(start).toBeGreaterThanOrEqual(0)
  const tail = sql.slice(start)
  const bodyStart = tail.indexOf('as $$')
  const bodyEnd = tail.indexOf('$$;', bodyStart)
  expect(bodyStart).toBeGreaterThanOrEqual(0)
  expect(bodyEnd).toBeGreaterThan(bodyStart)
  return { sql, body: tail.slice(bodyStart + 5, bodyEnd) }
}

function statement(body: string, verb: 'delete from' | 'insert into', table: string) {
  const start = body.indexOf(`${verb} public.${table}`)
  expect(start, `${verb} ${table}`).toBeGreaterThanOrEqual(0)
  const end = body.indexOf(';', start)
  expect(end).toBeGreaterThan(start)
  return { start, text: body.slice(start, end) }
}

describe('replace_workspace_document SQL contract', () => {
  it('locks and validates the complete v3 payload before the first delete', async () => {
    const { body } = await functionSql()
    const firstDelete = body.indexOf('delete from public.tasks')
    const firstValidation = body.indexOf("raise exception 'target owner is required'")

    expect(body).toContain('lock table public.projects')
    expect(body.indexOf('lock table public.projects')).toBeLessThan(firstValidation)
    expect(body.indexOf('lock table public.projects')).toBeLessThan(firstDelete)
    expect(body).toContain("jsonb_typeof(payload) <> 'object'")
    expect(body).toContain("payload->>'version'")
    for (const field of ['projects', 'milestones', 'tasks', 'quartergoals']) {
      expect(body).toContain(`payload->'${field}'`)
      expect(body).toContain(`jsonb_array_elements(payload->'${field}')`)
    }
    expect(body).toContain('duplicate')
    expect(body).toContain('owner mismatch')
    expect(body).toContain('invalid active relationship')
    expect(body.indexOf('invalid active relationship')).toBeLessThan(firstDelete)
    expect(body.slice(firstDelete)).not.toContain('raise exception')
  })

  it('rejects wrong JSON scalar types for every nullable field before deletion', async () => {
    const { body } = await functionSql()
    const validation = body.slice(0, body.indexOf('delete from public.tasks'))

    for (const field of [
      'priority', 'targetDate', 'deletedAt', 'projectId', 'milestoneId', 'dueDate',
      'dueTime', 'estimatedMinutes', 'reminderAt', 'snoozedUntil', 'lastRemindedAt',
      'completedAt',
    ]) {
      expect(validation).toContain(`jsonb_typeof(value->'${field.toLowerCase()}') not in`)
    }
  })

  it('rejects null or non-string enum fields as malformed before deletion', async () => {
    const { body } = await functionSql()
    const validation = body.slice(0, body.indexOf('delete from public.tasks'))
    const projectValidation = validation.slice(
      validation.indexOf("jsonb_array_elements(payload->'projects')"),
      validation.indexOf("raise exception 'malformed project value'"),
    )

    expect(projectValidation).toContain("jsonb_typeof(value->'status') <> 'string'")
    expect(validation).toContain("jsonb_typeof(value->'progressmode') <> 'string'")
    expect(validation).toContain("jsonb_typeof(value->'importance') <> 'string'")
    expect(validation).toContain("jsonb_typeof(value->'isfocus') <> 'boolean'")
    expect(validation).toContain("raise exception 'malformed project value'")
  })

  it('accepts omitted optional task fields and canonicalizes SQL insert and response defaults', async () => {
    const { body } = await functionSql()
    const taskValidation = body.slice(
      body.indexOf("jsonb_array_elements(payload->'tasks')"),
      body.indexOf("raise exception 'malformed task value'"),
    )
    const requiredKeys = taskValidation.slice(
      taskValidation.indexOf('not (value ?& array['),
      taskValidation.indexOf('])'),
    )
    const taskInsert = statement(body, 'insert into', 'tasks').text

    for (const field of ['status', 'importance', 'estimatedMinutes', 'reminderAt', 'snoozedUntil', 'lastRemindedAt']) {
      expect(requiredKeys).not.toContain(`'${field.toLowerCase()}'`)
    }
    expect(taskInsert).toContain("coalesce(value->>'status', case when value->'completedat' = 'null'::jsonb then 'todo' else 'done' end)")
    expect(taskInsert).toContain("coalesce(value->>'importance', case when value->>'priority' = 'high' then 'important' else 'normal' end)")
    for (const field of ['estimatedminutes', 'reminderat', 'snoozeduntil', 'lastremindedat']) {
      expect(taskInsert).toContain(`value->>'${field}'`)
    }
    expect(body).toMatch(/jsonb_set\(\s*payload,\s*'\{tasks\}'/)
    expect(body).toContain("'estimatedminutes', coalesce(value->'estimatedminutes', 'null'::jsonb)")
    expect(body).toContain('return canonical_payload')
  })

  it('rejects existing cross-owner task references before deleting target-owner parents', async () => {
    const { body } = await functionSql()
    const firstDelete = body.indexOf('delete from public.tasks')
    const guardStart = body.indexOf('from public.tasks existing_task')
    const guardEnd = body.indexOf("raise exception 'cross-owner task reference blocks replacement'")
    const guard = body.slice(guardStart, guardEnd)

    expect(guardStart).toBeGreaterThanOrEqual(0)
    expect(guardEnd).toBeGreaterThan(guardStart)
    expect(guardEnd).toBeLessThan(firstDelete)
    expect(guard).toContain('existing_task.owner_id <> target_owner_id')
    expect(guard).toContain('existing_task.project_id = existing_project.id')
    expect(guard).toContain('existing_project.owner_id = target_owner_id')
    expect(guard).toContain('existing_task.milestone_id = existing_milestone.id')
    expect(guard).toContain('existing_milestone.owner_id = target_owner_id')
    expect(guard).not.toContain('existing_task.deleted_at is null')
  })

  it('deletes only the target owner in child-to-parent order', async () => {
    const { body } = await functionSql()
    const tasks = statement(body, 'delete from', 'tasks')
    const milestones = statement(body, 'delete from', 'milestones')
    const goals = statement(body, 'delete from', 'quarter_goals')
    const projects = statement(body, 'delete from', 'projects')

    expect(tasks.start).toBeLessThan(milestones.start)
    expect(milestones.start).toBeLessThan(projects.start)
    for (const item of [tasks, milestones, goals, projects]) {
      expect(item.text).toContain('where owner_id = target_owner_id')
    }
  })

  it('inserts parent-to-child with every v3 field mapping', async () => {
    const { body } = await functionSql()
    const projects = statement(body, 'insert into', 'projects')
    const milestones = statement(body, 'insert into', 'milestones')
    const tasks = statement(body, 'insert into', 'tasks')
    const goals = statement(body, 'insert into', 'quarter_goals')

    expect(projects.start).toBeLessThan(milestones.start)
    expect(milestones.start).toBeLessThan(tasks.start)
    expect(tasks.start).toBeLessThan(goals.start)
    for (const field of ['description', 'priority', 'status', 'target_date', 'sort_order', 'created_at', 'updated_at', 'deleted_at']) {
      expect(projects.text).toContain(field)
    }
    for (const field of ['project_id', 'target_date', 'status', 'progress_mode', 'progress', 'sort_order', 'created_at', 'updated_at', 'deleted_at']) {
      expect(milestones.text).toContain(field)
    }
    for (const field of ['project_id', 'milestone_id', 'due_date', 'due_time', 'is_focus', 'status', 'importance', 'estimated_minutes', 'reminder_at', 'snoozed_until', 'last_reminded_at', 'sort_order', 'completed_at', 'created_at', 'updated_at', 'deleted_at']) {
      expect(tasks.text).toContain(field)
    }
    for (const field of ['quarter', 'description', 'progress', 'status', 'sort_order', 'created_at', 'updated_at', 'deleted_at']) {
      expect(goals.text).toContain(field)
    }
  })

  it('fixes privileges and preserves supplied milestone order only inside replacement', async () => {
    const { sql, body } = await functionSql()

    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = pg_catalog, public')
    expect(sql).toContain('revoke all on function public.replace_workspace_document(uuid, jsonb) from public')
    expect(sql).toContain('revoke all on function public.replace_workspace_document(uuid, jsonb) from anon')
    expect(sql).toContain('revoke all on function public.replace_workspace_document(uuid, jsonb) from authenticated')
    expect(sql).toContain('grant execute on function public.replace_workspace_document(uuid, jsonb) to service_role')
    expect(sql).toContain("current_setting('app.workspace_replacement', true)")
    expect(body).toContain("set_config('app.workspace_replacement', 'on', true)")
    expect(body.slice(body.indexOf('insert into public.milestones'), body.indexOf('insert into public.tasks')))
      .not.toContain('update public.milestones')
    expect(body.slice(body.indexOf('insert into public.milestones'), body.indexOf('insert into public.tasks')))
      .toContain("(value->>'sortorder')::integer")
    expect(body.slice(body.indexOf('insert into public.milestones'), body.indexOf('insert into public.tasks')))
      .toContain("(value->>'updatedat')::timestamptz")
    expect(body).toContain('return canonical_payload')
  })
})

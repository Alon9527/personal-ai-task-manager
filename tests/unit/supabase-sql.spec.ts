import { readFile } from 'node:fs/promises'

function functionBody(sql: string, name: string) {
  const signature = `create or replace function public.${name}`
  const functionStart = sql.indexOf(signature)
  expect(functionStart, `${name} must be defined`).toBeGreaterThanOrEqual(0)
  const nextFunctionStart = sql.indexOf('create or replace function public.', functionStart + signature.length)
  const functionSql = sql.slice(functionStart, nextFunctionStart < 0 ? sql.length : nextFunctionStart)
  const bodyStart = functionSql.indexOf('as $$')
  const bodyEnd = functionSql.indexOf('$$;', bodyStart)
  expect(bodyStart, `${name} must have a body`).toBeGreaterThanOrEqual(0)
  expect(bodyEnd, `${name} body must terminate`).toBeGreaterThan(bodyStart)
  return functionSql.slice(bodyStart + 'as $$'.length, bodyEnd)
}

function deleteStatement(body: string, table: string) {
  const start = body.indexOf(`delete from public.${table}`)
  expect(start, `delete from public.${table} must exist in this function`).toBeGreaterThanOrEqual(0)
  const end = body.indexOf(';', start)
  expect(end, `delete from public.${table} must terminate`).toBeGreaterThan(start)
  return body.slice(start, end)
}

function expectDeleteOrder(body: string) {
  const tasks = body.indexOf('delete from public.tasks')
  const milestones = body.indexOf('delete from public.milestones')
  const projects = body.indexOf('delete from public.projects')
  expect(tasks).toBeGreaterThanOrEqual(0)
  expect(milestones).toBeGreaterThan(tasks)
  expect(projects).toBeGreaterThan(milestones)
}

describe('Supabase workspace SQL', () => {
  it('defines tables, soft deletion, owner indexes, RLS, and transactional RPCs', async () => {
    const sql = (await readFile('supabase/migrations/202607220001_workspace.sql', 'utf8')).toLowerCase()

    expect(sql).toContain('create table if not exists public.projects')
    expect(sql).toContain('create table if not exists public.tasks')
    expect(sql).toContain('deleted_at timestamptz')
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('create index if not exists projects_owner_active_idx')
    expect(sql).toContain('soft_delete_project')
    expect(sql).toContain('reorder_projects')
    expect(sql).toContain('reorder_tasks')
    expect(sql).toContain('security definer')
  })

  it('uses the fixed demo owner in idempotent seed inserts', async () => {
    const sql = (await readFile('supabase/seed.sql', 'utf8')).toLowerCase()

    expect(sql).toContain('00000000-0000-4000-8000-000000000001')
    expect(sql).toContain('on conflict')
  })

  it('defines an owner-scoped atomic permanent trash cleanup', async () => {
    const sql = (await readFile('supabase/migrations/202608090002_empty_trash.sql', 'utf8')).toLowerCase()

    expect(sql).toContain('create or replace function public.empty_workspace_trash')
    expect(sql).toContain('delete from public.tasks')
    expect(sql).toContain('delete from public.projects')
    expect(sql).toContain('delete from public.quarter_goals')
    expect(sql).toContain('where owner_id = p_owner_id')
  })

  it('defines an owner-scoped transaction that clears all workspace records', async () => {
    const sql = (await readFile('supabase/migrations/202608120001_clear_workspace_data.sql', 'utf8')).toLowerCase()

    expect(sql).toContain('create or replace function public.clear_workspace_data')
    expect(sql.indexOf('delete from public.tasks')).toBeLessThan(sql.indexOf('delete from public.projects'))
    expect(sql).toContain('delete from public.quarter_goals')
    expect(sql).toContain('where owner_id = p_owner_id')
    expect(sql).toContain('revoke all on function public.clear_workspace_data(uuid) from public')
    expect(sql).toContain('grant execute on function public.clear_workspace_data(uuid) to service_role')
  })

  it('replaces clear and empty operations with owner-scoped child-before-parent milestone cleanup', async () => {
    const sql = (await readFile(
      'supabase/migrations/202608130001_project_milestones.sql',
      'utf8',
    )).toLowerCase()
    const clearBody = functionBody(sql, 'clear_workspace_data')
    const emptyBody = functionBody(sql, 'empty_workspace_trash')

    expectDeleteOrder(clearBody)
    expectDeleteOrder(emptyBody)
    for (const table of ['tasks', 'milestones', 'quarter_goals', 'projects']) {
      const clearDelete = deleteStatement(clearBody, table)
      const emptyDelete = deleteStatement(emptyBody, table)
      expect(clearDelete).toContain('where owner_id = p_owner_id')
      expect(emptyDelete).toContain('where owner_id = p_owner_id')
      expect(emptyDelete).toContain('deleted_at is not null')
    }
    expect(sql).toContain('revoke all on function public.clear_workspace_data(uuid) from public')
    expect(sql).toContain('grant execute on function public.clear_workspace_data(uuid) to service_role')
    expect(sql).toContain('revoke all on function public.empty_workspace_trash(uuid) from public')
    expect(sql).toContain('grant execute on function public.empty_workspace_trash(uuid) to service_role')
  })
})

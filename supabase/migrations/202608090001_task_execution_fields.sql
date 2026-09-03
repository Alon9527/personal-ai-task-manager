alter table public.tasks
  add column if not exists status text not null default 'todo'
    check (status in ('inbox', 'todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  add column if not exists importance text not null default 'normal'
    check (importance in ('normal', 'important')),
  add column if not exists estimated_minutes integer
    check (estimated_minutes is null or estimated_minutes between 5 and 1440),
  add column if not exists reminder_at timestamptz,
  add column if not exists snoozed_until timestamptz,
  add column if not exists last_reminded_at timestamptz;

update public.tasks
set
  status = case when completed_at is null then 'todo' else 'done' end,
  importance = case when priority = 'high' then 'important' else 'normal' end;

create index if not exists tasks_owner_status_due_idx
  on public.tasks (owner_id, status, due_date, due_time)
  where deleted_at is null;

create index if not exists tasks_owner_reminder_idx
  on public.tasks (owner_id, reminder_at)
  where deleted_at is null and completed_at is null and reminder_at is not null;

create or replace function public.restore_project(p_project_id uuid, p_owner_id uuid)
returns setof public.projects
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted_timestamp timestamptz;
begin
  select deleted_at into deleted_timestamp
  from public.projects
  where id = p_project_id and owner_id = p_owner_id and deleted_at is not null
  for update;

  if deleted_timestamp is null then
    return;
  end if;

  update public.tasks
  set deleted_at = null, updated_at = now()
  where owner_id = p_owner_id and project_id = p_project_id and deleted_at = deleted_timestamp;

  return query
  update public.projects
  set deleted_at = null, updated_at = now()
  where id = p_project_id and owner_id = p_owner_id
  returning *;
end;
$$;

create or replace function public.start_task(p_task_id uuid, p_owner_id uuid)
returns setof public.tasks
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.tasks
  set status = 'todo', updated_at = now()
  where owner_id = p_owner_id and deleted_at is null and status = 'in_progress' and id <> p_task_id;

  return query
  update public.tasks
  set status = 'in_progress', completed_at = null, is_focus = true, updated_at = now()
  where id = p_task_id and owner_id = p_owner_id and deleted_at is null
  returning *;
end;
$$;

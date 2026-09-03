begin;

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  project_id uuid references public.projects(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  priority text check (priority in ('low', 'medium', 'high')),
  due_date date,
  due_time time,
  is_focus boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists projects_owner_active_idx
  on public.projects (owner_id, sort_order)
  where deleted_at is null;

create unique index if not exists projects_owner_active_name_idx
  on public.projects (owner_id, lower(name))
  where deleted_at is null;

create index if not exists tasks_owner_active_idx
  on public.tasks (owner_id, is_focus, completed_at, sort_order)
  where deleted_at is null;

create index if not exists tasks_project_active_idx
  on public.tasks (project_id, sort_order)
  where deleted_at is null;

create or replace function public.set_workspace_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_workspace_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_workspace_updated_at();

alter table public.projects enable row level security;
alter table public.tasks enable row level security;

create or replace function public.soft_delete_project(
  p_project_id uuid,
  p_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_projects integer;
begin
  update public.projects
  set deleted_at = now()
  where id = p_project_id
    and owner_id = p_owner_id
    and deleted_at is null;

  get diagnostics affected_projects = row_count;
  if affected_projects <> 1 then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  update public.tasks
  set deleted_at = now()
  where project_id = p_project_id
    and owner_id = p_owner_id
    and deleted_at is null;
end;
$$;

create or replace function public.reorder_projects(
  p_owner_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
  distinct_count integer;
begin
  if coalesce(cardinality(p_ordered_ids), 0) = 0 then
    raise exception 'ordered project ids are required' using errcode = '22023';
  end if;

  select count(*) into active_count
  from public.projects
  where owner_id = p_owner_id and deleted_at is null;

  select count(distinct id) into distinct_count
  from unnest(p_ordered_ids) as ordered(id);

  if active_count <> cardinality(p_ordered_ids) or distinct_count <> cardinality(p_ordered_ids) then
    raise exception 'project order does not match active projects' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(p_ordered_ids) as ordered(id)
    left join public.projects project
      on project.id = ordered.id
      and project.owner_id = p_owner_id
      and project.deleted_at is null
    where project.id is null
  ) then
    raise exception 'project order contains inaccessible ids' using errcode = '22023';
  end if;

  update public.projects project
  set sort_order = ordered.ordinality - 1
  from unnest(p_ordered_ids) with ordinality as ordered(id, ordinality)
  where project.id = ordered.id and project.owner_id = p_owner_id;
end;
$$;

create or replace function public.reorder_tasks(
  p_owner_id uuid,
  p_group text,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_count integer;
  distinct_count integer;
begin
  if p_group not in ('focus', 'later', 'completed') then
    raise exception 'invalid task group' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_ordered_ids), 0) = 0 then
    raise exception 'ordered task ids are required' using errcode = '22023';
  end if;

  select count(*) into active_count
  from public.tasks
  where owner_id = p_owner_id
    and deleted_at is null
    and (
      (p_group = 'completed' and completed_at is not null)
      or (p_group = 'focus' and completed_at is null and is_focus)
      or (p_group = 'later' and completed_at is null and not is_focus)
    );

  select count(distinct id) into distinct_count
  from unnest(p_ordered_ids) as ordered(id);

  if active_count <> cardinality(p_ordered_ids) or distinct_count <> cardinality(p_ordered_ids) then
    raise exception 'task order does not match active group' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(p_ordered_ids) as ordered(id)
    left join public.tasks task
      on task.id = ordered.id
      and task.owner_id = p_owner_id
      and task.deleted_at is null
      and (
        (p_group = 'completed' and task.completed_at is not null)
        or (p_group = 'focus' and task.completed_at is null and task.is_focus)
        or (p_group = 'later' and task.completed_at is null and not task.is_focus)
      )
    where task.id is null
  ) then
    raise exception 'task order contains inaccessible ids' using errcode = '22023';
  end if;

  update public.tasks task
  set sort_order = ordered.ordinality - 1
  from unnest(p_ordered_ids) with ordinality as ordered(id, ordinality)
  where task.id = ordered.id and task.owner_id = p_owner_id;
end;
$$;

revoke all on function public.soft_delete_project(uuid, uuid) from public;
revoke all on function public.reorder_projects(uuid, uuid[]) from public;
revoke all on function public.reorder_tasks(uuid, text, uuid[]) from public;
grant execute on function public.soft_delete_project(uuid, uuid) to service_role;
grant execute on function public.reorder_projects(uuid, uuid[]) to service_role;
grant execute on function public.reorder_tasks(uuid, text, uuid[]) to service_role;

commit;

begin;

alter table public.projects
  add column if not exists description text not null default ''
    check (char_length(description) <= 4000),
  add column if not exists priority text
    check (priority in ('low', 'medium', 'high')),
  add column if not exists status text not null default 'active'
    check (status in ('planned', 'active', 'paused', 'completed')),
  add column if not exists target_date date;

create unique index if not exists projects_id_owner_uidx
  on public.projects (id, owner_id);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  project_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  target_date date,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'blocked', 'completed')),
  progress_mode text not null default 'auto'
    check (progress_mode in ('auto', 'manual')),
  progress integer not null default 0 check (progress between 0 and 100),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint milestones_project_owner_fk
    foreign key (project_id, owner_id)
    references public.projects (id, owner_id)
    on delete cascade
);

alter table public.tasks
  add column if not exists milestone_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_milestone_id_fkey'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_milestone_id_fkey
      foreign key (milestone_id)
      references public.milestones(id) on delete set null;
  end if;
end;
$$;

update public.tasks task
set project_id = null, milestone_id = null
where task.deleted_at is null
  and task.project_id is not null
  and not exists (
    select 1
    from public.projects project
    where project.id = task.project_id
      and project.owner_id = task.owner_id
      and project.deleted_at is null
  );

create index if not exists milestones_owner_active_idx
  on public.milestones (owner_id, sort_order)
  where deleted_at is null;

create index if not exists milestones_project_active_idx
  on public.milestones (owner_id, project_id, sort_order)
  where deleted_at is null;

create index if not exists milestones_owner_deleted_idx
  on public.milestones (owner_id, deleted_at, project_id, sort_order)
  where deleted_at is not null;

create index if not exists tasks_milestone_active_idx
  on public.tasks (owner_id, milestone_id, sort_order)
  where deleted_at is null and milestone_id is not null;

drop trigger if exists milestones_set_updated_at on public.milestones;
create trigger milestones_set_updated_at
before update on public.milestones
for each row execute function public.set_workspace_updated_at();

alter table public.milestones enable row level security;

drop policy if exists milestones_owner_policy on public.milestones;
create policy milestones_owner_policy
on public.milestones
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create or replace function public.enforce_milestone_active_project()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  active_project_id uuid;
  next_sort_order integer;
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'milestone owner cannot change' using errcode = '23514';
  end if;

  if new.deleted_at is not null then
    return new;
  end if;

  select project.id into active_project_id
  from public.projects project
  where project.id = new.project_id
    and project.owner_id = new.owner_id
    and project.deleted_at is null
  for update;

  if not found then
    raise exception 'active project not found for milestone owner' using errcode = '23503';
  end if;

  if tg_op = 'INSERT' or (
    tg_op = 'UPDATE' and (
      new.project_id is distinct from old.project_id
      or (old.deleted_at is not null and new.deleted_at is null)
    )
  ) then
    select coalesce(max(milestone.sort_order), -1) + 1
    into next_sort_order
    from public.milestones milestone
    where milestone.project_id = new.project_id
      and milestone.owner_id = new.owner_id
      and milestone.deleted_at is null
      and milestone.id <> new.id;
    new.sort_order := next_sort_order;
  end if;

  return new;
end;
$$;

drop trigger if exists milestones_enforce_active_project on public.milestones;
create trigger milestones_enforce_active_project
before insert or update of project_id, owner_id, deleted_at on public.milestones
for each row execute function public.enforce_milestone_active_project();

create or replace function public.enforce_task_milestone_link()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  linked_project_id uuid;
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'task owner cannot change' using errcode = '23514';
  end if;

  if new.deleted_at is not null then
    return new;
  end if;

  if new.milestone_id is not null then
    select milestone.project_id into linked_project_id
    from public.milestones milestone
    join public.projects project
      on project.id = milestone.project_id
      and project.owner_id = milestone.owner_id
      and project.deleted_at is null
    where milestone.id = new.milestone_id
      and milestone.owner_id = new.owner_id
      and milestone.deleted_at is null
    for share of milestone, project;

    if not found then
      raise exception 'active milestone not found for task owner' using errcode = '23503';
    end if;

    new.project_id := linked_project_id;
  elsif new.project_id is not null then
    select project.id into linked_project_id
    from public.projects project
    where project.id = new.project_id
      and project.owner_id = new.owner_id
      and project.deleted_at is null
    for share;

    if not found then
      raise exception 'active project not found for task owner' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_enforce_milestone_link on public.tasks;
create trigger tasks_enforce_milestone_link
before insert or update of milestone_id, owner_id, project_id, deleted_at on public.tasks
for each row execute function public.enforce_task_milestone_link();

create or replace function public.sync_milestone_task_project()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.project_id is distinct from old.project_id then
    update public.tasks
    set project_id = new.project_id, updated_at = now()
    where milestone_id = new.id
      and owner_id = new.owner_id;
  end if;

  return new;
end;
$$;

drop trigger if exists milestones_sync_task_project on public.milestones;
create trigger milestones_sync_task_project
after update of project_id on public.milestones
for each row execute function public.sync_milestone_task_project();

create or replace function public.soft_delete_milestone(p_milestone_id uuid, p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_timestamp timestamptz := now();
  affected_milestones integer;
begin
  perform 1
  from public.milestones
  where id = p_milestone_id
    and owner_id = p_owner_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  update public.tasks
  set milestone_id = null, updated_at = now()
  where milestone_id = p_milestone_id
    and owner_id = p_owner_id;

  update public.milestones
  set deleted_at = deleted_timestamp
  where id = p_milestone_id
    and owner_id = p_owner_id
    and deleted_at is null;

  get diagnostics affected_milestones = row_count;
  if affected_milestones <> 1 then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.restore_milestone(p_milestone_id uuid, p_owner_id uuid)
returns setof public.milestones
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted_timestamp timestamptz;
  project_deleted_timestamp timestamptz;
begin
  select milestone.deleted_at, project.deleted_at
  into deleted_timestamp, project_deleted_timestamp
  from public.milestones milestone
  join public.projects project
    on project.id = milestone.project_id
    and project.owner_id = p_owner_id
  where milestone.id = p_milestone_id
    and milestone.owner_id = p_owner_id
    and milestone.deleted_at is not null
  for update of milestone, project;

  if deleted_timestamp is null then
    return;
  end if;

  if project_deleted_timestamp is not null then
    raise exception 'cannot restore milestone into deleted project' using errcode = '55000';
  end if;

  return query
  update public.milestones
  set deleted_at = null, updated_at = now()
  where id = p_milestone_id
    and owner_id = p_owner_id
    and deleted_at = deleted_timestamp
  returning *;
end;
$$;

create or replace function public.reorder_milestones(p_owner_id uuid, p_project_id uuid, p_ordered_ids uuid[])
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
    raise exception 'ordered milestone ids are required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.projects
    where id = p_project_id
      and owner_id = p_owner_id
      and deleted_at is null
  ) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  select count(*) into active_count
  from public.milestones
  where owner_id = p_owner_id
    and project_id = p_project_id
    and deleted_at is null;

  select count(distinct id) into distinct_count
  from unnest(p_ordered_ids) as ordered(id);

  if active_count <> cardinality(p_ordered_ids)
    or distinct_count <> cardinality(p_ordered_ids) then
    raise exception 'milestone order does not match active milestones' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_ordered_ids) as ordered(id)
    left join public.milestones milestone
      on milestone.id = ordered.id
      and milestone.owner_id = p_owner_id
      and milestone.project_id = p_project_id
      and milestone.deleted_at is null
    where milestone.id is null
  ) then
    raise exception 'milestone order contains inaccessible ids' using errcode = '22023';
  end if;

  update public.milestones milestone
  set sort_order = ordered.ordinality - 1
  from unnest(p_ordered_ids) with ordinality as ordered(id, ordinality)
  where milestone.id = ordered.id
    and milestone.owner_id = p_owner_id
    and milestone.project_id = p_project_id
    and milestone.deleted_at is null;
end;
$$;

create or replace function public.restore_task(p_task_id uuid, p_owner_id uuid)
returns setof public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_timestamp timestamptz;
  restored_project_id uuid;
  restored_milestone_id uuid;
  milestone_project_id uuid;
begin
  select task.deleted_at, task.project_id, task.milestone_id
  into deleted_timestamp, restored_project_id, restored_milestone_id
  from public.tasks task
  where task.id = p_task_id
    and task.owner_id = p_owner_id
    and task.deleted_at is not null
  for update of task;

  if deleted_timestamp is null then
    return;
  end if;

  if restored_milestone_id is not null then
    select milestone.project_id into milestone_project_id
    from public.milestones milestone
    join public.projects project
      on project.id = milestone.project_id
      and project.owner_id = milestone.owner_id
      and project.deleted_at is null
    where milestone.id = restored_milestone_id
      and milestone.owner_id = p_owner_id
      and milestone.deleted_at is null
    for share of milestone, project;

    if found then
      restored_project_id := milestone_project_id;
    else
      restored_milestone_id := null;
    end if;
  end if;

  if restored_milestone_id is null and restored_project_id is not null then
    perform 1
    from public.projects project
    where project.id = restored_project_id
      and project.owner_id = p_owner_id
      and project.deleted_at is null
    for share;

    if not found then
      restored_project_id := null;
    end if;
  end if;

  return query
  update public.tasks
  set project_id = restored_project_id,
      milestone_id = restored_milestone_id,
      deleted_at = null,
      updated_at = now()
  where id = p_task_id
    and owner_id = p_owner_id
    and deleted_at = deleted_timestamp
  returning *;
end;
$$;

create or replace function public.soft_delete_project(p_project_id uuid, p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_timestamp timestamptz := now();
  affected_projects integer;
begin
  update public.projects
  set deleted_at = deleted_timestamp
  where id = p_project_id
    and owner_id = p_owner_id
    and deleted_at is null;

  get diagnostics affected_projects = row_count;
  if affected_projects <> 1 then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  update public.milestones
  set deleted_at = deleted_timestamp
  where project_id = p_project_id
    and owner_id = p_owner_id
    and deleted_at is null;

  update public.tasks
  set deleted_at = deleted_timestamp
  where project_id = p_project_id
    and owner_id = p_owner_id
    and deleted_at is null;
end;
$$;

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

  update public.projects
  set deleted_at = null, updated_at = now()
  where id = p_project_id
    and owner_id = p_owner_id
    and deleted_at = deleted_timestamp;

  update public.milestones
  set deleted_at = null, updated_at = now()
  where owner_id = p_owner_id
    and project_id = p_project_id
    and deleted_at = deleted_timestamp;

  update public.tasks
  set deleted_at = null, updated_at = now()
  where owner_id = p_owner_id
    and project_id = p_project_id
    and deleted_at = deleted_timestamp;

  return query
  select * from public.projects
  where id = p_project_id
    and owner_id = p_owner_id
    and deleted_at is null;
end;
$$;

create or replace function public.clear_workspace_data(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.tasks
  where owner_id = p_owner_id;

  delete from public.milestones
  where owner_id = p_owner_id;

  delete from public.quarter_goals
  where owner_id = p_owner_id;

  delete from public.projects
  where owner_id = p_owner_id;
end;
$$;

create or replace function public.empty_workspace_trash(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.tasks
  where owner_id = p_owner_id
    and deleted_at is not null;

  delete from public.milestones
  where owner_id = p_owner_id
    and deleted_at is not null;

  delete from public.quarter_goals
  where owner_id = p_owner_id
    and deleted_at is not null;

  delete from public.projects
  where owner_id = p_owner_id
    and deleted_at is not null;
end;
$$;

revoke all on function public.soft_delete_milestone(uuid, uuid) from public;
revoke all on function public.restore_milestone(uuid, uuid) from public;
revoke all on function public.reorder_milestones(uuid, uuid, uuid[]) from public;
revoke all on function public.restore_task(uuid, uuid) from public;
revoke all on function public.soft_delete_project(uuid, uuid) from public;
revoke all on function public.restore_project(uuid, uuid) from public;
revoke all on function public.clear_workspace_data(uuid) from public;
revoke all on function public.empty_workspace_trash(uuid) from public;

grant execute on function public.soft_delete_milestone(uuid, uuid) to service_role;
grant execute on function public.restore_milestone(uuid, uuid) to service_role;
grant execute on function public.reorder_milestones(uuid, uuid, uuid[]) to service_role;
grant execute on function public.restore_task(uuid, uuid) to service_role;
grant execute on function public.soft_delete_project(uuid, uuid) to service_role;
grant execute on function public.restore_project(uuid, uuid) to service_role;
grant execute on function public.clear_workspace_data(uuid) to service_role;
grant execute on function public.empty_workspace_trash(uuid) to service_role;

commit;

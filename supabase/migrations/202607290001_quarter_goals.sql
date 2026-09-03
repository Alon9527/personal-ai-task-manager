begin;

create table if not exists public.quarter_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  quarter text not null check (quarter ~ '^\d{4}-Q[1-4]$'),
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  progress integer not null default 0 check (progress between 0 and 100),
  status text not null default 'active'
    check (status in ('active', 'completed', 'paused')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists quarter_goals_owner_quarter_active_idx
  on public.quarter_goals (owner_id, quarter, sort_order)
  where deleted_at is null;

drop trigger if exists quarter_goals_set_updated_at on public.quarter_goals;
create trigger quarter_goals_set_updated_at
before update on public.quarter_goals
for each row execute function public.set_workspace_updated_at();

alter table public.quarter_goals enable row level security;

create or replace function public.reorder_quarter_goals(
  p_owner_id uuid,
  p_quarter text,
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
  if p_quarter !~ '^\d{4}-Q[1-4]$' then
    raise exception 'invalid quarter' using errcode = '22023';
  end if;

  if coalesce(cardinality(p_ordered_ids), 0) = 0 then
    raise exception 'ordered quarter goal ids are required' using errcode = '22023';
  end if;

  select count(*) into active_count
  from public.quarter_goals
  where owner_id = p_owner_id
    and quarter = p_quarter
    and deleted_at is null;

  select count(distinct id) into distinct_count
  from unnest(p_ordered_ids) as ordered(id);

  if active_count <> cardinality(p_ordered_ids)
    or distinct_count <> cardinality(p_ordered_ids) then
    raise exception 'quarter goal order does not match active goals' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_ordered_ids) as ordered(id)
    left join public.quarter_goals goal
      on goal.id = ordered.id
      and goal.owner_id = p_owner_id
      and goal.quarter = p_quarter
      and goal.deleted_at is null
    where goal.id is null
  ) then
    raise exception 'quarter goal order contains inaccessible ids' using errcode = '22023';
  end if;

  update public.quarter_goals goal
  set sort_order = ordered.ordinality - 1
  from unnest(p_ordered_ids) with ordinality as ordered(id, ordinality)
  where goal.id = ordered.id
    and goal.owner_id = p_owner_id
    and goal.quarter = p_quarter
    and goal.deleted_at is null;
end;
$$;

revoke all on function public.reorder_quarter_goals(uuid, text, uuid[]) from public;
grant execute on function public.reorder_quarter_goals(uuid, text, uuid[]) to service_role;

commit;

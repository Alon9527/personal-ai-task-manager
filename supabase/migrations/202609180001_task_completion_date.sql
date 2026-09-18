-- Optional user-entered completion date; independent of completed_at and status.
begin;
alter table public.tasks add column if not exists completion_date date;

create or replace function public.replace_workspace_document(
  target_owner_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  canonical_payload jsonb;
begin
  -- This conflicts with the RowExclusive lock used by ordinary REST writes and
  -- serializes the complete validation/delete/insert window.
  lock table public.projects, public.milestones, public.tasks, public.quarter_goals
    in share row exclusive mode;

  if target_owner_id is null then
    raise exception 'target owner is required' using errcode = '22023';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'workspace payload must be an object' using errcode = '22023';
  end if;
  if not (payload ? 'version')
    or jsonb_typeof(payload->'version') not in ('number', 'string')
    or payload->>'version' <> '3' then
    raise exception 'workspace version must be 3' using errcode = '22023';
  end if;
  if not (payload ?& array['projects', 'milestones', 'tasks', 'quarterGoals'])
    or jsonb_typeof(payload->'projects') <> 'array'
    or jsonb_typeof(payload->'milestones') <> 'array'
    or jsonb_typeof(payload->'tasks') <> 'array'
    or jsonb_typeof(payload->'quarterGoals') <> 'array' then
    raise exception 'workspace arrays are required' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(payload->'projects') as item(value)
    where jsonb_typeof(value) <> 'object'
      or not (value ?& array[
        'id', 'ownerId', 'name', 'color', 'description', 'priority', 'status',
        'targetDate', 'sortOrder', 'createdAt', 'updatedAt', 'deletedAt'
      ])
      or jsonb_typeof(value->'id') <> 'string'
      or jsonb_typeof(value->'ownerId') <> 'string'
      or jsonb_typeof(value->'name') <> 'string'
      or jsonb_typeof(value->'color') <> 'string'
      or jsonb_typeof(value->'description') <> 'string'
      or jsonb_typeof(value->'priority') not in ('string', 'null')
      or jsonb_typeof(value->'status') <> 'string'
      or jsonb_typeof(value->'targetDate') not in ('string', 'null')
      or jsonb_typeof(value->'sortOrder') <> 'number'
      or jsonb_typeof(value->'createdAt') <> 'string'
      or jsonb_typeof(value->'updatedAt') <> 'string'
      or jsonb_typeof(value->'deletedAt') not in ('string', 'null')
  ) then
    raise exception 'malformed project value' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(payload->'milestones') as item(value)
    where jsonb_typeof(value) <> 'object'
      or not (value ?& array[
        'id', 'ownerId', 'projectId', 'title', 'description', 'targetDate',
        'status', 'progressMode', 'progress', 'sortOrder', 'createdAt', 'updatedAt', 'deletedAt'
      ])
      or jsonb_typeof(value->'id') <> 'string'
      or jsonb_typeof(value->'ownerId') <> 'string'
      or jsonb_typeof(value->'projectId') <> 'string'
      or jsonb_typeof(value->'title') <> 'string'
      or jsonb_typeof(value->'description') <> 'string'
      or jsonb_typeof(value->'targetDate') not in ('string', 'null')
      or jsonb_typeof(value->'status') <> 'string'
      or jsonb_typeof(value->'progressMode') <> 'string'
      or jsonb_typeof(value->'progress') <> 'number'
      or jsonb_typeof(value->'sortOrder') <> 'number'
      or jsonb_typeof(value->'createdAt') <> 'string'
      or jsonb_typeof(value->'updatedAt') <> 'string'
      or jsonb_typeof(value->'deletedAt') not in ('string', 'null')
  ) then
    raise exception 'malformed milestone value' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(payload->'tasks') as item(value)
    where jsonb_typeof(value) <> 'object'
      or not (value ?& array[
        'id', 'ownerId', 'projectId', 'milestoneId', 'title', 'description', 'priority',
        'dueDate', 'dueTime', 'isFocus', 'sortOrder', 'completedAt',
        'createdAt', 'updatedAt', 'deletedAt'
      ])
      or jsonb_typeof(value->'id') <> 'string'
      or jsonb_typeof(value->'ownerId') <> 'string'
      or jsonb_typeof(value->'projectId') not in ('string', 'null')
      or jsonb_typeof(value->'milestoneId') not in ('string', 'null')
      or jsonb_typeof(value->'title') <> 'string'
      or jsonb_typeof(value->'description') <> 'string'
      or jsonb_typeof(value->'priority') not in ('string', 'null')
      or jsonb_typeof(value->'dueDate') not in ('string', 'null')
      or (value ? 'completionDate' and jsonb_typeof(value->'completionDate') not in ('string', 'null'))
      or jsonb_typeof(value->'dueTime') not in ('string', 'null')
      or jsonb_typeof(value->'isFocus') <> 'boolean'
      or jsonb_typeof(value->'status') <> 'string'
      or jsonb_typeof(value->'importance') <> 'string'
      or jsonb_typeof(value->'estimatedMinutes') not in ('number', 'null')
      or jsonb_typeof(value->'reminderAt') not in ('string', 'null')
      or jsonb_typeof(value->'snoozedUntil') not in ('string', 'null')
      or jsonb_typeof(value->'lastRemindedAt') not in ('string', 'null')
      or jsonb_typeof(value->'sortOrder') <> 'number'
      or jsonb_typeof(value->'completedAt') not in ('string', 'null')
      or jsonb_typeof(value->'createdAt') <> 'string'
      or jsonb_typeof(value->'updatedAt') <> 'string'
      or jsonb_typeof(value->'deletedAt') not in ('string', 'null')
  ) then
    raise exception 'malformed task value' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(payload->'quarterGoals') as item(value)
    where jsonb_typeof(value) <> 'object'
      or not (value ?& array[
        'id', 'ownerId', 'quarter', 'title', 'description', 'progress', 'status',
        'sortOrder', 'createdAt', 'updatedAt', 'deletedAt'
      ])
      or jsonb_typeof(value->'id') <> 'string'
      or jsonb_typeof(value->'ownerId') <> 'string'
      or jsonb_typeof(value->'quarter') <> 'string'
      or jsonb_typeof(value->'title') <> 'string'
      or jsonb_typeof(value->'description') <> 'string'
      or jsonb_typeof(value->'progress') <> 'number'
      or jsonb_typeof(value->'status') <> 'string'
      or jsonb_typeof(value->'sortOrder') <> 'number'
      or jsonb_typeof(value->'createdAt') <> 'string'
      or jsonb_typeof(value->'updatedAt') <> 'string'
      or jsonb_typeof(value->'deletedAt') not in ('string', 'null')
  ) then
    raise exception 'malformed quarter goal value' using errcode = '22023';
  end if;

  -- Force every database cast before the first delete. Nullable values cast to NULL.
  perform
    (value->>'id')::uuid, (value->>'ownerId')::uuid,
    (value->>'targetDate')::date, (value->>'sortOrder')::integer,
    (value->>'createdAt')::timestamptz, (value->>'updatedAt')::timestamptz,
    (value->>'deletedAt')::timestamptz
  from jsonb_array_elements(payload->'projects') as item(value);

  perform
    (value->>'id')::uuid, (value->>'ownerId')::uuid, (value->>'projectId')::uuid,
    (value->>'targetDate')::date, (value->>'progress')::integer,
    (value->>'sortOrder')::integer, (value->>'createdAt')::timestamptz,
    (value->>'updatedAt')::timestamptz, (value->>'deletedAt')::timestamptz
  from jsonb_array_elements(payload->'milestones') as item(value);

  perform
    (value->>'id')::uuid, (value->>'ownerId')::uuid, (value->>'projectId')::uuid,
    (value->>'milestoneId')::uuid, (value->>'completionDate')::date, (value->>'dueDate')::date, (value->>'dueTime')::time,
    (value->>'isFocus')::boolean, (value->>'estimatedMinutes')::integer,
    (value->>'reminderAt')::timestamptz, (value->>'snoozedUntil')::timestamptz,
    (value->>'lastRemindedAt')::timestamptz, (value->>'sortOrder')::integer,
    (value->>'completedAt')::timestamptz, (value->>'createdAt')::timestamptz,
    (value->>'updatedAt')::timestamptz, (value->>'deletedAt')::timestamptz
  from jsonb_array_elements(payload->'tasks') as item(value);

  perform
    (value->>'id')::uuid, (value->>'ownerId')::uuid, (value->>'progress')::integer,
    (value->>'sortOrder')::integer, (value->>'createdAt')::timestamptz,
    (value->>'updatedAt')::timestamptz, (value->>'deletedAt')::timestamptz
  from jsonb_array_elements(payload->'quarterGoals') as item(value);

  if exists (
    select 1 from (
      select value->>'ownerId' as owner_id from jsonb_array_elements(payload->'projects') as item(value)
      union all select value->>'ownerId' from jsonb_array_elements(payload->'milestones') as item(value)
      union all select value->>'ownerId' from jsonb_array_elements(payload->'tasks') as item(value)
      union all select value->>'ownerId' from jsonb_array_elements(payload->'quarterGoals') as item(value)
    ) owners where owner_id is distinct from target_owner_id::text
  ) then
    raise exception 'workspace owner mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1 from (
      select 'projects' as entity, value->>'id' as id from jsonb_array_elements(payload->'projects') as item(value)
      union all select 'milestones', value->>'id' from jsonb_array_elements(payload->'milestones') as item(value)
      union all select 'tasks', value->>'id' from jsonb_array_elements(payload->'tasks') as item(value)
      union all select 'quarterGoals', value->>'id' from jsonb_array_elements(payload->'quarterGoals') as item(value)
    ) ids group by entity, id having count(*) > 1
  ) then
    raise exception 'duplicate workspace id' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(payload->'projects') as project(value)
    where char_length(trim(value->>'name')) not between 1 and 80
      or value->>'color' !~ '^#[0-9A-Fa-f]{6}$'
      or char_length(value->>'description') > 4000
      or coalesce(value->>'priority', '') not in ('', 'low', 'medium', 'high')
      or value->>'status' not in ('planned', 'active', 'paused', 'completed')
      or (value->>'sortOrder')::integer < 0
  ) or exists (
    select 1
    from jsonb_array_elements(payload->'milestones') as milestone(value)
    where char_length(trim(value->>'title')) not between 1 and 160
      or char_length(value->>'description') > 4000
      or value->>'status' not in ('planned', 'in_progress', 'blocked', 'completed')
      or value->>'progressMode' not in ('auto', 'manual')
      or (value->>'progress')::integer not between 0 and 100
      or (value->>'sortOrder')::integer < 0
  ) or exists (
    select 1
    from jsonb_array_elements(payload->'tasks') as task(value)
    where char_length(trim(value->>'title')) not between 1 and 160
      or char_length(value->>'description') > 4000
      or coalesce(value->>'priority', '') not in ('', 'low', 'medium', 'high')
      or value->>'status' not in ('inbox', 'todo', 'in_progress', 'waiting', 'done', 'cancelled')
      or value->>'importance' not in ('normal', 'important')
      or (value->>'estimatedMinutes' is not null and (value->>'estimatedMinutes')::integer not between 5 and 1440)
      or (value->>'sortOrder')::integer < 0
  ) or exists (
    select 1
    from jsonb_array_elements(payload->'quarterGoals') as goal(value)
    where value->>'quarter' !~ '^\d{4}-Q[1-4]$'
      or char_length(trim(value->>'title')) not between 1 and 160
      or char_length(value->>'description') > 4000
      or (value->>'progress')::integer not between 0 and 100
      or value->>'status' not in ('active', 'completed', 'paused')
      or (value->>'sortOrder')::integer < 0
  ) then
    raise exception 'workspace field constraint failed' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(payload->'milestones') as milestone(value)
    left join jsonb_array_elements(payload->'projects') as project(value)
      on project.value->>'id' = milestone.value->>'projectId'
    where project.value is null
      or (
        milestone.value->'deletedAt' = 'null'::jsonb
        and project.value->'deletedAt' <> 'null'::jsonb
      )
  ) or exists (
    select 1
    from jsonb_array_elements(payload->'tasks') as task(value)
    left join jsonb_array_elements(payload->'projects') as project(value)
      on project.value->>'id' = task.value->>'projectId'
    left join jsonb_array_elements(payload->'milestones') as milestone(value)
      on milestone.value->>'id' = task.value->>'milestoneId'
    where (task.value->'projectId' <> 'null'::jsonb and project.value is null)
      or (task.value->'milestoneId' <> 'null'::jsonb and milestone.value is null)
      or (
        task.value->'milestoneId' <> 'null'::jsonb
        and task.value->>'projectId' is distinct from milestone.value->>'projectId'
      )
      or (
        task.value->'deletedAt' = 'null'::jsonb
        and task.value->'projectId' <> 'null'::jsonb
        and project.value->'deletedAt' <> 'null'::jsonb
      )
      or (
        task.value->'deletedAt' = 'null'::jsonb
        and task.value->'milestoneId' <> 'null'::jsonb
        and milestone.value->'deletedAt' <> 'null'::jsonb
      )
  ) then
    raise exception 'invalid active relationship' using errcode = '22023';
  end if;

  select jsonb_set(
    payload,
    '{tasks}',
    coalesce(
      jsonb_agg(
        value || jsonb_build_object(
          'status', to_jsonb(coalesce(
            value->>'status',
            case when value->'completedAt' = 'null'::jsonb then 'todo' else 'done' end
          )),
          'importance', to_jsonb(coalesce(
            value->>'importance',
            case when value->>'priority' = 'high' then 'important' else 'normal' end
          )),
          'completionDate', coalesce(value->'completionDate', 'null'::jsonb),
          'estimatedMinutes', coalesce(value->'estimatedMinutes', 'null'::jsonb),
          'reminderAt', coalesce(value->'reminderAt', 'null'::jsonb),
          'snoozedUntil', coalesce(value->'snoozedUntil', 'null'::jsonb),
          'lastRemindedAt', coalesce(value->'lastRemindedAt', 'null'::jsonb)
        ) order by ordinality
      ),
      '[]'::jsonb
    )
  )
  into canonical_payload
  from jsonb_array_elements(payload->'tasks') with ordinality as item(value, ordinality);

  -- A task owned by somebody else can still retain a historical project or
  -- milestone FK into this owner's rows. Reject before deletion so cascading
  -- FK behavior can never detach or otherwise mutate another owner's task.
  if exists (
    select 1
    from public.tasks existing_task
    left join public.projects existing_project
      on existing_task.project_id = existing_project.id
      and existing_project.owner_id = target_owner_id
    left join public.milestones existing_milestone
      on existing_task.milestone_id = existing_milestone.id
      and existing_milestone.owner_id = target_owner_id
    where existing_task.owner_id <> target_owner_id
      and (existing_project.id is not null or existing_milestone.id is not null)
  ) then
    raise exception 'cross-owner task reference blocks replacement' using errcode = '23503';
  end if;

  delete from public.tasks
  where owner_id = target_owner_id;

  delete from public.milestones
  where owner_id = target_owner_id;

  delete from public.quarter_goals
  where owner_id = target_owner_id;

  delete from public.projects
  where owner_id = target_owner_id;

  insert into public.projects (
    id, owner_id, name, color, description, priority, status, target_date,
    sort_order, created_at, updated_at, deleted_at
  )
  select
    (value->>'id')::uuid, (value->>'ownerId')::uuid, value->>'name', value->>'color',
    value->>'description', value->>'priority', value->>'status', (value->>'targetDate')::date,
    (value->>'sortOrder')::integer, (value->>'createdAt')::timestamptz,
    (value->>'updatedAt')::timestamptz, (value->>'deletedAt')::timestamptz
  from jsonb_array_elements(payload->'projects') as item(value);

  perform set_config('app.workspace_replacement', 'on', true);

  insert into public.milestones (
    id, owner_id, project_id, title, description, target_date, status, progress_mode,
    progress, sort_order, created_at, updated_at, deleted_at
  )
  select
    (value->>'id')::uuid, (value->>'ownerId')::uuid, (value->>'projectId')::uuid,
    value->>'title', value->>'description', (value->>'targetDate')::date, value->>'status',
    value->>'progressMode', (value->>'progress')::integer, (value->>'sortOrder')::integer,
    (value->>'createdAt')::timestamptz, (value->>'updatedAt')::timestamptz,
    (value->>'deletedAt')::timestamptz
  from jsonb_array_elements(payload->'milestones') as item(value);

  insert into public.tasks (
    id, owner_id, project_id, milestone_id, title, description, priority, start_date, due_date, completion_date,
    due_time, is_focus, status, importance, estimated_minutes, reminder_at,
    snoozed_until, last_reminded_at, sort_order, completed_at, created_at, updated_at, deleted_at
  )
  select
    (value->>'id')::uuid, (value->>'ownerId')::uuid, (value->>'projectId')::uuid,
    (value->>'milestoneId')::uuid, value->>'title', value->>'description', value->>'priority',
    (value->>'startDate')::date, (value->>'dueDate')::date, (value->>'completionDate')::date, (value->>'dueTime')::time, (value->>'isFocus')::boolean,
    coalesce(value->>'status', case when value->'completedAt' = 'null'::jsonb then 'todo' else 'done' end),
    coalesce(value->>'importance', case when value->>'priority' = 'high' then 'important' else 'normal' end),
    (value->>'estimatedMinutes')::integer,
    (value->>'reminderAt')::timestamptz, (value->>'snoozedUntil')::timestamptz,
    (value->>'lastRemindedAt')::timestamptz, (value->>'sortOrder')::integer,
    (value->>'completedAt')::timestamptz, (value->>'createdAt')::timestamptz,
    (value->>'updatedAt')::timestamptz, (value->>'deletedAt')::timestamptz
  from jsonb_array_elements(canonical_payload->'tasks') as item(value);

  insert into public.quarter_goals (
    id, owner_id, quarter, title, description, progress, status, sort_order,
    created_at, updated_at, deleted_at
  )
  select
    (value->>'id')::uuid, (value->>'ownerId')::uuid, value->>'quarter', value->>'title',
    value->>'description', (value->>'progress')::integer, value->>'status',
    (value->>'sortOrder')::integer, (value->>'createdAt')::timestamptz,
    (value->>'updatedAt')::timestamptz, (value->>'deletedAt')::timestamptz
  from jsonb_array_elements(payload->'quarterGoals') as item(value);

  return canonical_payload;
end;
$$;

revoke all on function public.replace_workspace_document(uuid, jsonb) from public;
revoke all on function public.replace_workspace_document(uuid, jsonb) from anon;
revoke all on function public.replace_workspace_document(uuid, jsonb) from authenticated;
grant execute on function public.replace_workspace_document(uuid, jsonb) to service_role;

commit;

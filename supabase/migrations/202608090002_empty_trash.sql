begin;

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

  delete from public.quarter_goals
  where owner_id = p_owner_id
    and deleted_at is not null;

  delete from public.projects
  where owner_id = p_owner_id
    and deleted_at is not null;
end;
$$;

revoke all on function public.empty_workspace_trash(uuid) from public;
grant execute on function public.empty_workspace_trash(uuid) to service_role;

commit;

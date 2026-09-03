begin;

create or replace function public.clear_workspace_data(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.tasks
  where owner_id = p_owner_id;

  delete from public.quarter_goals
  where owner_id = p_owner_id;

  delete from public.projects
  where owner_id = p_owner_id;
end;
$$;

revoke all on function public.clear_workspace_data(uuid) from public;
grant execute on function public.clear_workspace_data(uuid) to service_role;

commit;

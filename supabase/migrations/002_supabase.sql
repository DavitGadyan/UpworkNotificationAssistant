-- Supabase-only: access rules and realtime. Single-user app: only the owner's account (email listed in
-- private.owners) can read or change anything through the API. The server uses the database connection
-- directly and is not affected by RLS.

create table if not exists private.owners (email text primary key);

create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.owners o where o.email = coalesce(auth.jwt() ->> 'email', ''));
$$;
grant usage on schema private to authenticated;
grant execute on function private.is_owner() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['settings','feeds','jobs','notifications','counters','proposals','job_watch','feedback',
                           'prompt_versions','metrics_snapshots','reports','mcp_log','devices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_read on public.%I', t);
    execute format('create policy owner_read on public.%I for select to authenticated using (private.is_owner())', t);
  end loop;
end $$;

-- What the mobile app may change directly. Everything that touches Upwork or Claude goes through the backend API.
drop policy if exists owner_feedback on public.feedback;
create policy owner_feedback on public.feedback for insert to authenticated with check (private.is_owner());
drop policy if exists owner_job_status on public.jobs;
create policy owner_job_status on public.jobs for update to authenticated using (private.is_owner()) with check (private.is_owner());
drop policy if exists owner_settings on public.settings;
create policy owner_settings on public.settings for update to authenticated using (private.is_owner()) with check (private.is_owner());
drop policy if exists owner_devices on public.devices;
create policy owner_devices on public.devices for insert to authenticated with check (private.is_owner());

-- Column-level limits for client updates: jobs → status only; settings → data only.
revoke update on public.jobs from authenticated;
grant update (status) on public.jobs to authenticated;
revoke update on public.settings from authenticated;
grant update (data) on public.settings to authenticated;

-- Live updates for the mobile app.
do $$ begin
  begin alter publication supabase_realtime add table public.jobs; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.proposals; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.job_watch; exception when duplicate_object then null; end;
end $$;

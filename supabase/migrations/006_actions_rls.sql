alter table public.action_requests enable row level security;
alter table public.worker_status enable row level security;
drop policy if exists owner_read on public.action_requests;
create policy owner_read on public.action_requests for select to authenticated using (private.is_owner());
drop policy if exists owner_insert on public.action_requests;
create policy owner_insert on public.action_requests for insert to authenticated with check (private.is_owner() and status = 'queued');
drop policy if exists owner_read on public.worker_status;
create policy owner_read on public.worker_status for select to authenticated using (private.is_owner());
revoke update, delete on public.action_requests from authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'pulse_app') then
    grant all on public.action_requests, public.worker_status to pulse_app;
    grant all on sequence public.action_requests_id_seq to pulse_app;
  end if;
end $$;
do $$ begin
  begin alter publication supabase_realtime add table public.action_requests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.worker_status; exception when duplicate_object then null; end;
end $$;

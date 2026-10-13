-- Supabase-only: owner read access + backend role grants for 003.
do $$
declare t text;
begin
  foreach t in array array['job_outcomes','clients'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_read on public.%I', t);
    execute format('create policy owner_read on public.%I for select to authenticated using (private.is_owner())', t);
  end loop;
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'pulse_app') then
    grant all on public.job_outcomes, public.clients to pulse_app;
  end if;
end $$;

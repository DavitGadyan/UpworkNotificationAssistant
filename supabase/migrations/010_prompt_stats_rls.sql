-- Supabase-only: owner read access for the phone app + backend role grants for 009.
alter table public.prompt_stats enable row level security;
drop policy if exists owner_read on public.prompt_stats;
create policy owner_read on public.prompt_stats for select to authenticated using (private.is_owner());
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'pulse_app') then
    grant all on public.prompt_stats to pulse_app;
  end if;
end $$;

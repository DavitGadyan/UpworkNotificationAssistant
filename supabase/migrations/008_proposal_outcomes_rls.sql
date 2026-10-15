-- Supabase-only: owner read access for the phone app + backend role grants for 007.
alter table public.proposal_outcomes enable row level security;
drop policy if exists owner_read on public.proposal_outcomes;
create policy owner_read on public.proposal_outcomes for select to authenticated using (private.is_owner());
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'pulse_app') then
    grant all on public.proposal_outcomes to pulse_app;
  end if;
end $$;

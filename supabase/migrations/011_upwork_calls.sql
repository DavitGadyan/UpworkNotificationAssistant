-- Permanent history of every Upwork call (David, 2026-10-19). mcp_log keeps 7 days for the live budgets; this table
-- is never purged, so we can see which call rates Upwork throttled or restricted ("too quickly", "restricted").
-- Written next to mcp_log by logMcpCall; older rows are copied in by `npm run calls -- backfill`.
create table if not exists public.upwork_calls (
  id bigserial primary key,
  created_at bigint not null,          -- epoch ms
  source text not null,                -- worker | chat | backfill
  tool text not null,
  action text,
  category text,                       -- most_recent | best_match | saved_query | keyword | get | ... (chat loop)
  ok boolean not null,
  error_class text,                    -- restricted | throttle | transient | auth | other (null when ok)
  ms int not null default 0,
  detail text,
  mcp_log_id bigint unique             -- set for rows copied from mcp_log, so the backfill can run again safely
);
create index if not exists upwork_calls_created on public.upwork_calls (created_at);
create index if not exists upwork_calls_class on public.upwork_calls (error_class) where error_class is not null;

alter table public.upwork_calls enable row level security;
drop policy if exists owner_read on public.upwork_calls;
create policy owner_read on public.upwork_calls for select to authenticated using (private.is_owner());
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'pulse_app') then
    grant all on public.upwork_calls to pulse_app;
    grant usage, select on sequence public.upwork_calls_id_seq to pulse_app;
  end if;
end $$;

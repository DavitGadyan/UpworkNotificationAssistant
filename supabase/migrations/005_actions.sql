-- Phone → home worker without any public server: the app inserts a request row, the worker (running at
-- home, outbound connections only) claims it, runs it with the same code as the web API, and writes the
-- result back. worker_status carries health/usage so the app can read them without asking.

create table if not exists public.action_requests (
  id bigserial primary key,
  path text not null,                 -- e.g. /api/proposals/12/approve (same shapes as the web API)
  method text not null default 'POST',
  body jsonb,
  status text not null default 'queued',   -- queued | running | done | error
  result jsonb,
  error text,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  started_at bigint,
  finished_at bigint
);
create index if not exists action_requests_queued on public.action_requests (id) where status = 'queued';

create table if not exists public.worker_status (
  id int primary key default 1 check (id = 1),
  host text,
  health jsonb,
  usage jsonb,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

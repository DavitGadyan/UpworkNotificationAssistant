-- Pulse Assistant schema. Plain Postgres (also runs in PGlite for tests).
-- Timestamps are epoch milliseconds (bigint) to match the app code; published_at keeps Upwork's ISO text.

create schema if not exists private;

-- Secrets, tokens, locks, counters the app keeps for itself. Never exposed to clients.
create table if not exists private.kv (
  key text primary key,
  value jsonb not null,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists public.feeds (
  id bigserial primary key,
  name text not null,
  kind text not null default 'search',
  enabled boolean not null default true,
  data jsonb not null,
  created_at text not null
);

create table if not exists public.jobs (
  id text primary key,
  feed_id bigint not null,
  title text not null,
  url text not null,
  total int not null,
  status text not null default 'new',
  published_at text not null,
  fetched_at bigint not null,
  keep boolean not null default false,
  data jsonb not null,
  score jsonb not null,
  enrichment jsonb,
  feeds jsonb not null default '[]'::jsonb
);
create index if not exists jobs_fetched on public.jobs (fetched_at);
create index if not exists jobs_status on public.jobs (status);
create index if not exists jobs_published on public.jobs (published_at desc);

create table if not exists public.notifications (
  id bigserial primary key,
  job_id text not null,
  channel text not null,
  ok boolean not null,
  detail text not null,
  title text not null,
  score int not null,
  created_at bigint not null
);
create index if not exists notif_created on public.notifications (created_at);

create table if not exists public.counters (
  day text primary key,
  requests int not null default 0
);

create table if not exists public.proposals (
  id bigserial primary key,
  job_id text not null,
  status text not null,
  data jsonb not null,
  created_at text not null,
  updated_at text not null
);
create index if not exists proposals_job on public.proposals (job_id);

create table if not exists public.job_watch (
  job_id text primary key,
  message_id bigint,
  last_count int not null,
  last_tier text,
  warned boolean not null default false,
  started_at bigint not null,
  next_at bigint not null,
  done text
);

create table if not exists public.feedback (
  id bigserial primary key,
  kind text not null,
  ref_id text not null,
  rating int not null,
  reason text,
  data jsonb,
  created_at text not null
);
create index if not exists feedback_ref on public.feedback (kind, ref_id);

create table if not exists public.prompt_versions (
  id bigserial primary key,
  name text not null,
  body text not null,
  note text,
  active boolean not null default false,
  created_at text not null
);

create table if not exists public.metrics_snapshots (
  id bigserial primary key,
  period text not null,
  data jsonb not null,
  created_at text not null
);

create table if not exists public.reports (
  id bigserial primary key,
  kind text not null,
  data jsonb not null,
  created_at text not null
);
create index if not exists reports_kind on public.reports (kind, id desc);

create table if not exists public.mcp_log (
  id bigserial primary key,
  tool text not null,
  action text,
  ok boolean not null,
  ms int not null,
  detail text,
  created_at bigint not null
);
create index if not exists mcp_log_created on public.mcp_log (created_at);

-- Expo push tokens registered by the mobile app.
create table if not exists public.devices (
  token text primary key,
  platform text,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- Learning which clients actually hire. Derived facts (our own data), kept past the 24h job purge.

create table if not exists public.job_outcomes (
  job_id text primary key,
  client_id text,
  title text not null,
  published_at text not null,
  checks int not null default 0,
  next_check_at bigint not null,
  status text not null default 'open',          -- open | hired | closed_no_hire
  proposals_tier text,
  invites int, interviewed int, hired int,
  intent_archetype text,
  hire_likelihood int,
  updated_at bigint not null
);
create index if not exists job_outcomes_due on public.job_outcomes (next_check_at) where status = 'open';
create index if not exists job_outcomes_client on public.job_outcomes (client_id);

create table if not exists public.clients (
  client_id text primary key,
  country text,
  jobs_seen int not null default 0,
  hired int not null default 0,
  closed_no_hire int not null default 0,
  last_seen bigint not null
);

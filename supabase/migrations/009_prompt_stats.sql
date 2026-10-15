-- Daily snapshot of how each prompt version performs (Prompt analytics trend charts).
-- One row per day x prompt (proposal | job_ranking) x version (0 = built-in, -1 = written by hand) x scenario ('all' = every scenario).

create table if not exists public.prompt_stats (
  day text not null,                -- YYYY-MM-DD
  prompt text not null,
  version int not null,
  scenario text not null,
  sent int not null default 0,      -- decided proposals (got a result)
  viewed int not null default 0,
  replied int not null default 0,   -- client replied, interviewed, offered or hired
  offers int not null default 0,
  hires int not null default 0,
  kept numeric,                     -- avg share of the AI draft David kept (0..1)
  updated_at bigint not null,
  primary key (day, prompt, version, scenario)
);
create index if not exists prompt_stats_version on public.prompt_stats (prompt, version, day);

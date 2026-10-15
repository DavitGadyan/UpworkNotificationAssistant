-- What happened after David sent a proposal (read back from Upwork): did the client view it, reply, hire?
-- Feeds the "What wins" lessons report, the proposal writer's examples and ranking calibration.

create table if not exists public.proposal_outcomes (
  upwork_proposal_id text primary key,
  job_id text not null,
  job_title text not null default '',
  local_proposal_id bigint,                       -- public.proposals.id when the app drafted it
  submitted_at text not null,                     -- ISO
  status text not null,                           -- Upwork: Accepted (= submitted), Offered, Hired, Activated, Declined, Withdrawn, Archived
  status_label text,
  archive_reason text,
  viewed boolean not null default false,
  boosted boolean not null default false,
  connects_bid int,
  bid numeric,
  bid_label text,
  cover_letter text,
  insights jsonb,                                 -- the job's applicant stats from proposal get
  room_id text,
  replied_at text,
  first_reply text,
  outcome text not null default 'pending',        -- win | loss_viewed | loss_unviewed | pending
  job jsonb,                                      -- job snapshot: category, skills, budget, client, our rank
  checks int not null default 0,
  next_check_at bigint not null default 0,
  updated_at bigint not null
);
create index if not exists proposal_outcomes_due on public.proposal_outcomes (next_check_at);
create index if not exists proposal_outcomes_job on public.proposal_outcomes (job_id);

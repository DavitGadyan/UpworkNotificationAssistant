# Staying inside Upwork's rules

The assistant reads Upwork only through official channels, and does it at a person's pace.

## What we never do
- **No scraping.** We never fetch, render or automate `upwork.com` pages: no HTML requests, no headless browser, no Playwright.
  - Pasted links (`/nx/find-work/most-recent`, `/nx/find-work/`, `/nx/search/jobs?…`) are parsed locally into filters. That is all that happens to them (`lib/upwork/urlImport.ts`).
- **No automatic writes.** Proposals, messages and profile edits are never sent by the worker. Every write goes through a draft and a person's confirmation in the app (see the submit gate below).
- **No off-platform deals.** The Closer prompt forbids suggesting contact or payment outside Upwork.
- **No Upwork branding** in the app name, hostname or logo. This was a condition of the API key review.

## Data sources
| Source | Used for | Auth |
|---|---|---|
| Upwork MCP server `https://mcp.upwork.com/mcp` (default) | Feeds (Most Recent / Best Matches / search), job details, proposals, messages, profile, contracts, transactions, peer search | OAuth 2.1 + PKCE, dynamic client registration; tokens encrypted at rest (AES-256-GCM) |
| Marketplace GraphQL API (fallback) | Filtered job search only | Your own API key (read scopes) |

## Request budget (`lib/upwork/governor.ts`)
Every Upwork call goes through the pacing governor. The worker and web app reach it via `lib/upwork/guard.ts`; the Claude chat watch loop runs `npm run -s governor -- check <category>` before each call and `npm run -s governor -- record <category> ok|error "<msg>"` after.

| Limit | Value |
|---|---|
| Who searches | One searcher only: Settings → **Who searches Upwork** (`chat`, the default, or `worker`). The governor refuses feed searches from the other one. |
| Calls in flight | 1 (single-flight queue) |
| Gap between calls | ≥ 4 s (setting floor 3 s); job opens ≥ 8 s |
| Feed cadence | Each feed at most every 5 min (`pollIntervalSec` ≥ 300, jitter only adds time). The chat loop fires 4 staggered crons, one call each, ~60 s apart. |
| Daily calls | ≤ 2,800 per 24 h (setting clamped to 2,800) and ≤ 200 per hour |
| Searches | ≤ 1,400 per 24 h |
| Job opens (`find_jobs get`) | ≤ 120 per 24 h, ≤ 10 per cycle (default 5); the same job at most once per 6 h, never again after a refusal |
| Proposal-watch | Each job every 60 min at most (setting ≥ 30), 2 jobs per worker tick |
| "Too quickly" | Never retried. All job opens pause 30 min (doubling per level). |
| Slow-down levels | Any 429 / "too quickly" / 5xx raises the level: L1 10 min, L2 20 min, L3 40 min per feed. Two clean hours lower it one step. Running ahead of an even daily pace counts as one level. Transient errors are retried once. |
| "Restricted" | Stops **every** Upwork call (worker and chat) and sends one Telegram message. Nothing resumes on its own: after Upwork support restores access, run `npm run governor -- resume` (restarts at L2). |

`npm run governor -- status` shows the state. Overview → Costs & balance → Upwork shows a **Pacing** panel (state, searcher, budgets, last warning), and `/api/health` reports `pacing` and is not ok while stopped. Calls by tool are in the `mcp_log` table.

**What happened.** Upwork restricted the account's search on 2026-10-15 and 2026-10-17. On 17 Oct we made about 4,600 calls in 24 h, 1,475 of them job opens; the same jobs were re-opened about 40× after "jobs are being opened too quickly"; search kept being called after the block; and two pollers (the worker and a Claude chat watch loop) ran on one account.
**What changed.** One searcher, one governor for every call, hard daily/hourly/job-open budgets, no retries on "too quickly", and a full stop on "restricted" that only a human can lift. Never raise these limits to catch up.

## Submit gate (`lib/proposals/submit.ts`)
1. Draft (AI). Status: `needs_loom`.
2. Loom share link attached. Status: `ready`.
3. David approves. Status: `approved`.
4. Upwork preview built (`manage_proposals create` or `accept_invitation`; shows Connects cost). Status: `previewed`.
5. David types SUBMIT, then `confirm_preview` runs. Status: `submitted`.

Editing the text after approval drops the proposal back to `ready`. The worker cannot call any of these steps.

## Retention
- Job data nobody acted on is purged after 24 h.
- Jobs with a proposal draft or an active watch are kept until those finish.
- Call logs (`mcp_log`, the live budgets) are kept 7 days.
- Every Upwork call is also kept permanently in `public.upwork_calls` (2026-10-19): time, source (worker or chat), tool, action, feed category, ok, error class. `npm run -s calls -- report` writes `docs/upwork-call-history.md`: daily volumes, peak rates, and every throttle or restriction with the call rates that led up to it.

### Evening peak (2026-10-17)
High-value US clients post from about 18:00 Armenian time. From 18:00 to 01:00 Asia/Yerevan each feed runs every 4 min (the chat loop makes one call a minute, rotating the four categories); the rest of the day every 7 min. Daytime Upwork job calls may use at most 40% of the day's budget (the budget day starts at 01:00), so the evening keeps its reserve. Hours where high-value jobs (client spent ≥ $10k, fixed ≥ $1,000 or ≥ $70/hr) actually cluster are learned from feed results and added to the peak after 7 days of data. Window, time zone and both intervals: Settings → Ban-safety limits → Evening peak (also in the phone app). About 420 calls in the evening plus ~580 in the day, well under the 2,800 cap.

### Night auto-apply (2026-10-18, off by default)
Settings → Auto-apply at night. While David sleeps (default 00:00–11:00 Asia/Yerevan) the worker may submit auto-drafted proposals **without a Loom video** for jobs that clear every bar: rank ≥ 80, AI fit ≥ 75, fewer than 15 proposals, verified payment, not excluded, not a likely ghost post, still open, seen in the last 24 h. Limits: at most 6 per night, at most 120 Connects per night, never below 50 Connects; one submission per worker cycle; a preview with no readable Connects cost is held for David. It never runs while the governor is stopped, and every submission or hold is reported on Telegram. Proposals approved by hand still need a Loom. With the chat session as the searcher, its new jobs reach the app through `npm run ingest`, which feeds ranking, auto-drafts and auto-apply.

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

## Request budget (`lib/upwork/guard.ts`, every value set in Settings)
| Guard | Default |
|---|---|
| Calls in flight | 1 (single-flight queue) |
| Minimum gap between calls | 1.5 s |
| Poll interval | 300 s ± 40 s jitter |
| Detail look-ups per cycle | 8 (only for jobs that pass the cheap rules) |
| Proposal-watch re-checks per cycle | 6 (each job every 15 min, for at most 72 h) |
| Daily cap | 2,000 calls |
| Backoff | Exponential on 429/5xx/network errors (3 retries) |
| Circuit breaker | 3 consecutive failures pause everything for 30 min and send one Telegram notice |

A normal day is about 4 feed calls per cycle plus a few look-ups. That comes to roughly 1,500–2,000 calls a day, about what a person refreshing three tabs would generate. The Overview page shows calls today and calls by tool for the last hour (`mcp_log` table).

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
- Call logs are kept 7 days.

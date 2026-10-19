# Up Assistant

A personal AI back office for winning high-value Upwork work.
- The deployed app is branded **Pulse Assistant**, a neutral name that leaves Upwork's marks out.
- It reads Upwork through the official **Upwork MCP server** and alerts you on Telegram.
- It drafts proposals you finish with a Loom video, coaches replies to clients, and reviews your profile and results every month.

```
Upwork MCP ──► pacing governor (lib/upwork/governor.ts) ──► one searcher: Claude chat loop (default) or worker
                 │  feeds: Most Recent · Best Matches · saved search URL · keyword, each at most every 5 min
                 ▼
          JobRankingAssistant
            1. rules     (lib/ranking/rules.ts)   country / proposals / payment / rates / agency / hire-rate
            2. details   (find_jobs get)          client record, history, reviews (promising jobs only, ≤ 120/day)
            3. LLM       (lib/agents/jobRanking)  fit, value, summary, final product, big fish
                 │
                 ├─► Telegram channel alert (opens in the Upwork app) + 👍/👎 feedback
                 └─► proposal-count watch: edits the alert, warns at 15, "skip" past 20
Dashboard / mobile PWA (Next.js)
  Jobs → ProposalDraftAssistant (research → big fish → draft) → Loom → approve → Upwork preview → SUBMIT
  Closer (playbook + cultural profile + thread) · Insights (funnel, ProfileCoach, monthly review, client profile, calibration)
```

## What's where
| Path | What |
|---|---|
| `worker/index.ts` | The loop: feeds → rank → notify → watch → periodic jobs (profile sync, monthly snapshot, review, client profile, calibration) |
| `lib/db.ts`, `lib/pg.ts`, `supabase/migrations/` | Supabase Postgres data layer (async), RLS + realtime for the mobile app; PGlite in tests |
| `apps/mobile/` | Native Expo app (iOS/Android) reading Supabase live, actions via the backend API |
| `lib/upwork/mcp/` | MCP client (OAuth DCR + PKCE, encrypted tokens) and job/detail mapping |
| `lib/upwork/guard.ts` | Ban-safety: single-flight, gap, daily cap, backoff, circuit breaker |
| `lib/upwork/urlImport.ts` | Upwork link → feed (parsed locally, never fetched) |
| `lib/ranking/rules.ts` | David's hard rules and red flags (pure, tested) |
| `lib/agents/` | `jobRanking`, `proposal`, `closer`, prompts (versioned), profile digest, Claude API wrapper |
| `lib/proposals/submit.ts` | The submit gate |
| `lib/watch.ts` | Proposal-count watch |
| `lib/insights/` | Ideal client profile, monthly metrics, peer benchmark + ProfileCoach, monthly review |
| `lib/feedback/calibrate.ts` | Preference loop: 👍/👎 → logistic regression → proposed weights/threshold |
| `knowledge_base/` | Sales course transcripts, `closer_playbook.md` (distilled), `cultural_profiles.json`, `portfolio.json` |
| `docs/compliance.md` | Upwork rules and request budget |
| `deploy/` | VM, Caddy/nginx |

## Ranking rules (defaults, all editable in Settings → Ranking rules)
- **Hard reject:**
  - client in India, Pakistan, Turkey or Azerbaijan
  - more than 20 proposals (or the "20 to 50" / "50+" tier)
  - already applied, job closed, or the client already hired
- **Red flags:**
  - payment not verified (forgiven only for a brand-new client on an LLM fit of 85 or more)
  - client averages $25/hr or less over 100+ hours (agency pattern)
  - client's average contract is $200 or less
  - 3+ open jobs and no activity after 2 days
  - AI work: hire rate under 90%. DevOps/MLOps work: hire rate under 75%
- **Value:**
  - hourly rate of $80 or more, or no rate but the client has paid about $80/hr or more before
  - AI clients: average paid $50+/hr and a hire in the last 90 days
- Upwork doesn't expose per-contract rates, so "average paid" is lifetime spend ÷ hours. Treat it as an upper estimate.

## Run locally
```bash
cp .env.example .env        # TOKEN_ENC_KEY, ANTHROPIC_API_KEY, TELEGRAM_*; DEMO_MODE=1 to try it without Upwork
npm install
npm run dev                 # http://localhost:3010 → Settings → Connect Upwork (MCP) → Feeds → paste your links
npm run worker:once         # one ranked cycle, no alerts (dry run)
npm run worker              # the real loop
npm test && npm run typecheck && npm run build
```

Deploying: `deploy/home-ubuntu.md` (home machine, no static IP — the phone app talks only to Supabase), `deploy/deployment-ubuntu.md` (public server) or the short `deploy/README.md`. Upwork API-key application (fallback source): `docs/upwork-api-application.md`.

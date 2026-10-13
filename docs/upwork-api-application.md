# API key application — copy/paste sheet

Form: https://www.upwork.com/developer/keys/apply (select your **freelancer** context top-right first —
the key is owned by the context it is created in).

## Before you submit — account eligibility (from Upwork docs, Keys → Preparation)
- [ ] Real name, valid address, valid profile photo
- [ ] Active, verified payment method
- [ ] Identity verification completed
- [ ] ≥ $25,000 lifetime earnings/spend
- [ ] Job Success Score ≥ 90%
- [ ] No active suspensions
- [ ] DNS: A record `jobs.s1mpleai.org → 35.209.49.25` and the backend reachable over HTTPS

## Form fields

| Field | Value |
|---|---|
| Title | `JobPulse – Personal Job Alert Assistant` |
| Project type | **Web project** |
| Callback URL | `https://jobs.s1mpleai.org/api/auth/callback` |
| API Usage | `1-10` |
| Rotation Period | 12 months (default) |

> Don't put "Upwork" in the title or the hostname. The checklist makes you confirm the app doesn't use
> the Upwork name, logo, brand colors or other trademarks. (`upwork.s1mpleai.org` would work
> technically, but a reviewer may flag it.)

### Permissions — tick only these
- [x] **Common Entities - Read-Only Access** (required for every key)
- [x] **Read marketplace Job Postings** (`marketplaceJobPostingsSearch`)
- [x] **Job Details Entities - Read-Only Access** (full job details when a job is opened)
- [x] **View UserDetails** (shows which account is connected on the Settings page)

Leave everything else unticked. That includes Submit Proposal, Messaging, Offers, Contracts, Payments, Freelancer
Profile write, Job Postings write and all client-side scopes. The app does no write actions, and
asking for fewer scopes speeds up review.

### Project description (paste as-is)

```
Internal, single-user tool for my own freelancer account. Role: freelancer/developer — I am the only
user and the key owner; this is not a public application and is not offered to anyone else.

What it does: every 3 minutes a small backend runs marketplaceJobPostingsSearch with my own saved
filters (skills, hourly/budget range, payment-verified clients, experience level, posted in the last
24h). It ranks each new job against my own criteria using the job details and the client stats
returned with the job (hires, total spend, feedback, payment verification). The best matches are
sent as a private notification to my own Telegram account, and — for the highest-ranked jobs, at
times I configure — as a short automated phone call to my own phone. I then open the job on
upwork.com and decide myself whether to apply.

What it does NOT do: it never submits proposals, sends messages or performs any write action; all
applications are made manually on upwork.com. It does not scrape the website.

Limits and data handling:
- Usage: about 5 saved searches every 3 minutes ≈ 2,400 requests/day — far below the 40,000
  requests/day limit — with a hard daily cap of 30,000 in code, a per-minute limiter and backoff on
  HTTP 429.
- Upwork data is kept no longer than 24 hours and then deleted automatically.
- Data is not shared, sold, sublicensed or transferred to third parties, not used for profiling or
  advertising, and no client database is built.
- The app is free, not public, does not compete with Upwork, and does not use the Upwork name, logo,
  brand colors or other trademarked assets.

Callback URL is used only for the OAuth 2.0 Authorization Code flow for my own account.
```

### Terms checkbox
Tick "I agree to comply with the Upwork API Terms of Use". The design matches each certification:

| You certify | How JobPulse complies |
|---|---|
| Won't charge users | Single user (you), free, never sold |
| Won't compete with Upwork | Only sends alerts; you apply on upwork.com |
| No Upwork Content for user profiling/advertising | Client stats are scored per job on the fly and deleted after 24h; there is no client table |
| Won't sell/lease/transfer Upwork Content | Telegram/Retell deliver a minimal summary only to your own chat/phone |
| ≤ 24h caching (API docs) | `purgeExpired()` runs every worker loop and deletes rows older than 24h |
| 40k requests/day | Daily counter stops at 30k; limiter at 250/min (the API limit is 300/min/IP) |
| No Upwork brand | Public theme is neutral; the green "upwork" theme is only enabled on localhost (`NEXT_PUBLIC_THEME=upwork`) |

## After approval
1. Copy the Client ID and Secret into `output/jobpulse/.env` (`UPWORK_CLIENT_ID`, `UPWORK_CLIENT_SECRET`).
2. Open `https://jobs.s1mpleai.org/settings` and click **Connect account** to complete OAuth.
3. Keys start **disabled** until review passes. Nothing works until Upwork enables the key.

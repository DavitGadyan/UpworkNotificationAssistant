# API key application: copy/paste sheet (updated 2026-10-18)

Form: https://www.upwork.com/developer/keys/apply. First select your **freelancer** context (top right); the key belongs to the context it's created in.

## Before you submit: account eligibility (Upwork Help, "How to request an API key")
- [ ] Real name, valid address, valid profile photo
- [ ] Active, verified payment method
- [ ] Identity verification completed
- [ ] At least $25,000 lifetime earnings/spend
- [ ] Job Success Score of 90% or higher
- [ ] **Account in good standing with no active suspensions.** Upwork restricted the account's *search* on 2026-10-15 and 2026-10-17. Wait until support confirms it's lifted, or say so in the description, or the request may be refused.
- [ ] Gateway reachable: A record `gw.s1mpleai.org → 35.209.49.25`, and `https://gw.s1mpleai.org/health` returns `{"ok":true}` (deploy/gateway/README.md)

Decisions arrive by email in about a week. Keys start **disabled** until the review passes.

## Form fields

| Field | Value |
|---|---|
| Title | `JobPulse - Personal Job Assistant` |
| Project type | **Web project** |
| Callback URL | `https://gw.s1mpleai.org/oauth/callback` |
| Project description | below |
| API Usage | `1-10` |
| Rotation Period | 12 months (default) |

Don't put "Upwork" in the title or the hostname: you must confirm the app doesn't use the Upwork name, logo, colours or other trademarks.

### Permissions: tick only these
- [x] Common Entities - Read-Only Access
- [x] Read marketplace Job Postings
- [x] Job Details Entities - Read-Only Access
- [x] View UserDetails
- [x] Ad Credits and Connects Information - Read-Only Access
- [x] Freelancer's Invitation Entities - Read-Only Access
- [x] Contract Proposals Entities - Read-Only Access
- [x] Submit Proposal

Leave everything else unticked. The application should say clearly why each scope is needed (see the description):
- Activity, client-side job postings / proposals / invitations
- Contracts, offers, payments, transactions
- Messaging, profile writes, job-details write
- Organization, work diary, timesheets, snapshots

### Project description (paste)

> Internal, single-user tool for my own freelancer account (David Gadyan). It is not public, not sold, and has no other users.
>
> **What it does:**
> - Searches the marketplace with my saved filters (AI/ML, data, automation) every 4-7 minutes.
> - Loads job details only for jobs that could fit me (at most 120 a day).
> - Ranks them against my skills and sends me a private Telegram alert.
> - Uses "Submit Proposal" to send proposals I have prepared and approved rules for. Some are submitted automatically at night, capped at 6 per night and a Connects budget I set. Every submission is reported to me.
> - Reads my Connects balance and invitations so it doesn't spend Connects I don't have or re-apply where I was already invited.
>
> **Volume:**
> - Under 5,000 requests a day, far under the 40,000 limit.
> - Enforced by a per-minute and per-day limiter, 429 backoff, and a hard stop if access is ever restricted.
>
> **Data handling:**
> - Job data is deleted after 24 hours.
> - Nothing is shared, sold, used for profiling or advertising, or shown publicly.
> - No scraping. No Upwork branding.
>
> **Callback URL:** a small private gateway I run (`gw.s1mpleai.org`). It handles my own OAuth sign-in and keeps the tokens encrypted. It is used only by me.

### Terms checklist: how the app complies

| You certify | How |
|---|---|
| Read and agree to the API Terms of Use | Personal, internal use only |
| Authority to agree | It's your own account |
| Won't charge users | No users, no payments |
| No competing service, no profiling/ads with Upwork content | Personal alerts only; data purged after 24 h (`purgeExpired()`) |
| Won't sell/transfer Upwork content | Nothing is shared |
| Daily limit of 40,000 requests | Gateway caps at 5,000/day and 250/min; the app's pacing governor caps at 2,800/day |
| No Upwork name/logo/colours | Title and hostname don't use them; neutral theme |

## After approval
1. Put the Client ID and Secret into `/etc/gw.env` on the VM and restart: `sudo systemctl restart gw`.
2. Open `https://gw.s1mpleai.org/oauth/start`, enter the admin token, and approve.
3. In the app's `.env`, set `UPWORK_GATEWAY_URL` and `UPWORK_GATEWAY_TOKEN`, then restart the services.
4. Run `npm run api:schema` to confirm the job-details fields and see the proposal mutations against the live schema.
5. In Settings → Upwork connection, choose **Official API**.

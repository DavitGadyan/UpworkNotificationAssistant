# How jobs are ranked

Your Upwork feeds (Most Recent, Best Matches, your saved search and the keyword search) are read through the official MCP connector by the selected searcher (Settings → Who searches Upwork), each at most every 5 minutes, paced by the governor (`lib/upwork/governor.ts`). Each new job goes through these steps in order.

## 0. Is it your field? (`lib/ranking/profileFit.ts`)
A free check on Upwork's skill tags, the title and Upwork's category, before anything else:
- **Your fields:** AI agents & LLM apps; ML, deep learning & computer vision; data science & data engineering; algorithmic trading & quant; voice agents, automation & bots; AI marketing & ads; AI video, image & 3D (Blender, 3ds Max, Cinema 4D, product configurators); web & app development; blockchain; cloud & DevOps — plus the skills on your Upwork profile (synced daily).
- **Never your field:** game development, legal, admin/VA, customer service, non-technical writing & editing, non-AI design and photo editing, non-AI video editing, sales & PR roles, accounting & tax, CAD & architecture, IT helpdesk & networking.
- **Not your field** (the title names off-profile work and no skill tag is yours, or the tags/category point outside and nothing points in): rank 0, no client lookup, no AI call, no alert, no draft, hidden from the lists (Filter → Status → "Not my field" shows them).
- A title that mixes both ("AI Video Editor") or gives no clear signal goes to the AI, which can also mark a job off-profile.
- Add your own words in **Settings → Your fields** ("Also my work" / "Never my work"). A bare "AI" in a description never counts.

## 1. Hard rejects (your rules → rank 0, never alerted)
- Client country is India, Pakistan, Turkey or Azerbaijan.
- More than 20 proposals, or the "20 to 50" / "50+" tier.
- You already applied, the job is closed, or the client already hired.
- The feed's own filters, such as excluded keywords.

## 2. Client record first
Before the job is judged, `find_jobs get` loads the client's record: hire rate, total spent, hours, open jobs, recent contracts and reviews.
- If the record can't be loaded (Upwork error or too many requests), the job waits as **"Checking client…"** and is retried in a later cycle (a job is opened at most once per 6 h and never again after Upwork refuses it; job opens are capped at 120 a day).
- A job is never ranked or alerted on feed data alone.
- Upwork doesn't show per-contract rates, so **average paid ≈ total spent ÷ total hours**. Fixed-price spend inflates this, so it's an upper estimate.

## 3. Rule score (0–100), `lib/ranking/rules.ts`
```
rule score = fit-by-category + client quality + money + competition − flag penalties
```
- **Fit by category** is keyword-based until the AI reads the job: AI or MLOps 34, SaaS 30, automation 28, DevOps or data 24, marketing or other 8. The category comes from the title, then Upwork's skill tags, then only unambiguous phrases in the description ("machine learning", "LLM", "AI agents" — not "enemy AI" or "rag doll").
- **Client quality** (up to 35 points):
  - up to 20 points for total spent, on a log scale
  - up to 10 points for hire rate
  - up to 5 points for rating
- **Money** (up to about 15 points):
  - Hourly: max rate compared with your $80/hr floor.
  - No rate: average paid compared with your $80/hr floor.
  - Fixed: budget on a log scale up to $10k.
- **Competition** (up to 10 points): fewer proposals and a fresher posting score higher.
- **Red flags** (red or amber) each subtract points:

| Flag | When it fires |
|---|---|
| Payment not verified | −25. Forgiven only for a brand-new client with AI fit ≥ 85. |
| Hourly rate cap | Below your $80/hr. |
| Client average paid | Below your threshold. |
| Cheap-labour history | Average ≤ $25/hr over 100+ hours. |
| Mostly small jobs | ≤ $200 per contract. |
| Hire rate, AI/SaaS work | Below 90%. |
| Hire rate, DevOps/MLOps work | Below 75%. |
| Hire rate, other work | Below 50% is amber, below 30% is red. |
| Ignored client | 3+ open jobs and no client activity after 2 days. |
| Crowded | 15+ proposals. |
| Client record not loaded | The record couldn't be fetched. |

## 4. AI judgement (Claude Sonnet), `lib/agents/jobRanking.ts`
- **Which jobs:** every job in your core fields, and any other job whose rule score is within 25 of the alert threshold.
- **Off-profile:** the AI says whether the work is outside your fields; if so the job is excluded like step 0.
- **Fit (0–100):** only how closely the work matches your fields and what you have actually delivered (your portfolio and Upwork profile). Budget and client are ignored here.
- **Value (0–100):** how likely this client is to pay a senior professional for the whole solution.
- Also: a summary, the final product, the "big fish" problem, the skills wanted, reasons and red flags.

## 5. Final rank
```
rank = 0.45 × rule score + 0.55 × (0.7 × AI fit + 0.3 × AI value) − 5 × (number of red flags)
```
A hard reject is always 0.

## 6. What happens next
- **Nothing alerts without the AI's verdict.** A job the AI couldn't rank yet (daily budget, outage, per-cycle cap) waits as **"Waiting for AI check"** and is ranked — then alerted if it qualifies — as soon as the AI is available. You get one Telegram notice when AI ranking pauses and one when it resumes. (Only if you turn the AI off in Settings do rule scores alone decide.)
- **Rank ≥ 60:** Telegram and phone alert, plus a proposal-count watch (warning at 15, "skip" past 20).
- **Strong-fit lane:** AI fit ≥ 80 with no red flags alerts even below 60, labelled "💡 Strong fit, weak signals".
- **Auto-draft:** rank ≥ 60 with an AI verdict, up to 10 per day, within the daily AI budget ($5 by default). Never submitted automatically.

## 7. Hire likelihood / ghost risk (advisory, rules untouched), `lib/ranking/intent.ts`
A separate verdict on whether the client will actually hire anyone. It **does not change the rank or your rules.**

**High risk:**
- The alert says "🚫 Likely not hiring — skip", with the reasons.
- **No auto-draft** is written.
- You can still apply by hand.

| Archetype | Pattern |
|---|---|
| Posts but never hires | $0 spent, 2+ jobs posted, no hires |
| No payment attached | Payment not verified and no hiring history |
| Collects free plans/quotes | "Quote your true price", "nonbinding budget", "no hire authorized", asks for architecture or a rate card, a huge spec for a tiny budget |
| Mass poster | Hundreds of posts with a low hire rate, or 10+ jobs open at once |
| Front/identity request | "US-only" or "represent us in client meetings" from a non-US account with $0 spent |
| Harvests personal data | Asks for device, account or ID data |
| No client activity | 2+ days old with no invites or interviews |
| Closed past jobs without hiring | Learned from jobs the assistant tracked for this client |

**How it learns:** the assistant re-checks each job about 2 and about 7 days after posting, and records whether the client hired. Insights → **Ghost patterns** shows how often each pattern actually hired, and suggests rule changes. The suggestions are text only and are never applied for you.

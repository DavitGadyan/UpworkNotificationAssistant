/*
 * Build docs/up-assistant-system.pdf: a 2-3 page overview of Up Assistant and its agents, with every agent's
 * live prompt in the appendices (read from the database, so the PDF matches what actually runs).
 * Usage: npm run docs     (needs pandoc and Google Chrome; writes docs/up-assistant-system.{md,html,pdf})
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPrompt, type PromptName } from "../lib/agents/prompts";
import { FIRST_CONTACT_RULES } from "../lib/agents/proposal";
import { getSettings } from "../lib/db";
import { LESSONS_SYSTEM } from "../lib/learning/lessons";
import { AUTO_DRAFT_MIN_FIT } from "../lib/autodraft";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const s = await getSettings();
  const prompts: Record<PromptName, { body: string; version: number | null }> = {
    job_ranking: await getPrompt("job_ranking"),
    proposal: await getPrompt("proposal"),
    closer: await getPrompt("closer"),
    profile_coach: await getPrompt("profile_coach"),
    monthly_review: await getPrompt("monthly_review"),
  };
  const v = (n: PromptName) => (prompts[n].version == null ? "built-in" : `v${prompts[n].version}`);
  const today = new Date().toISOString().slice(0, 10);
  const R = s.llm.rankingModel, W = s.llm.writerModel;

  const md = `---
title: "Up Assistant - system overview"
subtitle: "How the Upwork assistant finds jobs, drafts proposals and learns from client replies"
date: "${today}"
---

# 1. What it does

Up Assistant watches Upwork for jobs that fit David Gadyan (Expert-Vetted AI engineer, data scientist and full-stack builder), tells him about the good ones within minutes, drafts the proposal, and learns from what clients actually do with his proposals. **It never sends anything on his behalf**: every proposal needs his Loom video, his approval, the Upwork preview and a typed "SUBMIT".

**The loop, in one line:** Upwork (official MCP connector) → rules → field check → AI ranker → alert → AI proposal draft → David's Loom + approval + SUBMIT → reply tracking → lessons and prompt analytics → better ranking and drafts.

**Where it runs:** a background worker and a web dashboard on David's Mac (always-on services), a Supabase Postgres database, and an iPhone app (TestFlight) that reads the database and sends its actions through a queue table, so no server is exposed to the internet.

# 2. How a job flows through the system

1. **Polling (every 4 minutes, with jitter).** The worker reads 4 Upwork feeds through the official Upwork MCP connector: Most Recent, Best Matches, a keyword search for AI/data/marketing, and a *Scout* search for SaaS, automation, web3, 3D and technical specs. Only one machine polls at a time (a lease in the database). A guard keeps Upwork calls spaced out, capped per day and paused after repeated errors. Upwork pages are never scraped.
2. **Hard rules (code, free).** Client countries India, Pakistan, Turkey and Azerbaijan are rejected; jobs with 20+ proposals are rejected. David's point-based rules score budget, client spend and hire rate, competition and skills. These thresholds and points only change when he changes them.
3. **Field check (code, free).** Is this David's kind of work at all? Skill tags, title and Upwork category are matched against his fields (AI agents and automation, ML/DL, data science and Python analysis, algorithmic trading, dApps/web3, AI content incl. 3D, AI marketing/SEO/GEO/AEO, AI-powered SaaS, AI accounting systems, technical specs). Work outside them (game dev, legal, admin, bookkeeping roles, logo design…) is hidden and never alerted.
4. **Client record.** The client's spend, hire rate, reviews and job activity are loaded before anything is judged.
5. **AI ranker.** Claude judges fit, value potential and whether the client will really hire. With the AI on, nothing is alerted on rule scores alone.
6. **Alert.** Strong jobs go to Telegram and the phone; the proposal count keeps being watched afterwards so David knows when competition piles up.
7. **Auto-draft.** Only tight AI fits (ranked high, AI fit ≥ ${AUTO_DRAFT_MIN_FIT}, no 3D work) get a draft automatically; anything else is one tap away.
8. **David submits.** Loom link → approve → Upwork preview → type SUBMIT. The app records how much of the AI draft he kept.
9. **Reply tracking (8 times a day, read-only).** Each sent proposal is read back from Upwork: viewed or not, did the client reply (a message in the proposal room), offer, hire. "Viewed, no reply" and "never viewed" are both counted as misses, kept apart.
10. **Learning.** Weekly lessons reports and the prompt analytics turn those results into better prompts - with David's approval.

# 3. The agents

| Agent | What it does | When it runs | Model | May change | Never does |
|---|---|---|---|---|---|
| **Job ranker** (\`job_ranking\`, ${v("job_ranking")}) | Scores every new job in his fields: fit, value potential, hire likelihood, red flags, the "big fish" problem | Every new job, ~4-minute cycles, within the $${s.llm.dailyBudgetUsd}/day AI budget | ${R} | Rank and alert of a job | Alert on rules alone; touch Upwork |
| **Proposal writer** (\`proposal\`, ${v("proposal")}) | Researches the client, diagnoses the real problem and writes a 600-900 character draft with a Loom placeholder, deliverables, budget and one question | When David taps Draft, or auto-draft for tight AI fits | ${W} (with web search) | A draft in "needs Loom" | Submit; invent facts; contact off-platform |
| **Closer** (\`closer\`, ${v("closer")}) | Suggests the next reply in an open client conversation | When David opens a conversation in Closer | ${W} | A suggested message for him to copy | Send messages |
| **Profile coach** (\`profile_coach\`, ${v("profile_coach")}) | Benchmarks his profile against top peers and suggests changes | Monthly or on demand | ${W} | A report | Edit his profile |
| **Monthly review** (\`monthly_review\`, ${v("monthly_review")}) | Reviews the month's funnel and what to change | Monthly or on demand | ${W} | A report | - |
| **Writer lessons** | Compares proposals that got a reply with viewed-no-reply ones, plus David's own edits to AI drafts, and proposes writing rules | Weekly or on demand (~$0.30) | ${W} | Nothing until David approves; then a new writer prompt version | Change the ranker |
| **Ranker lessons** | Compares viewed with never-viewed proposals and reply rate by the rank each job had; proposes ranking rules | Weekly or on demand (~$0.30) | ${W} | Nothing until David approves; then a new ranker prompt version | Change the writer |
| **Prompt lab** (code) | Reply/offer/hire rate per prompt version and scenario (field × client type); optional A/B test by Thompson sampling among versions David picked | After every reply check | - | Which approved version drafts next (only when the A/B test is on, or a version David pinned) | Create or edit prompts |
| **Calibration, ICP, ghost reports** (code) | Suggest rule weights from feedback, describe his ideal client, spot clients who never hire | Monthly / daily | - | Reports; weights only when David clicks Apply | Change rules by themselves |

**What the system learns on its own (low risk):** letters that got a reply become writing examples; pairs of "AI draft → what David sent" become examples of how he corrects drafts (hired and replied ones first); real outcomes feed the ranker's examples. **What needs David's click:** any prompt change from lessons, rule-weight calibration, starting an A/B test, pinning a version to a scenario.

# 4. Safety rules built in

- Never auto-submit; Loom + approval + preview + typed SUBMIT for every proposal.
- Only the official Upwork MCP connector (read-only for learning); no scraping; nothing is ever sent to clients by the system.
- Upwork calls are spaced, capped per day and paused on repeated errors; reply checks skip when the day's calls pass 70% of the cap.
- Only jobs in his fields can rank high, alert or be drafted; the AI must agree before an alert.
- Secrets live only in the server's .env; the phone has read-only database access to David's own rows.
- Every prompt change is a saved version that can be rolled back in Settings → Prompts.

\\newpage

# Appendix A - Job ranker prompt (${v("job_ranking")})

\`\`\`text
${prompts.job_ranking.body}
\`\`\`

The ranker also receives David's profile and portfolio, his own field notes from Settings, his Ideal Client Profile and recent calibration examples.

# Appendix B - Proposal writer prompt (${v("proposal")})

\`\`\`text
${prompts.proposal.body}
\`\`\`

Added to every draft: these first-contact sales rules, a cultural profile for the client's country, David's profile and portfolio, letters that got replies, and examples of how David corrected earlier drafts.

\`\`\`text
${FIRST_CONTACT_RULES}
\`\`\`

# Appendix C - Closer prompt (${v("closer")})

\`\`\`text
${prompts.closer.body}
\`\`\`

# Appendix D - Profile coach prompt (${v("profile_coach")})

\`\`\`text
${prompts.profile_coach.body}
\`\`\`

# Appendix E - Monthly review prompt (${v("monthly_review")})

\`\`\`text
${prompts.monthly_review.body}
\`\`\`

# Appendix F - Writer lessons prompt

\`\`\`text
${LESSONS_SYSTEM.writer}
\`\`\`

# Appendix G - Ranker lessons prompt

\`\`\`text
${LESSONS_SYSTEM.ranker}
\`\`\`
`;

  const dir = join(process.cwd(), "docs");
  const mdPath = join(dir, "up-assistant-system.md"), htmlPath = join(dir, "up-assistant-system.html"), pdfPath = join(dir, "up-assistant-system.pdf");
  writeFileSync(mdPath, md);
  const css = join(dir, ".docs.css");
  writeFileSync(css, `
    @page { size: A4; margin: 16mm 15mm; }
    body { font: 10.5pt/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a1d21; max-width: none; margin: 0; }
    header h1.title { font-size: 22pt; margin: 0 0 2pt; color: #108a00; } header .subtitle { font-size: 12pt; color: #444; margin: 0; } header .date { color: #777; margin: 2pt 0 10pt; }
    h1 { font-size: 14pt; margin: 14pt 0 5pt; border-bottom: 1px solid #ddd; padding-bottom: 2pt; } p, li { margin: 3pt 0; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; word-wrap: break-word; font-size: 8.4pt; margin: 6pt 0; } th, td { border: 1px solid #d7d7d7; padding: 3pt 4pt; vertical-align: top; text-align: left; } th { background: #f2f6f1; }
    pre { white-space: pre-wrap; font: 7.6pt/1.35 Menlo, monospace; background: #f6f7f8; border: 1px solid #e3e3e3; padding: 6pt; border-radius: 4px; }
    code { font-family: Menlo, monospace; font-size: 0.9em; } h1 { page-break-after: avoid; } tr, pre { page-break-inside: auto; }
    .newpage { page-break-before: always; }`);
  execFileSync("pandoc", [mdPath, "-s", "--metadata", "pagetitle=Up Assistant - system overview", "-c", ".docs.css", "-o", htmlPath, "--resource-path", dir], { cwd: dir });
  if (!existsSync(CHROME)) throw new Error("Google Chrome not found - open docs/up-assistant-system.html and print to PDF");
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`], { stdio: "ignore" });
  console.log(`wrote ${pdfPath}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

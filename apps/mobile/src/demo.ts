/*
 * Demo fixtures, served instead of Supabase and the backend API when EXPO_PUBLIC_DEMO=1.
 * Used for screenshots and UI work without the owner account. Shapes match the real rows exactly.
 */
import type {
  Calibration, CloserAdvice, CloserInboxResponse, CoachReport, FeedRow, HealthSummary, Icp, Job, JobEnrichment, JobRow,
  MonthMetrics, MonthlyReview, NotificationDbRow, ProposalRow, ReportRow, ScoreBreakdown, Settings, SnapshotRow, UsageReport, WatchRow,
} from "./types";

const now = Date.now();
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function job(p: Partial<Job> & Pick<Job, "id" | "title">): Job {
  return {
    ciphertext: `~02${p.id.padStart(16, "0")}`,
    description: "",
    skills: [],
    jobType: "FIXED",
    amount: null,
    hourlyMin: null,
    hourlyMax: null,
    experienceLevel: "EXPERT",
    totalApplicants: 5,
    proposalsTier: "5 to 10",
    publishedAt: iso(now - H),
    category: "AI & Machine Learning",
    client: { paymentVerified: true, identityVerified: true, totalSpent: 48_000, totalHires: 21, totalPostedJobs: 30, totalReviews: 18, totalFeedback: 4.9, country: "United States", hasFinancialPrivacy: false },
    ...p,
  };
}

function enrichment(p: Partial<JobEnrichment["record"]> & { connects?: number; questions?: string[] } = {}): JobEnrichment {
  const { connects, questions, ...record } = p;
  return {
    fetchedAt: iso(now - H / 2),
    description: "",
    connectsCost: connects ?? 16,
    connectsBalance: 142,
    canApply: true,
    applied: false,
    status: "ACTIVE",
    subcategory: null,
    clientState: null,
    clientTimezone: "America/New_York",
    record: { hires: 18, contractsTotal: 26, contractsActive: 3, totalSpent: 48_000, feedbackScore: 4.9, feedbackCount: 18, hours: 1240, jobsPosted: 30, hireRatePercent: 70, openJobs: 2, ...record },
    activity: { invitesSent: 4, interviewed: 2, hired: 0, offered: 0, unansweredInvites: 1 },
    bidStats: { avg: 4200, min: 1500, max: 9000 },
    workHistory: [
      { title: "RAG pipeline for internal docs", type: "FIXED", status: "closed", started: "2026-05-01", ended: "2026-06-20", feedback: 5, open: false },
      { title: "Data engineer for Snowflake migration", type: "HOURLY", status: "closed", started: "2026-02-10", ended: "2026-04-30", feedback: 4.8, open: false },
    ],
    reviews: [
      { comment: "Clear communicator, shipped ahead of schedule. Would hire again.", score: 5, ended: "2026-06-20", title: "RAG pipeline for internal docs" },
      { comment: "Strong engineer, understood the business problem quickly.", score: 4.8, ended: "2026-04-30", title: "Data engineer for Snowflake migration" },
    ],
    otherOpenJobs: [],
    screeningQuestions: questions ?? [],
    preferredQualifications: null,
  };
}

function score(total: number, extra: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    total, skills: Math.round(total * 0.4), client: Math.round(total * 0.35), budget: 12, competition: 8, excluded: null, matchedSkills: ["Python", "LLM"],
    rules: {
      score: total - 4, rejected: null,
      flags: total > 80
        ? [{ code: "few_reviews", label: "Only 3 reviews in the last year", severity: "info", penalty: 2 }]
        : [{ code: "low_rate", label: "Client avg paid ≈ $22/hr", severity: "amber", penalty: 8 }, { code: "many_proposals", label: "20 to 50 proposals already", severity: "red", penalty: 14 }],
      passes: ["Payment verified", "Hire rate 70%", "Hired in the last 14 days", "Spent $48k+"],
      category: "ai",
      derived: { avgPaid: total > 80 ? 68 : 22, avgPerContract: 1850, lastHireDays: 9, hireRate: 70 },
    },
    llm: {
      model: "claude-sonnet", category: "ai", fit: total + 2, valuePotential: total - 6,
      summary: "Series-A logistics startup wants an LLM agent that reads inbound carrier emails, extracts load details and books them into their TMS.",
      finalProduct: "Production email-to-TMS agent with human review queue, evals and a Grafana dashboard.",
      skillsWanted: ["Python", "LLM agents", "Evaluation", "AWS"],
      reasons: ["Exact match with the freight-ops agent portfolio project", "Client has rehired AI freelancers 3 times", "Budget fits a 4-6 week build"],
      redFlags: total > 80 ? [] : ["Wants fixed price for an open-ended scope"],
      bigFish: "Ops team spends ~40 h/week re-keying loads; automation unlocks scaling without hiring.",
    },
    ...extra,
  };
}

const jobsSeed: { j: Job; total: number; status: JobRow["status"]; feed: number; e?: JobEnrichment | null; s?: Partial<ScoreBreakdown> }[] = [
  { j: job({ id: "1001", title: "LLM agent to read carrier emails and book loads into our TMS", jobType: "FIXED", amount: 6000, skills: ["Python", "LangGraph", "AWS"], proposalsTier: "Less than 5", totalApplicants: 4, publishedAt: iso(now - 0.4 * H) }), total: 91, status: "notified", feed: 1, e: enrichment({ connects: 16, questions: ["Describe a similar agent you shipped to production.", "How would you evaluate extraction accuracy?"] }) },
  { j: job({ id: "1002", title: "Senior ML engineer – RAG over 2M legal documents", jobType: "HOURLY", hourlyMin: 70, hourlyMax: 110, skills: ["RAG", "pgvector"], proposalsTier: "5 to 10", publishedAt: iso(now - 1.2 * H), client: { paymentVerified: true, identityVerified: true, totalSpent: 210_000, totalHires: 64, totalPostedJobs: 80, totalReviews: 51, totalFeedback: 4.8, country: "United Kingdom", hasFinancialPrivacy: false } }), total: 86, status: "called", feed: 2, e: enrichment({ totalSpent: 210_000, hireRatePercent: 80, hours: 8_400, openJobs: 4, connects: 20 }) },
  { j: job({ id: "1003", title: "Automate weekly finance reporting with n8n + GPT", jobType: "FIXED", amount: 1500, skills: ["n8n", "OpenAI"], proposalsTier: "10 to 15", totalApplicants: 15, publishedAt: iso(now - 2.5 * H), category: "Automation" }), total: 72, status: "new", feed: 1, e: enrichment({ connects: 12, hireRatePercent: 55 }) },
  { j: job({ id: "1004", title: "MLOps: move our training jobs to SageMaker pipelines", jobType: "HOURLY", hourlyMin: 50, hourlyMax: 80, skills: ["SageMaker", "Terraform"], proposalsTier: "5 to 10", publishedAt: iso(now - 3 * H), category: "DevOps" }), total: 78, status: "pending", feed: 3, e: null },
  { j: job({ id: "1005", title: "Chatbot for Shopify store, quick turnaround", jobType: "FIXED", amount: 300, skills: ["Chatbot"], proposalsTier: "20 to 50", totalApplicants: 50, publishedAt: iso(now - 5 * H), client: { paymentVerified: false, identityVerified: false, totalSpent: 0, totalHires: 0, totalPostedJobs: 1, totalReviews: 0, totalFeedback: 0, country: "India", hasFinancialPrivacy: false } }), total: 38, status: "new", feed: 1, e: enrichment({ totalSpent: 0, hires: 0, hireRatePercent: 0, hours: 0, feedbackCount: 0, connects: 8 }) },
  { j: job({ id: "1006", title: "Data pipeline for IoT telemetry (Kafka → ClickHouse)", jobType: "FIXED", amount: 4500, skills: ["Kafka", "ClickHouse"], proposalsTier: "5 to 10", publishedAt: iso(now - 7 * H), category: "Data" }), total: 69, status: "drafting", feed: 2, e: enrichment({ connects: 14 }) },
];

export const demoJobs: JobRow[] = jobsSeed.map(({ j, total, status, feed, e, s }, i) => ({
  id: j.id, feed_id: feed, title: j.title, url: `https://www.upwork.com/jobs/${j.ciphertext}`, total, status,
  published_at: j.publishedAt, fetched_at: now - (i + 0.2) * H, keep: false, data: j, score: score(total, s),
  enrichment: e === undefined ? enrichment() : e, feeds: [feed === 1 ? "Most Recent" : feed === 2 ? "Best Matches" : "MLOps search"],
}));

export const demoFeeds: FeedRow[] = [
  { id: 1, name: "Most Recent", kind: "most_recent", enabled: true, data: { skills: [], query: "", jobType: "ANY" } },
  { id: 2, name: "Best Matches", kind: "best_match", enabled: true, data: { skills: [], query: "" } },
  { id: 3, name: "MLOps search", kind: "search", enabled: true, data: { skills: ["MLOps"], query: "sagemaker OR kubeflow", minHourly: 50 } },
  { id: 4, name: "Data engineering", kind: "search", enabled: false, data: { skills: ["ETL"], query: "data pipeline" } },
];

const research = {
  contactName: "Maya", contactSource: "job post signature", company: "Freightline", companyConfidence: "likely" as const,
  companySignals: ["Mentions 'our TMS (Turvo)'", "Client city = Chicago"],
  bigFish: "Scaling ops without hiring: 40 h/week of manual load entry.",
  hiddenProblems: ["Carrier emails come in 6+ formats", "No eval set exists yet", "Ops trusts nothing they cannot override"],
  whyNotSolvedInternally: "Two backend engineers, both on the core product.",
  assumptions: ["They already have API access to the TMS", "Volume ≈ 300 emails/day"],
};

const letter = `Hi Maya,

Your ops team re-keying carrier emails into Turvo is exactly the problem I solved for a 3PL last spring: an agent that reads every inbound email, extracts the load, and books it - with a review queue for anything under 95% confidence.

I recorded a 2-minute walkthrough of how I'd build yours: {{LOOM_URL}}

Plan: week 1 an eval set from 200 real emails, weeks 2-4 the agent and review UI, week 5 shadow mode, week 6 go-live.

David`;

export const demoProposals: ProposalRow[] = [
  {
    id: 41, job_id: "1001", status: "needs_loom", created_at: iso(now - 0.3 * H), updated_at: iso(now - 0.2 * H),
    data: {
      jobTitle: demoJobs[0].title, jobUrl: demoJobs[0].url, coverLetter: letter, research,
      answers: [
        { question: "Describe a similar agent you shipped to production.", answer: "A carrier-email booking agent for a 3PL: 92% straight-through, 4 s median latency, review queue for the rest." },
        { question: "How would you evaluate extraction accuracy?", answer: "A labelled set of 200 real emails, field-level precision/recall, run on every prompt change in CI." },
      ],
      bid: 6000, estimatedDuration: "1 to 3 months", portfolioProjectIds: [], loomUrl: null, approvedAt: null, preview: null, previewId: null,
      submittedAt: null, originalDraft: letter, model: "claude-opus", promptVersion: 3,
    },
  },
  {
    id: 40, job_id: "1006", status: "previewed", created_at: iso(now - 6 * H), updated_at: iso(now - 5 * H),
    data: {
      jobTitle: demoJobs[5].title, jobUrl: demoJobs[5].url, coverLetter: letter.replace("{{LOOM_URL}}", "https://www.loom.com/share/abc123"), research,
      answers: [], bid: 4500, estimatedDuration: null, portfolioProjectIds: [], loomUrl: "https://www.loom.com/share/abc123", approvedAt: iso(now - 5.5 * H),
      preview: { upwork: { preview_id: "pv_77", connects_cost: 14, connects_balance: 142, boost: "none", unmet_preferred_qualifications: [] }, type: "proposal" },
      previewId: "pv_77", submittedAt: null, originalDraft: letter, model: "claude-opus", promptVersion: 3,
    },
  },
  {
    id: 37, job_id: "1002", status: "submitted", created_at: iso(now - 30 * H), updated_at: iso(now - 26 * H),
    data: {
      jobTitle: demoJobs[1].title, jobUrl: demoJobs[1].url, coverLetter: letter, research, answers: [], bid: 95, estimatedDuration: null,
      portfolioProjectIds: [], loomUrl: "https://www.loom.com/share/def456", approvedAt: iso(now - 27 * H), preview: null, previewId: "pv_70",
      submittedAt: iso(now - 26 * H), originalDraft: letter, model: "claude-opus", promptVersion: 2,
    },
  },
];

export const demoWatch: WatchRow[] = [
  { job_id: "1001", message_id: 1, last_count: 4, last_tier: "Less than 5", warned: false, started_at: now - 0.4 * H, next_at: now + 0.3 * H, done: null },
  { job_id: "1003", message_id: 2, last_count: 15, last_tier: "10 to 15", warned: true, started_at: now - 2.5 * H, next_at: now + 0.5 * H, done: null },
];

export const demoNotifications: NotificationDbRow[] = [
  { id: 1, job_id: "1001", channel: "telegram", ok: true, detail: "sent", title: demoJobs[0].title, score: 91, created_at: now - 0.4 * H },
  { id: 2, job_id: "1002", channel: "call", ok: true, detail: "answered", title: demoJobs[1].title, score: 86, created_at: now - 1.2 * H },
  { id: 3, job_id: "1002", channel: "telegram", ok: true, detail: "sent", title: demoJobs[1].title, score: 86, created_at: now - 1.2 * H },
];

export const demoSettings: Partial<Settings> = {
  pollIntervalSec: 300, alertsPaused: false, telegramEnabled: true, telegramMin: 65, callMode: "outside_hours", callMin: 85,
  llm: { enabled: true, provider: "api", rankingModel: "claude-sonnet", writerModel: "claude-opus", maxRankPerCycle: 20, dailyBudgetUsd: 5, prepaidCreditUsd: 50, creditSetAt: null },
  autoDraft: { enabled: true, minRank: 85, dailyCap: 3, perCycle: 1, webSearch: false },
};

const month = (offset: number) => { const d = new Date(now); d.setMonth(d.getMonth() - offset); return d.toISOString().slice(0, 7); };
const funnel = [[22, 14, 4, 2], [30, 19, 6, 3], [26, 15, 3, 1], [34, 24, 8, 4], [28, 20, 7, 4], [31, 23, 9, 5]];
export const demoSnapshots: SnapshotRow[] = funnel.map(([sent, viewed, offers, hired], i) => {
  const data: MonthMetrics = {
    period: month(6 - i), proposals: { sent, viewed, offers, hired, declined: 2, withdrawn: 1, boosted: 3 }, invites: 4 + i,
    connects: { balance: 140, spentInPeriod: sent * 14 }, earnings: { gross: 6000 + i * 1800, contracts: 2 + (i % 3) },
    alerts: { alerted: 60 + i * 5, applied: sent, thumbsUp: 12 + i, thumbsDown: 6 }, drafts: { created: sent + 4, submitted: sent, avgEditSimilarity: 0.86 }, manual: {},
  };
  return { id: i + 1, period: data.period, data, created_at: iso(now - (6 - i) * 30 * 24 * H) };
}).reverse();

const coach: CoachReport = {
  headline: "Lead with outcomes: top peers open their overview with a quantified result, not a skills list.",
  peerPatterns: [{ pattern: "Niche title", evidence: "7 of 8 peers name one vertical in the title" }],
  recommendations: [
    { area: "title", change: "Name the vertical", newText: "AI agents for logistics & ops teams | LLM, RAG, evals", why: "Peers with a vertical title convert 2× on invites", impact: "high" },
    { area: "rate", change: "Raise hourly from $85 to $110", newText: null, why: "You are 30% under peers with similar JSS", impact: "medium" },
  ],
  experiments: ["Run the vertical title for 30 days and compare search appearances"],
  builtAt: iso(now - 5 * 24 * H),
};
const review: MonthlyReview = {
  headline: "Best month for win rate (16%) - driven by faster first replies on top-ranked jobs.",
  whatChanged: ["Alert threshold raised to 65"], whatWorked: ["Proposals sent within 30 min won 3 of 9", "Loom intros on every proposal"],
  whatDidnt: ["Fixed-price jobs under $2k: 0 of 7"], actions: ["Skip fixed < $2k unless fit ≥ 90", "Keep auto-draft at rank 85+"],
  rankingTweaks: [{ setting: "telegramMin", from: "60", to: "65", why: "11 of 14 👎 were below 65" }], period: month(1), builtAt: iso(now - 3 * 24 * H),
};
const icp: Icp = {
  builtAt: iso(now - 10 * 24 * H), windowFrom: iso(now - 365 * 24 * H), totalGross: 96_400, contracts: 14, avgTopContract: 12_050, countries: { "United States": 4, "United Kingdom": 2 },
  top: [
    { contractId: "c1", title: "LLM email agent", client: "Freight co.", gross: 18_400, last: "2026-08-30", country: "United States", type: "FIXED" },
    { contractId: "c2", title: "RAG search", client: "Legal SaaS", gross: 14_200, last: "2026-06-12", country: "United Kingdom", type: "HOURLY" },
  ],
  notes: ["Top clients are Series A-B with an ops-heavy business", "Repeat clients account for 58% of gross"],
};
const calibration: Calibration = {
  builtAt: iso(now - 24 * H), samples: 46, positives: 19, ok: true, message: "Fitted on 46 rated alerts (78% agreement with your ratings).",
  coefficients: { bias: -2.1, rules: 2.4, llmFit: 3.1 }, proposed: { weights: { rules: 0.44, llm: 0.56 }, telegramMin: 67, penalties: { low_rate: 12 } }, accuracy: 0.78,
};

export const demoReports: ReportRow[] = [
  { id: 1, kind: "coach", data: coach, created_at: coach.builtAt },
  { id: 2, kind: "monthly_review", data: review, created_at: review.builtAt },
  { id: 3, kind: "icp", data: icp, created_at: icp.builtAt },
  { id: 4, kind: "calibration", data: calibration, created_at: calibration.builtAt },
];

export const demoHealth: HealthSummary = { ok: true, workerStale: false, lateFeeds: 0, feeds: 3, lateAfterMin: 15 };

export const demoUsage: UsageReport = {
  claude: {
    today: 1.84, last7: 9.42, last30: 38.1, calls30: 1240, dailyBudget: 5, provider: "api", prepaidCredit: 50, remainingCredit: 21.3,
    consoleToday: 1.52, consoleLast30: 31.2, subscriptionToday: 0.32, subscriptionLast30: 6.9,
    byAgent30: { ranking: 21.4, proposal: 12.1, closer: 4.6 }, byModel30: {}, daily: [],
  },
  upwork: { callsToday: 212, dailyCap: 1500, calls24h: 230, failed24h: 2, connects: { balance: 142, at: iso(now - H), source: "last job detail" } },
};

export const demoInbox: CloserInboxResponse = {
  inbox: [
    { id: "room_1", name: "Maya · Freightline", lastMessage: "Thanks David - can you do $4,500 if we drop the dashboard?", lastAt: iso(now - 0.5 * H), awaiting: "freelancer", unread: true },
    { id: "room_2", name: "Oliver · LexIndex", lastMessage: "Let's schedule a call for Thursday.", lastAt: iso(now - 20 * H), awaiting: "client", unread: false },
  ],
  inboxError: null,
  history: [],
};

export const demoAdvice: CloserAdvice = {
  stage: "pricing",
  clientRead: "Budget-conscious but motivated: she is negotiating scope, not walking away.",
  culturalNotes: ["US clients usually expect a direct counter with a clear trade - hypothesis, check her tone.", "Keep it short; she replied in 2 lines."],
  recommendedMove: "Trade, don't discount: keep $6k for the full scope or offer $4.5k without the dashboard and with a paid phase 2.",
  reply: "Hi Maya - happy to make this work. Two options:\n\n1) $6,000 - everything as scoped, including the dashboard.\n2) $4,500 - agent + review queue now; dashboard as a separate $1,500 phase once you've seen the results.\n\nEither way we start with the eval set this week. Which fits better?",
  alternatives: ["Offer a paid 1-week discovery milestone at $900 credited to the build.", "Ask what the dashboard is for - it may be a 1-day Metabase setup."],
  risks: ["Dropping the dashboard may remove the ops manager's buy-in"],
  nextStep: "Send the reply, then propose a 20-min call to lock the milestone plan.",
  questionsToAsk: ["Who signs off on go-live?"],
  model: "claude-opus", country: "United States", roomId: "room_1", createdAt: iso(now), reportId: 99,
};

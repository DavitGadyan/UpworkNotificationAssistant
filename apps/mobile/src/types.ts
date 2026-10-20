/*
 * Shared shapes, copied from the web app's lib/types.ts (plus a few API response shapes from lib/).
 * KEEP IN SYNC: when lib/types.ts changes, copy the changed types here. The mobile app is its own package
 * and must not import across the package boundary.
 */

export type ContractType = "HOURLY" | "FIXED";
export type ExperienceLevel = "ENTRY_LEVEL" | "INTERMEDIATE" | "EXPERT";

/** A job as returned by a feed (MCP find_jobs search / smart_search, or GraphQL search). */
export interface Job {
  id: string;
  ciphertext: string; // "~02…", used for the public job URL
  title: string;
  description: string;
  skills: string[];
  jobType: ContractType;
  amount: number | null; // fixed budget
  hourlyMin: number | null;
  hourlyMax: number | null;
  experienceLevel: string | null;
  /** Exact count when the plan exposes it (Freelancer Plus), else the upper bound of the tier. */
  totalApplicants: number;
  proposalsTier?: string | null;
  publishedAt: string; // ISO
  category: string | null;
  duration?: string | null;
  workload?: string | null;
  applied?: boolean;
  featured?: boolean;
  client: {
    paymentVerified: boolean | null; // null = unknown
    identityVerified: boolean;
    totalSpent: number;
    totalHires: number;
    totalPostedJobs: number;
    totalReviews: number;
    totalFeedback: number; // rating freelancers gave the client
    country: string | null;
    hasFinancialPrivacy: boolean;
  };
}

/** Extra client intelligence from find_jobs action=get. Only fetched for jobs that pass the cheap filters. */
export interface JobEnrichment {
  fetchedAt: string;
  description: string;
  connectsCost: number | null;
  connectsBalance: number | null;
  canApply: boolean | null;
  applied: boolean;
  status: string | null; // ACTIVE / CLOSED …
  subcategory: string | null;
  clientState: string | null;
  clientTimezone: string | null;
  record: {
    hires: number | null; // jobs_with_hires
    contractsTotal: number | null;
    contractsActive: number | null;
    totalSpent: number | null;
    feedbackScore: number | null;
    feedbackCount: number | null;
    hours: number | null;
    jobsPosted: number | null;
    hireRatePercent: number | null;
    openJobs: number | null;
  };
  activity: { invitesSent: number; interviewed: number; hired: number; offered: number; unansweredInvites: number };
  bidStats: { avg: number | null; min: number | null; max: number | null } | null;
  workHistory: { title: string; type: string | null; status: string | null; started: string | null; ended: string | null; feedback: number | null; open: boolean }[];
  reviews: { comment: string; score: number | null; ended: string | null; title: string | null }[];
  otherOpenJobs: { id: string; title: string; url: string | null }[];
  screeningQuestions: string[];
  preferredQualifications: Record<string, unknown> | null;
}

export type FeedKind = "search" | "most_recent" | "best_match";

/** A feed = one Upwork view that is polled: Most Recent, Best Matches, or a filtered search. */
export interface SavedSearch {
  id: number;
  name: string;
  enabled: boolean;
  kind: FeedKind;
  /** Upwork skill names (ANDed upstream on MCP search, so keep to 0–2). Also used for scoring overlap. */
  skills: string[];
  query: string;
  jobType: ContractType | "ANY";
  minHourly: number | null;
  minBudget: number | null;
  experienceLevel: ExperienceLevel | "ANY";
  verifiedPaymentOnly: boolean;
  maxProposals: number | null;
  excludeKeywords: string[];
  excludeCountries: string[];
  /** The Upwork URL this feed was imported from, kept for reference. */
  sourceUrl?: string | null;
  createdAt: string;
}

export type CallMode = "outside_hours" | "inside_hours" | "always" | "off";

export interface WorkingHours {
  days: number[]; // 0=Sun … 6=Sat
  start: string; // "09:00"
  end: string; // "18:00"
  timezone: string; // IANA
}

/** JobRankingAssistant rule thresholds. All user-editable. */
export interface RankingRules {
  excludedCountries: string[];
  maxProposals: number; // hard reject above
  watchWarnAt: number; // warn when proposals reach this
  minHourly: number; // "good" hourly floor
  minClientAvgPaid: number; // for jobs without a rate: client must have paid ≥ this per hour
  ai: { minHireRate: number; minAvgPaid: number; recentHireDays: number };
  devops: { minHireRate: number };
  lowRateMax: number; // avg paid ≤ this ⇒ cheap-labour / agency flag
  smallJobAvg: number; // avg spend per contract ≤ this ⇒ small-jobs flag
  ignoredOpenJobs: number; // ≥ N open jobs with no client activity ⇒ flag
  unverifiedExceptionFit: number; // LLM fit needed to forgive unverified payment for a brand-new client
  weights: { rules: number; llm: number };
}

export interface Settings {
  pollIntervalSec: number;
  alertsPaused: boolean;
  telegramEnabled: boolean;
  telegramMin: number;
  callMode: CallMode;
  callMin: number;
  callCooldownMin: number;
  maxCallsPerDay: number;
  quietHours: { enabled: boolean; start: string; end: string };
  workingHours: WorkingHours;
  /** Where jobs come from. auto = MCP when connected, else GraphQL. */
  source: "auto" | "mcp" | "graphql";
  /** Ban-safety: per-cycle and per-day caps on Upwork calls, plus poll jitter. */
  guard: { maxEnrichPerCycle: number; dailyCallCap: number; jitterSec: number; minGapMs: number };
  autoApply?: { enabled: boolean; timezone: string; start: string; end: string; maxPerNight: number; minRank: number; minFit: number; maxProposals: number; maxConnectsPerNight: number; minConnectsBalance: number; requireVerifiedPayment: boolean };
  /** Who searches Upwork feeds: the Claude chat session or the worker - never both. */
  upwork?: {
    poller: "chat" | "worker";
    peak?: { enabled: boolean; timezone: string; start: string; end: string; peakEveryMin: number; offPeakEveryMin: number; reservePct: number; learn: boolean };
    /** Minutes with no new Upwork warning before the feeds go back to the normal schedule. */
    recoverAfterMin?: number;
    /** Job opens allowed per day, resets 04:00 Asia/Yerevan (60–600, default 500). */
    jobOpensPerDay?: number;
  };
  watch: { enabled: boolean; intervalMin: number; maxHours: number };
  /** provider: api = Claude API key; claude-cli = local Claude Code login (`claude -p`, subscription). */
  llm: {
    enabled: boolean; provider: "api" | "claude-cli"; rankingModel: string; writerModel: string; maxRankPerCycle: number; dailyBudgetUsd: number;
    /** Anthropic prepaid credit you last topped up to, and when - remaining = credit − spend since then. */
    prepaidCreditUsd: number | null; creditSetAt: string | null;
  };
  rules: RankingRules;
  /** Draft a proposal automatically for every job ranked at or above minRank (never submitted). */
  autoDraft: { enabled: boolean; minRank: number; dailyCap: number; perCycle: number; webSearch: boolean };
  /** Settings → Your fields: phrases added to the built-in field lists (web lib/ranking/fields.ts). */
  profileFit?: { never: string[]; alsoMine: string[] };
}

/** pending = saved before its client record loaded; it is retried and never alerted until then. */
export type JobStatus = "new" | "pending" | "awaiting_ai" | "notified" | "called" | "dismissed" | "drafting" | "applied";

/** Profile-fit gate (web lib/ranking/profileFit.ts). Off-profile jobs are excluded as "Not your field — …". */
export interface ProfileFit { verdict: "core" | "adjacent" | "off"; field: string | null; reasons: string[] }

export interface ScoreBreakdown {
  total: number; // 0-100 final rank
  skills: number; // /40 - fit (skills overlap, or LLM fit when available)
  client: number; // /35 - client quality
  budget: number; // /15
  competition: number; // /10
  excluded: string | null; // reason, if a hard reject fired
  matchedSkills: string[];
  /** Rule engine output, newest model. Absent on rows written by the old scorer. */
  rules?: RuleResult;
  llm?: LlmRanking | null;
  /** Advisory: how likely this client is to actually hire. Never changes `total` or the rules. */
  intent?: ClientIntent | null;
  profileFit?: ProfileFit;
}

export type IntentArchetype =
  | "ghost_poster" | "unfunded" | "template_collector" | "mass_poster" | "identity_fronting" | "data_harvest" | "stale"
  | "repeat_no_hire" | "genuine";

/** Advisory hire-likelihood verdict (web lib/ranking/intent.ts). High risk ⇒ labelled "skip", no auto-draft. */
export interface ClientIntent {
  hireLikelihood: number; // 0-100
  ghostRisk: "low" | "medium" | "high";
  archetype: IntentArchetype;
  evidence: string[];
  source: "rules" | "rules+ai";
}

export interface RuleFlag { code: string; label: string; severity: "red" | "amber" | "info"; penalty: number }

export interface RuleResult {
  score: number; // 0-100 before LLM
  rejected: string | null;
  flags: RuleFlag[];
  passes: string[]; // human-readable positives
  category: JobCategory;
  derived: { avgPaid: number | null; avgPerContract: number | null; lastHireDays: number | null; hireRate: number | null };
}

export type JobCategory = "ai" | "saas" | "automation" | "devops" | "mlops" | "data" | "marketing" | "other";

export interface LlmRanking {
  model: string;
  category: JobCategory;
  fit: number; // 0-100 fit to David's profile
  valuePotential: number; // 0-100 chance this is a high-value A-Z client
  summary: string;
  finalProduct: string;
  skillsWanted: string[];
  reasons: string[];
  redFlags: string[];
  bigFish?: string;
}

export interface CachedJob extends Job {
  searchId: number;
  searchName: string;
  score: ScoreBreakdown;
  status: JobStatus;
  fetchedAt: string;
  enrichment?: JobEnrichment | null;
  feeds?: string[];
}

export interface NotificationRow {
  id: number;
  jobId: string;
  channel: "telegram" | "call";
  ok: boolean;
  detail: string;
  title: string;
  score: number;
  createdAt: string;
}

// ---------- proposals ----------
export type ProposalStatus = "draft" | "needs_loom" | "ready" | "approved" | "previewed" | "submitted" | "discarded";

export interface ProposalResearch {
  contactName: string | null;
  /** Who the proposal speaks to - decides vocabulary (HR plain, CTO technical, founder business). */
  contactRole?: "hr_recruiter" | "technical_lead" | "founder_exec" | "marketing_seo" | "operations" | "investor_shareholder" | "unknown";
  roleEvidence?: string | null;
  contactSource: string | null;
  company: string | null;
  companyConfidence: "confirmed" | "likely" | "unknown";
  companySignals: string[];
  bigFish: string;
  hiddenProblems: string[];
  whyNotSolvedInternally: string;
  assumptions: string[];
}

export interface Proposal {
  id: number;
  jobId: string;
  jobTitle: string;
  jobUrl: string;
  status: ProposalStatus;
  coverLetter: string;
  research: ProposalResearch | null;
  answers: { question: string; answer: string }[];
  bid: number | null;
  estimatedDuration: string | null;
  portfolioProjectIds: string[];
  loomUrl: string | null;
  approvedAt: string | null;
  preview: Record<string, unknown> | null;
  previewId: string | null;
  submittedAt: string | null;
  originalDraft: string;
  model: string | null;
  promptVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackRow {
  id: number;
  kind: "alert" | "draft" | "closer" | "profile";
  refId: string;
  rating: number; // -1, 0, 1 (or 1..5 scaled)
  reason: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}

// ---------- mobile-only row + API shapes ----------

/** public.jobs row as returned by Supabase, flattened into the CachedJob-like shape screens use. */
export interface JobRow {
  id: string;
  feed_id: number;
  title: string;
  url: string;
  total: number;
  status: JobStatus;
  published_at: string;
  fetched_at: number;
  keep: boolean;
  data: Job;
  score: ScoreBreakdown;
  enrichment: JobEnrichment | null;
  feeds: string[] | null;
}

export interface ProposalRow {
  id: number;
  job_id: string;
  status: ProposalStatus;
  data: Omit<Proposal, "id" | "jobId" | "status" | "createdAt" | "updatedAt">;
  created_at: string;
  updated_at: string;
}

export interface FeedRow { id: number; name: string; kind: FeedKind; enabled: boolean; data: Partial<SavedSearch>; created_at?: string }

export interface WatchRow {
  job_id: string;
  message_id: number | null;
  last_count: number;
  last_tier: string | null;
  warned: boolean;
  started_at: number;
  next_at: number;
  done: string | null;
}

export interface NotificationDbRow { id: number; job_id: string; channel: string; ok: boolean; detail: string; title: string; score: number; created_at: number }

export interface MonthMetrics {
  period: string;
  proposals: { sent: number; viewed: number; offers: number; hired: number; declined: number; withdrawn: number; boosted: number };
  invites: number;
  connects: { balance: number | null; spentInPeriod: number | null };
  earnings: { gross: number; contracts: number };
  alerts: { alerted: number; applied: number; thumbsUp: number; thumbsDown: number };
  drafts: { created: number; submitted: number; avgEditSimilarity: number | null };
  manual: Record<string, number>;
}
export interface SnapshotRow { id: number; period: string; data: MonthMetrics; created_at: string }

export interface CoachReport {
  headline: string;
  peerPatterns: { pattern: string; evidence: string }[];
  recommendations: { area: string; change: string; newText: string | null; why: string; impact: "high" | "medium" | "low" }[];
  experiments: string[];
  builtAt: string;
  note?: string;
}
export interface MonthlyReview {
  headline: string;
  whatChanged: string[];
  whatWorked: string[];
  whatDidnt: string[];
  actions: string[];
  rankingTweaks: { setting: string; from: string; to: string; why: string }[];
  period: string;
  builtAt: string;
}
export interface IcpContract { contractId: string; title: string; client: string; gross: number; last: string; country: string | null; type: string | null }
export interface Icp { builtAt: string; windowFrom: string; totalGross: number; contracts: number; top: IcpContract[]; countries: Record<string, number>; avgTopContract: number; notes: string[] }
export interface Calibration {
  builtAt: string;
  samples: number;
  positives: number;
  ok: boolean;
  message: string;
  coefficients: Record<string, number>;
  proposed: { weights: { rules: number; llm: number }; telegramMin: number; penalties: Record<string, number> } | null;
  accuracy: number | null;
}
export type ReportKind = "coach" | "monthly_review" | "icp" | "calibration" | "closer" | "ghost_patterns" | "lessons" | "ranker_lessons" | "lessons_decision" | "prompt_lab" | "ranker_lab";

/** What the client did with a sent proposal (public.proposal_outcomes, read-only for the app). */
export type OutcomeLabel = "win" | "loss_viewed" | "loss_unviewed" | "pending" | "void";
export interface ProposalOutcomeRow {
  upwork_proposal_id: string; job_id: string; job_title: string; submitted_at: string; status: string; viewed: boolean; boosted: boolean;
  bid_label: string | null; first_reply: string | null; outcome: OutcomeLabel;
  insights: { proposalsTotal: number | null } | null; job: { field: string | null; clientCountry: string | null } | null;
}
export interface Lesson { id: string; target: "writer" | "ranker"; area: string; lesson: string; evidence: string; support: number; confidence: "low" | "medium" | "high" }
export interface LessonsReport { builtAt: string; ok: boolean; message: string; headline: string | null; convinces: string | null; earnsClick: string | null; lessons: Lesson[] }
export interface LessonsDecision { reportId: number; status: "approved" | "rejected"; ids: string[]; at: string }

/** public.reports kind "ghost_patterns" (web lib/insights/ghosts.ts). Suggestions are never applied. */
export interface GhostReport {
  builtAt: string;
  jobsAssessed: number;
  byArchetype: { archetype: string; jobs: number; highRisk: number; avgLikelihood: number }[];
  outcomes: { archetype: string; tracked: number; hired: number; closedNoHire: number; open: number; avgLikelihood: number | null }[];
  topClients: { clientId: string; country: string | null; jobsSeen: number; hired: number; closedNoHire: number }[];
  suggestions: { suggestion: string; rationale: string }[];
}
export interface ReportRow<T = unknown> { id: number; kind: ReportKind; data: T; created_at: string }

/** GET /api/health (public summary). */
export interface HealthSummary { ok: boolean; workerStale: boolean; lateFeeds: number; feeds: number; lateAfterMin: number }

/** GET /api/health/full (owner only): per-feed polling status from the worker. */
export interface HealthFull {
  ok: boolean; goal: string; workerHeartbeat: string | null; workerStale: boolean; lateAfterMin: number;
  feeds: { feedId: number; name: string; kind: string; lastOkAt: string | null; lastError: string | null; failures: number; successRate24h: number | null; runs24h: number; late: boolean }[];
  /** Paused ⇒ new jobs wait for their AI check; nothing alerts on rules alone. Absent from older workers. */
  aiRanking?: { paused: boolean; since: string | null; reason: string | null };
}

/** GET /api/usage. */
export interface UsageReport {
  claude: {
    today: number; last7: number; last30: number; calls30: number; dailyBudget: number; provider: string;
    prepaidCredit: number | null; remainingCredit: number | null;
    consoleToday: number; consoleLast30: number; subscriptionToday: number; subscriptionLast30: number;
    byAgent30: Record<string, number>; byModel30: Record<string, number>;
    daily: { date: string; total: number }[];
  };
  upwork: {
    callsToday: number; dailyCap: number; calls24h: number; failed24h: number;
    connects: { balance: number | null; at: string | null; source: string };
  };
}

export type CloserStage = "first_reply" | "discovery" | "scoping" | "pricing" | "objection" | "closing" | "stalled" | "post_hire";
export interface CloserAdvice {
  stage: CloserStage;
  clientRead: string;
  culturalNotes: string[];
  recommendedMove: string;
  reply: string;
  alternatives: string[];
  risks: string[];
  nextStep: string;
  questionsToAsk: string[];
  model: string;
  country: string;
  roomId: string | null;
  createdAt: string;
  reportId?: number;
}
export interface CloserRoom { id: string; name: string; lastMessage: string; lastAt: string | null; awaiting: string | null; unread: boolean }
export interface CloserInboxResponse { inbox: CloserRoom[]; inboxError: string | null; history: unknown[] }

/** Prompt analytics (lib/learning/promptLab.ts LabBoard, saved as reports prompt_lab / ranker_lab). */
export interface ArmStat { arm: number; label: string; n: number; wins: number; viewed: number; offers: number; hires: number; replyRate: number; viewRate: number; offerRate: number; hireRate: number; expected: number; pBest: number | null; kept: number | null }
export interface LabBoardScenario { key: string; label: string; n: number; arms: ArmStat[]; best: number | null; verdict: "best" | "leading" | "single" | "not_enough_data"; pinned: number | null }
export interface LabVersionProposal { upworkProposalId: string; localProposalId: number | null; jobId: string; jobTitle: string; submittedAt: string; outcome: OutcomeLabel; status: string; viewed: boolean; scenario: string; kept: number | null; rank: number | null }
export interface LabBoard {
  builtAt: string;
  prompt: "proposal" | "job_ranking";
  config: { enabled: boolean; arms: number[]; pinned: Record<string, number>; explore: number };
  versions: { id: number; label: string; note: string | null; createdAt: string | null; active: boolean }[];
  overall: LabBoardScenario;
  byScenario: LabBoardScenario[];
  byRank?: LabBoardScenario[];
  decided: number;
  proposals: Record<string, LabVersionProposal[]>;
  funnel: { sent: number; decided: number; viewed: number; replied: number; offers: number; hires: number; connects: number };
}
export interface PromptStatRow { day: string; prompt: string; version: number; scenario: string; sent: number; viewed: number; replied: number; offers: number; hires: number }

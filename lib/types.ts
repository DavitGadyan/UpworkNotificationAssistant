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
  /** Upwork's public client company id (clientCompanyPublic.id) - links jobs from the same client. */
  clientId?: string | null;
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
}

/** pending = saved before its client record loaded; it is retried and never alerted until then. */
export type JobStatus = "new" | "pending" | "notified" | "called" | "dismissed" | "drafting" | "applied";

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
}

export type IntentArchetype =
  | "ghost_poster" | "unfunded" | "template_collector" | "mass_poster" | "identity_fronting" | "data_harvest" | "stale"
  | "repeat_no_hire" | "genuine";

/** Advisory hire-likelihood verdict (lib/ranking/intent.ts). High risk ⇒ labelled "skip", no auto-draft. */
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
  /** The AI's own read of whether this client will hire (folded into score.intent). */
  intent?: { hireLikelihood: number; archetype: IntentArchetype; evidence: string[] };
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

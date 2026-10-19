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
  /** Upwork subcategory ("Game Design & Development", "AI Apps & Integration"), when the feed row has it. */
  subcategory?: string | null;
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
/** A file the client attached to the job post (when the connector returns it). */
export interface JobAttachment { name: string; url: string | null }

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
  /** When the client's Upwork account was created ("Member since"), if Upwork returns it - null when unknown. */
  clientSince?: string | null;
  /** Files attached to the post, if Upwork returns them. */
  attachments?: JobAttachment[];
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
  /** Who searches Upwork feeds: this Claude chat session's watch loop, or the worker. Never both (lib/upwork/governor.ts). */
  upwork: {
    poller: "chat" | "worker";
    /**
     * Evening peak (David, 2026-10-17): high-value US clients post from ~18:00 Armenian time. Inside the window
     * each feed runs every `peakEveryMin` (4); outside it every `offPeakEveryMin` (7), and off-peak may use at most
     * (100 − reservePct)% of the day's budget so the evening is never starved. `learn` adds hours where
     * high-value jobs actually showed up (after 7 days of data). Times are HH:MM in `timezone`.
     */
    peak: { enabled: boolean; timezone: string; start: string; end: string; peakEveryMin: number; offPeakEveryMin: number; reservePct: number; learn: boolean };
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
  /**
   * Night auto-apply (David, 2026-10-18): while he sleeps (default 00:00-11:00 Asia/Yerevan) auto-drafted proposals
   * for jobs that clear every bar below are submitted without a Loom video, within per-night and Connects limits.
   * Off by default; never runs while the pacing governor is stopped. Every submission is reported on Telegram.
   */
  autoApply: {
    enabled: boolean; timezone: string; start: string; end: string;
    maxPerNight: number; minRank: number; minFit: number; maxProposals: number;
    maxConnectsPerNight: number; minConnectsBalance: number; requireVerifiedPayment: boolean;
  };
  /** Settings → Your fields: phrases added to the built-in field lists (lib/ranking/fields.ts). */
  profileFit: { never: string[]; alsoMine: string[] };
}

/**
 * pending = saved before its client record loaded; awaiting_ai = record loaded but the AI ranking hasn't run yet
 * (budget, outage, per-cycle cap). Both are retried and never alerted until then.
 * awaiting_payment = a good fit whose client hasn't verified payment yet; re-checked and alerted once they do.
 */
export type JobStatus = "new" | "pending" | "awaiting_ai" | "awaiting_payment" | "notified" | "called" | "dismissed" | "drafting" | "applied";

/** Profile-fit gate (lib/ranking/profileFit.ts): is this David's kind of work at all? */
export interface ProfileFit {
  verdict: "core" | "adjacent" | "off";
  field: string | null;
  reasons: string[];
}

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
  /** Off-profile jobs are excluded ("Not your field — …"); absent on rows scored before 2026-10-14. */
  profileFit?: ProfileFit;
  /** The chat watch loop alerted David on this job (`npm run vouch`): its fit counts for auto-draft and auto-apply. */
  watch?: WatchVouch | null;
}

export interface WatchVouch { fit: number; at: string; why?: string }

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
  similarProject?: boolean;
  /** The AI's read: outside David's fields entirely (excluded like the profile-fit gate). */
  offProfile?: boolean;
  /** Which of his fields the work belongs to, in a few words. */
  field?: string;
  /** The AI's own read of whether this client will hire (folded into score.intent). */
  intent?: { hireLikelihood: number; archetype: IntentArchetype; evidence: string[] };
  /** job_ranking prompt version that judged it (null = built-in prompt). */
  promptVersion?: number | null;
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
  /** The AI's bid before David's edits (to learn from bid changes). */
  originalBid?: number | null;
  model: string | null;
  promptVersion: number | null;
  /** Prompt-lab scenario when drafted (field · client tier) and why that prompt version was used. */
  scenario?: string | null;
  promptPick?: string | null;
  /** Upwork's id for the sent proposal (read back after submit) - links it to its outcome. */
  upworkProposalId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the client did after David sent a proposal. Both kinds of loss are negative feedback, kept apart because
 * they need different fixes: viewed-no-reply = the letter didn't convince; never viewed = job choice/timing/first line.
 */
/** void = no signal about David (he withdrew, or the client deleted the job as accidental/inappropriate). */
export type OutcomeLabel = "win" | "loss_viewed" | "loss_unviewed" | "pending" | "void";

export interface OutcomeJob {
  category: string | null;
  subcategory: string | null;
  /** David's field per the profile-fit gate (null = unclear). */
  field: string | null;
  fitVerdict: "core" | "adjacent" | "off" | null;
  contractType: string | null;
  budget: string | null;
  clientCountry: string | null;
  clientSpent: number | null;
  clientHires: number | null;
  interviewed: number | null;
  hired: number | null;
  /** Our ranking when the job was still cached. */
  rank: number | null;
  rulesScore: number | null;
  llmFit: number | null;
  flags: string[];
  ruleCategory: string | null;
  description: string;
  /** The client invited David to apply (an invitation sits in the proposal room). */
  invited?: boolean;
  /** job_ranking prompt version that ranked the job (null = built-in; undefined = not ranked by the AI). */
  rankerVersion?: number | null;
}

export interface ProposalOutcome {
  upworkProposalId: string;
  jobId: string;
  jobTitle: string;
  localProposalId: number | null;
  submittedAt: string;
  status: string;
  statusLabel: string | null;
  archiveReason: string | null;
  viewed: boolean;
  boosted: boolean;
  connectsBid: number | null;
  bid: number | null;
  bidLabel: string | null;
  coverLetter: string | null;
  insights: { proposalsTotal: number | null; opened: number | null; messaged: number | null; shortlisted: number | null } | null;
  roomId: string | null;
  repliedAt: string | null;
  firstReply: string | null;
  outcome: OutcomeLabel;
  job: OutcomeJob | null;
  checks: number;
  nextCheckAt: number;
  updatedAt: number;
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

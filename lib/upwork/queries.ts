import type { Job, JobEnrichment, SavedSearch } from "../types";
import { gql } from "./graphql";

// Scope: "Read marketplace Job Postings". Only fields the scorer and the UI actually use.
export const SEARCH_JOBS = /* GraphQL */ `
  query searchJobs($filter: MarketplaceJobPostingsSearchFilter, $sort: [MarketplaceJobPostingSearchSortAttribute]) {
    marketplaceJobPostingsSearch(marketPlaceJobFilter: $filter, searchType: USER_JOBS_SEARCH, sortAttributes: $sort) {
      totalCount
      edges {
        node {
          id
          ciphertext
          title
          description
          experienceLevel
          category
          totalApplicants
          publishedDateTime
          amount { rawValue currency }
          hourlyBudgetMin { rawValue }
          hourlyBudgetMax { rawValue }
          skills { name prettyName }
          client {
            totalHires
            totalPostedJobs
            totalSpent { rawValue }
            verificationStatus
            totalReviews
            totalFeedback
            hasFinancialPrivacy
            location { country }
          }
        }
      }
    }
  }
`;

// Scope: "View UserDetails". Shown on the Settings page so you can see which account is connected.
export const ME = /* GraphQL */ `query me { user { id nid name } }`;

export function buildFilter(s: SavedSearch): Record<string, unknown> {
  const f: Record<string, unknown> = {
    daysPosted_eq: 1,
    pagination_eq: { first: 50, after: "0" },
  };
  if (s.skills.length) f.skillExpression_eq = s.skills.join(",");
  if (s.query.trim()) f.searchExpression_eq = s.query.trim();
  if (s.jobType !== "ANY") f.jobType_eq = s.jobType;
  if (s.experienceLevel !== "ANY") f.experienceLevel_eq = s.experienceLevel;
  if (s.verifiedPaymentOnly) f.verifiedPaymentOnly_eq = true;
  if (s.minHourly != null) f.hourlyRate_eq = { rangeStart: s.minHourly };
  if (s.minBudget != null) f.budgetRange_eq = { rangeStart: s.minBudget };
  if (s.maxProposals != null) f.proposalRange_eq = { rangeStart: 0, rangeEnd: s.maxProposals };
  return f;
}

type Money = { rawValue: string } | null;
const num = (m: Money) => (m?.rawValue ? Number(m.rawValue) : null);

interface Node {
  id: string; ciphertext: string; title: string; description: string; experienceLevel: string | null;
  category: string | null; totalApplicants: number; publishedDateTime: string;
  amount: Money; hourlyBudgetMin: Money; hourlyBudgetMax: Money;
  skills: ({ name: string; prettyName: string } | null)[];
  client: {
    totalHires: number; totalPostedJobs: number; totalSpent: Money; verificationStatus: string | null;
    totalReviews: number; totalFeedback: number; hasFinancialPrivacy: boolean; location: { country: string | null } | null;
  };
}

export function mapNode(n: Node, verifiedPaymentFilter: boolean): Job {
  const hourlyMin = num(n.hourlyBudgetMin);
  const hourlyMax = num(n.hourlyBudgetMax);
  const amount = num(n.amount);
  return {
    id: n.id,
    ciphertext: n.ciphertext,
    title: n.title,
    description: n.description,
    skills: n.skills.filter(Boolean).map((s) => s!.prettyName || s!.name),
    jobType: hourlyMin != null || hourlyMax != null || amount == null ? "HOURLY" : "FIXED",
    amount: amount && amount > 0 ? amount : null,
    hourlyMin, hourlyMax,
    experienceLevel: n.experienceLevel,
    totalApplicants: n.totalApplicants ?? 0,
    publishedAt: n.publishedDateTime,
    category: n.category,
    client: {
      // Search results don't expose payment verification; when the search filtered on it, it's known true.
      paymentVerified: verifiedPaymentFilter ? true : null,
      identityVerified: n.client.verificationStatus === "VERIFIED",
      totalSpent: num(n.client.totalSpent) ?? 0,
      totalHires: n.client.totalHires ?? 0,
      totalPostedJobs: n.client.totalPostedJobs ?? 0,
      totalReviews: n.client.totalReviews ?? 0,
      totalFeedback: n.client.totalFeedback ?? 0,
      country: n.client.location?.country ?? null,
      hasFinancialPrivacy: !!n.client.hasFinancialPrivacy,
    },
  };
}

export async function searchJobs(s: SavedSearch, meta: { category?: string } = {}): Promise<Job[]> {
  const data = await gql<{ marketplaceJobPostingsSearch: { edges: { node: Node }[] } }>(SEARCH_JOBS, {
    filter: buildFilter(s),
    sort: [{ field: "RECENCY" }],
  }, { label: "api.search", meta: { feed: true, ...meta } });
  return data.marketplaceJobPostingsSearch.edges.map((e) => mapNode(e.node, s.verifiedPaymentOnly));
}

export async function whoAmI(): Promise<string | null> {
  try {
    const d = await gql<{ user: { name: string | null; nid: string | null } }>(ME, {}, { label: "api.me" });
    return d.user.name ?? d.user.nid ?? null;
  } catch {
    return null;
  }
}


/*
 * Job details + client activity (scope "Job Details Entities - Read-Only"). UNVERIFIED field names: Upwork's schema
 * reference isn't reachable without a key, so these follow the names the MCP connector returns. Once the key works,
 * `npm run api:schema` dumps the live schema to docs/upwork-graphql-schema.json - confirm or fix the fields here.
 * Until then a schema error is logged and the job is judged on its search row (no client activity), never failed.
 */
export const JOB_DETAILS = /* GraphQL */ `
  query jobDetails($id: ID!) {
    marketplaceJobPosting(id: $id) {
      id
      content { description }
      workFlowState { status }
      activityStat { jobActivity { invitesSent totalInvitedToInterview totalHired totalUnansweredInvites totalOffered } }
      clientCompanyPublic { id paymentVerification { paymentVerified } }
    }
  }
`;

interface DetailNode {
  id: string;
  content?: { description?: string | null } | null;
  workFlowState?: { status?: string | null } | null;
  activityStat?: { jobActivity?: { invitesSent?: number; totalInvitedToInterview?: number; totalHired?: number; totalUnansweredInvites?: number; totalOffered?: number } | null } | null;
  clientCompanyPublic?: { id?: string | null; paymentVerification?: { paymentVerified?: boolean | null } | null } | null;
}

const SCHEMA_ERROR = /Cannot query field|Unknown (argument|type)|Validation error|FieldUndefined|not exist/i;

/** Map an API job-details answer onto the same shape the MCP path produces (lib/upwork/mcp/jobs.ts mapDetail). */
export function mapApiDetail(d: DetailNode, job: Pick<Job, "description" | "client"> | null, now = new Date()): { enrichment: JobEnrichment; patch: Partial<Job> } {
  const a = d.activityStat?.jobActivity ?? {};
  const c = job?.client;
  const verified = d.clientCompanyPublic?.paymentVerification?.paymentVerified;
  const enrichment: JobEnrichment = {
    fetchedAt: now.toISOString(),
    description: d.content?.description ?? job?.description ?? "",
    connectsCost: null, connectsBalance: null, canApply: null, applied: false,
    status: d.workFlowState?.status ?? null,
    subcategory: null, clientState: null, clientTimezone: null,
    record: {
      hires: c?.totalHires ?? null, contractsTotal: null, contractsActive: null, totalSpent: c?.totalSpent ?? null,
      feedbackScore: c?.totalFeedback ?? null, feedbackCount: c?.totalReviews ?? null, hours: null,
      jobsPosted: c?.totalPostedJobs ?? null,
      hireRatePercent: c?.totalPostedJobs ? Math.round(((c.totalHires ?? 0) / c.totalPostedJobs) * 100) : null,
      openJobs: null,
    },
    activity: { invitesSent: a.invitesSent ?? 0, interviewed: a.totalInvitedToInterview ?? 0, hired: a.totalHired ?? 0, offered: a.totalOffered ?? 0, unansweredInvites: a.totalUnansweredInvites ?? 0 },
    bidStats: null, workHistory: [], reviews: [], otherOpenJobs: [], screeningQuestions: [], preferredQualifications: null,
    clientId: d.clientCompanyPublic?.id ?? null,
  };
  const patch: Partial<Job> = verified == null || !c ? {} : { client: { ...c, paymentVerified: verified } };
  return { enrichment, patch };
}

export async function apiJobDetail(id: string, job: Pick<Job, "description" | "client"> | null): Promise<{ enrichment: JobEnrichment; patch: Partial<Job> } | null> {
  try {
    const d = await gql<{ marketplaceJobPosting: DetailNode | null }>(JOB_DETAILS, { id }, { label: "api.job", meta: { jobId: id } });
    return d.marketplaceJobPosting ? mapApiDetail(d.marketplaceJobPosting, job) : null;
  } catch (e) {
    if (SCHEMA_ERROR.test((e as Error).message)) {
      console.warn("api job details: schema mismatch - run npm run api:schema and fix JOB_DETAILS:", (e as Error).message.slice(0, 200));
      return null;
    }
    throw e;
  }
}

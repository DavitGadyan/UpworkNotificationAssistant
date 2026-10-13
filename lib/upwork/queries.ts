import type { Job, SavedSearch } from "../types";
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

export async function searchJobs(s: SavedSearch): Promise<Job[]> {
  const data = await gql<{ marketplaceJobPostingsSearch: { edges: { node: Node }[] } }>(SEARCH_JOBS, {
    filter: buildFilter(s),
    sort: [{ field: "RECENCY" }],
  });
  return data.marketplaceJobPostingsSearch.edges.map((e) => mapNode(e.node, s.verifiedPaymentOnly));
}

export async function whoAmI(): Promise<string | null> {
  try {
    const d = await gql<{ user: { name: string | null; nid: string | null } }>(ME);
    return d.user.name ?? d.user.nid ?? null;
  } catch {
    return null;
  }
}


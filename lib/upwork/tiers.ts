import type { Job } from "../types";

/* Proposal tiers as the connector reports them when the exact count is hidden by the plan. */
const TIER_HIGH: Record<string, number> = { "fewer than 5": 4, "5 to 10": 10, "10 to 15": 15, "15 to 20": 20, "20 to 50": 50, "50+": 50 };
const TIER_LOW: Record<string, number> = { "fewer than 5": 0, "5 to 10": 5, "10 to 15": 10, "15 to 20": 15, "20 to 50": 20, "50+": 50 };
export const tierHigh = (t?: string | null) => (t ? TIER_HIGH[t.toLowerCase()] ?? 0 : 0);
export const tierLow = (t?: string | null) => (t ? TIER_LOW[t.toLowerCase()] ?? 0 : 0);
/** Lower bound on proposals already sent: exact when known, else the tier's floor. */
export const proposalsLow = (j: Pick<Job, "totalApplicants" | "proposalsTier">) =>
  j.proposalsTier ? tierLow(j.proposalsTier) : j.totalApplicants;


import { getJob, getSettings, getTokens, hasJob } from "../db";
import type { Job, JobEnrichment, SavedSearch } from "../types";
import { viaGateway } from "./graphql";
import { mcpConnected } from "./mcp/client";
import { fetchFeedMcp, getJobDetailMcp } from "./mcp/jobs";
import { apiJobDetail, searchJobs } from "./queries";

/*
 * One interface over the two ways of reading Upwork (Settings → Upwork connection):
 *   mcp     - the official MCP connector (Most Recent, Best Matches, saved searches, job details)
 *   graphql - the official Upwork GraphQL API, through the gateway on the GCP VM (gateway/server.ts) or with a
 *             local OAuth token: saved searches, Most Recent (as a recency search), job details. No Best Matches.
 * Both go through the pacing governor (lib/upwork/guard.ts).
 */

export type SourceKind = "mcp" | "graphql" | "none";

/** The official API is usable: a gateway is configured, or a local OAuth token exists. */
export const apiConnected = async () => viaGateway() || !!(await getTokens());

export async function activeSource(): Promise<SourceKind> {
  const pref = (await getSettings()).source;
  if (pref === "mcp") return (await mcpConnected()) ? "mcp" : "none";
  if (pref === "graphql") return (await apiConnected()) ? "graphql" : "none";
  return (await mcpConnected()) ? "mcp" : (await apiConnected()) ? "graphql" : "none";
}

export async function fetchFeed(feed: SavedSearch): Promise<Job[]> {
  const src = await activeSource();
  if (src === "mcp") return fetchFeedMcp(feed, { isKnown: hasJob, maxPages: 3 });
  if (src === "graphql") {
    // The API has no recommendation feed: Best Matches stays MCP-only. Most Recent = newest postings, recency-sorted.
    if (feed.kind === "best_match") return [];
    return searchJobs(feed.kind === "most_recent" ? { ...feed, kind: "search" } : feed, { category: `feed:${feed.id}` });
  }
  throw new Error("No Upwork connection - open Settings and connect");
}

/** Full details + client record, from whichever backend is active. */
export async function fetchDetail(id: string): Promise<{ enrichment: JobEnrichment; patch: Partial<Job> } | null> {
  const src = await activeSource();
  if (src === "mcp") return getJobDetailMcp(id);
  if (src === "graphql") return apiJobDetail(id, await getJob(id));
  return null;
}

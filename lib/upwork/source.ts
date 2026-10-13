import { getSettings, getTokens, hasJob } from "../db";
import type { Job, JobEnrichment, SavedSearch } from "../types";
import { mcpConnected } from "./mcp/client";
import { fetchFeedMcp, getJobDetailMcp } from "./mcp/jobs";
import { searchJobs } from "./queries";

/*
 * One interface over the two ways of reading Upwork:
 *   mcp     - the official MCP connector (default; supports Most Recent / Best Matches feeds)
 *   graphql - the Marketplace GraphQL API with your own API key (fallback; searches only)
 */

export type SourceKind = "mcp" | "graphql" | "none";

export async function activeSource(): Promise<SourceKind> {
  const pref = (await getSettings()).source;
  if (pref === "mcp") return (await mcpConnected()) ? "mcp" : "none";
  if (pref === "graphql") return (await getTokens()) ? "graphql" : "none";
  return (await mcpConnected()) ? "mcp" : (await getTokens()) ? "graphql" : "none";
}

export async function fetchFeed(feed: SavedSearch): Promise<Job[]> {
  const src = await activeSource();
  if (src === "mcp") return fetchFeedMcp(feed, { isKnown: hasJob, maxPages: 3 });
  if (src === "graphql") {
    if (feed.kind !== "search") return []; // GraphQL has no recommendation feeds
    return searchJobs(feed);
  }
  throw new Error("No Upwork connection - open Settings and connect");
}

/** Full details + client record. MCP only; GraphQL returns null (search rows are all we have). */
export async function fetchDetail(id: string): Promise<{ enrichment: JobEnrichment; patch: Partial<Job> } | null> {
  if ((await activeSource()) !== "mcp") return null;
  return getJobDetailMcp(id);
}

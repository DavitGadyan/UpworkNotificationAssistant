import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";
import { getJob, getSettings, listProposals, saveReport } from "../db";
import { callTool } from "../upwork/mcp/client";
import { normalizeCountry } from "../upwork/mcp/jobs";
import { jobBrief } from "./jobRanking";
import { structured, untrusted } from "./llm";
import { profileDigest } from "./profile";
import { getPrompt } from "./prompts";

/*
 * Closer agent. The system prompt is assembled fresh for each client:
 *   playbook (distilled from the sales courses in knowledge_base/) + cultural profile for the client's
 *   country + David's profile + this client's job, record, reviews, the proposal sent and the thread.
 * Output is advice and a reply draft; sending goes through Upwork by David (or send_message with confirm).
 */

const kb = (f: string) => { try { return readFileSync(join(process.cwd(), "knowledge_base", f), "utf8"); } catch { return ""; } };

interface Culture { summary: string; do: string[]; avoid: string[]; alsoApplies?: string[] }
export function culturalProfile(country: string | null | undefined): { country: string; profile: Culture } {
  let all: Record<string, Culture> = {};
  try { all = JSON.parse(kb("cultural_profiles.json")); } catch { /* fall through to default */ }
  const c = country ? normalizeCountry(country) : "";
  const direct = all[c];
  if (direct && c !== "_note") return { country: c, profile: direct };
  const via = Object.entries(all).find(([, v]) => (v as Culture).alsoApplies?.includes(c));
  if (via) return { country: c, profile: via[1] };
  return { country: c || "unknown", profile: all.default ?? { summary: "Mirror the client.", do: [], avoid: [] } };
}

const CloserSchema = z.object({
  stage: z.enum(["first_reply", "discovery", "scoping", "pricing", "objection", "closing", "stalled", "post_hire"]),
  clientRead: z.string(),
  culturalNotes: z.array(z.string()),
  recommendedMove: z.string(),
  reply: z.string(),
  alternatives: z.array(z.string()),
  risks: z.array(z.string()),
  nextStep: z.string(),
  questionsToAsk: z.array(z.string()),
});
export type CloserAdvice = z.infer<typeof CloserSchema> & { model: string; country: string; roomId: string | null; createdAt: string; reportId?: number };

type Msg = { from?: string; from_self?: boolean; from_side?: string; message?: string; text?: string; created?: string; createdDateTime?: string };

/** Read a room's thread (newest first upstream) and return it oldest → newest as plain lines. */
export async function readThread(roomId: string, max = 60): Promise<string> {
  const r = await callTool<{ messages?: Msg[]; stories?: Msg[] }>("get_messages", "list_messages", { room_id: roomId, limit: Math.min(100, max) });
  const msgs = (r.messages ?? r.stories ?? []).slice(0, max).reverse();
  return msgs.map((m) => `${m.from_self ? "David" : m.from_side === "client" ? `Client (${m.from ?? "?"})` : m.from ?? "?"}: ${(m.message ?? m.text ?? "").trim()}`).join("\n");
}

export async function findRoomForProposal(upworkProposalId: string): Promise<string | null> {
  try {
    const r = await callTool<{ room_id?: string; id?: string; room?: { id?: string } }>("get_messages", "find_room", { context_type: "proposal", context_id: upworkProposalId });
    return r.room_id ?? r.room?.id ?? r.id ?? null;
  } catch { return null; }
}

export interface CloserInput {
  jobId?: string;
  roomId?: string;
  thread?: string; // pasted thread when there is no room id
  country?: string;
  clientName?: string;
  goal?: string; // what David wants from this reply ("get them to accept $6k fixed", "book a call")
}

export async function suggestReply(input: CloserInput): Promise<CloserAdvice> {
  const job = input.jobId ? await getJob(input.jobId) : null;
  const country = input.country ?? job?.client.country ?? null;
  const culture = culturalProfile(country);
  const thread = input.thread?.trim() || (input.roomId ? await readThread(input.roomId) : "");
  if (!thread) throw new Error("No conversation to work from - pick a room or paste the thread");
  const proposal = input.jobId ? (await listProposals({ jobId: input.jobId })).find((p) => p.status === "submitted") ?? (await listProposals({ jobId: input.jobId }))[0] : null;

  const playbook = kb("closer_playbook.md") || "(Playbook not distilled yet - rely on challenger selling: teach, tailor, take control; trade concessions; propose a paid discovery milestone.)";
  const system = [
    (await getPrompt("closer")).body,
    "## Sales playbook",
    playbook,
    `## Cultural profile - ${culture.country} (hypothesis only)`,
    `${culture.profile.summary}\nDo: ${culture.profile.do.join("; ")}\nAvoid: ${culture.profile.avoid.join("; ")}`,
    "## David",
    await profileDigest({ projects: false }),
  ].join("\n\n");

  const user = [
    input.clientName ? `Client contact: ${input.clientName}` : "",
    job ? jobBrief(job, job.enrichment) : "Job details: not available",
    proposal ? `Proposal David sent:\n${proposal.coverLetter}\nBid: ${proposal.bid ?? "?"}` : "",
    "",
    untrusted("client_messages", thread.slice(-12000)),
    "",
    input.goal ? `David's goal for this reply: ${input.goal}` : "David's goal: move the deal forward to a signed contract at a fair senior rate.",
  ].filter(Boolean).join("\n");

  const { data, model } = await structured({ model: (await getSettings()).llm.writerModel, system, user, schema: CloserSchema, effort: "high", agent: "closer", maxTokens: 8000 });
  const advice: CloserAdvice = { ...data, model, country: culture.country, roomId: input.roomId ?? null, createdAt: new Date().toISOString() };
  const reportId = await saveReport("closer", { input: { ...input, thread: thread.slice(-2000) }, advice });
  return { ...advice, reportId };
}

/** Rooms waiting on David, newest first - the Closer inbox. */
export async function closerInbox(limit = 20) {
  const r = await callTool<{ rooms?: Record<string, unknown>[]; data?: unknown }>("get_messages", "list_rooms", { limit });
  return (r.rooms ?? []).map((x) => ({
    id: String(x.id ?? x.room_id ?? ""),
    name: String(x.name ?? x.room_name ?? x.topic ?? "Conversation"),
    lastMessage: String(x.last_message ?? x.latest_message ?? "").slice(0, 160),
    lastAt: (x.last_message_at ?? x.updated ?? x.last_activity ?? null) as string | null,
    awaiting: (x.awaiting_reply_from ?? null) as string | null,
    unread: Boolean(x.unread ?? (x.unread_count as number) > 0),
  }));
}

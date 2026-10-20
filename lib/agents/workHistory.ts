import { kvGet, kvSet } from "../db";
import { callTool } from "../upwork/mcp/client";

/*
 * David's past Upwork contracts with the client's rating and written feedback (David, 2026-10-20: "index all of
 * them once, then just pick the most similar skill set with the best 5-star ratings and text").
 *
 * Built ONCE from `list_contracts search` (paged) plus `list_contracts get` for contracts whose search row has no
 * feedback text, through the ban-safety guard like every other Upwork call, and kept in kv "upwork_work_history".
 * A build is resumable (offset + pending details are stored), so a run capped at N calls just continues next time.
 * Drafting never calls Upwork for this: relevantWork() is a keyword match over the stored index, preferring
 * 5-star contracts with written feedback, and workHistoryDigest() hands the writer 2-3 of them to cite.
 *
 * Upwork cannot "attach" a contract to a proposal - only portfolio items (get_profile list_highlights →
 * portfolio_project_ids) are attachable, and lib/agents/proposal.ts already does that when the profile has any.
 */

export interface WorkItem {
  contractId: string;
  title: string;
  client: string | null;
  type: string | null;
  status: string | null;
  skills: string[];
  rating: number | null;
  feedback: string | null;
  earned: number | null;
  started: string | null;
  ended: string | null;
}

export interface WorkHistory {
  builtAt: string;
  /** Every search page read (a later run only looks for new contracts on the first page). */
  complete: boolean;
  offset: number;
  items: WorkItem[];
  /** Contracts still to open with `list_contracts get` for their feedback text. */
  detailsPending: string[];
  notes: string[];
  /** One raw search row, kept so the parser can be checked against the live shape. */
  sample?: unknown;
}

export const WORK_HISTORY_KEY = "upwork_work_history";
const PAGE = 10;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** First value under a key matching `re` (depth-first, shallow keys first); objects with a `name` count as that name. */
function findKey(o: unknown, re: RegExp, depth = 0): unknown {
  if (!isObj(o) || depth > 5) return undefined;
  for (const [k, v] of Object.entries(o)) {
    if (!re.test(k) || v == null) continue;
    if (!isObj(v) && !Array.isArray(v)) return v;
    if (isObj(v) && typeof v.name === "string") return v.name;
    if (isObj(v) && (typeof v.rawValue === "string" || typeof v.rawValue === "number")) return v.rawValue;
    if (isObj(v) && (typeof v.displayValue === "string")) return v.displayValue;
  }
  for (const v of Object.values(o)) {
    const r = isObj(v) ? findKey(v, re, depth + 1) : undefined;
    if (r !== undefined) return r;
  }
  return undefined;
}

const str = (v: unknown): string | null => (v == null || v === "" ? null : typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const date = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const ms = /^\d{11,}$/.test(s) ? Number(s) : Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : s;
};

/** Contract rows wherever the tool put them: `contracts`, `data.contracts`, `results`, `data.edges[].node`… */
export function contractRows(r: unknown): Obj[] {
  const seen: Obj[][] = [];
  const walk = (o: unknown, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(o)) {
      const objs = o.map((x) => (isObj(x) && isObj(x.node) ? x.node : x)).filter(isObj);
      if (objs.length && objs.length === o.length) seen.push(objs);
      return;
    }
    if (!isObj(o)) return;
    for (const [k, v] of Object.entries(o)) if (/contract|result|item|edge|list|data|node/i.test(k) || Array.isArray(v)) walk(v, depth + 1);
  };
  walk(r, 0);
  // The list that looks most like contracts (ids + titles) wins; the longest breaks ties.
  return seen.sort((a, b) => score(b) - score(a) || b.length - a.length)[0] ?? [];
  function score(xs: Obj[]) { return xs.filter((x) => findKey(x, /^(id|contractId|contract_id|uid)$/i) !== undefined && findKey(x, /title|name/i) !== undefined).length; }
}

/** Client feedback on the contract: the client's rating of David and the text they wrote (never David's of them). */
function clientFeedback(o: Obj): { rating: number | null; feedback: string | null } {
  // Prefer a block that is explicitly the client's / "to freelancer" feedback.
  const blocks: unknown[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (/feedback|review|rating/i.test(k) && isObj(v)) blocks.push(v);
    if (/feedback|review/i.test(k) && Array.isArray(v)) blocks.push(...v.filter(isObj));
  }
  const toFreelancer = blocks.find((b) => isObj(b) && /client|buyer|freelancer|contractor|vendor|to_/i.test(JSON.stringify(Object.keys(b)))) ?? blocks[0];
  const src = isObj(toFreelancer) ? toFreelancer : o;
  const inner = isObj(src) ? (Object.entries(src).find(([k, v]) => /client|buyer|toFreelancer|to_freelancer|givenByClient|ofFreelancer|freelancerFeedback|vendorFeedback/i.test(k) && isObj(v))?.[1] as Obj | undefined) : undefined;
  const pick = inner ?? src;
  const rating = num(findKey(pick, /^(score|rating|totalScore|total_score|feedbackScore|feedback_score|overall|stars)$/i));
  const text = str(findKey(pick, /^(comment|comments|feedbackText|feedback_text|commentText|text|review|description|message)$/i));
  return { rating, feedback: text && text.length > 3 ? text.replace(/\s+/g, " ") : null };
}

export function parseContract(o: Obj): WorkItem | null {
  const contractId = str(findKey(o, /^(id|contractId|contract_id|uid|contractUid)$/i));
  const title = str(findKey(o, /^(title|name|contractTitle|contract_title|jobTitle|job_title)$/i));
  if (!contractId || !title) return null;
  const skillsRaw = findKey(o, /^(skills|skillset|skill_names|tags)$/i);
  const skillsArr = Array.isArray(skillsRaw) ? skillsRaw : Array.isArray((o.skills as Obj | undefined)) ? (o.skills as unknown[]) : [];
  const skills = (Array.isArray((o as Obj).skills) ? ((o as Obj).skills as unknown[]) : skillsArr)
    .map((s) => (typeof s === "string" ? s : isObj(s) ? str(s.prettyName ?? s.name ?? s.skill ?? s.label) : null)).filter((s): s is string => !!s);
  const fb = clientFeedback(o);
  return {
    contractId, title,
    client: str(findKey(o, /^(clientName|client_name|companyName|company_name|buyerName|buyer_name|client|buyer|company|organization)$/i)),
    type: str(findKey(o, /^(contractType|contract_type|type|deliveryModel|delivery_model|jobType|job_type|engagement)$/i)),
    status: str(findKey(o, /^(status|contractStatus|contract_status|state)$/i)),
    skills: [...new Set(skills)],
    rating: fb.rating,
    feedback: fb.feedback,
    earned: num(findKey(o, /^(totalCharge|total_charge|totalCharged|total_charged|earnings|totalEarnings|total_earnings|totalPaid|total_paid|amount|totalAmount|charged|earned)$/i)),
    started: date(findKey(o, /^(startDate|start_date|startedAt|started_at|createdDateTime|created_at|createdAt|created|startTime)$/i)),
    ended: date(findKey(o, /^(endDate|end_date|endedAt|ended_at|closedAt|closed_at|completedAt|ended|endTime)$/i)),
  };
}

export const workHistory = async () => await kvGet<WorkHistory>(WORK_HISTORY_KEY);

/**
 * Build or continue the index. `maxCalls` bounds the Upwork calls of this run (search pages + contract details);
 * the run stops early and the next one continues from the stored offset / pending list.
 */
export async function buildWorkHistory(opts: { maxCalls?: number; fresh?: boolean; log?: (m: string) => void } = {}): Promise<WorkHistory> {
  const maxCalls = opts.maxCalls ?? 40;
  const log = opts.log ?? (() => {});
  const prev = opts.fresh ? null : await workHistory();
  const h: WorkHistory = prev ?? { builtAt: new Date().toISOString(), complete: false, offset: 0, items: [], detailsPending: [], notes: [], sample: undefined };
  h.notes = [];
  const byId = new Map(h.items.map((i) => [i.contractId, i]));
  let calls = 0;

  // 1. Search pages. A complete index only re-reads the first page, looking for contracts it has not seen.
  let offset = h.complete ? 0 : h.offset;
  while (calls < maxCalls) {
    let rows: Obj[];
    try {
      const r = await callTool<Obj>("list_contracts", "search", { limit: PAGE, offset });
      calls++;
      rows = contractRows(r);
      if (!h.sample && rows[0]) h.sample = rows[0];
      if (!rows.length && offset === 0) h.notes.push(`search returned no contract rows: ${JSON.stringify(r).slice(0, 300)}`);
    } catch (e) {
      h.notes.push(`search offset ${offset}: ${(e as Error).message.slice(0, 200)}`);
      break;
    }
    let fresh = 0;
    for (const row of rows) {
      const item = parseContract(row);
      if (!item) continue;
      if (!byId.has(item.contractId)) { fresh++; if (!item.feedback) h.detailsPending.push(item.contractId); }
      // Keep feedback text a detail call already found.
      const old = byId.get(item.contractId);
      byId.set(item.contractId, { ...item, feedback: item.feedback ?? old?.feedback ?? null, rating: item.rating ?? old?.rating ?? null });
    }
    log(`page offset ${offset}: ${rows.length} rows, ${fresh} new`);
    if (h.complete && !fresh) break; // nothing new on the first page of a finished index
    if (rows.length < PAGE) { h.complete = true; offset = 0; break; }
    offset += rows.length;
    h.offset = offset;
  }
  if (h.complete) h.offset = 0;

  // 2. Details for contracts whose search row carried no feedback text.
  h.detailsPending = [...new Set(h.detailsPending)].filter((id) => byId.has(id));
  const stillPending: string[] = [];
  for (const id of h.detailsPending) {
    if (calls >= maxCalls) { stillPending.push(id); continue; }
    try {
      const d = await callTool<Obj>("list_contracts", "get", { contract_id: id });
      calls++;
      const detail = parseContract((contractRows(d)[0] as Obj | undefined) ?? (isObj(d.contract) ? (d.contract as Obj) : isObj(d.data) ? (d.data as Obj) : d)) ?? parseContract({ id, title: byId.get(id)!.title, ...d });
      const cur = byId.get(id)!;
      const fb = detail ?? cur;
      byId.set(id, {
        ...cur,
        rating: fb.rating ?? cur.rating, feedback: fb.feedback ?? cur.feedback, skills: cur.skills.length ? cur.skills : fb.skills,
        earned: cur.earned ?? fb.earned, client: cur.client ?? fb.client, type: cur.type ?? fb.type, started: cur.started ?? fb.started, ended: cur.ended ?? fb.ended,
      });
      log(`detail ${id}: ${fb.feedback ? `★${fb.rating ?? "?"} "${fb.feedback.slice(0, 60)}"` : "no feedback text"}`);
    } catch (e) {
      h.notes.push(`contract ${id}: ${(e as Error).message.slice(0, 160)}`);
      stillPending.push(id);
    }
  }
  h.detailsPending = stillPending;
  h.items = [...byId.values()].sort((a, b) => (b.ended ?? b.started ?? "").localeCompare(a.ended ?? a.started ?? ""));
  h.builtAt = new Date().toISOString();
  await kvSet(WORK_HISTORY_KEY, h);
  log(`saved ${h.items.length} contracts (${h.items.filter((i) => i.feedback).length} with feedback text), ${h.detailsPending.length} details pending, ${calls} Upwork calls`);
  return h;
}

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) ?? []);
const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "you", "your", "are", "was", "our", "have", "will", "need", "looking", "project", "work", "experience", "upwork", "david", "great", "very", "good", "job", "done", "best", "team", "client", "contract", "well", "all", "his", "him", "was", "were"]);

/**
 * The stored contracts most like a job: keyword overlap on title + skills + feedback, 5-star contracts with
 * written feedback first (that is what the writer may quote), then rating and money.
 */
export function relevantWork(items: WorkItem[], jobText: string, k = 3): WorkItem[] {
  const words = new Set([...tokens(jobText)].filter((w) => !STOP.has(w)));
  return items
    .map((it) => {
      const hay = [...tokens(`${it.title} ${it.skills.join(" ")} ${it.feedback ?? ""}`)].filter((w) => !STOP.has(w));
      const overlap = new Set(hay.filter((t) => words.has(t))).size;
      const five = it.rating != null && it.rating >= 4.8;
      const text = !!it.feedback;
      // Skill-set similarity decides; a 5★ written review is worth two matching keywords, money a little.
      const score = overlap + (five && text ? 2 : five ? 1 : 0) + Math.min(1, (it.earned ?? 0) / 5000);
      return { it, overlap, score, five, text };
    })
    .filter((x) => x.overlap > 0 && (x.it.rating == null || x.it.rating >= 4))
    .sort((a, b) => b.score - a.score || Number(b.five && b.text) - Number(a.five && a.text) || (b.it.rating ?? 0) - (a.it.rating ?? 0) || (b.it.earned ?? 0) - (a.it.earned ?? 0))
    .slice(0, k)
    .map((x) => x.it);
}

/** Prompt text for the writer: the 2-3 most similar past contracts with the client's own words. "" without an index. */
export async function workHistoryDigest(jobText: string, k = 3): Promise<string> {
  const h = await workHistory();
  if (!h?.items.length) return "";
  const picks = relevantWork(h.items, jobText, k);
  if (!picks.length) return "";
  const line = (it: WorkItem, i: number) => {
    const meta = [it.client, it.earned != null ? `$${Math.round(it.earned).toLocaleString("en-US")}` : null, (it.ended ?? it.started)?.slice(0, 4)].filter(Boolean).join(", ");
    const stars = it.rating != null ? `★${it.rating.toFixed(1)}` : "no rating";
    return `${i + 1}. "${it.title}"${meta ? ` (${meta})` : ""} - ${stars}${it.feedback ? ` - client wrote: "${it.feedback.slice(0, 280)}"` : ""}${it.skills.length ? ` [${it.skills.slice(0, 8).join(", ")}]` : ""}`;
  };
  return [
    "David's past Upwork contracts most like this job, with the client's own rating and words (real, from his Upwork work history). Use them as the proof folded into the opener - name the kind of client and result, and you may quote at most one short phrase of the client's feedback. Never invent or embellish beyond what is written here:",
    ...picks.map(line),
  ].join("\n");
}

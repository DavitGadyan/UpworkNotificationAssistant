import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { spawn } from "node:child_process";
import { accessSync } from "node:fs";
import { config } from "../config";
import { getSettings, kvGet, kvSet } from "../db";
import { query } from "../pg";

/*
 * Thin wrapper over the Claude API used by every agent:
 *   - structured JSON output validated against a Zod schema (client.beta.messages.parse);
 *   - server-side refusal fallback (`fallbacks: "default"`), so a safety decline is retried on
 *     Anthropic's recommended model instead of failing the job;
 *   - optional web search (research step of the ProposalDraftAssistant);
 *   - the stable system prompt is cached (prompts are long; jobs are short).
 */

let _client: Anthropic | null = null;
/** API mode needs a key; CLI mode needs a logged-in `claude` binary (checked when it runs). */
export const llmReady = async () => (await getSettings()).llm.provider === "claude-cli" || !!config.anthropic.apiKey;

// ---------- spend accounting & daily budget ----------
/** $ per million tokens: input, output, cache read (list prices, 2026-10). */
const PRICES: Record<string, [number, number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-sonnet-5-5": [2, 10, 0.2],
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-fable-5-1": [10, 50, 0.25],
};
const day = (d = new Date()) => d.toISOString().slice(0, 10);
const spendKey = (d?: Date) => `llm_spend:${day(d)}`;
export const llmSpendToday = async () => (await kvGet<number>(spendKey())) ?? 0;

/** Per-day ledger of Claude spend: total plus breakdowns by agent and model (kept 90 days). */
export interface LedgerDay { date: string; total: number; calls: number; byAgent: Record<string, number>; byModel: Record<string, number> }
export const ledgerDay = async (date: string) => await kvGet<LedgerDay>(`llm_ledger:${date}`);
/** Several days in one query (a burst of 30 parallel reads through the transaction pooler can stall). */
export async function ledgerDays(dates: string[]): Promise<Map<string, LedgerDay>> {
  const rows = await query<{ key: string; value: LedgerDay }>("select key, value from private.kv where key = any($1::text[])", [dates.map((d) => `llm_ledger:${d}`)]);
  return new Map(rows.map((r) => [r.key.slice("llm_ledger:".length), r.value]));
}
export async function addSpend(usd: number, model = "unknown", agent = "other") {
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  await kvSet(spendKey(), r((await llmSpendToday()) + usd));
  const d = day();
  const cur = (await ledgerDay(d)) ?? { date: d, total: 0, calls: 0, byAgent: {}, byModel: {} };
  cur.total = r(cur.total + usd);
  cur.calls++;
  cur.byAgent[agent] = r((cur.byAgent[agent] ?? 0) + usd);
  cur.byModel[model] = r((cur.byModel[model] ?? 0) + usd);
  await kvSet(`llm_ledger:${d}`, cur);
}
export function costOf(model: string, u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; server_tool_use?: { web_search_requests?: number | null } | null }) {
  const [i, o, c] = PRICES[model.replace(/-\d{8}$/, "")] ?? PRICES["claude-opus-5-5"];
  return ((u.input_tokens ?? 0) * i + (u.cache_creation_input_tokens ?? 0) * i * 1.25 + (u.cache_read_input_tokens ?? 0) * c + (u.output_tokens ?? 0) * o) / 1e6
    + (u.server_tool_use?.web_search_requests ?? 0) * 0.01;
}
export class BudgetError extends Error {}
/** Ranking respects the daily cap; drafts/Closer are explicit taps, so they may exceed it (they still count). */
async function checkBudget(kind: "auto" | "manual") {
  const cap = (await getSettings()).llm.dailyBudgetUsd;
  if (kind === "auto" && (await llmSpendToday()) >= cap) throw new BudgetError(`Daily LLM budget of $${cap} reached`);
}
const client = () => (_client ??= new Anthropic({ apiKey: config.anthropic.apiKey || undefined }));

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class LlmError extends Error {}

export interface StructuredOpts<S extends z.ZodType> {
  model: string;
  system: string;
  user: string;
  schema: S;
  effort?: Effort;
  maxTokens?: number;
  webSearch?: { maxUses: number };
  /** auto = background ranking (budget-capped); manual = David tapped a button. */
  kind?: "auto" | "manual";
  /** Label for the spend ledger: ranking, proposal, closer, coach, review… */
  agent?: string;
}

export async function structured<S extends z.ZodType>(o: StructuredOpts<S>): Promise<{ data: z.infer<S>; model: string; usage: Anthropic.Beta.BetaUsage }> {
  if (!(await llmReady())) throw new LlmError("ANTHROPIC_API_KEY is not set");
  await checkBudget(o.kind ?? "manual");
  if ((await getSettings()).llm.provider === "claude-cli") return viaCli(o);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: o.user }];
  const tools: Anthropic.Beta.BetaToolUnion[] | undefined = o.webSearch
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: o.webSearch.maxUses }]
    : undefined;

  for (let turn = 0; turn < 4; turn++) {
    const res = await client().beta.messages.parse({
      model: o.model,
      max_tokens: o.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
      messages,
      ...(tools ? { tools } : {}),
      output_config: { format: betaZodOutputFormat(o.schema), effort: o.effort ?? "medium" },
    });
    if (res.stop_reason === "refusal") {
      throw new LlmError(`Model declined (${res.stop_details?.category ?? "unspecified"})`);
    }
    if (res.stop_reason === "pause_turn") {
      // Server tool loop paused (long web search) - send the content back to let it continue.
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    if (res.stop_reason === "max_tokens") throw new LlmError("Response was cut off (max_tokens)");
    await addSpend(costOf(res.model, res.usage), res.model, o.agent);
    if (res.parsed_output == null) throw new LlmError("Model returned no parseable JSON");
    return { data: res.parsed_output as z.infer<S>, model: res.model, usage: res.usage };
  }
  throw new LlmError("Web search did not finish");
}

/** Wrap untrusted marketplace text so prompts can tell it apart from instructions. */
export const untrusted = (label: string, text: string) =>
  `<${label}>\n${text.replace(new RegExp(`</?${label}>`, "g"), "")}\n</${label}>`;

/*
 * Claude Code CLI provider: runs `claude -p` with your Claude login (subscription) instead of an API key.
 * Measured 2026-10-13: each call loads ~90k tokens of Claude Code context, so it is far heavier per call
 * than the API and draws on subscription limits - fine for occasional drafts, not ideal for ranking.
 */
async function viaCli<S extends z.ZodType>(o: StructuredOpts<S>): Promise<{ data: z.infer<S>; model: string; usage: Anthropic.Beta.BetaUsage }> {
  const schema = JSON.stringify(z.toJSONSchema(o.schema));
  const args = [
    "-p", o.user, "--output-format", "json", "--json-schema", schema, "--model", o.model,
    "--system-prompt", o.system, "--no-session-persistence", "--strict-mcp-config", "--effort", o.effort ?? "medium",
    "--tools", o.webSearch ? "WebSearch" : "", ...(o.webSearch ? ["--allowedTools", "WebSearch"] : []),
  ];
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(claudeBin(), args, { cwd: "/tmp", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new LlmError("claude CLI timed out")); }, 600_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new LlmError(`claude CLI not available: ${e.message}`)); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new LlmError(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`)); });
  });
  const r = JSON.parse(out) as { structured_output?: unknown; result?: string; total_cost_usd?: number; is_error?: boolean; usage?: Anthropic.Beta.BetaUsage };
  if (r.is_error) throw new LlmError(`claude CLI error: ${String(r.result).slice(0, 300)}`);
  await addSpend(r.total_cost_usd ?? 0, `${o.model} (cli)`, o.agent);
  const raw = r.structured_output ?? (r.result ? JSON.parse(r.result) : null);
  const parsed = o.schema.safeParse(raw);
  if (!parsed.success) throw new LlmError("claude CLI returned JSON that does not match the schema");
  return { data: parsed.data as z.infer<S>, model: o.model, usage: (r.usage ?? {}) as Anthropic.Beta.BetaUsage };
}

/** The Claude Code binary: CLAUDE_BIN, else the standard install path, else PATH. */
export function claudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const home = process.env.HOME ?? "";
  try { accessSync(`${home}/.local/bin/claude`); return `${home}/.local/bin/claude`; } catch { return "claude"; }
}

import { getSettings, mcpCallStats } from "@/lib/db";
import { json } from "@/lib/http";
import { llmSpendToday } from "@/lib/agents/llm";
import { breakerState, mcpCallsToday, resetBreaker } from "@/lib/upwork/guard";
import { mcpAccount, mcpConnected } from "@/lib/upwork/mcp/client";
import { activeSource } from "@/lib/upwork/source";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSettings();
  return json({
    connected: await mcpConnected(),
    account: await mcpAccount(),
    source: await activeSource(),
    callsToday: await mcpCallsToday(),
    dailyCap: s.guard.dailyCallCap,
    lastHour: await mcpCallStats(Date.now() - 36e5),
    breaker: await breakerState(),
    llmSpendToday: await llmSpendToday(),
    llmBudget: s.llm.dailyBudgetUsd,
  });
}

/** Reset the circuit breaker (after fixing whatever tripped it). */
export async function DELETE() {
  await resetBreaker();
  return json({ ok: true });
}

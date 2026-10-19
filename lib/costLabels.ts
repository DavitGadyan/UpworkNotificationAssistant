/** Display names for the cost ledger's agent keys (lib/agents/llm.ts addSpend). Shared by client and server views. */
export const AGENT_LABELS: Record<string, string> = {
  ranking: "Job ranking", proposal: "Proposal drafts", closer: "Closer", coach: "Profile coach", review: "Monthly review",
  claude_fetch: "Load via Claude", other: "Other",
};
export const agentLabel = (k: string) => AGENT_LABELS[k] ?? k.replace(/_/g, " ");
/** "(cli)" models ran on the Claude subscription (Load via Claude, CLI provider): not billed to the Console API credit. */
export const isSubscriptionModel = (model: string) => model.endsWith("(cli)");

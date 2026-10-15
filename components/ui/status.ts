import type { JobStatus, ScoreBreakdown, Settings } from "@/lib/types";

export function scoreTone(score: ScoreBreakdown, s: Pick<Settings, "callMin" | "telegramMin">): "good" | "info" | "warn" | "bad" {
  if (score.excluded) return "bad";
  if (score.total >= s.callMin) return "good";
  if (score.total >= s.telegramMin) return "info";
  return "warn";
}

export const isOffProfile = (score: ScoreBreakdown) => !!score.excluded?.startsWith("Not your field");

/** Match labels need the AI's verdict: a high rules-only rank says "Not AI-checked", never "Top match". */
export function jobPill(status: JobStatus, score: ScoreBreakdown, s: Pick<Settings, "callMin" | "telegramMin">): { label: string; cls: string } {
  if (status === "dismissed") return { label: "Dismissed", cls: "pill-neutral" };
  if (isOffProfile(score)) return { label: "Not your field", cls: "pill-neutral" };
  if (score.excluded) return { label: "Filtered out", cls: "pill-bad" };
  if (status === "awaiting_ai") return { label: "Waiting for AI check", cls: "pill-neutral" };
  if (status === "called") return { label: "Called", cls: "pill-good" };
  if (!score.llm && score.total >= s.telegramMin) return { label: "Not AI-checked", cls: "pill-warn" };
  if (score.total >= s.callMin) return { label: "Top match", cls: "pill-good" };
  if (status === "notified") return { label: "Notified", cls: "pill-info" };
  if (score.total >= s.telegramMin) return { label: "Match", cls: "pill-info" };
  return { label: "Low fit", cls: "pill-warn" };
}

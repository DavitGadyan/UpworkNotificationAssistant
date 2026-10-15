import { applyCalibration, calibrate } from "@/lib/feedback/calibrate";
import { buildIcp } from "@/lib/insights/icp";
import { buildGhostReport } from "@/lib/insights/ghosts";
import { benchmarkPeers, monthlyReview, monthlySnapshot, saveManualMetrics, syncProfile } from "@/lib/insights/metrics";
import { bad, json } from "@/lib/http";
import { buildLessons, decideLessons } from "@/lib/learning/lessons";
import { syncProposalOutcomes } from "@/lib/learning/outcomes";
import { saveLabReport, updateLabConfig } from "@/lib/learning/promptLab";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Manual triggers for the slow jobs the worker otherwise runs monthly. */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const b = (await req.json().catch(() => ({}))) as { period?: string; values?: Record<string, number>; queries?: string[]; reportId?: number; ids?: string[]; enabled?: boolean; arms?: number[]; explore?: number; pin?: { key: string; version: number | null }; target?: string };
  try {
    switch (action) {
      case "profile": return json(await syncProfile());
      case "snapshot": return json(await monthlySnapshot(b.period));
      case "review": return json(await monthlyReview());
      case "coach": return json(await benchmarkPeers(b.queries));
      case "icp": return json(await buildIcp());
      case "calibrate": return json(await calibrate());
      case "ghosts": return json(await buildGhostReport());
      case "apply-calibration": return json({ applied: await applyCalibration() });
      case "outcomes": return json(await syncProposalOutcomes({ maxCalls: 60 }));
      case "lessons": return json(await buildLessons(Date.now(), b.target === "ranker" ? "ranker" : "writer"));
      case "approve-lessons": return json(await decideLessons(Number(b.reportId), "approved", Array.isArray(b.ids) ? b.ids.map(String) : undefined));
      case "reject-lessons": return json(await decideLessons(Number(b.reportId), "rejected"));
      case "lab": return json(await updateLabConfig({ enabled: b.enabled, arms: b.arms, explore: b.explore, pin: b.pin }));
      case "lab-refresh": return json(await saveLabReport());
      case "manual": {
        if (!b.period || !/^\d{4}-\d{2}$/.test(b.period) || !b.values) return bad("period (YYYY-MM) and values required");
        const clean = Object.fromEntries(Object.entries(b.values).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k.slice(0, 40), Number(v)]));
        await saveManualMetrics(b.period, clean);
        return json({ ok: true });
      }
      default: return bad("Unknown action", 404);
    }
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}

import Link from "next/link";
import { DataTable } from "@/components/insights/charts";
import type { ArmStat, Board, LabBoard, LabPrompt } from "@/lib/learning/promptLab";

export const VERDICT: Record<Board["verdict"], { label: string; cls: string }> = {
  best: { label: "Clear winner", cls: "pill-good" },
  leading: { label: "Leading", cls: "pill-info" },
  single: { label: "Only one version tried", cls: "pill-neutral" },
  not_enough_data: { label: "Not enough data", cls: "pill-neutral" },
};

export const tabOf = (p: string | undefined): LabPrompt => (p === "ranker" ? "job_ranking" : "proposal");
export const tabParam = (p: LabPrompt) => (p === "job_ranking" ? "ranker" : "writer");

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

/** Sent → viewed → replied → offer → hired, with rates on decided proposals. */
export function FunnelTiles({ f }: { f: LabBoard["funnel"] }) {
  const tiles: [string, React.ReactNode, string?, string?][] = [
    ["Sent", f.sent, `${f.decided} with a result`],
    ["Viewed", pct(f.viewed, f.decided), `${f.viewed} proposals`],
    ["Client replied", pct(f.replied, f.decided), `${f.replied} replies`, "good"],
    ["Offers", pct(f.offers, f.decided), `${f.offers} offers`],
    ["Hired", pct(f.hires, f.decided), `${f.hires} hires`, "good"],
    ["Connects spent", f.connects, f.hires ? `${Math.round(f.connects / f.hires)} per hire` : undefined],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map(([label, value, sub, tone]) => (
        <div key={label} className="min-w-0 rounded-[14px] bg-[var(--color-sunken)] p-3">
          <p className="truncate text-[13px] text-[var(--color-muted)]">{label}</p>
          <p className="display num mt-0.5 truncate text-[26px] font-bold leading-tight" style={tone ? { color: `var(--color-${tone})` } : undefined}>{value}</p>
          {sub && <p className="truncate text-[12px] text-[var(--color-muted)]">{sub}</p>}
        </div>
      ))}
    </div>
  );
}

const HEAD = ["Version", "Sent", "Viewed", "Replied", "Offer", "Hired", "Expected reply", "Chance best", "Text kept"];
const cells = (a: ArmStat) => [a.n, `${a.viewRate}%`, `${a.wins} (${a.replyRate}%)`, `${a.offers} (${a.offerRate}%)`, `${a.hires} (${a.hireRate}%)`, `${a.expected}%`, a.pBest == null ? "baseline" : `${a.pBest}%`, a.kept == null ? "-" : `${a.kept}%`];

/** Version leaderboard; each row links to its page. */
export function VersionTable({ b, prompt, linked = true }: { b: Board; prompt: LabPrompt; linked?: boolean }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[14px]">
        <thead><tr className="text-[var(--color-muted)]">{HEAD.map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {b.arms.map((a) => (
            <tr key={a.arm} className="border-t border-[var(--color-line)]">
              <td className="py-2 pr-3 font-medium">{linked ? <Link className="hover:underline" href={`/insights/prompts/${a.arm}?p=${tabParam(prompt)}`}>{a.label}</Link> : a.label}</td>
              {cells(a).map((c, i) => <td key={i} className="num py-2 pr-3">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScenarioRows({ boards }: { boards: Board[] }) {
  return <DataTable head={["Scenario", "Decided", "Verdict", "Best version"]} rows={boards.map((s) => [s.label, s.n, VERDICT[s.verdict].label, s.best == null ? "-" : s.arms.find((a) => a.arm === s.best)?.label ?? "-"])} />;
}

import { RunButton } from "@/components/insights/RunButton";
import { CardHead, Note } from "@/components/ui/bits";
import { fmtDateTime, INTENT_LABELS } from "@/lib/format";
import type { GhostReport } from "@/lib/insights/ghosts";
import type { IntentArchetype } from "@/lib/types";

const label = (a: string) => INTENT_LABELS[a as IntentArchetype] ?? (a === "unknown" ? "Not assessed" : a);
const chanceColor = (v: number | null) => (v == null ? "var(--color-muted)" : v < 35 ? "var(--color-bad)" : v < 60 ? "var(--color-warn)" : "var(--color-good)");

/** Insights → Ghost patterns: which hire-likelihood archetypes show up, how they resolved, and rule suggestions (never applied). */
export function GhostPatterns({ report }: { report: { data: GhostReport; createdAt: string } | null }) {
  const r = report?.data;
  const max = Math.max(1, ...(r?.byArchetype.map((a) => a.jobs) ?? [0]));
  return (
    <section className="card mt-4 min-w-0 p-5 md:p-6" aria-labelledby="ghost-h">
      <CardHead id="ghost-h" title="Ghost patterns" right={<RunButton action="ghosts" label="Rebuild" done="Rebuilt" />}
        sub={r ? `${r.jobsAssessed} jobs assessed · built ${fmtDateTime(r.builtAt)}. Advisory: hire chance never changes your rank.` : "Clients who post but rarely hire, grouped by pattern."} />
      {!r ? (
        <Note className="mt-4">No report yet. Tap “Rebuild” to group recent jobs by hire-likelihood pattern.</Note>
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="tag mb-3">By pattern</h3>
            {r.byArchetype.length ? (
              <ul className="grid gap-3" aria-label="Jobs per pattern">
                {r.byArchetype.map((a) => (
                  <li key={a.archetype} className="text-[14px]">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="min-w-0 font-medium">{label(a.archetype)}</span>
                      <span className="num shrink-0 text-[13px] text-[var(--color-muted)]">
                        {a.jobs} {a.jobs === 1 ? "job" : "jobs"} · <span className={a.highRisk ? "text-[var(--color-bad)]" : ""}>{a.highRisk} high risk</span> · <span style={{ color: chanceColor(a.avgLikelihood) }}>{a.avgLikelihood}% avg</span>
                      </span>
                    </div>
                    <span className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-[var(--color-control)]" title={`${label(a.archetype)}: ${a.jobs} jobs, ${a.highRisk} high risk, avg hire chance ${a.avgLikelihood}%`}>
                      <span className="block h-full bg-[var(--color-bad)]" style={{ width: `${(a.highRisk / max) * 100}%` }} />
                      <span className="block h-full bg-[var(--color-accent)]" style={{ width: `${((a.jobs - a.highRisk) / max) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[var(--color-muted)]">No assessed jobs yet.</p>}
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--color-muted)]" aria-hidden>
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[var(--color-bad)]" />High risk</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[var(--color-accent)]" />Other</span>
            </p>
          </div>

          <div className="min-w-0">
            <h3 className="tag mb-1">Outcomes</h3>
            {r.outcomes.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[14px]">
                  <thead><tr className="text-[var(--color-muted)]">{["Pattern", "Tracked", "Hired", "Closed, no hire", "Still open"].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
                  <tbody className="num">
                    {r.outcomes.map((o) => (
                      <tr key={o.archetype} className="border-t border-[var(--color-line)]">
                        <td className="py-1.5 pr-3 font-body">{label(o.archetype)}</td>
                        <td className="py-1.5 pr-3">{o.tracked}</td>
                        <td className="py-1.5 pr-3 text-[var(--color-good)]">{o.hired}</td>
                        <td className="py-1.5 pr-3 text-[var(--color-bad)]">{o.closedNoHire}</td>
                        <td className="py-1.5 pr-3">{o.open}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="mt-2 text-[var(--color-muted)]">Nothing tracked yet. Outcomes are checked about 2 and 7 days after a job is posted.</p>}

            <h3 className="tag mb-1 mt-6">Clients who post without hiring</h3>
            {r.topClients.length ? (
              <ul className="divide-row text-[14px]">
                {r.topClients.map((c) => (
                  <li key={c.clientId} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate"><span className="font-medium">{c.country ?? "Unknown country"}</span> <span className="text-[12px] text-[var(--color-faint)]">#{c.clientId.slice(-6)}</span></span>
                    <span className="num shrink-0 text-[13px] text-[var(--color-muted)]">{c.jobsSeen} posts · {c.hired} hired · <span className="text-[var(--color-bad)]">{c.closedNoHire} closed, no hire</span></span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-[var(--color-muted)]">No repeat posters yet.</p>}
          </div>

          <div className="min-w-0 lg:col-span-2">
            <h3 className="tag mb-3">Suggestions (not applied — your rules are unchanged)</h3>
            <ul className="grid gap-2.5">
              {r.suggestions.map((s, i) => (
                <li key={i} className="rounded-[14px] bg-[var(--color-sunken)] p-4">
                  <p className="font-medium">{s.suggestion}</p>
                  <p className="mt-1 text-[14px] text-[var(--color-muted)]">{s.rationale}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

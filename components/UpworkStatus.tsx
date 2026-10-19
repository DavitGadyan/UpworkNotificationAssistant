"use client";

import { useEffect, useState } from "react";
import { CardHead, Spinner } from "@/components/ui/bits";
import type { GovernorStatus } from "@/lib/upwork/governor";

const REFRESH_MS = 60_000;
const FEEDS: [string, string][] = [["most_recent", "Most Recent"], ["best_match", "Best Matches"], ["saved_query", "Saved search"], ["keyword", "Keywords"]];
const CLASS: Record<string, { label: string; bad: boolean }> = {
  restricted: { label: "Restricted", bad: true },
  throttle: { label: "Throttled", bad: true },
  auth: { label: "Login", bad: true },
  transient: { label: "Temporary", bad: false },
  other: { label: "Other", bad: false },
};
type Tone = "good" | "warn" | "bad" | "muted";
const COLOR: Record<Tone, string> = { good: "var(--color-good)", warn: "var(--color-warn)", bad: "var(--color-bad)", muted: "var(--color-faint)" };

const mins = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
const ago = (iso: string) => { const m = mins(iso); return m < 1 ? "now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const pctTone = (p: number): Tone => (p >= 0.9 ? "bad" : p >= 0.7 ? "warn" : "good");

/** Upwork at a glance: is it safe, how often each feed searches, budgets left, and anything Upwork refused (24 h). */
export function UpworkStatus() {
  const [g, setG] = useState<GovernorStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/upwork/status", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as GovernorStatus;
        if (alive) { setG(body); setErr(null); }
      } catch (e) { if (alive) setErr((e as Error).message); }
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    const clock = setInterval(() => tick((n) => n + 1), 15_000); // keep "2m ago" fresh between loads
    return () => { alive = false; clearInterval(t); clearInterval(clock); };
  }, []);

  if (!g) {
    return (
      <section className="card mb-6 p-5 md:p-6" aria-labelledby="upst-h">
        <CardHead id="upst-h" title="Upwork" />
        <p className="mt-4 flex items-center gap-2 text-[14px] text-[var(--color-muted)]">{err ? <span className="text-[var(--color-bad)]">Status unavailable: {err}</span> : <><Spinner />Loading…</>}</p>
      </section>
    );
  }

  const stopped = g.state === "stopped";
  const stateTone: Tone = stopped ? "bad" : g.state === "slow" || g.getPauseUntil ? "warn" : "good";
  const e = g.errors24h;
  const serious = Object.entries(e.byClass).filter(([c]) => CLASS[c]?.bad).reduce((n, [, v]) => n + (v ?? 0), 0);
  const errTone: Tone = serious ? "bad" : e.total ? "warn" : "good";
  const day = g.budgets.day;

  return (
    <section className="card mb-6 p-5 md:p-6" aria-labelledby="upst-h" aria-live="polite">
      <CardHead id="upst-h" title="Upwork" right={<span className="text-[12px] text-[var(--color-faint)]">{err ? "refresh failed · " : ""}live</span>} />

      {stopped && (
        <p role="alert" className="mt-4 rounded-[12px] bg-[var(--color-bad-soft)] p-3 text-[14px] text-[var(--color-bad)]">
          ⛔ Upwork restricted access{g.restricted ? ` at ${hhmm(new Date(g.restricted.at).toISOString())}` : ""}. All calls stopped until <code>npm run governor -- resume</code>.
        </p>
      )}

      {/* Headline tiles */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Status" tone={stateTone}
          value={<span className="inline-flex items-center gap-2"><Dot tone={stateTone} />{stopped ? "Stopped" : g.state === "slow" ? `Slowed · L${g.level}` : "Safe"}</span>}
          sub={g.poller === "chat" ? "Claude chat searches" : "Worker searches"} />
        <Tile label="Search rate" value={stopped ? "—" : `every ${g.cadenceMin} min`}
          sub={g.peak.now ? `🌙 peak until 01:00` : `☀️ ${g.peak.peakEveryMin} min from ${g.peak.nextPeak ? hhmm(g.peak.nextPeak) : "18:00"}`} />
        <Tile label="Calls · 24 h" value={<>{day.used.toLocaleString()}<span className="text-[14px] font-normal text-[var(--color-muted)]"> / {day.cap.toLocaleString()}</span></>}
          meter={day.used / day.cap} />
        <Tile label="Errors · 24 h" tone={errTone} value={e.total === 0 ? "None" : String(e.total)}
          sub={e.total === 0 ? "nothing refused" : serious ? `${serious} throttle/block` : "no throttling"} />
      </div>

      {/* Feeds */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {FEEDS.map(([k, label]) => {
          const last = g.lastCall[k];
          const due = last ? Math.min(1, mins(last) / g.cadenceMin) : 0;
          return (
            <div key={k} className="rounded-[14px] border border-[var(--color-line)] px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{label}</span>
                <span className="num shrink-0 text-[12px] text-[var(--color-muted)]">{last ? ago(last) : "—"}</span>
              </div>
              <Bar value={due} color="var(--color-accent)" title={`next search in ~${Math.max(0, g.cadenceMin - (last ? mins(last) : 0))} min`} />
            </div>
          );
        })}
      </div>

      {/* Budgets */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">
        <Meter label="Last hour" b={g.budgets.hour} />
        <Meter label="Searches" b={g.budgets.search} />
        <Meter label="Job opens" b={g.budgets.get} />
        {g.peak.now ? <Meter label="Day budget" b={day} /> : <Meter label="Daytime share" b={{ used: g.peak.budgetDayUsed, cap: g.peak.offPeakAllowance }} />}
      </div>

      {e.total > 0 && (
        <details className="mt-4 border-t border-[var(--color-line)] pt-3">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-[13px] font-medium text-[var(--color-muted)]">
            Errors
            {Object.entries(e.byClass).map(([c, n]) => (
              <span key={c} className={`pill ${CLASS[c]?.bad ? "pill-bad" : "pill-neutral"}`}>{CLASS[c]?.label ?? c} {n}</span>
            ))}
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {e.recent.map((r, i) => (
              <li key={i} className="flex min-w-0 items-baseline gap-2 text-[13px]">
                <Dot tone={CLASS[r.cls]?.bad ? "bad" : "warn"} />
                <span className="num shrink-0 text-[var(--color-muted)]">{hhmm(r.at)}</span>
                <span className="shrink-0 font-medium">{r.call}</span>
                <span className="truncate text-[var(--color-muted)]" title={r.detail}>{r.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Tile({ label, value, sub, tone, meter }: { label: string; value: React.ReactNode; sub?: string; tone?: Tone; meter?: number }) {
  return (
    <div className="min-w-0 rounded-[16px] bg-[var(--color-sunken)] p-3.5">
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="display num mt-1 truncate text-[20px] font-semibold" style={tone && tone !== "good" ? { color: COLOR[tone] } : undefined}>{value}</p>
      {meter != null ? <Bar value={meter} color={COLOR[pctTone(meter)]} /> : sub && <p className="mt-0.5 truncate text-[12px] text-[var(--color-muted)]">{sub}</p>}
    </div>
  );
}

function Meter({ label, b }: { label: string; b: { used: number; cap: number } }) {
  const p = b.cap ? b.used / b.cap : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate text-[var(--color-muted)]">{label}</span>
        <span className="num shrink-0 font-medium" style={p >= 0.7 ? { color: COLOR[pctTone(p)] } : undefined}>{b.used.toLocaleString()}/{b.cap.toLocaleString()}</span>
      </div>
      <Bar value={p} color={COLOR[pctTone(p)]} />
    </div>
  );
}

function Bar({ value, color, title }: { value: number; color: string; title?: string }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-control)]" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100} title={title}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

function Dot({ tone }: { tone: Tone }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: COLOR[tone] }} />;
}

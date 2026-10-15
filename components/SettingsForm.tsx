"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconCheck, IconPhone, IconSend } from "@/components/icons";
import { LlmSpend } from "@/components/LlmSpend";
import { TelegramHelper } from "@/components/settings/TelegramHelper";
import type { CallMode, RankingRules, Settings } from "@/lib/types";

const MODEL_RE = /^claude-[a-z0-9-]+$/;

/* provider / dailyBudgetUsd are newer backend fields; treated as optional until every deploy has them. */
type LlmSettings = Settings["llm"] & { provider?: "api" | "claude-cli"; dailyBudgetUsd?: number };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MODES: { value: CallMode; label: string; hint: string }[] = [
  { value: "outside_hours", label: "Outside hours", hint: "Call only when you are away from the desk (default)." },
  { value: "inside_hours", label: "Inside hours", hint: "Call only during working hours." },
  { value: "always", label: "Always", hint: "Call whenever a job clears the threshold, quiet hours ignored." },
  { value: "off", label: "Off", hint: "Never call. Telegram keeps working." },
];

/** Every rule the worker reads lives here. Saving writes to /api/settings; the worker picks it up on its next loop. */
export function SettingsForm({ initial, timezones, configured }: {
  initial: Settings; timezones: string[]; configured: { telegram: boolean; retell: boolean };
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ ch: string; msg: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [countries, setCountries] = useState(initial.rules.excludedCountries.join(", "));
  const pf0 = (initial as Settings & { profileFit?: Settings["profileFit"] }).profileFit ?? { never: [], alsoMine: [] };
  const [neverList, setNeverList] = useState(pf0.never.join(", "));
  const [mineList, setMineList] = useState(pf0.alsoMine.join(", "));
  const splitList = (v: string) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const r = s.rules;
  const setRules = (patch: Partial<RankingRules>) => setS({ ...s, rules: { ...r, ...patch } });
  const llm = s.llm as LlmSettings;
  const ad = (s as Settings & { autoDraft?: Settings["autoDraft"] }).autoDraft ?? { enabled: true, minRank: 60, dailyCap: 10, perCycle: 3, webSearch: true };
  const setAd = (patch: Partial<Settings["autoDraft"]>) => setS({ ...s, autoDraft: { ...ad, ...patch } });
  const setLlm = (patch: Partial<LlmSettings>) => setS({ ...s, llm: { ...llm, ...patch } as Settings["llm"] });
  const modelErr = [llm.rankingModel, llm.writerModel].some((m) => !MODEL_RE.test(m));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modelErr) { setError("Model ids must look like claude-…"); return; }
    setBusy("save"); setError(null);
    const body = {
      ...s, rules: { ...r, excludedCountries: countries.split(",").map((c) => c.trim()).filter(Boolean) },
      profileFit: { never: splitList(neverList), alsoMine: splitList(mineList) },
    };
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (!res.ok) { setError(((await res.json()) as { error: string }).error); return; }
    const next = (await res.json()) as Settings;
    setS(next);
    setCountries(next.rules.excludedCountries.join(", "));
    if (next.profileFit) { setNeverList(next.profileFit.never.join(", ")); setMineList(next.profileFit.alsoMine.join(", ")); }
    setSaved(true); setTimeout(() => setSaved(false), 2500);
    router.refresh();
  };
  const runTest = async (ch: "telegram" | "call") => {
    setBusy(ch); setTest(null);
    const r = (await (await fetch(`/api/test/${ch}`, { method: "POST" })).json()) as { ok: boolean; detail: string };
    setBusy(null);
    setTest({ ch, msg: r.ok ? `OK · ${r.detail}` : `Failed · ${r.detail}` });
  };
  const wh = s.workingHours;
  const toggleDay = (d: number) => setS({ ...s, workingHours: { ...wh, days: wh.days.includes(d) ? wh.days.filter((x) => x !== d) : [...wh.days, d].sort() } });

  return (
    <form onSubmit={save} className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      {/* Telegram */}
      <section className="card min-w-0 p-5 md:p-6" aria-labelledby="tg">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tg" className="display text-[20px] font-semibold">Telegram</h2>
          <span className={`pill ${configured.telegram ? "pill-good" : "pill-warn"}`}>{configured.telegram ? "Configured" : "Set bot token in .env"}</span>
        </div>
        <p className="mt-1 text-[14px] text-[var(--color-muted)]">Every job at or above this score is sent to your chat, with Open / Dismiss buttons.</p>
        <div className="mt-5 grid gap-4">
          <label className="flex items-center gap-3"><input type="checkbox" className="size-4" checked={s.telegramEnabled} onChange={(e) => setS({ ...s, telegramEnabled: e.target.checked })} />Send Telegram alerts</label>
          <Range label="Minimum score for a message" value={s.telegramMin} onChange={(v) => setS({ ...s, telegramMin: v })} />
          <div className="flex items-center gap-3">
            <button type="button" className="btn btn-sm" disabled={!configured.telegram || busy === "telegram"} onClick={() => runTest("telegram")}><IconSend size={16} />Send test message</button>
            {test?.ch === "telegram" && <span className="text-[14px] text-[var(--color-muted)]">{test.msg}</span>}
          </div>
          <TelegramHelper />
        </div>
      </section>

      {/* Voice calls */}
      <section className="card min-w-0 p-5 md:p-6 lg:row-span-2" aria-labelledby="voice">
        <div className="flex items-center justify-between gap-3">
          <h2 id="voice" className="display text-[20px] font-semibold">Voice calls</h2>
          <span className={`pill ${configured.retell ? "pill-good" : "pill-warn"}`}>{configured.retell ? "Configured" : "Set Retell keys in .env"}</span>
        </div>
        <p className="mt-1 text-[14px] text-[var(--color-muted)]">A short automated call to your own phone for the very best jobs. Choose when calls are allowed.</p>

        <fieldset className="mt-5" aria-labelledby="cm-label">
          <p id="cm-label" className="mb-2 text-[13px] font-medium text-[var(--color-muted)]">When to call</p>
          <div className="seg w-full" role="radiogroup">
            {MODES.map((m) => (
              <button key={m.value} type="button" role="radio" aria-checked={s.callMode === m.value} aria-pressed={s.callMode === m.value}
                className="seg-item flex-1 justify-center" onClick={() => setS({ ...s, callMode: m.value })}>{m.label}</button>
            ))}
          </div>
          <p className="mt-2 text-[14px] text-[var(--color-muted)]">{MODES.find((m) => m.value === s.callMode)?.hint}</p>
        </fieldset>

        <div className="mt-5 grid gap-4">
          <Range label="Minimum score for a call" value={s.callMin} onChange={(v) => setS({ ...s, callMin: v })} />
          <div className="grid grid-cols-2 gap-4">
            <label className="field"><span>Cooldown between calls (min)</span><input className="input num" type="number" min="0" max="1440" value={s.callCooldownMin} onChange={(e) => setS({ ...s, callCooldownMin: Number(e.target.value) })} /></label>
            <label className="field"><span>Max calls per day</span><input className="input num" type="number" min="0" max="50" value={s.maxCallsPerDay} onChange={(e) => setS({ ...s, maxCallsPerDay: Number(e.target.value) })} /></label>
          </div>

          <fieldset aria-labelledby="wh-label" className="rounded-[16px] bg-[var(--color-sunken)] p-4">
            <p id="wh-label" className="mb-3 text-[13px] font-medium text-[var(--color-muted)]">Working hours</p>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => (
                <button key={d} type="button" aria-pressed={wh.days.includes(i)} onClick={() => toggleDay(i)}
                  className={`h-9 rounded-[10px] px-3 text-[14px] font-medium transition-colors ${wh.days.includes(i) ? "bg-[var(--color-ink)] text-[var(--color-surface)]" : "bg-[var(--color-surface)] border border-[var(--color-line)] hover:border-[var(--color-faint)]"}`}>{d}</button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.6fr]">
              <label className="field"><span>Start</span><input className="input num" type="time" value={wh.start} onChange={(e) => setS({ ...s, workingHours: { ...wh, start: e.target.value } })} /></label>
              <label className="field"><span>End</span><input className="input num" type="time" value={wh.end} onChange={(e) => setS({ ...s, workingHours: { ...wh, end: e.target.value } })} /></label>
              <label className="field col-span-2 sm:col-span-1"><span>Timezone</span>
                <select className="input" value={wh.timezone} onChange={(e) => setS({ ...s, workingHours: { ...wh, timezone: e.target.value } })}>
                  {!timezones.includes(wh.timezone) && <option value={wh.timezone}>{wh.timezone}</option>}
                  {timezones.map((z) => <option key={z} value={z}>{z}</option>)}
                </select></label>
            </div>
          </fieldset>

          <fieldset aria-labelledby="qh-label" className="rounded-[16px] bg-[var(--color-sunken)] p-4">
            <p id="qh-label" className="mb-3 text-[13px] font-medium text-[var(--color-muted)]">Quiet hours (no calls, except in “Always”)</p>
            <div className="grid grid-cols-[auto_1fr_1fr] items-end gap-3">
              <label className="flex h-11 items-center gap-3"><input type="checkbox" className="size-4" checked={s.quietHours.enabled} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, enabled: e.target.checked } })} />On</label>
              <label className="field"><span>From</span><input className="input num" type="time" value={s.quietHours.start} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, start: e.target.value } })} /></label>
              <label className="field"><span>Until</span><input className="input num" type="time" value={s.quietHours.end} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, end: e.target.value } })} /></label>
            </div>
          </fieldset>

          <div className="flex items-center gap-3">
            <button type="button" className="btn btn-sm" disabled={!configured.retell || busy === "call"} onClick={() => runTest("call")}><IconPhone size={16} />Place test call</button>
            {test?.ch === "call" && <span className="text-[14px] text-[var(--color-muted)]">{test.msg}</span>}
          </div>
        </div>
      </section>

      {/* Ban-safety */}
      <section className="card min-w-0 p-5 md:p-6" aria-labelledby="poll">
        <h2 id="poll" className="display text-[20px] font-semibold">Ban-safety limits</h2>
        <p className="mt-1 text-[14px] text-[var(--color-muted)]">Keeps usage human-paced: a slow, jittered poll, a gap between calls and hard caps per cycle and per day. When a cap is hit, the worker simply waits.</p>
        <div className="mt-5 grid gap-4">
          <label className="field"><span>Data source</span>
            <select className="input" value={s.source} onChange={(e) => setS({ ...s, source: e.target.value as Settings["source"] })}>
              <option value="auto">Auto (MCP connector when connected, else API key)</option>
              <option value="mcp">Upwork MCP connector only</option>
              <option value="graphql">GraphQL API key only</option>
            </select></label>
          <div className="grid grid-cols-2 gap-4">
            <Num label="Poll interval (s, 120–3600)" min={120} max={3600} step={30} value={s.pollIntervalSec} onChange={(v) => setS({ ...s, pollIntervalSec: v })} />
            <Num label="Random jitter (s, 0–300)" min={0} max={300} value={s.guard.jitterSec} onChange={(v) => setS({ ...s, guard: { ...s.guard, jitterSec: v } })} />
            <Num label="Gap between calls (ms)" min={250} max={30000} step={250} value={s.guard.minGapMs} onChange={(v) => setS({ ...s, guard: { ...s.guard, minGapMs: v } })} />
            <Num label="Client lookups per cycle" min={0} max={30} value={s.guard.maxEnrichPerCycle} onChange={(v) => setS({ ...s, guard: { ...s.guard, maxEnrichPerCycle: v } })} />
            <Num label="Daily call cap (50–10,000)" min={50} max={10000} step={50} value={s.guard.dailyCallCap} onChange={(v) => setS({ ...s, guard: { ...s.guard, dailyCallCap: v } })} />
          </div>
          <label className="flex items-center gap-3"><input type="checkbox" className="size-4" checked={s.alertsPaused} onChange={(e) => setS({ ...s, alertsPaused: e.target.checked })} />Pause all alerts (jobs are still collected)</label>
        </div>
      </section>

      {/* Proposal watch */}
      <section className="card min-w-0 p-5 md:p-6" aria-labelledby="watch">
        <h2 id="watch" className="display text-[20px] font-semibold">Proposal watch</h2>
        <p className="mt-1 text-[14px] text-[var(--color-muted)]">After an alert, the job&apos;s proposal count is re-checked so you know when it gets crowded. See Watchlist.</p>
        <div className="mt-5 grid gap-4">
          <label className="flex items-center gap-3"><input type="checkbox" className="size-4" checked={s.watch.enabled} onChange={(e) => setS({ ...s, watch: { ...s.watch, enabled: e.target.checked } })} />Watch alerted jobs</label>
          <div className="grid grid-cols-2 gap-4">
            <Num label="Check every (min, 5–240)" min={5} max={240} value={s.watch.intervalMin} onChange={(v) => setS({ ...s, watch: { ...s.watch, intervalMin: v } })} />
            <Num label="Stop after (hours, 1–336)" min={1} max={336} value={s.watch.maxHours} onChange={(v) => setS({ ...s, watch: { ...s.watch, maxHours: v } })} />
          </div>
          <p className="text-[13px] text-[var(--color-muted)]">Warning and drop thresholds live in Ranking rules (warn at {r.watchWarnAt}, drop above {r.maxProposals}).</p>
        </div>
      </section>

      {/* Auto proposal drafts */}
      <section className="card min-w-0 p-5 md:p-6" aria-labelledby="autodraft">
        <h2 id="autodraft" className="display text-[20px] font-semibold">Auto proposal drafts</h2>
        <p className="mt-1 text-[14px] text-[var(--color-muted)]">Jobs ranked at or above the threshold get a proposal draft automatically (Opus, ≈$0.15–0.30 each). Drafts wait for your Loom video and approval - nothing is sent to Upwork automatically.</p>
        <div className="mt-5 grid gap-4">
          <label className="flex items-center gap-3"><input type="checkbox" className="size-4" checked={ad.enabled} onChange={(e) => setAd({ enabled: e.target.checked })} />Draft automatically</label>
          <div className="grid grid-cols-2 gap-4">
            <Num label="Draft jobs ranked ≥ (0–100)" min={0} max={100} value={ad.minRank} onChange={(v) => setAd({ minRank: v })} />
            <Num label="Max drafts per day" min={0} max={100} value={ad.dailyCap} onChange={(v) => setAd({ dailyCap: v })} />
            <Num label="Max drafts per cycle" min={0} max={10} value={ad.perCycle} onChange={(v) => setAd({ perCycle: v })} />
          </div>
          <label className="flex items-center gap-3"><input type="checkbox" className="size-4" checked={ad.webSearch} onChange={(e) => setAd({ webSearch: e.target.checked })} />Research the client company on the web (more accurate, slightly slower)</label>
        </div>
      </section>

      {/* AI models */}
      <section className="card min-w-0 p-5 md:p-6" aria-labelledby="ai">
        <h2 id="ai" className="display text-[20px] font-semibold">AI models</h2>
        <p className="mt-1 text-[14px] text-[var(--color-muted)]">The ranking model reads every job that passes the rules; the writer drafts proposals, Closer replies and reports.</p>
        <div className="mt-5 grid gap-4">
          <label className="flex items-center gap-3"><input type="checkbox" className="size-4" checked={llm.enabled} onChange={(e) => setLlm({ enabled: e.target.checked })} />Use AI ranking (off = rules only)</label>
          <fieldset>
            <p className="mb-2 text-[13px] font-medium text-[var(--color-muted)]">Runs on</p>
            <div className="seg w-full" role="radiogroup" aria-label="AI provider">
              {([["api", "API key"], ["claude-cli", "Claude Code (subscription)"]] as const).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={(llm.provider ?? "api") === v} aria-pressed={(llm.provider ?? "api") === v}
                  className="seg-item flex-1 justify-center" onClick={() => setLlm({ provider: v })}>{l}</button>
              ))}
            </div>
            <p className="mt-2 text-[14px] text-[var(--color-muted)]">
              {(llm.provider ?? "api") === "api" ? "Pay-per-use through ANTHROPIC_API_KEY. Cheapest per call; the daily budget below caps spend." : "Uses the local Claude Code login (claude -p). No API key needed, but each call starts a CLI session: slower and heavier, so keep ranked-per-cycle low."}
            </p>
          </fieldset>
          <div className="grid grid-cols-2 gap-4">
            <ModelField label="Ranking model" value={llm.rankingModel} placeholder="claude-haiku-5-5" onChange={(v) => setLlm({ rankingModel: v })} />
            <ModelField label="Writer model" value={llm.writerModel} placeholder="claude-opus-5-5" onChange={(v) => setLlm({ writerModel: v })} />
            <Num label="Max jobs ranked per cycle" min={0} max={50} value={llm.maxRankPerCycle} onChange={(v) => setLlm({ maxRankPerCycle: v })} />
            <label className="field min-w-0"><span>Daily AI budget ($, 0 = no AI)</span>
              <input className="input num" type="number" inputMode="decimal" min={0} max={100} step={0.5} value={llm.dailyBudgetUsd ?? 1} onChange={(e) => setLlm({ dailyBudgetUsd: Number(e.target.value) })} />
            </label>
          </div>
          <label className="field min-w-0"><span>Anthropic prepaid credit ($) - enter your balance after each top-up; the app subtracts what it spends</span>
            <input className="input num" type="number" inputMode="decimal" min={0} step={1} placeholder="e.g. 50"
              value={llm.prepaidCreditUsd ?? ""} onChange={(e) => setLlm({ prepaidCreditUsd: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
          <p className="text-[14px] text-[var(--color-muted)]">Spent today: <LlmSpend budget={llm.dailyBudgetUsd ?? 1} fallback="not reported yet" />{llm.creditSetAt ? ` · credit counted since ${llm.creditSetAt.slice(0, 10)}` : ""}</p>
        </div>
      </section>

      {/* Your fields (profile-fit gate) */}
      <section className="card min-w-0 p-5 md:p-6 lg:col-span-2" aria-labelledby="fields">
        <h2 id="fields" className="display text-[20px] font-semibold">Your fields</h2>
        <p className="mt-1 text-[14px] text-[var(--color-muted)]">
          Jobs outside your fields are marked “Not your field”: rank 0, no AI check, no alert, no draft, hidden unless you filter for them.
          Built in: AI agents &amp; LLM apps, ML/CV/NLP, data science &amp; engineering, algorithmic trading, voice agents &amp; automation, AI marketing &amp; ads,
          AI video/image generation, web &amp; app development, blockchain, cloud/DevOps, plus the skills on your Upwork profile. Never: game dev, legal,
          admin/VA, customer service, non-technical writing &amp; editing, non-AI design and video editing, sales/PR roles, accounting &amp; tax, CAD, IT helpdesk.
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="field"><span>Also my work (comma-separated skills or title words)</span>
            <textarea className="input min-h-[72px] py-2.5" value={mineList} onChange={(e) => setMineList(e.target.value)} placeholder="e.g. Shopify app, Chrome extension" /></label>
          <label className="field"><span>Never my work (comma-separated skills or title words)</span>
            <textarea className="input min-h-[72px] py-2.5" value={neverList} onChange={(e) => setNeverList(e.target.value)} placeholder="e.g. WordPress theme, Salesforce admin" /></label>
        </div>
      </section>

      {/* Ranking rules */}
      <section className="card min-w-0 p-5 md:p-6 lg:col-span-2" aria-labelledby="rules">
        <h2 id="rules" className="display text-[20px] font-semibold">Ranking rules</h2>
        <p className="mt-1 text-[14px] text-[var(--color-muted)]">The rule engine flags and scores every job before the AI sees it. The final rank blends both.</p>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div className="grid content-start gap-4">
            <label className="field"><span>Excluded client countries (comma-separated)</span>
              <textarea className="input min-h-[72px] py-2.5" value={countries} onChange={(e) => setCountries(e.target.value)} /></label>
            <fieldset className="rounded-[16px] bg-[var(--color-sunken)] p-4">
              <p className="mb-3 text-[13px] font-medium text-[var(--color-muted)]">Competition</p>
              <div className="grid grid-cols-2 gap-3">
                <Num label="Reject above (proposals)" min={1} max={100} value={r.maxProposals} onChange={(v) => setRules({ maxProposals: v })} />
                <Num label="Warn at (proposals)" min={1} max={100} value={r.watchWarnAt} onChange={(v) => setRules({ watchWarnAt: v })} />
              </div>
            </fieldset>
            <fieldset className="rounded-[16px] bg-[var(--color-sunken)] p-4">
              <p className="mb-3 text-[13px] font-medium text-[var(--color-muted)]">Rates &amp; client spend</p>
              <div className="grid grid-cols-2 gap-3">
                <Num label="Good hourly floor ($)" min={0} max={1000} value={r.minHourly} onChange={(v) => setRules({ minHourly: v })} />
                <Num label="No rate: client avg paid ≥ ($/hr)" min={0} max={1000} value={r.minClientAvgPaid} onChange={(v) => setRules({ minClientAvgPaid: v })} />
                <Num label="Cheap-labour flag ≤ ($/hr)" min={0} max={500} value={r.lowRateMax} onChange={(v) => setRules({ lowRateMax: v })} />
                <Num label="Small-jobs flag ≤ ($/contract)" min={0} max={100000} value={r.smallJobAvg} onChange={(v) => setRules({ smallJobAvg: v })} />
                <Num label="Ignored open jobs ≥" min={0} max={100} value={r.ignoredOpenJobs} onChange={(v) => setRules({ ignoredOpenJobs: v })} />
                <Num label="Unverified OK if AI fit ≥" min={0} max={100} value={r.unverifiedExceptionFit} onChange={(v) => setRules({ unverifiedExceptionFit: v })} />
              </div>
            </fieldset>
          </div>
          <div className="grid content-start gap-4">
            <fieldset className="rounded-[16px] bg-[var(--color-sunken)] p-4">
              <p className="mb-3 text-[13px] font-medium text-[var(--color-muted)]">AI / ML jobs</p>
              <div className="grid grid-cols-2 gap-3">
                <Num label="Min hire rate (%)" min={0} max={100} value={r.ai.minHireRate} onChange={(v) => setRules({ ai: { ...r.ai, minHireRate: v } })} />
                <Num label="Min avg paid ($/hr)" min={0} max={1000} value={r.ai.minAvgPaid} onChange={(v) => setRules({ ai: { ...r.ai, minAvgPaid: v } })} />
                <Num label="Hired within (days)" min={1} max={3650} value={r.ai.recentHireDays} onChange={(v) => setRules({ ai: { ...r.ai, recentHireDays: v } })} />
              </div>
            </fieldset>
            <fieldset className="rounded-[16px] bg-[var(--color-sunken)] p-4">
              <p className="mb-3 text-[13px] font-medium text-[var(--color-muted)]">DevOps / MLOps / automation jobs</p>
              <div className="grid grid-cols-2 gap-3">
                <Num label="Min hire rate (%)" min={0} max={100} value={r.devops.minHireRate} onChange={(v) => setRules({ devops: { minHireRate: v } })} />
              </div>
            </fieldset>
            <fieldset className="rounded-[16px] bg-[var(--color-sunken)] p-4">
              <p className="mb-1 text-[13px] font-medium text-[var(--color-muted)]">Blend</p>
              <label className="field">
                <span className="flex justify-between"><span>Rules {Math.round(r.weights.rules * 100)}%</span><span className="num font-semibold text-[var(--color-ink)]">AI {Math.round(r.weights.llm * 100)}%</span></span>
                <input type="range" min="0" max="1" step="0.05" value={r.weights.rules} aria-label="Weight of rules versus AI"
                  onChange={(e) => { const v = Number(e.target.value); setRules({ weights: { rules: v, llm: Math.round((1 - v) * 100) / 100 } }); }} className="w-full accent-[var(--color-ink)]" />
              </label>
              <p className="mt-1 text-[13px] text-[var(--color-muted)]">Insights → Calibration can propose these from your thumbs.</p>
            </fieldset>
          </div>
        </div>
      </section>

      <div className="sticky bottom-[96px] z-10 flex flex-wrap items-center gap-3 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)]/95 p-3 backdrop-blur md:bottom-4 lg:col-span-2">
        <button type="submit" className="btn btn-dark" disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save settings"}</button>
        {saved && <span className="inline-flex items-center gap-1.5 text-[14px] text-[var(--color-good)]"><IconCheck size={16} />Saved — the worker applies it on its next run</span>}
        {error && <span role="alert" className="text-[14px] text-[var(--color-bad)]">{error}</span>}
      </div>
    </form>
  );
}

function Range({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span className="flex justify-between"><span>{label}</span><span className="num font-semibold text-[var(--color-ink)]">{value}%</span></span>
      <input type="range" min="0" max="100" step="5" value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--color-ink)]" />
    </label>
  );
}

function Num({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <label className="field min-w-0"><span>{label}</span>
      <input className="input num" type="number" inputMode="numeric" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function ModelField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  const bad = !MODEL_RE.test(value);
  return (
    <label className="field min-w-0"><span>{label}</span>
      <input className={`input ${bad ? "border-[var(--color-bad)]" : ""}`} value={value} placeholder={placeholder} spellCheck={false} autoCapitalize="off" aria-invalid={bad}
        onChange={(e) => onChange(e.target.value.trim())} />
      {bad && <span className="text-[12px] text-[var(--color-bad)]">Must look like claude-…</span>}
    </label>
  );
}

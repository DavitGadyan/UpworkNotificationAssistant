"use client";

import { useState } from "react";
import { FeedbackButtons } from "@/components/FeedbackButtons";
import { IconChat, IconRefresh, IconSpark } from "@/components/icons";
import { Bullets, CardHead, Note, Spinner } from "@/components/ui/bits";
import { CopyButton } from "@/components/ui/CopyButton";
import { fmtDateTime, timeAgo } from "@/lib/format";

export interface CloserAdviceView {
  stage: string; clientRead: string; culturalNotes: string[]; recommendedMove: string; reply: string;
  alternatives: string[]; risks: string[]; nextStep: string; questionsToAsk: string[];
  country?: string; model?: string; roomId?: string | null; createdAt?: string; reportId?: number;
}
export interface CloserHistoryItem {
  id: number;
  data: { input?: { jobId?: string; roomId?: string; thread?: string; country?: string; clientName?: string; goal?: string }; advice?: CloserAdviceView };
  createdAt: string;
}
type Room = { id: string; name: string; lastMessage: string; lastAt: string | null; awaiting: string | null; unread: boolean };

const STAGE: Record<string, string> = {
  first_reply: "First reply", discovery: "Discovery", scoping: "Scoping", pricing: "Pricing", objection: "Objection",
  closing: "Closing", stalled: "Stalled", post_hire: "Post-hire",
};

export function CloserClient({ history: initialHistory, jobs }: { history: CloserHistoryItem[]; jobs: { id: string; label: string }[] }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [history, setHistory] = useState(initialHistory);

  const [mode, setMode] = useState<"room" | "paste">("paste");
  const [roomId, setRoomId] = useState("");
  const [thread, setThread] = useState("");
  const [jobId, setJobId] = useState("");
  const [country, setCountry] = useState("");
  const [clientName, setClientName] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<CloserAdviceView | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const loadInbox = async () => {
    setInboxBusy(true); setInboxError(null);
    try {
      const r = (await (await fetch("/api/closer?inbox=1")).json()) as { inbox: Room[]; inboxError: string | null; history: CloserHistoryItem[] };
      setRooms(r.inbox); setInboxError(r.inboxError); setHistory(r.history);
      if (r.inbox.length) setMode("room");
    } catch (e) {
      setInboxError((e as Error).message);
    } finally { setInboxBusy(false); }
  };

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setAdvice(null);
    try {
      const res = await fetch("/api/closer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: mode === "room" ? roomId : undefined, thread: mode === "paste" ? thread : undefined, jobId, country, clientName, goal }),
      });
      const body = (await res.json().catch(() => ({}))) as CloserAdviceView & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setAdvice(body);
      const h = (await (await fetch("/api/closer")).json().catch(() => null)) as { history?: CloserHistoryItem[] } | null;
      if (h?.history) setHistory(h.history);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const canAsk = mode === "room" ? !!roomId : thread.trim().length > 10;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
        {/* Inbox */}
        <section className="card p-5 md:p-6" aria-labelledby="inbox-h">
          <CardHead id="inbox-h" title="Conversations"
            right={<button type="button" className="btn btn-sm" disabled={inboxBusy} onClick={loadInbox}>{inboxBusy ? <Spinner /> : rooms ? <IconRefresh size={16} /> : <IconChat size={16} />}{rooms ? "Reload" : "Load conversations"}</button>}
            sub="Loaded from Upwork only when you ask (one read call)." />
          {inboxError && <Note tone="bad" className="mt-4">{inboxError}</Note>}
          {rooms == null ? (
            <p className="mt-4 rounded-[14px] bg-[var(--color-sunken)] p-4 text-[14px] text-[var(--color-muted)]">Tap “Load conversations” to see rooms waiting on you, or paste a thread in the form.</p>
          ) : rooms.length === 0 ? (
            <p className="mt-4 text-[var(--color-muted)]">No conversations returned.</p>
          ) : (
            <ul className="mt-3 divide-row">
              {rooms.map((r) => (
                <li key={r.id}>
                  <button type="button" aria-pressed={mode === "room" && roomId === r.id}
                    onClick={() => { setMode("room"); setRoomId(r.id); if (!clientName) setClientName(r.name); }}
                    className={`-mx-2 flex w-[calc(100%+16px)] items-start gap-3 rounded-[12px] px-2 py-3 text-left transition-colors ${mode === "room" && roomId === r.id ? "bg-[var(--color-control)]" : "hover:bg-[var(--color-sunken)]"}`}>
                    <span className={`mt-2 size-2 shrink-0 rounded-full ${r.unread ? "bg-[var(--color-accent)]" : "bg-transparent"}`} aria-label={r.unread ? "Unread" : undefined} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{r.name}</span>
                        {r.lastAt && <span className="shrink-0 text-[13px] text-[var(--color-muted)]">{timeAgo(r.lastAt)}</span>}
                      </span>
                      <span className="line-clamp-2 text-[14px] text-[var(--color-muted)]">{r.lastMessage || "No preview"}</span>
                      {r.awaiting && <span className="tag mt-1.5">Awaiting {r.awaiting}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Form */}
        <form className="card p-5 md:p-6" aria-labelledby="ask-h" onSubmit={ask}>
          <CardHead id="ask-h" title="Get advice" sub="Pick a conversation or paste the thread. The more context, the better the read." />
          <div className="mt-4 grid gap-4">
            <div className="seg w-full" role="radiogroup" aria-label="Source">
              <button type="button" role="radio" aria-checked={mode === "room"} aria-pressed={mode === "room"} className="seg-item flex-1 justify-center" onClick={() => setMode("room")}>Conversation</button>
              <button type="button" role="radio" aria-checked={mode === "paste"} aria-pressed={mode === "paste"} className="seg-item flex-1 justify-center" onClick={() => setMode("paste")}>Paste thread</button>
            </div>
            {mode === "room" ? (
              rooms?.length ? (
                <label className="field"><span>Conversation</span>
                  <select className="input" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                    <option value="">Choose…</option>
                    {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select></label>
              ) : <Note>Load conversations first, or switch to “Paste thread”.</Note>
            ) : (
              <label className="field"><span>Thread (oldest first; mark who said what)</span>
                <textarea className="input min-h-[180px] py-3 leading-relaxed" value={thread} onChange={(e) => setThread(e.target.value)} maxLength={20000}
                  placeholder={"Client: Thanks for the proposal, can you do it for $2k?\nMe: …"} /></label>
            )}
            <label className="field"><span>Related job (optional)</span>
              <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">None</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.label.length > 70 ? j.label.slice(0, 70) + "…" : j.label}</option>)}
              </select></label>
            <div className="grid grid-cols-2 gap-4">
              <label className="field"><span>Client country</span><input className="input" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. Germany" /></label>
              <label className="field"><span>Client name</span><input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Anna" /></label>
            </div>
            <label className="field"><span>Your goal (optional)</span><input className="input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. get to a paid discovery call this week" /></label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn btn-dark" disabled={busy || !canAsk}>{busy ? <><Spinner />Thinking…</> : <><IconSpark size={16} />Get advice</>}</button>
              {busy && <span className="text-[14px] text-[var(--color-muted)]">Reading the thread and drafting a reply, about a minute.</span>}
            </div>
            {error && <Note tone="bad">{error}</Note>}
          </div>
        </form>
      </div>

      {advice && <AdviceView advice={advice} refId={advice.reportId != null ? String(advice.reportId) : advice.createdAt ?? String(Date.now())} />}

      <section className="card p-5 md:p-6" aria-labelledby="hist-h">
        <CardHead id="hist-h" title="History" sub="Recent advice, newest first." />
        {history.length === 0 ? (
          <p className="mt-3 text-[var(--color-muted)]">No advice yet. Each request is saved here.</p>
        ) : (
          <ul className="mt-3 divide-row">
            {history.map((h) => {
              const a = h.data.advice;
              const open = openId === h.id;
              return (
                <li key={h.id} className="py-1">
                  <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : h.id)} className="flex w-full items-start justify-between gap-3 py-2.5 text-left">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{h.data.input?.clientName || a?.country || "Client"} · {STAGE[a?.stage ?? ""] ?? a?.stage ?? "—"}</span>
                      <span className="line-clamp-1 text-[14px] text-[var(--color-muted)]">{a?.recommendedMove}</span>
                    </span>
                    <span className="shrink-0 text-[13px] text-[var(--color-muted)]">{fmtDateTime(h.createdAt)}</span>
                  </button>
                  {open && a && <div className="pb-4"><AdviceView advice={a} refId={String(h.id)} compact /></div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function AdviceView({ advice: a, refId, compact = false }: { advice: CloserAdviceView; refId: string; compact?: boolean }) {
  const box = compact ? "rounded-[16px] border border-[var(--color-line)] p-4" : "card p-5 md:p-6";
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className={box} aria-label="Suggested reply">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2"><span className="tag">Suggested reply</span><span className="pill pill-info">{STAGE[a.stage] ?? a.stage}</span></span>
            <CopyButton text={a.reply} label="Copy reply" />
          </div>
          <p className="mt-3 whitespace-pre-line rounded-[14px] bg-[var(--color-sunken)] p-4 leading-relaxed">{a.reply}</p>
          <p className="mt-3"><b>Move:</b> {a.recommendedMove}</p>
          <p className="mt-1"><b>Next step:</b> {a.nextStep}</p>
        </section>
        <section className={box} aria-label="Client read">
          <span className="tag">Client read</span>
          <p className="mt-3 leading-relaxed">{a.clientRead}</p>
          {a.culturalNotes.length > 0 && (
            <div className="mt-4 rounded-[14px] bg-[var(--color-warn-soft)] p-4">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-warn)]">Cultural notes · hypotheses{a.country && a.country !== "unknown" ? ` (${a.country})` : ""}</p>
              <p className="mb-2 mt-1 text-[13px] text-[var(--color-warn)]">Starting points only; this person&apos;s own messages always win.</p>
              <Bullets items={a.culturalNotes} />
            </div>
          )}
        </section>
      </div>
      {a.alternatives.length > 0 && (
        <section className={box} aria-label="Alternatives">
          <span className="tag">Alternatives</span>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {a.alternatives.map((t, i) => (
              <li key={i} className="flex flex-col gap-3 rounded-[14px] bg-[var(--color-sunken)] p-4">
                <p className="flex-1 whitespace-pre-line leading-relaxed">{t}</p>
                <CopyButton text={t} className="self-start" />
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {a.questionsToAsk.length > 0 && <section className={box} aria-label="Questions to ask"><span className="tag">Questions to ask</span><div className="mt-3"><Bullets items={a.questionsToAsk} /></div></section>}
        {a.risks.length > 0 && <section className={box} aria-label="Risks"><span className="tag">Risks</span><div className="mt-3"><Bullets items={a.risks} tone="bad" /></div></section>}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <FeedbackButtons kind="closer" refId={refId} label="Helpful?" />
        {a.model && <span className="text-[13px] text-[var(--color-faint)]">{a.model}</span>}
      </div>
    </div>
  );
}

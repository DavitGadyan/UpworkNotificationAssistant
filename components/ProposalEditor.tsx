"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeedbackButtons } from "@/components/FeedbackButtons";
import { IconCheck, IconExternal, IconLink, IconRefresh, IconSend } from "@/components/icons";
import { Bullets, Note, Spinner } from "@/components/ui/bits";
import { CopyButton } from "@/components/ui/CopyButton";
import { CONTACT_ROLE_LABELS, fmtDateTime, PROPOSAL_STATUS, percentChanged } from "@/lib/format";
import { findPlaceholders } from "@/lib/proposals/clean";
import { addProjectLink, hasProjectLink, removeProjectLink, type PortfolioChoices } from "@/lib/proposals/similarWork";
import type { Proposal } from "@/lib/types";

const LOOM_PLACEHOLDER = "{{LOOM_URL}}";
// A loom.com link or a branded short link (Rebrandly…); the server follows redirects and checks it lands on Loom.
const LOOM_RE = /^https:\/\/[^\s/]+\.[^\s/]+\/\S+$/;
const MAX = 5000;
const AUTOSAVE_MS = 1200;
const cacheKey = (id: number) => `proposal-draft:${id}`;
type Answer = { question: string; answer: string };
interface Cached { cover: string; answers: Answer[]; bid: string; duration: string; portfolioIds?: string[]; savedAt: number }
type SaveState = "idle" | "saving" | "saved" | "retrying";

// Browser copy of unsaved edits, so a closed tab or a dropped connection never loses text (per browser, best effort).
const readCache = (id: number): Cached | null => { try { const v = localStorage.getItem(cacheKey(id)); return v ? (JSON.parse(v) as Cached) : null; } catch { return null; } };
const writeCache = (id: number, c: Cached) => { try { localStorage.setItem(cacheKey(id), JSON.stringify(c)); } catch { /* storage full or blocked */ } };
const clearCache = (id: number) => { try { localStorage.removeItem(cacheKey(id)); } catch { /* blocked */ } };

/** Red line under a field that still has a note to David or a fill-in slot - the client must never see it. */
function PlaceholderWarning({ text }: { text: string }) {
  const found = findPlaceholders(text);
  if (!found.length) return null;
  return <p role="alert" className="mt-1.5 text-[13px] text-[var(--color-bad)]">Remove before sending: {found.map((f) => `"${f.length > 60 ? `${f.slice(0, 57)}…` : f}"`).join(", ")}</p>;
}

type Action = "save" | "loom" | "approve" | "preview" | "boost" | "submit" | "discard" | "rewrite";

/** The full submit gate on one page: edit → (optional Loom) → approve → Upwork preview → typed SUBMIT. */
export function ProposalEditor({ initial, screeningQuestions, connectsCost, portfolio }: { initial: Proposal; screeningQuestions: string[]; connectsCost: number | null; portfolio: PortfolioChoices }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [cover, setCover] = useState(initial.coverLetter);
  const [answers, setAnswers] = useState(() => {
    const qs = initial.answers.length ? initial.answers : screeningQuestions.map((q) => ({ question: q, answer: "" }));
    return qs.map((a) => ({ ...a }));
  });
  const [bid, setBid] = useState(initial.bid != null ? String(initial.bid) : "");
  const [duration, setDuration] = useState(initial.estimatedDuration ?? "");
  const [portfolioIds, setPortfolioIds] = useState<string[]>(initial.portfolioProjectIds ?? []);
  const [loom, setLoom] = useState(initial.loomUrl ?? "");
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<{ at: Action; msg: string } | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restored, setRestored] = useState<Cached | null>(null);

  const serverAnswers = useCallback((x: Proposal) => (x.answers.length ? x.answers : screeningQuestions.map((q) => ({ question: q, answer: "" }))), [screeningQuestions]);
  const dirty = cover !== p.coverLetter
    || JSON.stringify(answers) !== JSON.stringify(serverAnswers(p))
    || bid !== (p.bid != null ? String(p.bid) : "")
    || duration !== (p.estimatedDuration ?? "")
    || JSON.stringify(portfolioIds) !== JSON.stringify(p.portfolioProjectIds ?? []);
  const locked = p.status === "submitted" || p.status === "discarded";
  const bidValid = bid === "" || Number.isFinite(Number(bid));

  // ---------- autosave ----------
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retries = useRef(0);
  const latest = useRef({ cover, answers, bid, duration, portfolioIds, dirty, locked, bidValid });
  latest.current = { cover, answers, bid, duration, portfolioIds, dirty, locked, bidValid };
  const inflight = useRef<Promise<boolean> | null>(null);

  const patchBody = () => {
    const l = latest.current;
    return JSON.stringify({ coverLetter: l.cover, answers: l.answers, bid: l.bid === "" ? null : Number(l.bid), estimatedDuration: l.duration, portfolioProjectIds: l.portfolioIds });
  };
  /** Save what is on screen now. Only the server copy is updated, never the text boxes, so typing is never overwritten. */
  const saveNow = useCallback(async (opts: { keepalive?: boolean } = {}): Promise<boolean> => {
    const l = latest.current;
    if (!l.dirty || l.locked || !l.bidValid) return true;
    clearTimeout(timer.current);
    const mine = ++seq.current;
    setSaveState("saving");
    const run = (async () => {
      try {
        const res = await fetch(`/api/proposals/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: patchBody(), keepalive: opts.keepalive });
        const body = (await res.json().catch(() => ({}))) as Proposal & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
        if (mine !== seq.current) return true; // a newer save is on its way
        setP(body); retries.current = 0; setSaveError(null); setSaveState("saved");
        if (body.coverLetter === latest.current.cover) clearCache(p.id);
        return true;
      } catch (e) {
        if (mine !== seq.current) return false;
        setSaveError((e as Error).message); setSaveState("retrying");
        const wait = Math.min(30_000, 2_000 * 2 ** retries.current++);
        timer.current = setTimeout(() => { void saveNow(); }, wait);
        return false;
      }
    })();
    inflight.current = run;
    return run;
  }, [p.id]);

  // Every change: keep a browser copy at once, save to the server a moment after typing stops.
  useEffect(() => {
    if (locked || !dirty) return;
    writeCache(p.id, { cover, answers, bid, duration, portfolioIds, savedAt: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saveNow(); }, AUTOSAVE_MS);
    return () => clearTimeout(timer.current);
  }, [cover, answers, bid, duration, portfolioIds]);

  // Leaving or hiding the tab: save straight away (keepalive lets the request finish after the page closes).
  useEffect(() => {
    const flush = () => { if (latest.current.dirty) void saveNow({ keepalive: true }); };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onHide); };
  }, [saveNow]);

  // On open: bring back edits this browser kept that never reached the server.
  useEffect(() => {
    const c = readCache(initial.id);
    if (!c || locked) return;
    const same = c.cover === initial.coverLetter && JSON.stringify(c.answers) === JSON.stringify(serverAnswers(initial))
      && c.bid === (initial.bid != null ? String(initial.bid) : "") && c.duration === (initial.estimatedDuration ?? "")
      && JSON.stringify(c.portfolioIds ?? initial.portfolioProjectIds ?? []) === JSON.stringify(initial.portfolioProjectIds ?? []);
    if (same || c.savedAt <= Date.parse(initial.updatedAt)) { clearCache(initial.id); return; }
    setCover(c.cover); setAnswers(c.answers.map((a) => ({ ...a }))); setBid(c.bid); setDuration(c.duration);
    if (c.portfolioIds) setPortfolioIds(c.portfolioIds);
    setRestored(c);
  }, []);
  const undoRestore = () => {
    setCover(p.coverLetter); setAnswers(serverAnswers(p).map((a) => ({ ...a })));
    setBid(p.bid != null ? String(p.bid) : ""); setDuration(p.estimatedDuration ?? ""); setPortfolioIds(p.portfolioProjectIds ?? []);
    clearCache(p.id); setRestored(null);
  };
  /** Before approve / preview / rewrite: make sure the server has exactly what is on screen. */
  const flushSave = async () => { if (inflight.current) await inflight.current; return latest.current.dirty ? saveNow() : true; };
  const changed = useMemo(() => percentChanged(p.originalDraft.replaceAll(LOOM_PLACEHOLDER, p.loomUrl ?? LOOM_PLACEHOLDER), cover), [p.originalDraft, p.loomUrl, cover]);

  const call = async (at: Action, url: string, init: RequestInit, done?: string) => {
    setBusy(at); setError(null); setOk(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = (await res.json().catch(() => ({}))) as Proposal & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setP(body); setCover(body.coverLetter); setLoom(body.loomUrl ?? "");
      if (body.answers.length) setAnswers(body.answers.map((a) => ({ ...a })));
      setBid(body.bid != null ? String(body.bid) : ""); setDuration(body.estimatedDuration ?? ""); setPortfolioIds(body.portfolioProjectIds ?? []);
      clearCache(body.id); setRestored(null);
      if (done) setOk(done);
      router.refresh();
      return true;
    } catch (e) {
      setError({ at, msg: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  };
  // Restructures the draft to ≤ 900 chars server-side (~30-60s). No body; returns the updated proposal.
  const rewrite = async () => {
    if (!confirm("Rewriting replaces the current text with a shorter version. Continue?")) return;
    await flushSave();
    call("rewrite", `/api/proposals/${p.id}/rewrite`, { method: "POST" }, "Rewritten shorter");
  };
  const act = async (a: Exclude<Action, "save" | "rewrite">, body?: object, done?: string) => {
    if (a !== "discard" && !(await flushSave())) { setError({ at: a, msg: "Your latest edits are not saved yet - check the connection and try again." }); return false; }
    return call(a, `/api/proposals/${p.id}/${a}`, { method: "POST", body: JSON.stringify(body ?? {}) }, done);
  };

  // Stepper (a Loom video is optional, so it is not a step - David, 2026-10-20)
  const has = (...s: Proposal["status"][]) => s.includes(p.status);
  const canApprove = has("ready", "needs_loom", "draft");
  const steps = [
    { label: "Draft", done: true },
    { label: "Approved", done: has("approved", "previewed", "submitted") },
    { label: "Preview", done: has("previewed", "submitted") },
    { label: "Submitted", done: has("submitted") },
  ];
  const current = steps.findIndex((s) => !s.done);
  const st = PROPOSAL_STATUS[p.status] ?? { label: p.status, cls: "pill-neutral" };
  const upwork = (p.preview?.upwork ?? null) as Record<string, unknown> | null;
  const r = p.research;
  const err = (at: Action) => error?.at === at && <p role="alert" className="mt-3 rounded-[12px] bg-[var(--color-bad-soft)] p-3 text-[14px] text-[var(--color-bad)]">{error.msg}</p>;

  return (
    <div className="grid gap-4">
      {/* Stepper */}
      <section className="card p-4 md:p-5" aria-label="Progress">
        <ol className="grid grid-cols-4 gap-1.5">
          {steps.map((s, i) => {
            const isCur = i === current && !locked;
            return (
              <li key={s.label} className="min-w-0" aria-current={isCur ? "step" : undefined}>
                <div className={`h-1.5 rounded-full ${s.done ? "bg-[var(--color-good)]" : isCur ? "bg-[var(--color-ink)]" : "bg-[var(--color-line)]"}`} />
                <p className={`mt-2 flex items-center gap-1 truncate text-[12px] font-medium sm:text-[14px] ${s.done ? "text-[var(--color-good)]" : isCur ? "text-[var(--color-ink)]" : "text-[var(--color-faint)]"}`}>
                  {s.done && <IconCheck size={14} className="hidden shrink-0 sm:block" />}{s.label}
                </p>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4 text-[14px]">
          <span className={`pill ${st.cls}`}>{st.label}</span>
          <span className="text-[var(--color-muted)]">Nothing is sent to Upwork until you submit here.</span>
        </div>
      </section>

      {p.status === "discarded" && <Note>This draft was discarded. It is kept for the feedback loop and can still be read.</Note>}
      {p.status === "submitted" && <Note tone="good">Submitted to Upwork {p.submittedAt ? fmtDateTime(p.submittedAt) : ""}. Follow the client conversation in Closer.</Note>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        {/* Left: the text */}
        <div className="grid min-w-0 gap-4">
          <section className="card p-5 md:p-6" aria-labelledby="cl-h">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="cl-h" className="display text-[20px] font-semibold">Cover letter</h2>
              <span className="flex items-center gap-2">
                <span className={`pill num ${changed === 0 ? "pill-neutral" : changed < 25 ? "pill-info" : "pill-warn"}`} title="Share of words changed compared with the original AI draft">{changed}% changed</span>
                {!locked && (
                  <button type="button" className="btn btn-sm" onClick={rewrite} disabled={busy !== null} aria-busy={busy === "rewrite"}
                    title="Restructure the draft and cut it to about 900 characters">
                    {busy === "rewrite" ? <><Spinner />Rewriting…</> : <><IconRefresh size={16} />Rewrite shorter</>}
                  </button>
                )}
                <CopyButton text={cover} />
              </span>
            </div>
            {busy === "rewrite" && <p className="mt-3 text-[13px] text-[var(--color-muted)]" aria-live="polite">Rewriting - this usually takes 30 to 60 seconds.</p>}
            {err("rewrite")}
            {ok === "Rewritten shorter" && busy === null && <p className="mt-3 inline-flex items-center gap-1.5 text-[14px] text-[var(--color-good)]"><IconCheck size={16} />Rewritten shorter. Review it, then save or approve as usual.</p>}
            {restored && (
              <Note tone="warn" className="mt-3">Restored edits this browser kept from {fmtDateTime(new Date(restored.savedAt).toISOString())} that never reached the server. They save now.{" "}
                <button type="button" className="underline" onClick={undoRestore}>Undo</button></Note>
            )}
            {cover.includes(LOOM_PLACEHOLDER) && <Note className="mt-3">No Loom yet: attaching a link fills the {LOOM_PLACEHOLDER} line; approving without one removes the line.</Note>}
            <textarea
              aria-label="Cover letter" className="input mt-4 min-h-[340px] py-3 leading-relaxed md:min-h-[440px]" value={cover} maxLength={MAX} disabled={locked}
              onChange={(e) => setCover(e.target.value)}
            />
            <PlaceholderWarning text={cover} />
            <p className={`num mt-1.5 text-right text-[13px] ${cover.length > MAX * 0.95 ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]"}`}>{cover.length.toLocaleString()} / {MAX.toLocaleString()}</p>
          </section>

          {answers.length > 0 && (
            <section className="card p-5 md:p-6" aria-labelledby="qa-h">
              <h2 id="qa-h" className="display text-[20px] font-semibold">Screening answers</h2>
              <div className="mt-4 grid gap-4">
                {answers.map((a, i) => (
                  <label key={i} className="field">
                    <span className="text-[14px] text-[var(--color-ink)]">{i + 1}. {a.question}</span>
                    <textarea className="input min-h-[110px] py-3 leading-relaxed" value={a.answer} disabled={locked}
                      onChange={(e) => setAnswers(answers.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
                    <PlaceholderWarning text={a.answer} />
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="card p-5 md:p-6" aria-labelledby="terms-h">
            <h2 id="terms-h" className="display text-[20px] font-semibold">Terms</h2>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <label className="field"><span>Bid ($, hourly rate or fixed total)</span>
                <input className="input num" type="number" min="0" step="1" inputMode="decimal" value={bid} disabled={locked} onChange={(e) => setBid(e.target.value)} placeholder="e.g. 120" />
                {!bidValid && <span className="text-[13px] text-[var(--color-bad)]">Enter a number</span>}</label>
              <label className="field"><span>Estimated duration</span>
                <input className="input" value={duration} disabled={locked} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 1 to 3 months" /></label>
            </div>
            {connectsCost != null && <p className="mt-3 text-[14px] text-[var(--color-muted)]">This job costs {connectsCost} Connects to apply.</p>}
          </section>

          <PortfolioCard jobId={p.jobId} initial={portfolio} ids={portfolioIds} setIds={setPortfolioIds} cover={cover} setCover={setCover} locked={locked} />

          {!locked && (
            <div className="flex flex-wrap items-center gap-2 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[14px]" aria-live="polite">
              {saveState === "saving" || (dirty && saveState !== "retrying")
                ? <span className="inline-flex items-center gap-1.5 text-[var(--color-muted)]"><Spinner />Saving…</span>
                : saveState === "retrying"
                  ? <span className="text-[var(--color-warn)]">Not saved yet - kept in this browser, retrying. {saveError}</span>
                  : <span className="inline-flex items-center gap-1.5 text-[var(--color-good)]"><IconCheck size={16} />All changes saved</span>}            </div>
          )}
        </div>

        {/* Right: research + gate */}
        <div className="grid min-w-0 gap-4">
          <section className="card p-5 md:p-6" aria-labelledby="gate-h">
            <h2 id="gate-h" className="display text-[20px] font-semibold">Send it</h2>
            <p className="mt-1 text-[14px] text-[var(--color-muted)]">Three steps, each one yours. Nothing is sent to Upwork until you submit here.</p>

            {/* Loom (optional) */}
            <div className="mt-5 border-t border-[var(--color-line)] pt-4">
              <p className="flex items-center gap-2 font-medium"><Num n={0} done={!!p.loomUrl} />Loom video <span className="text-[13px] font-normal text-[var(--color-muted)]">optional, usually preferred</span></p>
              <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); act("loom", { url: loom.trim() }, "Loom attached"); }}>
                <label className="sr-only" htmlFor="loom">Loom share link</label>
                <input id="loom" className="input" type="url" inputMode="url" value={loom} disabled={locked} onChange={(e) => setLoom(e.target.value)} placeholder="https://www.loom.com/share/…" />
                {loom && !LOOM_RE.test(loom.trim()) && <span className="text-[13px] text-[var(--color-warn)]">Paste a Loom share link or a short link that redirects to one</span>}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="btn btn-sm" disabled={locked || busy === "loom" || !LOOM_RE.test(loom.trim()) || loom.trim() === p.loomUrl}>
                    {busy === "loom" ? <Spinner /> : <IconLink size={16} />}{p.loomUrl ? "Replace Loom" : "Attach Loom"}
                  </button>
                  {p.loomUrl && <a className="btn btn-sm btn-ghost" href={p.loomUrl} target="_blank" rel="noopener noreferrer">Watch <IconExternal size={14} /></a>}
                </div>
              </form>
              {err("loom")}
            </div>

            {/* 2. Approve */}
            <div className="mt-4 border-t border-[var(--color-line)] pt-4">
              <p className="flex items-center gap-2 font-medium"><Num n={1} done={has("approved", "previewed", "submitted")} />Approve the final text</p>
              <button type="button" className="btn btn-sm mt-3" disabled={locked || !canApprove || busy === "approve"} onClick={() => act("approve", undefined, "Approved")}>
                {busy === "approve" ? <Spinner /> : <IconCheck size={16} />}{has("approved", "previewed") ? `Approved ${p.approvedAt ? fmtDateTime(p.approvedAt) : ""}` : "Approve"}
              </button>
              <p className="mt-2 text-[13px] text-[var(--color-muted)]">{canApprove ? `Approving saves your latest edits first and records how much you edited the draft.${p.loomUrl ? "" : " No Loom attached: the Loom line is removed from the letter."}` : ""}</p>
              {err("approve")}
            </div>

            {/* 3. Preview */}
            <div className="mt-4 border-t border-[var(--color-line)] pt-4">
              <p className="flex items-center gap-2 font-medium"><Num n={2} done={has("previewed", "submitted")} />Build Upwork preview</p>
              <button type="button" className="btn btn-sm mt-3" disabled={locked || p.status !== "approved" || busy === "preview"} onClick={() => act("preview", undefined, "Preview ready")}>
                {busy === "preview" ? <><Spinner />Building…</> : "Build Upwork preview"}
              </button>
              <p className="mt-2 text-[13px] text-[var(--color-muted)]">Asks Upwork for the Connects cost, your balance and any unmet requirements. Does not submit.</p>
              {err("preview")}
            </div>

            {/* 3b. Boost (optional) */}
            {p.status === "previewed" && <BoostStep p={p} busy={busy === "boost"} onSet={(connects) => act("boost", { connects }, connects == null ? "Boost removed" : `Boost set to ${connects} Connects`)} error={err("boost")} />}

            {/* 4. Submit */}
            <div className="mt-4 border-t border-[var(--color-line)] pt-4">
              <p className="flex items-center gap-2 font-medium"><Num n={3} done={has("submitted")} />Submit</p>
              {!confirming ? (
                <button type="button" className="btn btn-accent mt-3" disabled={locked || p.status !== "previewed"} onClick={() => { setConfirming(true); setTyped(""); }}>
                  <IconSend size={16} />Submit to Upwork…
                </button>
              ) : (
                <form className="mt-3 grid gap-2 rounded-[14px] bg-[var(--color-sunken)] p-3" onSubmit={(e) => { e.preventDefault(); act("submit", { confirm: typed }, "Submitted").then((ok) => ok && setConfirming(false)); }}>
                  <label htmlFor="confirm" className="text-[14px]">This spends Connects and sends the proposal to the client{p.preview?.boostConnects ? <>, with a <b>{String(p.preview.boostConnects)}-Connect boost</b> bid</> : null}. Type <b>SUBMIT</b> to confirm.</label>
                  <input id="confirm" className="input" autoFocus autoComplete="off" autoCapitalize="characters" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="SUBMIT" />
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className="btn btn-accent" disabled={typed !== "SUBMIT" || busy === "submit"}>{busy === "submit" ? <><Spinner />Submitting…</> : "Submit proposal"}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
                  </div>
                </form>
              )}
              {err("submit")}
            </div>

            {!locked && (
              <div className="mt-5 border-t border-[var(--color-line)] pt-4">
                <button type="button" className="btn btn-sm btn-ghost btn-danger" disabled={busy === "discard"}
                  onClick={() => confirm("Discard this draft? It stays in the list as discarded.") && act("discard", undefined, "Discarded")}>
                  {busy === "discard" ? <Spinner /> : null}Discard draft
                </button>
                {err("discard")}
              </div>
            )}
          </section>

          {upwork && <PreviewPanel data={upwork} />}

          {r && (
            <section className="card p-5 md:p-6" aria-labelledby="res-h">
              <h2 id="res-h" className="display text-[20px] font-semibold">Research</h2>
              <div className="mt-4 grid gap-4 text-[15px]">
                <div className="grid grid-cols-2 gap-3">
                  <Kv label="Contact">{r.contactName ?? "Unknown"}{r.contactSource && <span className="block text-[13px] text-[var(--color-muted)]">{r.contactSource}</span>}</Kv>
                  <Kv label="Company">{r.company ?? "Unknown"} <span className={`pill ml-1 align-middle ${r.companyConfidence === "confirmed" ? "pill-good" : r.companyConfidence === "likely" ? "pill-warn" : "pill-neutral"}`}>{r.companyConfidence}</span></Kv>
                  {r.contactRole && (
                    <div className="col-span-2"><Kv label="Contact role">
                      <span className="pill pill-info">{CONTACT_ROLE_LABELS[r.contactRole] ?? r.contactRole}</span>
                      {r.roleEvidence && <span className="mt-1 block text-[13px] text-[var(--color-muted)]">{r.roleEvidence}</span>}
                    </Kv></div>
                  )}
                </div>
                {r.bigFish && (
                  <div className="rounded-[14px] bg-[var(--color-good-soft)] p-4">
                    <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-good)]">Big fish</p>
                    <p className="mt-1 leading-relaxed">{r.bigFish}</p>
                  </div>
                )}
                {r.hiddenProblems.length > 0 && <Kv label="Hidden problems"><Bullets items={r.hiddenProblems} tone="warn" /></Kv>}
                {r.whyNotSolvedInternally && <Kv label="Why they haven't solved it in-house">{r.whyNotSolvedInternally}</Kv>}
                {r.companySignals.length > 0 && <Kv label="Company signals"><Bullets items={r.companySignals} /></Kv>}
                {r.assumptions.length > 0 && <Kv label="Assumptions to verify"><Bullets items={r.assumptions} /></Kv>}
              </div>
            </section>
          )}

          <section className="card p-5 md:p-6">
            <FeedbackButtons kind="draft" refId={String(p.id)} label="Good draft?" />
            <p className="mt-3 text-[13px] text-[var(--color-faint)]">
              {p.model ? `Written by ${p.model}` : ""}{p.promptVersion != null ? ` · prompt v${p.promptVersion}` : ""} · created {fmtDateTime(p.createdAt)} · <Link className="underline" href={`/jobs/${encodeURIComponent(p.jobId)}`}>job details</Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * Portfolio items for this proposal. Upwork portfolio items are real attachments (saved as portfolioProjectIds and
 * sent with the Upwork preview). Portfolio-site projects can't be attached by Upwork, so "Add to letter" puts a
 * "Similar work:" line with the link into the cover letter, where David can see and edit it. Both autosave.
 */
function PortfolioCard({ jobId, initial, ids, setIds, cover, setCover, locked }: {
  jobId: string; initial: PortfolioChoices; ids: string[]; setIds: (v: string[]) => void;
  cover: string; setCover: (v: string) => void; locked: boolean;
}) {
  const [choices, setChoices] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const { items, checkedAt, canRefresh } = choices.upwork;
  const unknown = ids.filter((id) => !items.some((i) => i.id === id));
  const relevant = choices.site.relevant.map((id) => choices.site.projects.find((p) => p.id === id)).filter((p): p is PortfolioChoices["site"]["projects"][number] => !!p);
  const others = choices.site.projects.filter((p) => !choices.site.relevant.includes(p.id) && (!filter.trim() || `${p.title} ${p.summary}`.toLowerCase().includes(filter.trim().toLowerCase())));
  const inLetter = choices.site.projects.filter((p) => hasProjectLink(cover, p.url)).length;

  const toggleId = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const refresh = async () => {
    setRefreshing(true); setRefreshError(null);
    try {
      const res = await fetch(`/api/portfolio?jobId=${encodeURIComponent(jobId)}&refresh=1`);
      const body = (await res.json().catch(() => ({}))) as PortfolioChoices & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Refresh failed (${res.status})`);
      setChoices(body);
    } catch (e) { setRefreshError((e as Error).message); } finally { setRefreshing(false); }
  };

  const projectRow = (pr: PortfolioChoices["site"]["projects"][number], best: boolean) => {
    const added = hasProjectLink(cover, pr.url);
    return (
      <li key={pr.id} className="flex items-start gap-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="break-words">{pr.title}</span>
            {best && <span className="pill pill-info">Matches this job</span>}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-[var(--color-muted)]">{pr.summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <a className="btn btn-sm btn-ghost" href={pr.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${pr.title}`}><IconExternal size={14} /></a>
          <button type="button" className={`btn btn-sm ${added ? "" : "btn-ghost"}`} disabled={locked} aria-pressed={added}
            onClick={() => setCover(added ? removeProjectLink(cover, pr.url) : addProjectLink(cover, pr))}>
            {added ? <><IconCheck size={14} />In letter</> : "Add to letter"}
          </button>
        </div>
      </li>
    );
  };

  return (
    <section className="card p-5 md:p-6" aria-labelledby="pf-h">
      <h2 id="pf-h" className="display text-[20px] font-semibold">Portfolio</h2>
      <p className="mt-1 text-[14px] text-[var(--color-muted)]">Attach items from your Upwork portfolio, or add links to projects from your portfolio site.</p>

      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Upwork portfolio items <span className="text-[13px] font-normal text-[var(--color-muted)]">attached to the proposal</span></p>
          {canRefresh && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={refresh} disabled={refreshing} aria-busy={refreshing} title="Read the list from your Upwork profile again (one Upwork call)">
              {refreshing ? <Spinner /> : <IconRefresh size={14} />}Refresh
            </button>
          )}
        </div>
        {items.length > 0 || unknown.length > 0 ? (
          <ul className="mt-2 grid gap-1.5">
            {items.map((it) => (
              <li key={it.id}>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[12px] px-2 hover:bg-[var(--color-sunken)]">
                  <input type="checkbox" className="size-4 shrink-0" checked={ids.includes(it.id)} disabled={locked} onChange={() => toggleId(it.id)} />
                  <span className="min-w-0 break-words">{it.title}</span>
                </label>
              </li>
            ))}
            {unknown.map((id) => (
              <li key={id}>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[12px] px-2 hover:bg-[var(--color-sunken)]">
                  <input type="checkbox" className="size-4 shrink-0" checked disabled={locked} onChange={() => toggleId(id)} />
                  <span className="min-w-0 break-words text-[var(--color-warn)]">Item {id} - no longer on your Upwork profile; untick to remove</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <Note className="mt-2">
            Your Upwork profile has no portfolio items Upwork can attach{checkedAt ? ` (checked ${fmtDateTime(checkedAt)})` : ""}.
            Add them on Upwork under Profile → Portfolio, then press Refresh. Until then, add project links to the letter below.
          </Note>
        )}
        {refreshError && <p role="alert" className="mt-2 text-[13px] text-[var(--color-bad)]">{refreshError}</p>}
        {ids.length > 0 && <p className="mt-2 text-[13px] text-[var(--color-muted)]">{ids.length} attached. They go to Upwork with the preview; changing them after approval asks for a fresh approval.</p>}
      </div>

      <div className="mt-5 border-t border-[var(--color-line)] pt-4">
        <p className="font-medium">Portfolio-site projects <span className="text-[13px] font-normal text-[var(--color-muted)]">added to the letter as a link{inLetter ? ` · ${inLetter} in the letter` : ""}</span></p>
        {relevant.length > 0 && <ul className="divide-row mt-1">{relevant.map((pr) => projectRow(pr, true))}</ul>}
        <details className="mt-2" open={relevant.length === 0}>
          <summary className="cursor-pointer text-[14px] font-medium text-[var(--color-muted)]">{relevant.length ? "All other projects" : "All projects"} ({choices.site.projects.length - relevant.length})</summary>
          <label className="sr-only" htmlFor="pf-filter">Filter projects</label>
          <input id="pf-filter" className="input mt-3" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title or topic" />
          <ul className="divide-row mt-1 max-h-[420px] overflow-auto">{others.map((pr) => projectRow(pr, false))}</ul>
          {others.length === 0 && <p className="mt-2 text-[13px] text-[var(--color-muted)]">No project matches that filter.</p>}
        </details>
      </div>
    </section>
  );
}

/** Step number; n = 0 is the optional Loom row (shown as a link icon, never a number). */
function Num({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${done ? "bg-[var(--color-good)] text-[var(--color-surface)]" : "bg-[var(--color-control)] text-[var(--color-ink)]"}`}>
      {done ? <IconCheck size={13} /> : n === 0 ? <IconLink size={13} /> : n}
    </span>
  );
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[13px] font-medium text-[var(--color-muted)]">{label}</p>
      <div className="break-words leading-relaxed">{children}</div>
    </div>
  );
}

/**
 * Optional Connects boost for a top slot on the client's list (Upwork charges it only if the proposal lands in a paid
 * slot or the client engages before the auction closes). Shows Upwork's minimum, maximum and the competing bids; setting
 * or removing a boost rebuilds the Upwork preview, so the SUBMIT tap confirms exactly what is shown.
 */
function BoostStep({ p, busy, onSet, error }: { p: Proposal; busy: boolean; onSet: (connects: number | null) => void; error: ReactNode }) {
  const b = (p.preview?.boost ?? null) as { available: boolean; reason: string | null; skip: boolean; recommended: number | null; max: number | null; topBids: number[] | null; note: string | null } | null;
  const current = (p.preview?.boostConnects as number | null | undefined) ?? null;
  const [amount, setAmount] = useState(current != null ? String(current) : b?.recommended != null ? String(b.recommended) : "");
  const n = Number(amount);
  const valid = amount.trim() !== "" && Number.isInteger(n) && n >= Math.max(1, b?.recommended ?? 1) && (b?.max == null || n <= b.max);
  return (
    <div className="mt-4 border-t border-[var(--color-line)] pt-4">
      <p className="flex items-center gap-2 font-medium"><Num n={0} done={current != null} />Boost <span className="text-[13px] font-normal text-[var(--color-muted)]">optional, extra Connects for a top slot</span></p>
      {!b ? <p className="mt-2 text-[13px] text-[var(--color-muted)]">Upwork's preview has no boost details for this job.</p>
        : !b.available ? <p className="mt-2 text-[13px] text-[var(--color-muted)]">Boosting isn't available on this job{b.reason ? `: ${b.reason}` : ""}.</p>
        : (
          <>
            {b.skip && <p className="mt-2 text-[13px] text-[var(--color-warn)]">Upwork advises against boosting this one.</p>}
            <p className="mt-2 text-[13px] text-[var(--color-muted)]">
              {b.topBids == null ? "Current bids unknown." : b.topBids.length ? `Current top bids: ${b.topBids.join(", ")} Connects.` : "No one has boosted yet."}
              {b.recommended != null ? ` Minimum for a top slot: ${b.recommended}.` : ""}{b.max != null ? ` Most you can bid: ${b.max}.` : ""}
            </p>
            {b.note && <p className="mt-1 text-[13px] text-[var(--color-muted)]">{b.note}</p>}
            <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) onSet(n); }}>
              <label className="field w-[140px]"><span>Connects</span>
                <input className="input num" type="number" min={Math.max(1, b.recommended ?? 1)} max={b.max ?? undefined} step="1" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <button type="submit" className="btn btn-sm" disabled={busy || !valid || n === current}>{busy ? <><Spinner />Updating…</> : current != null ? "Change boost" : "Boost"}</button>
              {current != null && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onSet(null)}>Remove boost</button>}
            </form>
            <p className="mt-2 text-[13px] text-[var(--color-muted)]">{current != null ? `Boosted with ${current} Connects. ` : ""}Rebuilds the Upwork preview; nothing is sent until you submit.</p>
          </>
        )}
      {error}
    </div>
  );
}

const HIGHLIGHT: [string, string][] = [["connects_cost", "Connects cost"], ["connects_balance", "Connects balance"], ["boost", "Boost"], ["unmet_preferred_qualifications", "Unmet preferred qualifications"]];

/** Upwork's raw preview: the known fields first, then any other scalar fields, then the whole JSON. */
function PreviewPanel({ data }: { data: Record<string, unknown> }) {
  const flat: Record<string, unknown> = { ...((data.preview as Record<string, unknown>) ?? {}), ...data };
  const show = (v: unknown) => (v == null ? "—" : typeof v === "object" ? (Array.isArray(v) ? (v.length ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : "None") : JSON.stringify(v)) : String(v));
  const known = HIGHLIGHT.filter(([k]) => k in flat);
  const rest = Object.entries(flat).filter(([k, v]) => !HIGHLIGHT.some(([h]) => h === k) && k !== "preview" && (v == null || typeof v !== "object"));
  return (
    <section className="card p-5 md:p-6" aria-labelledby="pv-h">
      <h2 id="pv-h" className="display text-[20px] font-semibold">Upwork preview</h2>
      {known.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-3">
          {known.map(([k, label]) => (
            <div key={k} className={`rounded-[14px] bg-[var(--color-sunken)] p-3 ${k === "unmet_preferred_qualifications" || k === "boost" ? "col-span-2" : ""}`}>
              <dt className="text-[13px] text-[var(--color-muted)]">{label}</dt>
              <dd className={`mt-0.5 break-words font-semibold ${k.startsWith("connects") ? "display num text-[26px]" : "text-[15px]"}`}>{show(flat[k])}</dd>
            </div>
          ))}
        </dl>
      )}
      {rest.length > 0 && (
        <dl className="mt-4 divide-row text-[14px]">
          {rest.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-2">
              <dt className="text-[var(--color-muted)]">{k.replaceAll("_", " ")}</dt>
              <dd className="min-w-0 break-words text-right font-medium">{show(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-[14px] font-medium text-[var(--color-muted)]">Raw preview JSON</summary>
        <pre className="mt-2 max-h-[320px] overflow-auto rounded-[12px] bg-[var(--color-sunken)] p-3 text-[12px] leading-relaxed">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </section>
  );
}

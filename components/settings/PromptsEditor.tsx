"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCheck } from "@/components/icons";
import { Note, Spinner } from "@/components/ui/bits";
import { fmtDateTime } from "@/lib/format";

interface PromptInfo {
  name: string;
  active: { body: string; version: number | null };
  versions: { id: number; note: string | null; active: boolean; createdAt: string }[];
  default: string;
}

const LABEL: Record<string, string> = {
  job_ranking: "Job ranking", proposal: "Proposal writer", closer: "Closer", profile_coach: "Profile coach", monthly_review: "Monthly review",
};

/** Versioned system prompts: edit, save as a new active version with a note, roll back, or reset to the default text. */
export function PromptsEditor() {
  const [list, setList] = useState<PromptInfo[] | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (keep?: string) => {
    const r = await fetch("/api/prompts", { cache: "no-store" });
    if (!r.ok) { setMsg({ ok: false, text: `Could not load prompts (${r.status})` }); return; }
    const data = (await r.json()) as PromptInfo[];
    setList(data);
    const cur = data.find((p) => p.name === (keep ?? name)) ?? data[0];
    if (cur) { setName(cur.name); setBody(cur.active.body); }
  }, [name]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = list?.find((p) => p.name === name);
  const dirty = !!cur && body !== cur.active.body;

  const save = async (text: string, n: string) => {
    setBusy("save"); setMsg(null);
    const r = await fetch("/api/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, body: text, note: n || undefined }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!r.ok) { setMsg({ ok: false, text: j.error ?? "Save failed" }); return; }
    setNote(""); setMsg({ ok: true, text: "Saved as the new active version" });
    load(name);
  };
  const activate = async (id: number) => {
    setBusy(`v${id}`); setMsg(null);
    const r = await fetch("/api/prompts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setBusy(null);
    if (!r.ok) { setMsg({ ok: false, text: "Could not activate" }); return; }
    setMsg({ ok: true, text: "Version activated" });
    load(name);
  };

  return (
    <section className="card min-w-0 p-5 md:p-6 lg:col-span-2" aria-labelledby="pr-h">
      <h2 id="pr-h" className="display text-[20px] font-semibold">Prompts</h2>
      <p className="mt-1 text-[14px] text-[var(--color-muted)]">The instructions each assistant follows. Every save is a new version; drafts record which version wrote them, so you can compare and roll back.</p>
      {!list ? <div className="mt-5 flex items-center gap-2 text-[var(--color-muted)]"><Spinner />Loading prompts…</div> : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid min-w-0 gap-3">
            <div className="seg w-full" role="tablist" aria-label="Prompt">
              {list.map((p) => (
                <button key={p.name} type="button" role="tab" aria-selected={p.name === name} className="seg-item flex-1 justify-center"
                  onClick={() => { if (dirty && !confirm("Discard unsaved changes to this prompt?")) return; setName(p.name); setBody(p.active.body); setMsg(null); }}>
                  {LABEL[p.name] ?? p.name}
                </button>
              ))}
            </div>
            <textarea aria-label={`${LABEL[name] ?? name} prompt`} className="input min-h-[360px] py-3 font-mono text-[13px] leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="What changed? (version note)" aria-label="Version note" />
              <button type="button" className="btn btn-dark shrink-0" disabled={!dirty || busy === "save"} onClick={() => save(body, note)}>{busy === "save" ? <Spinner /> : null}Save version</button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-sm" disabled={!cur || cur.active.body === cur.default || busy === "save"}
                onClick={() => cur && confirm("Save the built-in default text as a new active version?") && save(cur.default, "Reset to default")}>Reset to default</button>
              <span className="num text-[13px] text-[var(--color-muted)]">{body.length.toLocaleString()} chars · active {cur?.active.version != null ? `v${cur.active.version}` : "default"}</span>
              {dirty && <span className="text-[13px] text-[var(--color-warn)]">Unsaved</span>}
            </div>
            {msg && <Note tone={msg.ok ? "good" : "bad"}>{msg.text}</Note>}
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-[13px] font-medium text-[var(--color-muted)]">Versions</p>
            {cur?.versions.length ? (
              <ul className="divide-row rounded-[16px] border border-[var(--color-line)] px-3">
                {cur.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{v.note || `Version ${v.id}`}</span>
                      <span className="text-[12px] text-[var(--color-muted)]">#{v.id} · {fmtDateTime(v.createdAt)}</span>
                    </span>
                    {v.active
                      ? <span className="pill pill-good shrink-0"><IconCheck size={13} />Active</span>
                      : <button type="button" className="btn btn-sm shrink-0" disabled={busy === `v${v.id}`} onClick={() => activate(v.id)}>Activate</button>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-[14px] text-[var(--color-muted)]">No saved versions; the built-in default is in use.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconClose } from "@/components/icons";
import type { SavedSearch } from "@/lib/types";

type Draft = Omit<SavedSearch, "id" | "createdAt">;
const empty: Draft = {
  kind: "search", name: "", enabled: true, skills: [], query: "", jobType: "ANY", minHourly: null, minBudget: null,
  experienceLevel: "ANY", verifiedPaymentOnly: true, maxProposals: null, excludeKeywords: [], excludeCountries: [],
};

/**
 * Drawer for creating or editing a feed. Lists are comma-separated in the form. Most Recent / Best Matches
 * feeds are Upwork's own views, so only the post-filters (verified payment, max proposals, exclusions) apply.
 */
export function SearchEditor({ initial, onClose }: { initial: SavedSearch | null; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(initial ?? empty);
  const [skills, setSkills] = useState((initial?.skills ?? []).join(", "));
  const [exKw, setExKw] = useState((initial?.excludeKeywords ?? []).join(", "));
  const [exCo, setExCo] = useState((initial?.excludeCountries ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const body = { ...d, skills, excludeKeywords: exKw, excludeCountries: exCo };
    const res = await fetch(initial ? `/api/searches/${initial.id}` : "/api/searches", {
      method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) { setError(((await res.json()) as { error: string }).error); return; }
    router.refresh();
    onClose();
  };
  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[var(--scrim)]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="se-title" onSubmit={submit}
        className="flex h-full w-full max-w-[520px] flex-col overflow-y-auto bg-[var(--color-surface)] p-6 shadow-[var(--shadow-pop)] md:p-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 id="se-title" className="display text-[22px] font-semibold">{initial ? "Edit feed" : "New feed"}</h2>
          <button type="button" aria-label="Close" className="icon-btn hover:bg-[var(--color-control)]" onClick={onClose}><IconClose size={20} /></button>
        </div>
        <div className="grid gap-4">
          <label className="field"><span>Name</span><input className="input" required autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Voice & AI agents" /></label>
          <fieldset>
            <p className="mb-2 text-[13px] font-medium text-[var(--color-muted)]">Feed type</p>
            <div className="seg w-full" role="radiogroup" aria-label="Feed type">
              {([["search", "Search"], ["most_recent", "Most Recent"], ["best_match", "Best Matches"]] as const).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={d.kind === k} aria-pressed={d.kind === k} className="seg-item flex-1 justify-center" onClick={() => setD({ ...d, kind: k })}>{l}</button>
              ))}
            </div>
            {d.kind !== "search" && <p className="mt-2 text-[14px] text-[var(--color-muted)]">{d.kind === "most_recent" ? "Your Most Recent tab." : "Upwork's Best Matches for your profile."} Upwork picks the jobs; the filters below are applied afterwards.</p>}
            {initial?.sourceUrl && <p className="mt-2 truncate text-[13px] text-[var(--color-faint)]" title={initial.sourceUrl}>Imported from {initial.sourceUrl}</p>}
          </fieldset>
          {d.kind === "search" && <>
          <label className="field"><span>Skills (comma-separated, any of them)</span><input className="input" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Python, OpenAI API, Retell AI" /></label>
          <label className="field"><span>Search words (optional)</span><input className="input" value={d.query} onChange={(e) => setD({ ...d, query: e.target.value })} placeholder="voice agent" /></label>
          </>}
          <div className="grid grid-cols-2 gap-4">
            {d.kind === "search" && <>
            <label className="field"><span>Job type</span>
              <select className="input" value={d.jobType} onChange={(e) => setD({ ...d, jobType: e.target.value as Draft["jobType"] })}>
                <option value="ANY">Any</option><option value="HOURLY">Hourly</option><option value="FIXED">Fixed price</option>
              </select></label>
            <label className="field"><span>Experience level</span>
              <select className="input" value={d.experienceLevel} onChange={(e) => setD({ ...d, experienceLevel: e.target.value as Draft["experienceLevel"] })}>
                <option value="ANY">Any</option><option value="ENTRY_LEVEL">Entry</option><option value="INTERMEDIATE">Intermediate</option><option value="EXPERT">Expert</option>
              </select></label>
            <label className="field"><span>Min hourly rate ($)</span><input className="input num" type="number" min="0" value={d.minHourly ?? ""} onChange={(e) => setD({ ...d, minHourly: num(e.target.value) })} /></label>
            <label className="field"><span>Min fixed budget ($)</span><input className="input num" type="number" min="0" value={d.minBudget ?? ""} onChange={(e) => setD({ ...d, minBudget: num(e.target.value) })} /></label>
            </>}
            <label className="field"><span>Max proposals</span><input className="input num" type="number" min="0" value={d.maxProposals ?? ""} onChange={(e) => setD({ ...d, maxProposals: num(e.target.value) })} placeholder="e.g. 30" /></label>
            <label className="mt-6 flex items-center gap-3"><input type="checkbox" className="size-4" checked={d.verifiedPaymentOnly} onChange={(e) => setD({ ...d, verifiedPaymentOnly: e.target.checked })} />Payment-verified clients only</label>
          </div>
          <label className="field"><span>Exclude keywords</span><input className="input" value={exKw} onChange={(e) => setExKw(e.target.value)} placeholder="wordpress, seo" /></label>
          <label className="field"><span>Exclude client countries</span><input className="input" value={exCo} onChange={(e) => setExCo(e.target.value)} placeholder="Country names, comma-separated" /></label>
          <label className="flex items-center gap-3"><input type="checkbox" className="size-4" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />Active (polled every few minutes)</label>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl bg-[var(--color-bad-soft)] p-3 text-[14px] text-[var(--color-bad)]">{error}</p>}
        <div className="mt-auto flex justify-end gap-2.5 pt-8">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-dark" disabled={busy}>{busy ? "Saving…" : initial ? "Save changes" : "Create feed"}</button>
        </div>
      </form>
    </div>
  );
}

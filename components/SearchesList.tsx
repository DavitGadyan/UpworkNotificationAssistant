"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { IconBriefcase, IconDots, IconPlus, IconStar, IconUser } from "@/components/icons";
import { SearchEditor } from "@/components/SearchEditor";
import type { SavedSearch } from "@/lib/types";

type Stat = { total: number; matchRate: number; notified: number };

export const KIND_LABEL: Record<SavedSearch["kind"], string> = { most_recent: "Most Recent", best_match: "Best Matches", search: "Search" };

/** Feed cards (device-card anatomy) with pause/edit/delete, plus the editor drawer. */
export function SearchesList({ searches, stats }: { searches: SavedSearch[]; stats: Record<number, Stat> }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [editing, setEditing] = useState<SavedSearch | null | "new">(sp.get("new") ? "new" : null);
  const [menu, setMenu] = useState<number | null>(null);

  const close = useCallback(() => {
    setEditing(null);
    if (sp.get("new")) router.replace(pathname);
  }, [router, pathname, sp]);

  const patch = async (id: number, body: object) => {
    setMenu(null);
    await fetch(`/api/searches/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    router.refresh();
  };
  const remove = async (s: SavedSearch) => {
    setMenu(null);
    if (!confirm(`Delete the feed "${s.name}"? Its cached jobs are removed too.`)) return;
    await fetch(`/api/searches/${s.id}`, { method: "DELETE" });
    router.refresh();
  };
  const item = "block w-full rounded-lg px-3 py-2 text-left text-[14px] hover:bg-[var(--color-control)]";

  return (
    <>
      {searches.length === 0 ? (
        <div className="card grid place-items-center gap-3 px-6 py-16 text-center">
          <h2 className="display text-[22px] font-semibold">No feeds yet</h2>
          <p className="max-w-md text-[var(--color-muted)]">A feed is one Upwork view that gets polled: your Most Recent tab, Best Matches, or a search with filters. Paste a link above, or build a search by hand. Up to 10 feeds.</p>
          <button type="button" className="btn btn-dark mt-2" onClick={() => setEditing("new")}><IconPlus size={18} />New feed</button>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {searches.map((s) => {
            const st = stats[s.id] ?? { total: 0, matchRate: 0, notified: 0 };
            return (
              <li key={s.id} className="card card-link relative p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`pill ${s.enabled ? "pill-good" : "pill-bad"}`}>{s.enabled ? "Active" : "Paused"}</span>
                    <span className={`tag ${s.kind === "search" ? "" : "bg-[var(--color-info-soft)] text-[var(--color-info)]"}`}>{KIND_LABEL[s.kind] ?? "Search"}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="num whitespace-nowrap text-[14px] text-[var(--color-muted)]">{st.total} / 24h</span>
                    <div className="relative">
                      <button type="button" aria-label={`Actions for ${s.name}`} aria-haspopup="menu" aria-expanded={menu === s.id}
                        className="grid size-10 place-items-center rounded-lg hover:bg-[var(--color-control)] md:size-8" onClick={() => setMenu(menu === s.id ? null : s.id)}>
                        <IconDots size={18} />
                      </button>
                      {menu === s.id && (
                        <div role="menu" className="absolute right-0 top-9 z-10 w-40 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-pop)]">
                          <button role="menuitem" className={item} onClick={() => { setMenu(null); setEditing(s); }}>Edit</button>
                          <button role="menuitem" className={item} onClick={() => patch(s.id, { enabled: !s.enabled })}>{s.enabled ? "Pause" : "Resume"}</button>
                          <button role="menuitem" className={`${item} text-[var(--color-bad)]`} onClick={() => remove(s)}>Delete</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <h2 className="mt-3 text-[17px] font-semibold leading-snug">
                  <button type="button" className="text-left hover:underline" onClick={() => setEditing(s)}>{s.name}</button>
                  {s.kind === "search" && <span className="ml-2 font-normal text-[var(--color-muted)]">{s.jobType === "ANY" ? "Any type" : s.jobType === "HOURLY" ? "Hourly" : "Fixed"}</span>}
                </h2>
                <p className="mt-1 line-clamp-1 text-[14px] text-[var(--color-muted)]">
                  {s.kind === "most_recent" ? "Your Most Recent tab, newest first" : s.kind === "best_match" ? "Upwork's Best Matches for your profile" : s.skills.join(", ") || s.query || "All jobs"}
                </p>
                <p className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px]">
                  <span className="inline-flex items-center gap-1.5"><IconBriefcase size={15} className="text-[var(--color-good)]" />{s.kind !== "search" ? (s.maxProposals != null ? `≤ ${s.maxProposals} proposals` : "Any competition") : s.minHourly ? `$${s.minHourly}/hr+` : s.minBudget ? `$${s.minBudget}+` : "Any budget"}</span>
                  <span className="text-[var(--color-faint)]">/</span>
                  <span className="inline-flex items-center gap-1.5"><IconStar size={15} className="text-[var(--color-warn)]" />{st.matchRate}% match</span>
                  <span className="text-[var(--color-faint)]">/</span>
                  <span className="inline-flex items-center gap-1.5"><IconUser size={15} className="text-[var(--color-muted)]" />{s.verifiedPaymentOnly ? "Verified only" : "Any client"}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <SearchEditor initial={editing === "new" ? null : editing} onClose={close} />}
    </>
  );
}

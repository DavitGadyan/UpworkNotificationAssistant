"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconClose, IconSearch } from "@/components/icons";

/**
 * Search field for a list page. Writes ?q= (debounced, page reset) so results survive auto-refresh and can be
 * bookmarked; the server component does the filtering.
 */
export function SearchBox({ placeholder, param = "q", className = "" }: { placeholder: string; param?: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const urlValue = sp.get(param) ?? "";
  // Typing goes to a draft tied to the URL value it started from; once the URL catches up it is dropped.
  const [draft, setDraft] = useState<{ base: string; v: string } | null>(null);
  const value = draft && draft.base === urlValue ? draft.v : urlValue;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const push = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    const q = new URLSearchParams(sp.toString());
    if (v.trim()) q.set(param, v.trim()); else q.delete(param);
    q.delete("page");
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
  };

  return (
    <label className={`flex min-h-[52px] min-w-0 items-center gap-3 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 transition-colors hover:border-[color-mix(in_srgb,var(--color-ink)_25%,var(--color-line))] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-ink)] ${className}`}>
      <IconSearch size={20} className="shrink-0 text-[var(--color-muted)]" />
      <input
        type="search" value={value} placeholder={placeholder} aria-label={placeholder} enterKeyHint="search"
        className="min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-[var(--color-faint)] [&::-webkit-search-cancel-button]:hidden"
        onChange={(e) => {
          const v = e.target.value;
          setDraft({ base: urlValue, v });
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => push(v), 300);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") push(value); if (e.key === "Escape" && value) { setDraft({ base: urlValue, v: "" }); push(""); } }}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => { setDraft({ base: urlValue, v: "" }); push(""); }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-control)] hover:text-[var(--color-ink)]">
          <IconClose size={16} />
        </button>
      )}
    </label>
  );
}

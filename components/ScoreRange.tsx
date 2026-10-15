"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { IconStar } from "@/components/icons";

/**
 * Draggable min–max score filter. The thumbs move locally; the URL (?min=&max=, left out at 0 and 100) is
 * written when a thumb is released or a key press ends - the native `change` event - so the list reloads once.
 */
export function ScoreRange({ min, max }: { min: number; max: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const base = `${min}-${max}`;
  // A draft belongs to the URL values it started from; once the URL catches up it is ignored.
  const [draft, setDraft] = useState<{ base: string; lo: number; hi: number } | null>(null);
  const { lo, hi } = draft && draft.base === base ? draft : { lo: min, hi: max };
  const loRef = useRef<HTMLInputElement>(null);
  const hiRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const inputs = [loRef.current, hiRef.current];
    const commit = () => {
      const nextLo = Number(loRef.current?.value ?? 0), nextHi = Number(hiRef.current?.value ?? 100);
      const q = new URLSearchParams(sp.toString());
      if (nextLo > 0) q.set("min", String(nextLo)); else q.delete("min");
      if (nextHi < 100) q.set("max", String(nextHi)); else q.delete("max");
      q.delete("page");
      router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
    };
    inputs.forEach((i) => i?.addEventListener("change", commit));
    return () => inputs.forEach((i) => i?.removeEventListener("change", commit));
  }, [sp, pathname, router]);

  return (
    <div className="flex min-h-[52px] min-w-0 items-center gap-3 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 md:flex-1">
      <IconStar size={20} className="shrink-0" />
      <span className="shrink-0 font-medium">Score</span>
      <div className="range-dual relative h-6 min-w-[120px] flex-1" style={{ "--lo": lo / 100, "--hi": hi / 100 } as CSSProperties}>
        <input
          ref={loRef} type="range" min={0} max={100} step={1} value={lo} aria-label="Minimum score" aria-valuetext={`${lo} or more`}
          style={{ zIndex: lo > 50 ? 2 : 1 }} // stacked thumbs at the top end: the lower one must stay grabbable
          onChange={(e) => setDraft({ base, lo: Math.min(Number(e.target.value), hi), hi })}
        />
        <input
          ref={hiRef} type="range" min={0} max={100} step={1} value={hi} aria-label="Maximum score" aria-valuetext={`${hi} or less`}
          onChange={(e) => setDraft({ base, lo, hi: Math.max(Number(e.target.value), lo) })}
        />
      </div>
      <span className="num w-[60px] shrink-0 text-right font-medium">{lo}–{hi}</span>
    </div>
  );
}

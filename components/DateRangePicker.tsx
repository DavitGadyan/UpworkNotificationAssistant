"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconCalendar, IconChevronDown, IconChevronLeft, IconChevronRight } from "@/components/icons";
import { DATE_PRESETS, type DatePreset } from "@/lib/jobFilters";

const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayEnd = (t: number) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); };
const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const long = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const monthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const monthOf = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function rangeLabel(preset: DatePreset | null, since: number | null, until: number | null) {
  if (preset) return DATE_PRESETS.find((p) => p.value === preset)!.label;
  if (since == null) return "Any date";
  const a = short.format(since), b = short.format(until ?? Date.now());
  return a === b ? a : `${a} – ${b}`;
}

/** "Posted: Last 24 hours ⌄" button with presets and a month calendar for a custom range (writes ?range= or ?since=&until=). */
export function DateRangePicker({ preset, since, until }: { preset: DatePreset | null; since: number | null; until: number | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [month, setMonth] = useState(() => monthOf(Date.now()));
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // Each opening starts from what the URL says (it may have changed via Clear filters or the back button).
  function toggle() {
    if (!open) {
      setStart(preset || since == null ? null : dayStart(since));
      setEnd(preset || until == null ? null : dayStart(until));
      setMonth(monthOf(preset || since == null ? Date.now() : since));
    }
    setOpen(!open);
  }

  function go(params: Record<string, string | null>) {
    const q = new URLSearchParams(sp.toString());
    for (const k of ["range", "since", "until", "page"]) q.delete(k);
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    setOpen(false);
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
  }

  function pick(day: number) {
    if (start == null || end != null) { setStart(day); setEnd(null); return; }
    if (day < start) { setEnd(start); setStart(day); } else setEnd(day);
  }

  const today = dayStart(Date.now());
  const first = new Date(month);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(offset).fill(null), ...Array.from({ length: daysIn }, (_, i) => new Date(first.getFullYear(), first.getMonth(), i + 1).getTime())];
  const lo = start, hi = end ?? start;
  const atCurrentMonth = first.getFullYear() === new Date().getFullYear() && first.getMonth() === new Date().getMonth();

  return (
    <div ref={wrap} className="relative min-w-0 md:w-[280px] md:shrink-0">
      <button
        ref={trigger} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        className="flex min-h-[52px] w-full items-center gap-3 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 text-left transition-colors hover:border-[color-mix(in_srgb,var(--color-ink)_25%,var(--color-line))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-ink)]"
      >
        <IconCalendar size={20} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium" suppressHydrationWarning>Posted: {rangeLabel(preset, since, until)}</span>
        <IconChevronDown size={18} className="shrink-0 text-[var(--color-muted)]" />
      </button>

      {open && (
        <div role="dialog" aria-label="Filter by posting date" className="card absolute left-0 top-full z-30 mt-2 w-[min(340px,calc(100vw-32px))] p-4 shadow-[var(--shadow-pop)]">
          <div className="seg mb-4 w-full flex-wrap">
            {DATE_PRESETS.map((p) => (
              <button key={p.value} type="button" className="seg-item h-[34px] flex-1 justify-center px-2 text-[14px]" aria-pressed={preset === p.value}
                onClick={() => go({ range: p.value === "24h" ? null : p.value })}>
                {p.label.replace("Last ", "")}
              </button>
            ))}
          </div>

          <div className="mb-2 flex items-center justify-between">
            <button type="button" className="icon-btn h-9 w-9 hover:bg-[var(--color-control)]" aria-label="Previous month"
              onClick={() => { const d = new Date(month); setMonth(monthOf(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime())); }}>
              <IconChevronLeft size={18} />
            </button>
            <span className="font-semibold">{monthTitle.format(month)}</span>
            <button type="button" className="icon-btn h-9 w-9 hover:bg-[var(--color-control)] disabled:opacity-30" aria-label="Next month" disabled={atCurrentMonth}
              onClick={() => { const d = new Date(month); setMonth(monthOf(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime())); }}>
              <IconChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center text-[13px]">
            {WEEKDAYS.map((w) => <span key={w} className="pb-1 font-medium text-[var(--color-faint)]">{w}</span>)}
            {cells.map((d, i) => {
              if (d == null) return <span key={`b${i}`} />;
              const future = d > today;
              const edge = d === lo || d === hi;
              const inside = lo != null && hi != null && d > lo && d < hi;
              return (
                <button
                  key={d} type="button" disabled={future} onClick={() => pick(d)} aria-label={long.format(d)} aria-pressed={edge || inside}
                  className={`num mx-auto grid h-9 w-full place-items-center text-[14px] transition-colors disabled:text-[var(--color-faint)] disabled:opacity-50
                    ${edge ? "rounded-[10px] bg-[var(--color-ink)] font-semibold text-[var(--color-surface)]" : inside ? "bg-[var(--color-accent-soft)] text-[var(--color-ink)]" : "rounded-[10px] hover:bg-[var(--color-control)]"}
                    ${d === today && !edge ? "font-semibold text-[var(--color-accent)]" : ""}`}
                >
                  {new Date(d).getDate()}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-[13px] leading-snug text-[var(--color-muted)]">
            {start == null ? "Pick a day, or a first and last day." : end == null ? "Pick the last day, or apply this one day." : `${short.format(lo!)} – ${short.format(hi!)}`}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-[var(--color-faint)]">Jobs you don&apos;t act on are deleted after 24 hours, so earlier days only show jobs you drafted, watched or kept.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-sm btn-dark" disabled={start == null}
              onClick={() => lo != null && go({ since: String(dayStart(lo)), until: String(dayEnd(hi ?? lo)) })}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

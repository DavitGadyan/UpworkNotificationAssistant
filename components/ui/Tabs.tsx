"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Tab strip on a gray track, active tab = white chip (template drill-down). Arrow keys move between tabs. */
export function Tabs({ tabs }: { tabs: { id: string; label: string; icon?: ReactNode; content: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const base = useId();
  const track = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const focusTab = (i: number) => {
    const t = tabs[(i + tabs.length) % tabs.length];
    setActive(t.id);
    document.getElementById(`${base}-tab-${t.id}`)?.focus();
  };
  return (
    <div>
      <div ref={track} role="tablist" aria-label="Job sections" className="seg w-full" style={overflowing ? { maskImage: "linear-gradient(to right, #000 85%, transparent)" } : undefined}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`${base}-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={active === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            className="seg-item flex-1 justify-center"
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") focusTab(i + 1);
              if (e.key === "ArrowLeft") focusTab(i - 1);
            }}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} id={`${base}-panel-${t.id}`} role="tabpanel" aria-labelledby={`${base}-tab-${t.id}`} hidden={active !== t.id} className="mt-5">
          {t.content}
        </div>
      ))}
    </div>
  );
}

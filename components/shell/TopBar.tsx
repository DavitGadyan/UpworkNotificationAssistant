"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { IconBell, IconPlus, IconSearch } from "@/components/icons";
import { ThemeCycleButton } from "@/components/theme/ThemeToggle";

/** Search-first top bar: "/" focuses search (searches cached jobs), black "+" = new feed, bell = alerts, sun/moon = theme. */
export function TopBar({ unread }: { unread: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-frame)]/90 backdrop-blur">
      <div className="flex h-[72px] items-center gap-3 px-4 md:px-6">
        <Link href="/" aria-label="Upwork Assistant home" className="mr-1 flex shrink-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" width={32} height={32} className="size-8 rounded-[9px] ring-1 ring-[var(--color-line)]" />
          <span className="display hidden text-[17px] font-bold tracking-tight lg:block">Upwork Assistant</span>
        </Link>
        <form
          role="search"
          className="flex h-11 w-full min-w-0 max-w-[360px] items-center gap-3 rounded-full bg-[var(--color-control)] px-4 focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-ink)]"
          onSubmit={(e) => {
            e.preventDefault();
            const q = input.current?.value.trim();
            router.push(q ? `/jobs?q=${encodeURIComponent(q)}` : "/jobs");
          }}
        >
          <IconSearch size={18} className="shrink-0" />
          <input ref={input} name="q" placeholder="Search jobs" aria-label="Search jobs"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--color-muted)]" />
          <kbd className="hidden font-body text-[14px] text-[var(--color-muted)] sm:block">/</kbd>
        </form>
        <div className="ml-auto flex items-center gap-1.5 md:gap-3">
          <ThemeCycleButton />
          <Link href="/feeds?new=1" aria-label="New feed" title="New feed"
            className="icon-btn bg-[var(--color-ink)] text-[var(--color-surface)] hover:bg-[color-mix(in_srgb,var(--color-surface)_14%,var(--color-ink))]">
            <IconPlus size={22} />
          </Link>
          <Link href="/alerts" aria-label={unread ? `${unread} alerts in the last hour` : "Alerts"} className="icon-btn relative hover:bg-[var(--color-control)]">
            <IconBell size={22} />
            {unread > 0 && <span className="absolute right-[11px] top-[10px] size-2.5 rounded-full border-2 border-[var(--color-frame)] bg-[var(--color-accent)]" />}
          </Link>
        </div>
      </div>
    </header>
  );
}

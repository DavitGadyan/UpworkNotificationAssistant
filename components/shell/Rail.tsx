"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  IconBriefcase, IconChart, IconFlask, IconChat, IconClose, IconDoc, IconEye, IconFeed, IconGrid, IconMore, IconSettings, IconSpark,
} from "@/components/icons";

type Item = { href: string; label: string; short?: string; Icon: (p: { size?: number; className?: string }) => React.ReactElement };

const primary: Item[] = [
  { href: "/", label: "Overview", Icon: IconGrid },
  { href: "/jobs", label: "Jobs", Icon: IconBriefcase },
  { href: "/watchlist", label: "Watchlist", Icon: IconEye },
  { href: "/proposals", label: "Proposals", Icon: IconDoc },
  { href: "/closer", label: "Closer", Icon: IconSpark },
  { href: "/insights", label: "Insights", Icon: IconChart },
];
const secondary: Item[] = [
  { href: "/insights/prompts", label: "Prompts", Icon: IconFlask },
  { href: "/feeds", label: "Feeds", Icon: IconFeed },
  { href: "/alerts", label: "Alerts log", Icon: IconChat },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

/* Phone: the four destinations used daily + "More" (everything else in a sheet). */
const mobileMain = ["/", "/jobs", "/proposals", "/closer"];

/**
 * Floating icon rail (template). Desktop: vertical capsule on the left. Mobile: a bottom tab bar with
 * labels (4 main destinations + More), and a sheet with the rest.
 */
export function Rail({ initials }: { initials: string }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/"
    : href === "/insights" && path.startsWith("/insights/prompts") ? false // Prompts has its own item
    : path === href || path.startsWith(href + "/") || (href === "/feeds" && path.startsWith("/searches")));
  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMore(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [more]);

  const all = [...primary, ...secondary];
  const moreItems = all.filter((i) => !mobileMain.includes(i.href));
  const moreActive = moreItems.some((i) => active(i.href));

  const desktopItem = (it: Item) => (
    <Link
      key={it.href}
      href={it.href}
      aria-label={it.label}
      title={it.label}
      aria-current={active(it.href) ? "page" : undefined}
      className={`grid size-12 place-items-center rounded-full transition-[background,color,box-shadow] duration-150 ${
        active(it.href)
          ? "bg-[var(--color-raised)] text-[var(--color-ink)] shadow-[var(--shadow-active)]"
          : "text-[var(--color-faint)] hover:text-[var(--color-ink)]"
      }`}
    >
      <it.Icon size={24} />
    </Link>
  );

  const tab = (label: string, Icon: Item["Icon"], on: boolean) => (
    <>
      <span className={`grid h-8 w-12 place-items-center rounded-full transition-colors ${on ? "bg-[var(--color-raised)] text-[var(--color-ink)] shadow-[var(--shadow-active)]" : ""}`}>
        <Icon size={22} />
      </span>
      <span className="text-[11px] font-medium leading-none">{label}</span>
    </>
  );

  return (
    <>
      {/* Desktop / tablet rail */}
      <nav aria-label="Main" className="sticky top-[96px] hidden flex-col items-center gap-2 rounded-full bg-[var(--color-sunken)] p-2 shadow-[var(--shadow-rail)] md:flex">
        {primary.map(desktopItem)}
        <span aria-hidden className="my-1 h-px w-8 bg-[var(--color-line)]" />
        {secondary.map(desktopItem)}
        <Link
          href="/settings"
          aria-label="Account"
          className="mt-2 grid size-11 shrink-0 place-items-center rounded-full bg-[var(--color-control)] text-[13px] font-semibold text-[var(--color-ink)] ring-1 ring-[var(--color-line)] hover:bg-[var(--color-line)]"
        >
          {initials}
        </Link>
      </nav>

      {/* Phone tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-3 z-30 grid grid-cols-5 rounded-[24px] bg-[var(--color-sunken)] p-1.5 shadow-[var(--shadow-rail)] md:hidden"
        style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        {mobileMain.map((href) => {
          const it = all.find((i) => i.href === href)!;
          const on = active(href);
          return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined}
              className={`flex flex-col items-center gap-1 rounded-[18px] py-1.5 ${on ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"}`}>
              {tab(it.label, it.Icon, on)}
            </Link>
          );
        })}
        <button type="button" aria-expanded={more} aria-controls="more-sheet" onClick={() => setMore((m) => !m)}
          className={`flex flex-col items-center gap-1 rounded-[18px] py-1.5 ${more || moreActive ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"}`}>
          {tab("More", more ? IconClose : IconMore, more || moreActive)}
        </button>
      </nav>

      {more && (
        <div className="fixed inset-0 z-[25] bg-[var(--scrim)] md:hidden" onClick={() => setMore(false)}>
          <div id="more-sheet" role="dialog" aria-label="More pages" onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-3 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-pop)]"
            style={{ bottom: "calc(max(12px, env(safe-area-inset-bottom)) + 84px)" }}>
            <ul className="grid grid-cols-3 gap-1">
              {moreItems.map((it) => {
                const on = active(it.href);
                return (
                  <li key={it.href}>
                    <Link href={it.href} aria-current={on ? "page" : undefined}
                      className={`flex flex-col items-center gap-2 rounded-[16px] px-2 py-4 text-[13px] font-medium ${on ? "bg-[var(--color-control)] text-[var(--color-ink)]" : "text-[var(--color-muted)] hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)]"}`}>
                      <it.Icon size={24} />{it.label}
                    </Link>
                  </li>
                );
              })}
              <li>
                <Link href="/about" className="flex flex-col items-center gap-2 rounded-[16px] px-2 py-4 text-[13px] font-medium text-[var(--color-muted)] hover:bg-[var(--color-sunken)]">
                  <span className="grid size-6 place-items-center rounded-full bg-[var(--color-control)] text-[11px] font-semibold text-[var(--color-ink)]">{initials}</span>About
                </Link>
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

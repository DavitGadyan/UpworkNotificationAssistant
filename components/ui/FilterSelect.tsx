"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { IconChevronDown } from "@/components/icons";

/** "Site: All ⌄" filter control (template filter bar). Writes its value to the URL query. */
export function FilterSelect({ param, label, icon, options }: {
  param: string; label: string; icon: ReactNode; options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const value = sp.get(param) ?? "";
  const current = options.find((o) => o.value === value)?.label ?? "All";
  return (
    <label className="relative flex min-h-[52px] min-w-0 shrink-0 items-center md:flex-1 gap-3 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 transition-colors hover:border-[color-mix(in_srgb,var(--color-ink)_25%,var(--color-line))] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-ink)]">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}: {current}</span>
      <IconChevronDown size={18} className="shrink-0 text-[var(--color-muted)]" />
      <select
        aria-label={label}
        className="absolute inset-0 cursor-pointer opacity-0"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(sp.toString());
          if (e.target.value) next.set(param, e.target.value); else next.delete(param);
          next.delete("page");
          router.push(`${pathname}?${next.toString()}`);
        }}
      >
        <option value="">All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

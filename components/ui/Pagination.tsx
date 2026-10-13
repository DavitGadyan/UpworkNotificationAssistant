import Link from "next/link";
import { IconChevronLeft, IconChevronRight } from "@/components/icons";

/** prev · 1 2 3 · next - active page is a black square (template Devices footer). */
export function Pagination({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 1);
  const cell = "grid h-11 min-w-11 place-items-center rounded-[var(--radius-control)] px-3 num font-medium";
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-2">
      <Link aria-label="Previous page" href={href(Math.max(1, page - 1))} aria-disabled={page === 1}
        className={`${cell} bg-[var(--color-control)] ${page === 1 ? "pointer-events-none opacity-40" : "hover:bg-[var(--color-line)]"}`}><IconChevronLeft size={16} /></Link>
      {nums.map((p, i) => (
        <span key={p} className="flex items-center gap-2">
          {i > 0 && p - nums[i - 1] > 1 && <span className="text-[var(--color-faint)]">…</span>}
          <Link href={href(p)} aria-current={p === page ? "page" : undefined}
            className={`${cell} ${p === page ? "bg-[var(--color-ink)] text-[var(--color-surface)]" : "hover:bg-[var(--color-control)]"}`}>{p}</Link>
        </span>
      ))}
      <Link aria-label="Next page" href={href(Math.min(pages, page + 1))} aria-disabled={page === pages}
        className={`${cell} bg-[var(--color-control)] ${page === pages ? "pointer-events-none opacity-40" : "hover:bg-[var(--color-line)]"}`}><IconChevronRight size={16} /></Link>
    </nav>
  );
}

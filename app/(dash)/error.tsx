"use client";

import { useEffect } from "react";

/** A page that failed to load (usually a database hiccup) shows a retry instead of a blank crash. */
export default function DashError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section className="card mx-auto mt-6 max-w-[560px] p-6" role="alert">
      <h1 className="text-[20px] font-semibold">This page didn&apos;t load</h1>
      <p className="mt-2 text-[15px] text-[var(--color-muted)]">
        The database was slow to answer, so the page couldn&apos;t refresh. What you just did (for example Approve) was most likely saved - try again to see it.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn btn-dark" onClick={() => reset()}>Try again</button>
        <button type="button" className="btn" onClick={() => location.reload()}>Reload page</button>
      </div>
      {error.digest && <p className="mt-4 text-[12px] text-[var(--color-faint)]">Ref {error.digest}</p>}
    </section>
  );
}

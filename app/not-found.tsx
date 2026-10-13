import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-5 text-center">
      <div>
        <h1 className="page-title">Not here</h1>
        <p className="mt-3 text-[var(--color-muted)]">Jobs disappear 24 hours after they were fetched, so an old link stops working.</p>
        <Link href="/jobs" className="btn btn-dark mt-6">Back to jobs</Link>
      </div>
    </main>
  );
}

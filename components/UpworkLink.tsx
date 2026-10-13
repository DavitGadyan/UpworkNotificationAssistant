import { jobUrl } from "@/lib/format";

/**
 * "Open in Upwork" for any card. Sits above the card's stretched link (relative z-10) so it opens the
 * original job post - Upwork's universal link, which the Upwork mobile app claims on phones.
 */
export function UpworkLink({ ciphertext, jobId, url, className = "" }: { ciphertext?: string | null; jobId?: string; url?: string | null; className?: string }) {
  const href = url ?? jobUrl(ciphertext || `~02${jobId ?? ""}`);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={`relative z-10 inline-flex items-center gap-1 text-[14px] font-medium text-[var(--color-accent)] hover:underline ${className}`}>
      Open in Upwork
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </a>
  );
}

import Link from "next/link";

export const metadata = { title: "About" };

/* Public, unauthenticated: the plain-language description of what this tool does (and doesn't do). */
export default function About() {
  return (
    <main className="mx-auto max-w-[720px] px-5 py-16">
      <p className="display flex items-center gap-2.5 text-[17px] font-bold">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" width={28} height={28} className="size-7 rounded-[8px]" />
        Upwork Assistant
      </p>
      <h1 className="page-title mt-4">About this app</h1>
      <div className="mt-6 grid gap-5 text-[16px] leading-relaxed">
        <p>Upwork Assistant is a private, single-user assistant for one freelancer. It is not offered to anyone else, free or paid.</p>
        <p>It connects to Upwork through Upwork&apos;s official MCP connector, signed in by the owner with OAuth. Every few minutes it reads the owner&apos;s feeds (Most Recent, Best Matches and saved searches), checks each new job against the owner&apos;s own rules and an AI fit assessment, and sends the best ones to the owner&apos;s Telegram, or for the strongest matches, as a short automated call to the owner&apos;s phone. After an alert it re-checks how many proposals the job has, so the owner knows when it gets crowded.</p>
        <p>Usage is deliberately human-paced: a slow, randomised poll, a gap between calls, and hard per-cycle and per-day caps with an automatic pause if Upwork returns errors.</p>
        <p>The assistant is read-mostly. When the owner asks, it drafts a proposal, but drafts are <b>never submitted automatically</b>. The owner records a Loom video, edits and approves the text, reviews Upwork&apos;s own preview (Connects cost and balance), and then types SUBMIT to send it. Reply suggestions for client conversations are only shown to the owner, who sends every message personally.</p>
        <p>Monthly insights (proposal funnel, profile suggestions, ideal client profile) are built from the owner&apos;s own account data. Job and client details are deleted automatically 24 hours after they were fetched. Nothing is sold or shared, used for advertising, or collected into a client database.</p>
        <p>The dashboard is password-protected. This page is the only public one.</p>
      </div>
      <Link href="/" className="btn btn-dark mt-10">Open dashboard</Link>
    </main>
  );
}

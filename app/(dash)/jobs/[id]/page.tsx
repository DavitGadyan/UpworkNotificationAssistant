import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftPanel } from "@/components/DraftPanel";
import { FeedbackButtons } from "@/components/FeedbackButtons";
import { JobActions } from "@/components/JobActions";
import { IconAlert, IconBriefcase, IconChat, IconCheck, IconDoc, IconGlobe, IconGrid, IconPhone, IconSend, IconSpark, IconStar, IconUser } from "@/components/icons";
import { Bullets, Note } from "@/components/ui/bits";
import { InfoCard } from "@/components/ui/InfoCard";
import { jobPill, scoreTone } from "@/components/ui/status";
import { StatGrid } from "@/components/ui/StatGrid";
import { Tabs } from "@/components/ui/Tabs";
import { getJob, getSearch, getSettings, listNotifications, listProposals } from "@/lib/db";
import { budgetLabel, compactMoney, experienceLabel, fmtDateTime, INTENT_LABELS, intentPill, intentRiskLabel, money, PROPOSAL_STATUS, proposalsLabel, timeAgo } from "@/lib/format";
import type { ClientIntent, RuleFlag } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const job = await getJob(decodeURIComponent((await params).id));
  return { title: job?.title ?? "Job" };
}

const toneCls = { good: "pill-good", info: "pill-info", warn: "pill-warn", bad: "pill-bad" } as const;
const sevCls: Record<RuleFlag["severity"], string> = { red: "pill-bad", amber: "pill-warn", info: "pill-info" };
const CAT: Record<string, string> = { ai: "AI", saas: "SaaS", automation: "Automation", devops: "DevOps", mlops: "MLOps", data: "Data", marketing: "Marketing", other: "Other" };

export default async function JobDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ draft?: string }> }) {
  const job = await getJob(decodeURIComponent((await params).id));
  if (!job) notFound();
  const sp = await searchParams;
  const wantDraft = sp.draft === "1";
  const settings = await getSettings();
  const search = await getSearch(job.searchId);
  const alerts = await listNotifications(job.id);
  const proposals = await listProposals({ jobId: job.id });
  const s = job.score;
  const rules = s.rules;
  const llm = s.llm ?? null;
  const e = job.enrichment ?? null;
  const tone = scoreTone(s, settings);
  const pill = jobPill(job.status, s, settings);
  const c = job.client;
  const d = rules?.derived;
  const hireRate = d?.hireRate ?? (c.totalPostedJobs ? Math.round((c.totalHires / c.totalPostedJobs) * 100) : null);
  const unmatched = search?.skills.filter((k) => !s.matchedSkills.includes(k)) ?? [];
  const category = llm?.category ?? rules?.category;
  const flags = [...(rules?.flags ?? [])].sort((a, b) => ["red", "amber", "info"].indexOf(a.severity) - ["red", "amber", "info"].indexOf(b.severity));
  const questions = e?.screeningQuestions ?? [];

  const part = (tag: string, got: number, max: number, title: string, sub: string, icon: React.ReactNode, footLabel: string, footValue: React.ReactNode) => (
    <InfoCard key={tag} tag={tag} status={`${got}/${max}`} statusCls={got / max >= 0.75 ? "pill-good" : got / max >= 0.4 ? "pill-warn" : "pill-bad"}
      title={title} sub={sub} icon={icon} footLabel={footLabel} footValue={footValue} />
  );

  const proposalList = proposals.length > 0 && (
    <section className="card p-5 md:p-6" aria-labelledby="props-h">
      <h2 id="props-h" className="tag mb-3">Proposals for this job</h2>
      <ul className="divide-row">
        {proposals.map((p) => {
          const st = PROPOSAL_STATUS[p.status] ?? { label: p.status, cls: "pill-neutral" };
          return (
            <li key={p.id}>
              <Link href={`/proposals/${p.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-[var(--color-accent)]">
                <span className="min-w-0">
                  <span className="block truncate font-medium">Draft #{p.id}{p.bid != null ? ` · ${money(p.bid)}` : ""}</span>
                  <span className="text-[13px] text-[var(--color-muted)]">Created {timeAgo(p.createdAt)}{p.model ? ` · ${p.model}` : ""}</span>
                </span>
                <span className={`pill shrink-0 ${st.cls}`}>{st.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 items-center gap-3 text-[14px] text-[var(--color-muted)]">
        <IconGlobe size={18} className="shrink-0 text-[var(--color-ink)]" />
        <span aria-hidden>/</span>
        <Link href="/jobs" className="hover:text-[var(--color-ink)]">Jobs</Link>
        <span aria-hidden>/</span>
        <Link href={`/jobs?search=${job.searchId}`} className="truncate hover:text-[var(--color-ink)]">{job.searchName}</Link>
        <span aria-hidden className="hidden sm:inline">/</span>
        <span className="hidden truncate font-medium text-[var(--color-ink)] sm:inline">{job.title}</span>
      </nav>

      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="display break-words text-[24px] font-bold md:text-[32px]">{job.title}</h1>
            <span className={`pill ${toneCls[tone]}`} title={llm ? "Final rank: rule score blended with the AI fit" : "Rule score only - the AI hasn't judged this job"}>Rank: {s.total}%</span>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[var(--color-muted)]">
            <span className={`pill ${pill.cls}`}>{pill.label}</span>
            {category && <span className="tag">{CAT[category] ?? category}</span>}
            {job.featured && <span className="tag">Featured</span>}
            {(job.applied || e?.applied) && <span className="pill pill-good">Applied</span>}
            <span>Posted {timeAgo(job.publishedAt)} · {job.category ?? "Uncategorised"}</span>
          </p>
          {s.profileFit && (
            <p className="mt-2 text-[14px]" title={s.profileFit.reasons.join(" · ")}>
              <span className={`font-semibold ${s.profileFit.verdict === "off" ? "text-[var(--color-bad)]" : s.profileFit.verdict === "core" ? "text-[var(--color-good)]" : "text-[var(--color-muted)]"}`}>
                {s.profileFit.verdict === "off" ? "Not your field" : s.profileFit.verdict === "core" ? "Your field" : "Unclear fit"}
                {s.profileFit.field ? ` · ${s.profileFit.field}` : ""}
              </span>
              <span className="text-[var(--color-muted)]"> — {s.profileFit.reasons.join("; ")}</span>
            </p>
          )}
        </div>
        <JobActions id={job.id} ciphertext={job.ciphertext} status={job.status} />
      </div>

      {wantDraft && <div className="mb-6"><DraftPanel jobId={job.id} highlight existing={proposals.length} /></div>}

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Summary icon={<IconUser size={18} />} title={`Client${c.country ? ` · ${c.country}` : ""}`}>
          <Dot ok={c.paymentVerified} yes="Payment verified" no="Payment not verified" unknown="Payment unknown" />
          <span className="text-[var(--color-faint)]">/</span>
          <span>{compactMoney(c.totalSpent)} spent</span>
          <span className="text-[var(--color-faint)]">/</span>
          <span>{c.totalHires} hires</span>
        </Summary>
        <Summary icon={<IconBriefcase size={18} />} title={budgetLabel(job)}>
          <span>{experienceLabel(job.experienceLevel)}</span>
          <span className="text-[var(--color-faint)]">/</span>
          <span>{proposalsLabel(job)}</span>
        </Summary>
        <Summary icon={<IconStar size={18} />} title={e?.connectsCost != null ? `${e.connectsCost} Connects to apply` : "Connects: unknown"}>
          {e?.connectsBalance != null ? <span>Balance {e.connectsBalance}</span> : <span>Fetched with client details</span>}
          {e?.canApply === false && <><span className="text-[var(--color-faint)]">/</span><span className="text-[var(--color-bad)]">Cannot apply</span></>}
        </Summary>
      </div>

      {s.intent && <IntentCard intent={s.intent} />}

      <div className="card mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <FeedbackButtons kind="alert" refId={job.id} label="Good alert?" />
        <p className="text-[13px] text-[var(--color-muted)] sm:max-w-[320px] sm:text-right">Your thumbs train the ranking (see Insights → Calibration).</p>
      </div>

      <Tabs tabs={[
        {
          id: "ranking", label: "Why this rank", icon: <IconSpark size={16} />,
          content: (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="card p-5 md:p-6" aria-labelledby="ai-h">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="ai-h" className="tag">AI assessment</h2>
                  {llm && <span className="flex flex-wrap gap-2"><span className="pill pill-info num">Fit {llm.fit}</span><span className="pill pill-good num">Value {llm.valuePotential}</span></span>}
                </div>
                {llm ? (
                  <div className="mt-4 grid gap-4">
                    <p className="text-[16px] leading-relaxed">{llm.summary}</p>
                    {llm.finalProduct && <Field label="Final product">{llm.finalProduct}</Field>}
                    {llm.bigFish && (
                      <div className="rounded-[14px] bg-[var(--color-good-soft)] p-4">
                        <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-good)]">Big fish</p>
                        <p className="mt-1 leading-relaxed">{llm.bigFish}</p>
                      </div>
                    )}
                    {llm.skillsWanted?.length > 0 && (
                      <Field label="Skills wanted"><span className="flex flex-wrap gap-1.5">{llm.skillsWanted.map((k) => <span key={k} className="pill pill-neutral">{k}</span>)}</span></Field>
                    )}
                    {llm.reasons?.length > 0 && <Field label="Reasons"><Bullets items={llm.reasons} tone="good" /></Field>}
                    {llm.redFlags?.length > 0 && <Field label="Red flags"><Bullets items={llm.redFlags} tone="bad" /></Field>}
                    <p className="text-[13px] text-[var(--color-faint)]">Model: {llm.model}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-[var(--color-muted)]">
                    {s.excluded
                      ? `No AI assessment - the job was excluded first (${s.excluded}).`
                      : job.status === "awaiting_ai"
                        ? "Waiting for the AI check (daily AI budget, an outage or the per-cycle limit). Nothing is alerted until the AI has ranked it."
                        : "No AI assessment for this job. The AI ranks jobs in your fields and jobs whose rule score is near the alert threshold; nothing is alerted without it."}
                  </p>
                )}
              </section>

              <section className="card p-5 md:p-6" aria-labelledby="rules-h">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="rules-h" className="tag">Rule checks</h2>
                  {rules && <span className={`pill num ${rules.rejected ? "pill-bad" : rules.score >= 70 ? "pill-good" : "pill-warn"}`}>Rules {rules.score}</span>}
                </div>
                {s.excluded && <Note tone="bad" className="mt-4">Rejected: {s.excluded}</Note>}
                {rules ? (
                  <div className="mt-4 grid gap-4">
                    {flags.length > 0 ? (
                      <ul className="flex flex-wrap gap-2" aria-label="Flags">
                        {flags.map((f) => (
                          <li key={f.code} className={`pill h-auto min-h-[26px] whitespace-normal py-1 ${sevCls[f.severity]}`} title={f.penalty ? `−${f.penalty} points` : undefined}>
                            {f.label}{f.penalty ? <span className="num opacity-70">−{f.penalty}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-[var(--color-muted)]">No flags raised.</p>}
                    {rules.passes.length > 0 && (
                      <Field label="Passes">
                        <ul className="grid gap-1.5">
                          {rules.passes.map((p) => <li key={p} className="flex gap-2 text-[15px]"><IconCheck size={16} className="mt-0.5 shrink-0 text-[var(--color-good)]" />{p}</li>)}
                        </ul>
                      </Field>
                    )}
                    <Field label="Client, derived">
                      <StatGrid cols={2} items={[
                        { label: "≈ Avg paid", value: d?.avgPaid != null ? `$${d.avgPaid}/hr` : "—" },
                        { label: "Hire rate", value: hireRate != null ? `${hireRate}%` : "—" },
                        { label: "Last hire", value: d?.lastHireDays != null ? `${d.lastHireDays}d ago` : "—" },
                        { label: "Per job", value: d?.avgPerContract != null ? money(d.avgPerContract) : "—" },
                      ]} />
                    </Field>
                    {llm && <p className="text-[13px] text-[var(--color-faint)]">Blend: rules × {settings.rules.weights.rules} + AI fit × {settings.rules.weights.llm}</p>}
                  </div>
                ) : (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {part("Skills", s.skills, 40, `${s.matchedSkills.length} of ${search?.skills.length ?? 0} wanted skills`, s.matchedSkills.join(", ") || "No overlap", <IconGrid size={16} />, "Missing", unmatched.slice(0, 2).join(", ") || "—")}
                    {part("Client", s.client, 35, "Client quality", "Payment, spend, hire rate, feedback", <IconUser size={16} />, "Spend", compactMoney(c.totalSpent))}
                    {part("Budget", s.budget, 15, budgetLabel(job), "Against your feed minimums", <IconBriefcase size={16} />, "Type", job.jobType === "HOURLY" ? "Hourly" : "Fixed")}
                    {part("Competition", s.competition, 10, proposalsLabel(job), `Posted ${timeAgo(job.publishedAt)}`, <IconAlert size={16} />, "Freshness", timeAgo(job.publishedAt))}
                  </div>
                )}
              </section>
            </div>
          ),
        },
        {
          id: "overview", label: "Description", icon: <IconGrid size={16} />,
          content: (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="card min-w-0 p-5 md:p-6">
                <h2 className="tag mb-3">Description</h2>
                <p className="whitespace-pre-line break-words leading-relaxed">{e?.description || job.description}</p>
              </div>
              <div className="card p-5 md:p-6">
                <h2 className="tag mb-3">Skills</h2>
                <ul className="flex flex-wrap gap-2">
                  {job.skills.map((k) => {
                    const hit = s.matchedSkills.some((m) => m.toLowerCase() === k.toLowerCase());
                    return <li key={k} className={`pill ${hit ? "pill-good" : "pill-neutral"}`}>{hit && <IconCheck size={14} />}{k}</li>;
                  })}
                </ul>
                <div className="mt-5"><StatGrid cols={2} items={[
                  { label: "Duration", value: job.duration ?? "—" },
                  { label: "Workload", value: job.workload ?? "—" },
                  { label: "Level", value: experienceLabel(job.experienceLevel) },
                  { label: "Status", value: e?.status ?? "—" },
                ]} /></div>
                {job.feeds && job.feeds.length > 1 && <p className="mt-3 text-[13px] text-[var(--color-muted)]">Seen in feeds: {job.feeds.join(", ")}</p>}
              </div>
            </div>
          ),
        },
        {
          id: "client", label: "Client", icon: <IconUser size={16} />,
          content: (
            <div className="grid gap-4">
              {e ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <section className="card p-5 md:p-6" aria-labelledby="rec-h">
                      <h2 id="rec-h" className="tag mb-2">Client record</h2>
                      <StatGrid cols={2} items={[
                        { label: "Spent", value: e.record.totalSpent != null ? compactMoney(e.record.totalSpent) : compactMoney(c.totalSpent) },
                        { label: "Hours", value: e.record.hours != null ? Math.round(e.record.hours).toLocaleString() : "—" },
                        { label: "Jobs posted", value: e.record.jobsPosted ?? c.totalPostedJobs },
                        { label: "With hires", value: e.record.hires ?? c.totalHires },
                        { label: "Hire rate", value: e.record.hireRatePercent != null ? `${e.record.hireRatePercent}%` : "—" },
                        { label: "Open jobs", value: e.record.openJobs ?? "—" },
                        { label: "Contracts", value: e.record.contractsTotal ?? "—" },
                        { label: "Active", value: e.record.contractsActive ?? "—" },
                        { label: "Rating", value: e.record.feedbackScore != null ? `${e.record.feedbackScore.toFixed(2)} (${e.record.feedbackCount ?? 0})` : "—" },
                        { label: "Local", value: [e.clientState, e.clientTimezone].filter(Boolean).join(" · ") || "—" },
                      ]} />
                    </section>
                    <section className="card p-5 md:p-6" aria-labelledby="act-h">
                      <h2 id="act-h" className="tag mb-2">Activity on this job</h2>
                      <StatGrid cols={2} items={[
                        { label: "Invites", value: e.activity.invitesSent },
                        { label: "Unanswered", value: e.activity.unansweredInvites },
                        { label: "Interviewing", value: e.activity.interviewed },
                        { label: "Offered", value: e.activity.offered },
                        { label: "Hired", value: e.activity.hired },
                        { label: "Proposals", value: job.proposalsTier ?? job.totalApplicants },
                      ]} />
                      {e.bidStats && (
                        <p className="mt-3 text-[14px] text-[var(--color-muted)]">Bids: avg {money(e.bidStats.avg)} · range {money(e.bidStats.min)}–{money(e.bidStats.max)}</p>
                      )}
                    </section>
                  </div>
                  <section className="card p-5 md:p-6" aria-labelledby="wh-h">
                    <h2 id="wh-h" className="tag mb-2">Recent work history</h2>
                    {e.workHistory.length ? (
                      <ul className="divide-row">
                        {e.workHistory.slice(0, 10).map((w, i) => (
                          <li key={i} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                            <span className="min-w-0">
                              <span className="block font-medium">{w.title}</span>
                              <span className="text-[13px] text-[var(--color-muted)]">{[w.type, w.started && `from ${w.started.slice(0, 10)}`, w.ended && `to ${w.ended.slice(0, 10)}`].filter(Boolean).join(" · ")}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {w.open && <span className="pill pill-info">Open</span>}
                              {w.feedback != null && <span className="pill pill-neutral num"><IconStar size={13} />{w.feedback.toFixed(1)}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-[var(--color-muted)]">No past contracts returned.</p>}
                  </section>
                  <section className="card p-5 md:p-6" aria-labelledby="rev-h">
                    <h2 id="rev-h" className="tag mb-2">Reviews from freelancers</h2>
                    {e.reviews.length ? (
                      <ul className="divide-row">
                        {e.reviews.slice(0, 8).map((r, i) => (
                          <li key={i} className="py-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="min-w-0 truncate text-[14px] font-medium">{r.title ?? "Contract"}</span>
                              {r.score != null && <span className="pill pill-neutral num shrink-0"><IconStar size={13} />{r.score.toFixed(1)}</span>}
                            </div>
                            {r.comment && <p className="mt-1 text-[15px] leading-relaxed text-[var(--color-muted)]">“{r.comment}”</p>}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-[var(--color-muted)]">No written reviews.</p>}
                  </section>
                </>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <InfoCard tag="Payment" status={c.paymentVerified ? "Verified" : c.paymentVerified === false ? "Not verified" : "Unknown"}
                    statusCls={c.paymentVerified ? "pill-good" : c.paymentVerified === false ? "pill-bad" : "pill-neutral"}
                    title={c.identityVerified ? "Identity verified" : "Identity not verified"} sub="As reported with this job"
                    icon={<IconCheck size={16} className="text-[var(--color-good)]" />} footLabel="Financial privacy" footValue={c.hasFinancialPrivacy ? "On" : "Off"} />
                  <InfoCard tag="Spend" status={compactMoney(c.totalSpent)} statusCls="pill-info"
                    title={`${c.totalHires} hires from ${c.totalPostedJobs} jobs`} sub={hireRate != null ? `${hireRate}% hire rate` : "No jobs posted before"}
                    icon={<IconBriefcase size={16} />} footLabel="Hire rate" footValue={hireRate != null ? `${hireRate}%` : "—"} />
                  <InfoCard tag="Feedback" status={c.totalReviews ? <><IconStar size={13} />{c.totalFeedback.toFixed(1)}</> : "No reviews"} statusCls={c.totalFeedback >= 4.5 ? "pill-good" : c.totalReviews ? "pill-warn" : "pill-neutral"}
                    title={`${c.totalReviews} reviews`} sub="Average rating from freelancers"
                    icon={<IconStar size={16} className="text-[var(--color-warn)]" />} footLabel="Rating" footValue={c.totalReviews ? c.totalFeedback.toFixed(2) : "—"} />
                  <Note className="md:col-span-2">Full client history (work history, reviews, hire rate) is fetched only for jobs that pass the cheap filters, up to the per-cycle limit in Settings → Ban-safety limits.</Note>
                </div>
              )}
            </div>
          ),
        },
        {
          id: "apply", label: `Apply${proposals.length ? ` (${proposals.length})` : ""}`, icon: <IconDoc size={16} />,
          content: (
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <section className="card p-5 md:p-6" aria-labelledby="sq-h">
                  <h2 id="sq-h" className="tag mb-3">Screening questions</h2>
                  {questions.length ? (
                    <ol className="grid list-decimal gap-2 pl-5 leading-relaxed">{questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
                  ) : <p className="text-[var(--color-muted)]">{e ? "This job has no screening questions." : "Unknown until client details are fetched."}</p>}
                </section>
                <section className="card p-5 md:p-6" aria-labelledby="cn-h">
                  <h2 id="cn-h" className="tag mb-3">Connects</h2>
                  <p className="display num text-[34px] font-bold leading-none">{e?.connectsCost ?? "—"}</p>
                  <p className="mt-2 text-[14px] text-[var(--color-muted)]">{e?.connectsBalance != null ? `You have ${e.connectsBalance} Connects.` : "Your balance shows in the Upwork preview before you submit."}</p>
                </section>
              </div>
              {!wantDraft && <DraftPanel jobId={job.id} existing={proposals.length} />}
              {proposalList}
            </div>
          ),
        },
        {
          id: "alerts", label: `Alerts (${alerts.length})`, icon: <IconChat size={16} />,
          content: alerts.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {alerts.map((a) => (
                <InfoCard key={a.id} tag={a.channel === "call" ? "Voice call" : "Telegram"} status={a.ok ? "Delivered" : "Failed"} statusCls={a.ok ? "pill-good" : "pill-bad"}
                  title={a.channel === "call" ? "Phone call placed" : "Message sent"} sub={fmtDateTime(a.createdAt)}
                  icon={a.channel === "call" ? <IconPhone size={16} /> : <IconSend size={16} />} footLabel="Result" footValue={<span className="font-normal">{a.detail}</span>} />
              ))}
            </div>
          ) : <p className="card p-6 text-[var(--color-muted)]">No alerts were sent for this job. The rank was below your thresholds, alerts were paused, or the call rules didn&apos;t allow a call.</p>,
        },
      ]} />
      {wantDraft && proposalList && <div className="mt-6">{proposalList}</div>}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-[var(--color-muted)]">{label}</p>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

/** Advisory hire-likelihood verdict. Display only: it never changes the rank or the rules. */
function IntentCard({ intent }: { intent: ClientIntent }) {
  const high = intent.ghostRisk === "high";
  return (
    <section className={`card mb-4 p-5 md:p-6 ${high ? "border-[color-mix(in_srgb,var(--color-bad)_45%,var(--color-line))]" : ""}`} aria-labelledby="intent-h">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 id="intent-h" className="tag">Hire likelihood</h2>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <span className="display num text-[34px] font-bold leading-none" style={{ color: high ? "var(--color-bad)" : intent.ghostRisk === "medium" ? "var(--color-warn)" : "var(--color-good)" }}>{intent.hireLikelihood}%</span>
            <span className={`pill ${intentPill(intent.ghostRisk)}`}>{intentRiskLabel(intent.ghostRisk)}</span>
            <span className="text-[15px] font-medium">{INTENT_LABELS[intent.archetype] ?? intent.archetype}</span>
            {high && <span className="pill pill-bad">Likely not hiring — skip</span>}
          </div>
        </div>
        <Link href="/ranking" className="shrink-0 text-[14px] font-medium text-[var(--color-accent)] underline-offset-4 hover:underline">How ranking works →</Link>
      </div>
      {intent.evidence.length > 0 && <div className="mt-4"><Bullets items={intent.evidence} tone={high ? "bad" : intent.ghostRisk === "medium" ? "warn" : "good"} /></div>}
      <p className="mt-4 text-[13px] text-[var(--color-muted)]">
        Advisory only — your ranking rules are unchanged. High-risk jobs get no auto-draft.
        <span className="text-[var(--color-faint)]"> · Source: {intent.source === "rules+ai" ? "rules + AI" : "rules"}</span>
      </p>
    </section>
  );
}

function Summary({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="card flex min-w-0 items-center gap-4 p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[var(--color-control)]">{icon}</span>
      <div className="min-w-0">
        <p className="display truncate text-[17px] font-semibold">{title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[14px]">{children}</p>
      </div>
    </div>
  );
}

function Dot({ ok, yes, no, unknown }: { ok: boolean | null; yes: string; no: string; unknown: string }) {
  const color = ok ? "var(--color-good)" : ok === false ? "var(--color-bad)" : "var(--color-faint)";
  return <span className="inline-flex items-center gap-1.5" style={{ color }}><span className="size-2 rounded-sm" style={{ background: color }} />{ok ? yes : ok === false ? no : unknown}</span>;
}

/*
 * Backfill / refresh proposal outcomes from Upwork (read-only MCP calls; writes only our proposal_outcomes table)
 * and print which proposals got a client reply and which did not.
 * Usage: npx tsx --env-file=.env scripts/sync-outcomes.ts [--report-only] [--days=120] [--max-calls=600]
 */
import { listProposalOutcomes } from "../lib/db";
import { syncProposalOutcomes } from "../lib/learning/outcomes";

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
const LABEL = { win: "✅ replied/hired", loss_viewed: "👀 viewed, no reply", loss_unviewed: "🙈 not viewed", pending: "⏳ waiting", void: "· no signal" } as const;

async function main() {
  const days = arg("days", 120);
  if (!process.argv.includes("--report-only")) {
    const r = await syncProposalOutcomes({ pages: 8, sinceDays: days, maxCalls: arg("max-calls", 600), log: console.log });
    console.log(`Synced: ${r.listed} listed · ${r.added} new · ${r.changed} changed · ${r.detailed} detailed · ${r.roomChecks} room checks · ${r.calls} Upwork calls${r.stoppedAtCap ? " (stopped at cap - run again)" : ""}`);
  }
  const rows = await listProposalOutcomes({ since: new Date(Date.now() - days * 864e5).toISOString() });
  const counts: Record<string, number> = {};
  for (const o of rows) {
    counts[o.outcome] = (counts[o.outcome] ?? 0) + 1;
    console.log(`${o.submittedAt.slice(0, 10)} ${LABEL[o.outcome].padEnd(20)} ${o.status.padEnd(9)} ${(o.job?.field ?? "-").slice(0, 22).padEnd(22)} ${o.jobTitle.slice(0, 70)}${o.firstReply ? `\n            ↳ "${o.firstReply.replace(/\s+/g, " ").slice(0, 110)}"` : ""}`);
  }
  const decided = (counts.win ?? 0) + (counts.loss_viewed ?? 0) + (counts.loss_unviewed ?? 0);
  console.log(`\n${rows.length} proposals in ${days} days:`, Object.entries(counts).map(([k, v]) => `${LABEL[k as keyof typeof LABEL]} ${v}`).join(" · "),
    decided ? `\nReply rate (decided only): ${Math.round(((counts.win ?? 0) / decided) * 100)}%` : "");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

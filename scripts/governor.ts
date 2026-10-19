/*
 * Upwork pacing governor from the shell - the Claude chat watch loop asks it before every Upwork call.
 *   npm run -s governor -- next                               <category> (exit 0) | WAIT <reason> (10) | STOP <reason> (20)
 *                                                             - the category due now (the chat loop's every-minute cron)
 *   npm run -s governor -- check <category>                  GO (exit 0) | WAIT <reason> (10) | STOP <reason> (20)
 *   npm run -s governor -- record <category> ok|error "<message>" [--new N --hv M]
 *                       --new/--hv: new jobs and high-value ones (client spent ≥ $10k, fixed ≥ $1k or ≥ $70/hr)
 *                       in this result - they teach the evening-peak window which hours matter.
 *   npm run -s governor -- status
 *   npm run -s governor -- resume                             human only, after Upwork support restores access
 *   npm run -s governor -- mark-restricted "<message>"        record a restriction seen elsewhere (no Telegram)
 * Categories: most_recent, best_match (smart_search), saved_query, keyword (search). A raw "tool.action" label
 * also works for other calls. Calls checked here are counted with the worker's in one shared budget.
 */
import { decide, governorStatus, markRestricted, nextCategory, noteJobs, record, resume, type CallMeta } from "@/lib/upwork/governor";

const flag = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Math.max(0, Number(process.argv[i + 1]) || 0) : 0; };

const CATEGORIES: Record<string, string> = {
  most_recent: "find_jobs.smart_search",
  best_match: "find_jobs.smart_search",
  saved_query: "find_jobs.search",
  keyword: "find_jobs.search",
};
const target = (arg: string | undefined): { label: string; meta: CallMeta } => {
  if (!arg) throw new Error("missing category");
  if (CATEGORIES[arg]) return { label: CATEGORIES[arg], meta: { feed: true, category: arg } };
  if (/^[a-z_]+\.[a-z_]+$/.test(arg)) return { label: arg, meta: {} };
  throw new Error(`unknown category "${arg}" - use ${Object.keys(CATEGORIES).join(", ")} or tool.action`);
};

async function main(): Promise<number> {
  const [cmd, a, b, c] = process.argv.slice(2);
  switch (cmd) {
    case "next": {
      const n = await nextCategory(CATEGORIES, "chat");
      if ("category" in n) { console.log(n.category); return 0; }
      if (n.go) return 0;
      const when = Number.isFinite(n.retryAt) ? ` (next ${new Date(n.retryAt).toISOString()})` : "";
      console.log(`${n.scope === "stop" ? "STOP" : "WAIT"} ${n.reason}${when}`);
      return n.scope === "stop" ? 20 : 10;
    }
    case "check": {
      const t = target(a);
      const d = await decide(t.label, t.meta, "chat");
      if (d.go) { console.log("GO"); return 0; }
      const when = Number.isFinite(d.retryAt) ? ` (next ${new Date(d.retryAt).toISOString()})` : "";
      console.log(`${d.scope === "stop" ? "STOP" : "WAIT"} ${d.reason}${when}`);
      return d.scope === "stop" ? 20 : 10;
    }
    case "record": {
      const t = target(a);
      if (b !== "ok" && b !== "error") throw new Error('record needs "ok" or "error"');
      const msg = c && !c.startsWith("--") ? c : "error";
      const cls = await record(t.label, b === "ok", b === "ok" ? null : msg, t.meta, { log: true });
      if (b === "ok") await noteJobs(flag("new"), flag("hv"));
      console.log(cls ? `RECORDED error (${cls})` : "RECORDED ok");
      return cls === "restricted" ? 20 : 0;
    }
    case "status":
      console.log(JSON.stringify(await governorStatus(), null, 2));
      return 0;
    case "resume":
      await resume();
      console.log("RESUMED at slow-down level L2 (20 min per category); it speeds up after clean hours");
      return 0;
    case "mark-restricted":
      await markRestricted(a ?? "restricted");
      console.log("MARKED restricted");
      return 0;
    default:
      console.log("usage: governor check|record|status|resume|mark-restricted …");
      return 2;
  }
}

main().then((code) => process.exit(code), (e) => { console.error(`ERROR ${(e as Error).message}`); process.exit(2); });

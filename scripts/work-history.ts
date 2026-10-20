/*
 * Past Upwork contracts with client ratings and feedback - the index the proposal writer cites (David, 2026-10-20).
 *   npm run -s work-history -- build [--calls N] [--fresh]   index (or continue indexing) via the Upwork MCP, through the governor
 *   npm run -s work-history -- status                         what is stored
 *   npm run -s work-history -- show "<job title + skills>"    the contracts the writer would cite for that job
 * `build` makes Upwork calls (list_contracts search/get) - run it yourself, once; later runs only pick up new contracts.
 */
import { buildWorkHistory, relevantWork, workHistory } from "@/lib/agents/workHistory";

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "build") {
    const calls = Number(rest[rest.indexOf("--calls") + 1]) || 40;
    const h = await buildWorkHistory({ maxCalls: rest.includes("--calls") ? calls : 40, fresh: rest.includes("--fresh"), log: (m) => console.log(m) });
    for (const n of h.notes) console.log(`note: ${n}`);
    if (h.sample && !h.items.length) console.log("sample row:", JSON.stringify(h.sample).slice(0, 1500));
    console.log(`${h.complete ? "COMPLETE" : "PARTIAL"} ${h.items.length} contracts, ${h.items.filter((i) => i.feedback).length} with feedback text, ${h.detailsPending.length} details pending${h.detailsPending.length ? " - run build again to continue" : ""}`);
    return 0;
  }
  const h = await workHistory();
  if (!h) { console.log("No index yet. Run: npm run -s work-history -- build"); return 1; }
  if (cmd === "show") {
    const text = rest.join(" ");
    if (!text) { console.log('usage: work-history show "<job title and skills>"'); return 2; }
    const picks = relevantWork(h.items, text, 5);
    if (!picks.length) console.log("No similar contract in the index.");
    for (const it of picks) console.log(`★${it.rating ?? "?"} ${it.title} (${it.client ?? "?"}, $${it.earned ?? "?"}, ${it.ended ?? it.started ?? "?"})\n   ${it.feedback ?? "(no feedback text)"}\n   [${it.skills.join(", ")}]`);
    return 0;
  }
  console.log(`${h.complete ? "complete" : `partial (offset ${h.offset})`} · built ${h.builtAt} · ${h.items.length} contracts · ${h.items.filter((i) => i.feedback).length} with feedback text · ${h.items.filter((i) => (i.rating ?? 0) >= 4.8).length} rated ≥ 4.8 · ${h.detailsPending.length} details pending`);
  for (const n of h.notes) console.log(`note: ${n}`);
  if (h.sample) console.log("sample search row keys:", Object.keys(h.sample as object).join(", "));
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(`ERROR ${(e as Error).message}`); process.exit(2); });

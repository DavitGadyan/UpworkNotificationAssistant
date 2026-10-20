/*
 * The chat watch loop logs each Telegram job alert it sends (David, 2026-10-20), so the 24-hour stats count them
 * next to the app's own alerts:   npm run -s alerted -- <jobId> <fit> "<title>"
 */
import { logNotification } from "@/lib/db";

async function main(): Promise<number> {
  const [id, fitArg, ...title] = process.argv.slice(2);
  const fit = Number(fitArg);
  if (!id || !Number.isFinite(fit)) { console.log('usage: alerted <jobId> <fit> "<title>"'); return 2; }
  await logNotification({ jobId: id, channel: "telegram", ok: true, detail: "watch loop", title: title.join(" ") || id, score: Math.round(fit) });
  console.log(`LOGGED alert ${id}`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(`ERROR ${(e as Error).message}`); process.exit(2); });

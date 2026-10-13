import { createSearch, listSearches } from "./db";
import { demoJobs, demoSearches } from "./fixtures";
import { processResults, type Notifiers } from "./pipeline";
import { scoreJob } from "./scoring";

/*
 * Demo jobs are made up, so they never go to the real Telegram channel or phone - unless DEMO_NOTIFY=1
 * is set explicitly to test delivery.
 */
const silent: Notifiers = {
  telegram: async () => ({ ok: false, detail: "demo: not sent" }),
  call: async () => ({ ok: false, detail: "demo: not sent" }),
  ready: { telegram: false, call: false },
};

/** Seed demo searches if none exist, then route the fixture jobs to whichever search fits each one best. */
export async function runDemo(now = new Date(), notifiers: Notifiers | undefined = process.env.DEMO_NOTIFY === "1" ? undefined : silent) {
  if (!(await listSearches()).length) for (const s of demoSearches) await createSearch(s);
  const searches = (await listSearches()).filter((s) => s.enabled);
  const jobs = demoJobs(now.getTime());
  const totals = { fresh: 0, telegram: 0, calls: 0 };
  for (const s of searches) {
    const mine = jobs.filter((j) =>
      searches.reduce((best, cur) => (scoreJob(j, cur, now).total > scoreJob(j, best, now).total ? cur : best)).id === s.id);
    const r = await processResults(s, mine, { now, ...(notifiers ? { notifiers } : {}) });
    totals.fresh += r.fresh; totals.telegram += r.telegram; totals.calls += r.calls;
  }
  return totals;
}

import Link from "next/link";
import { Suspense } from "react";
import { FeedImport } from "@/components/FeedImport";
import { IconPlus } from "@/components/icons";
import { SearchesList } from "@/components/SearchesList";
import { PageHead } from "@/components/ui/PageHead";
import { getSettings, listJobs, listSearches } from "@/lib/db";
import { searchStats } from "@/lib/stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feeds" };

export default async function Feeds() {
  const searches = await listSearches();
  const jobs = await listJobs();
  const settings = await getSettings();
  const stats = Object.fromEntries(searches.map((s) => {
    const st = searchStats(s, jobs, settings);
    return [s.id, { total: st.total, matchRate: st.matchRate, notified: st.notified }];
  }));
  return (
    <>
      <PageHead title="Feeds" subtitle={`${searches.length} of 10 feeds. Each active feed is polled about every ${Math.round(settings.pollIntervalSec / 60)} minutes (with a little random jitter).`}
        actions={<Link href="/feeds?new=1" className="btn btn-dark"><IconPlus size={18} />New feed</Link>} />
      <FeedImport />
      <Suspense><SearchesList searches={searches} stats={stats} /></Suspense>
    </>
  );
}

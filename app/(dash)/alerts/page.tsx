import { AlertsToggle } from "@/components/AlertsToggle";
import { LineCard } from "@/components/LineCard";
import { PageHead } from "@/components/ui/PageHead";
import { SearchBox } from "@/components/SearchBox";
import { getSettings, listNotifications } from "@/lib/db";
import { describeCallRule } from "@/lib/schedule";
import { channelStats } from "@/lib/stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alerts" };

export default async function Alerts({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q?.trim().toLowerCase() ?? "";
  const settings = await getSettings();
  const all = (await listNotifications()).filter((n) => !q || n.title.toLowerCase().includes(q));
  const tg = all.filter((n) => n.channel === "telegram");
  const calls = all.filter((n) => n.channel === "call");
  return (
    <>
      <PageHead title="Alerts" subtitle="What reached you in the last 24 hours, per channel. Older entries are deleted with the jobs they belong to."
        actions={<AlertsToggle paused={settings.alertsPaused} />} />
      <SearchBox placeholder="Search alerts by job title" className="mb-4" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <LineCard title="Telegram" channel="telegram" rows={tg} {...channelStats(tg)}
          rule={settings.telegramEnabled ? `Messages for score ≥ ${settings.telegramMin}.` : "Telegram alerts are off."} />
        <LineCard title="Voice calls" channel="call" rows={calls} {...channelStats(calls)} rule={describeCallRule(settings)} />
      </div>
    </>
  );
}

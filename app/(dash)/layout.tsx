import { AutoRefresh } from "@/components/AutoRefresh";
import { Rail } from "@/components/shell/Rail";
import { TopBar } from "@/components/shell/TopBar";
import { getTokens, listNotifications } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const hourAgo = Date.now() - 36e5;
  const unread = (await listNotifications()).filter((n) => n.ok && new Date(n.createdAt).getTime() > hourAgo).length;
  const account = (await getTokens())?.account ?? "";
  const initials = account.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "JP";
  return (
    <div className="min-h-dvh bg-[var(--color-frame)]">
      <AutoRefresh />
      <TopBar unread={unread} />
      <div className="mx-auto grid max-w-[1560px] gap-6 px-4 pb-28 pt-6 md:grid-cols-[72px_minmax(0,1fr)] md:gap-10 md:px-6 md:pb-16 md:pt-8 lg:gap-14 lg:pl-10">
        <div className="md:self-start"><Rail initials={initials} /></div>
        <main id="main" className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

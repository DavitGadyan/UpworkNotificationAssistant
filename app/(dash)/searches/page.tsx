import { redirect } from "next/navigation";

/* Saved searches are called "Feeds" now; keep old links (and ?new=1) working. */
export default async function Searches({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  redirect(sp.new ? "/feeds?new=1" : "/feeds");
}

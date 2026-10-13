import type { NextRequest } from "next/server";
import { listJobs } from "@/lib/db";
import { json } from "@/lib/http";
import type { JobStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return json(await listJobs({
    status: (p.get("status") as JobStatus | "all") ?? "all",
    searchId: p.get("search") ? Number(p.get("search")) : undefined,
    q: p.get("q") ?? undefined,
  }));
}

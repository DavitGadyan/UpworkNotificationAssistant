import { json } from "@/lib/http";
import { governorStatus } from "@/lib/upwork/governor";

export const dynamic = "force-dynamic";

/** Live Upwork pacing for the dashboard: search rate, slow-down level, budgets and errors. Reads only; no Upwork call. */
export async function GET() {
  return json(await governorStatus());
}

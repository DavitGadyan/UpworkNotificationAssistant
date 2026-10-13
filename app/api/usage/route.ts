import { json } from "@/lib/http";
import { usageReport } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** Costs & balance: Claude spend (today / 7d / 30d, by agent and model, remaining credit) and Upwork usage + Connects. */
export async function GET(req: Request) {
  return json(await usageReport({ refreshConnects: new URL(req.url).searchParams.get("refresh") === "1" }));
}

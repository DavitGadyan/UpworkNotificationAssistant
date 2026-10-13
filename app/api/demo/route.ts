import { config } from "@/lib/config";
import { runDemo } from "@/lib/demo";
import { bad, json } from "@/lib/http";

export async function POST() {
  if (!config.demoMode) return bad("Demo mode is off (set DEMO_MODE=1)", 403);
  return json(await runDemo());
}

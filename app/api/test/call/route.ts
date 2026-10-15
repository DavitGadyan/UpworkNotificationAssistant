import { json } from "@/lib/http";
import { placeCall } from "@/lib/notify/retell";

export async function POST() {
  return json(await placeCall({
    job_title: "Test call from Up Assistant", budget: "no budget", score: "100", proposals: "0",
    client_summary: "this is only a test", matched_skills: "",
  }, { test: "1" }));
}

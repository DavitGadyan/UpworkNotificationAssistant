import Link from "next/link";
import { FunnelTiles, VersionTable } from "@/components/insights/promptAnalytics";
import { CardHead, Note } from "@/components/ui/bits";
import { labBoard, type LabBoard } from "@/lib/learning/promptLab";

/** Insights summary: overall funnel and the writer-version leaderboard; details on /insights/prompts. */
export async function PromptLab() {
  let b: LabBoard;
  try { b = await labBoard("proposal"); } catch (e) {
    return <section className="card mt-4 p-5 md:p-6"><CardHead title="Prompt analytics" /><Note tone="warn" className="mt-4">{(e as Error).message}</Note></section>;
  }
  return (
    <section className="card mt-4 p-5 md:p-6" aria-labelledby="lab-h">
      <CardHead id="lab-h" title="Prompt analytics"
        sub={`Which writer prompt version gets replies and hires. A/B test ${b.config.enabled ? "on" : "off"}.`}
        right={<Link className="btn btn-sm btn-dark" href="/insights/prompts">Open prompt analytics →</Link>} />
      <div className="mt-4"><FunnelTiles f={b.funnel} /></div>
      {b.decided > 0 && <VersionTable b={b.overall} prompt="proposal" />}
    </section>
  );
}

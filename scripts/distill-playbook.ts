/*
 * Re-distil knowledge_base/closer_playbook.md from the sales course transcripts in knowledge_base/*.txt
 * (run after adding new courses). The current playbook was written from the same transcripts; review the
 * diff before committing. Usage: ANTHROPIC_API_KEY=… npm run distill:playbook
 */
import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "knowledge_base");
const transcripts = readdirSync(dir).filter((f) => f.endsWith(".txt"))
  .map((f) => `<course file="${f}">\n${readFileSync(join(dir, f), "utf8")}\n</course>`).join("\n\n");
const current = (() => { try { return readFileSync(join(dir, "closer_playbook.md"), "utf8"); } catch { return ""; } })();

async function main() {
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 64000,
    output_config: { effort: "high" },
    system: "You distil sales course transcripts into a dense, practical playbook for a Closer agent that advises David Gadyan (Upwork Expert-Vetted freelance AI engineer) how to reply to prospective clients in Upwork message threads to win high-value contracts at senior rates. Adapt everything to async written chat on Upwork; money stays on Upwork; no manipulation, fake scarcity or invented facts. Tag each key idea with its course in parentheses. Output only the markdown file.",
    messages: [{ role: "user", content: `${transcripts}\n\nCurrent playbook (keep its structure; improve and extend with anything new):\n${current}` }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("Model declined");
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
  writeFileSync(join(dir, "closer_playbook.md"), text.trim() + "\n");
  console.log(`Wrote closer_playbook.md (${text.split(/\s+/).length} words)`);
}
main().catch((e) => { console.error(e); process.exit(1); });

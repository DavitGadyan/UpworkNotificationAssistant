import { describe, expect, it } from "vitest";
import { mentionsAttachment, readAttachments } from "@/lib/agents/attachments";
import { mapDetail } from "@/lib/upwork/mcp/jobs";

// A minimal one-page PDF that says "Scope: 3 dashboards, budget 4000 EUR" (pdftotext rebuilds the xref).
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
  "4 0 obj<</Length 66>>stream\nBT /F1 12 Tf 20 100 Td (Scope: 3 dashboards, budget 4000 EUR) Tj ET\nendstream endobj\n" +
  "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const fake = (files: Record<string, { body: Buffer | string; type: string; status?: number }>) =>
  (async (url: string | URL | Request) => {
    const f = files[String(url)];
    if (!f) return new Response("nope", { status: 404 });
    return new Response(typeof f.body === "string" ? f.body : new Uint8Array(f.body), { status: f.status ?? 200, headers: { "content-type": f.type } });
  }) as typeof fetch;

describe("job post attachments for the proposal writer", () => {
  it("spots posts that refer to attached files", () => {
    expect(mentionsAttachment("Full spec is attached. Please read it.")).toBe(true);
    expect(mentionsAttachment("See the PDF for the screens")).toBe(true);
    expect(mentionsAttachment("We need a RAG chatbot for our docs")).toBe(false);
  });
  it("reads text and PDF attachments, and reports the ones it cannot read", async () => {
    const out = await readAttachments([
      { name: "brief.pdf", url: "https://x/brief.pdf" },
      { name: "notes.txt", url: "https://x/notes.txt" },
      { name: "mockups.fig", url: "https://x/mockups.fig" },
      { name: "secret.docx", url: null },
    ], fake({
      "https://x/brief.pdf": { body: PDF, type: "application/pdf" },
      "https://x/notes.txt": { body: "Deadline: 30 Nov", type: "text/plain" },
      "https://x/mockups.fig": { body: "binary", type: "application/octet-stream" },
    }));
    expect(out[0].text).toMatch(/3 dashboards, budget 4000 EUR/);
    expect(out[1].text).toBe("Deadline: 30 Nov");
    expect(out[2]).toMatchObject({ text: null, reason: expect.stringMatching(/unsupported/) });
    expect(out[3]).toMatchObject({ text: null, reason: "no download link" });
  });
  it("keeps attachments from the job details when Upwork returns them", () => {
    const { enrichment } = mapDetail({ data: { marketplaceJobPosting: { attachments: [{ name: "spec.pdf", link: "https://x/spec.pdf" }] } } });
    expect(enrichment.attachments).toEqual([{ name: "spec.pdf", url: "https://x/spec.pdf" }]);
  });
});

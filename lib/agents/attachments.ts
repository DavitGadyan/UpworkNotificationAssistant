import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobAttachment } from "../types";

/*
 * Job-post attachments for the proposal writer (David, 2026-10-15: "review all attached documents before
 * writing proposals"). Upwork's connector does not document attachments today, so this reads whatever the job
 * details carry and, just as important, says so when the post refers to files the writer could not read.
 */

const MAX_FILES = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CHARS = 15_000; // per file, after extraction
const TIMEOUT_MS = 20_000;

/** The post talks about files the client attached ("see attached", "the PDF", "brief attached"). */
export const mentionsAttachment = (text: string) =>
  /\b(attached|attachments?|enclosed|see (the )?(pdf|doc|docx|brief|file|spec|document|deck|sheet)|(in|on) the (attached )?(pdf|document|file|brief|spec|deck|spreadsheet))\b/i.test(text);

export interface ReadAttachment { name: string; text: string | null; reason?: string }

const pdfText = async (bytes: Buffer): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "upwork-att-"));
  try {
    const file = join(dir, "a.pdf");
    await writeFile(file, bytes);
    return await new Promise<string>((resolve, reject) =>
      execFile("pdftotext", ["-layout", "-q", file, "-"], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(out))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/** Download and extract text from up to 4 attachments: plain text, CSV, JSON, Markdown, HTML and PDF. */
export async function readAttachments(list: JobAttachment[], fetcher: typeof fetch = fetch): Promise<ReadAttachment[]> {
  const out: ReadAttachment[] = [];
  for (const a of list.slice(0, MAX_FILES)) {
    if (!a.url) { out.push({ name: a.name, text: null, reason: "no download link" }); continue; }
    try {
      const res = await fetcher(a.url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
      if (!res.ok) { out.push({ name: a.name, text: null, reason: `download failed (${res.status})` }); continue; }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_BYTES) { out.push({ name: a.name, text: null, reason: "file too large" }); continue; }
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      const isPdf = type.includes("pdf") || /\.pdf$/i.test(a.name) || bytes.subarray(0, 5).toString() === "%PDF-";
      let text: string | null = null;
      if (isPdf) text = await pdfText(bytes);
      else if (/^text\/|json|csv|markdown|xml/.test(type) || /\.(txt|md|csv|json|html?)$/i.test(a.name)) {
        text = bytes.toString("utf8").replace(/<[^>]+>/g, " ");
      }
      if (text == null) { out.push({ name: a.name, text: null, reason: `unsupported type (${type || "unknown"})` }); continue; }
      const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      out.push(clean ? { name: a.name, text: clean.slice(0, MAX_CHARS) } : { name: a.name, text: null, reason: "no readable text (scanned?)" });
    } catch (e) {
      out.push({ name: a.name, text: null, reason: (e as Error).name === "TimeoutError" ? "download timed out" : "could not read" });
    }
  }
  return out;
}

export const ATTACHMENTS_UNREAD_NOTE = "⚠️ The job post refers to attached files that were not read - open them on Upwork, then redraft with their key points pasted into \"Guidance for the writer\".";

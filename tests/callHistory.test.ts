import { describe, expect, it } from "vitest";
import { callReport, type CallRow } from "@/lib/callHistory";

const at = (iso: string) => Date.parse(`${iso}+04:00`);
const call = (iso: string, action: string, ok = true, detail: string | null = null): CallRow => ({ created_at: at(iso), tool: "find_jobs", action, ok, detail });

describe("Upwork call history report", () => {
  it("counts per day, peak rates and the rates before each throttle/restriction episode", () => {
    const rows = [
      call("2026-10-14T10:00:00", "search"),
      call("2026-10-14T10:05:00", "get"),
      call("2026-10-15T09:00:00", "search"),
      call("2026-10-15T09:01:00", "get"),
      call("2026-10-15T09:02:00", "get", false, "This job can't be opened right now (PERMISSION)"),
      call("2026-10-15T09:10:00", "search", false, "Your account has been restricted"),
      call("2026-10-15T15:00:00", "get", false, "No proposal room was found"),
    ];
    const md = callReport(rows, { "Job opens per day": 120 }, at("2026-10-19T12:00:00"));
    expect(md).toContain("| 2026-10-14 | 2 | 1 | 1 | 0 |");
    expect(md).toContain("| 2026-10-15 | 5 | 2 | 3 | 0 |");
    // One episode (errors 8 min apart), both kinds, 2 calls in the 10 minutes before it.
    expect(md).toMatch(/\| 10-15 09:02 \| 10-15 09:10 \| throttle \(find_jobs\.get\), restricted \(find_jobs\.search\) \| 2 \| 2 \|/);
    // "room not found" is an ordinary error, not a pacing episode.
    expect(md.match(/^\| 10-15/gm)).toHaveLength(1);
    expect(md).toContain("Days with no throttle or restriction: 2026-10-14.");
    expect(md).toContain("| Job opens per day | 120 |");
  });
});

import { describe, expect, it } from "vitest";
import { describeHits, findPlaceholders, normalizeHeadings, placeholderHits, removePlaceholders } from "@/lib/proposals/clean";

describe("client-ready proposal text", () => {
  it("finds notes to David, fill-in slots and TODOs", () => {
    expect(findPlaceholders("Explainer I wrote: [DAVID: add link]. More work: https://x.io")).toEqual(["[DAVID: add link]"]);
    expect(findPlaceholders("I moved it [add the real number] from X to Y")).toEqual(["[add the real number]", "from X to Y"]);
    expect(findPlaceholders("BUDGET: <number or range> - TODO")).toEqual(["<number or range>", "TODO"]);
    expect(findPlaceholders("Hi {{CLIENT_NAME}}, Loom: {{LOOM_URL}}")).toEqual(["{{CLIENT_NAME}}"]);
    expect(findPlaceholders("[CHECK: is this right?]")).toEqual(["[CHECK: is this right?]"]);
  });

  it("leaves normal text, the Loom placeholder and links alone", () => {
    expect(findPlaceholders("I ship React (Next.js) and Python. Loom: {{LOOM_URL}}. See [ImprovTalk](https://improvtalk.vip/). 2 < 3 > 1")).toEqual([]);
    expect(findPlaceholders("DELIVERABLES:\n• Day 5: review\nBUDGET: $80/hr")).toEqual([]);
  });

  it("names the field in the gate message and cuts notes out as a last resort", () => {
    const hits = placeholderHits({ coverLetter: "Hi,", answers: [{ answer: "ok" }, { answer: "Shipped it. [DAVID: add the number.] Done." }] });
    expect(describeHits(hits)).toBe('Answer 2 still has a note to you: "[DAVID: add the number.]"');
    expect(removePlaceholders("Shipped it. [DAVID: add the number.] Done.")).toEqual({ text: "Shipped it. Done.", removed: ["[DAVID: add the number.]"] });
  });

  it("writes the section headings in capitals and nothing else", () => {
    expect(normalizeHeadings("Hi Ann,\n\nDeliverables:\n• a budget: plan\n\nbudget : $5k\n\nDavid"))
      .toBe("Hi Ann,\n\nDELIVERABLES:\n• a budget: plan\n\nBUDGET: $5k\n\nDavid");
  });
});

describe("Upwork estimated duration for fixed-price previews", () => {
  it("maps what the draft or David wrote to Upwork's values", async () => {
    const { durationEnum } = await import("@/lib/proposals/submit");
    expect(durationEnum("1_to_3_months")).toBe("1_to_3_months");
    expect(durationEnum("1 to 3 months")).toBe("1_to_3_months");
    expect(durationEnum("Less than 1 month")).toBe("less_than_1_month");
    expect(durationEnum("2 weeks")).toBe("less_than_1_month");
    expect(durationEnum("3-6 months")).toBe("3_to_6_months");
    expect(durationEnum("6+ months")).toBe("more_than_6_months");
    expect(durationEnum("")).toBeNull();
    expect(durationEnum("soon")).toBeNull();
  });
});

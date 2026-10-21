import { describe, expect, it } from "vitest";
import { findPlaceholders } from "../lib/proposals/clean";
import { addProjectLink, hasProjectLink, removeProjectLink } from "../lib/proposals/similarWork";

const A = { title: "AI Marketing — Tracking, SEO & GEO/AEO", url: "https://davitgadyan.github.io/portfolio_app/portfolio/project-38/" };
const B = { title: "Generative AI: Video Ads", url: "https://davitgadyan.github.io/portfolio_app/portfolio/project-36/" };
const LETTER = "Hi Anna,\n\nYour tracking misses two of three enquiry routes.\n\nLoom: https://www.loom.com/share/abc\n\nDELIVERABLES:\n- GA4 audit\n\nBUDGET: $1,500 fixed\n\nShall I start Monday?";

describe("Similar work links in the letter", () => {
  it("adds one block just before DELIVERABLES, after the opener and Loom", () => {
    const out = addProjectLink(LETTER, A);
    const blocks = out.split("\n\n");
    expect(blocks[3]).toBe(`Similar work:\n- ${A.title}: ${A.url}`);
    expect(blocks[4]).toMatch(/^DELIVERABLES:/);
    expect(blocks.slice(0, 3)).toEqual(LETTER.split("\n\n").slice(0, 3));
  });

  it("puts a second link in the same block and never duplicates one", () => {
    const out = addProjectLink(addProjectLink(addProjectLink(LETTER, A), B), A);
    expect(out.match(/Similar work:/g)).toHaveLength(1);
    expect(out.match(new RegExp(A.url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g"))).toHaveLength(1);
    expect(hasProjectLink(out, B.url)).toBe(true);
  });

  it("goes before the closing paragraph when there is no DELIVERABLES block", () => {
    const out = addProjectLink("Hi,\n\nOpener.\n\nThanks, David", A);
    expect(out).toBe(`Hi,\n\nOpener.\n\nSimilar work:\n- ${A.title}: ${A.url}\n\nThanks, David`);
    expect(addProjectLink("", A)).toBe(`Similar work:\n- ${A.title}: ${A.url}`);
  });

  it("removes a link, and the heading with the last one, giving back the original letter", () => {
    const both = addProjectLink(addProjectLink(LETTER, A), B);
    const one = removeProjectLink(both, A.url);
    expect(hasProjectLink(one, A.url)).toBe(false);
    expect(one).toContain("Similar work:");
    expect(removeProjectLink(one, B.url)).toBe(LETTER);
    expect(removeProjectLink(LETTER, A.url)).toBe(LETTER);
  });

  it("never reads as a note to David or a fill-in slot", () => {
    expect(findPlaceholders(addProjectLink(LETTER, A))).toEqual([]);
  });
});

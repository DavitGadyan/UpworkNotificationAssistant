import { describe, expect, it } from "vitest";
import { locationRequirement } from "@/lib/ranking/rules";

describe("location requirements on the freelancer", () => {
  it("catches residency and on-site requirements", () => {
    for (const text of [
      "MUST BE UK BASED - We need a senior software engineer to independently audit AI-generated code",
      "You must be located in the United States to apply.",
      "IMPORTANT: You must currently live in the United States and be fully fluent in natural U.S. English.",
      "We are seeking a senior AI software developer based in the US. US-based candidates only.",
      "Onsite – In person, client site – Washington DC. Long Term.",
      "Senior · Hybrid · one on-site day per week near Avenida Paulista in São Paulo",
      "Remote-only delivery is not acceptable.",
      "This role is open to US citizens only.",
      "We are only accepting freelancers from Canada.",
    ]) expect(locationRequirement(text), text).not.toBeNull();
  });
  it("ignores where the client is, time zones and worldwide posts", () => {
    for (const text of [
      "We are a UK company based in London building an AI-powered CRM.",
      "Ideally you overlap with EST hours for a daily standup.",
      "Fully remote, worldwide. Skippio is used at stadiums across Ireland and the UK.",
      "Our team is based in Germany; you will work with our CTO.",
    ]) expect(locationRequirement(text), text).toBeNull();
  });
});

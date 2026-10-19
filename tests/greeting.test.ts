import { describe, expect, it } from "vitest";
import { greetingLine, localiseGreeting, nativeHello } from "@/lib/agents/greeting";

describe("proposal greeting in the client's language", () => {
  it("greets in the language of the client's country, keeping the name", () => {
    expect(greetingLine("Cyprus", null, "Jay")).toBe("Γεια σας Jay,");
    expect(greetingLine("Cyprus", null, null)).toBe("Γεια σας,");
    expect(greetingLine("DEU", null, "Anna Schmidt")).toBe("Hallo Anna,"); // ISO-3 code from the feed
    expect(greetingLine("Brazil", null, null)).toBe("Olá,");
    expect(nativeHello("Canada", "Quebec")).toBe("Bonjour");
  });
  it("uses plain Hi for English-speaking or unknown countries - never 'Hi there'", () => {
    expect(greetingLine("United States", null, null)).toBe("Hi,");
    expect(greetingLine("United Kingdom", null, "Jay")).toBe("Hi Jay,");
    expect(greetingLine(null, null, null)).toBe("Hi,");
  });
  it("swaps only the first greeting line of the draft", () => {
    const draft = "Hi there,\n\nA Lovable-style builder rarely fails on the chat UI.\n\nLoom: {{LOOM_URL}}";
    expect(localiseGreeting(draft, "Γεια σας,")).toBe("Γεια σας,\n\nA Lovable-style builder rarely fails on the chat UI.\n\nLoom: {{LOOM_URL}}");
    expect(localiseGreeting("Opener without greeting.\n\nLoom: x", "Hola,")).toBe("Hola,\n\nOpener without greeting.\n\nLoom: x");
    expect(localiseGreeting("Dia duit,\n\nAt a stadium, the hard part is peak load.", "Hi,")).toBe("Hi,\n\nAt a stadium, the hard part is peak load.");
    expect(localiseGreeting("Hi there,\n\nX", "Hi,")).toBe("Hi,\n\nX");
    expect(localiseGreeting("Dia duit, At a stadium, the half-time rush matters.\n\nLoom: x", "Hi,")).toBe("Hi,\n\nAt a stadium, the half-time rush matters.\n\nLoom: x");
    expect(localiseGreeting("At a stadium, the half-time rush matters.", "Hi,")).toBe("Hi,\n\nAt a stadium, the half-time rush matters.");
  });
});

import { describe, expect, it } from "vitest";
import { buildFieldSpec } from "@/lib/ranking/fields";
import { assessProfileFit } from "@/lib/ranking/profileFit";
import { detectCategory } from "@/lib/ranking/rules";

/* Real titles, skill tags and Upwork categories from the jobs stored on 2026-10-14. */
const job = (title: string, skills: string[] = [], category: string | null = null) => ({ title, skills, category });

describe("profile-fit gate", () => {
  it("marks work outside David's fields as off", () => {
    const off: [ReturnType<typeof job>, string][] = [
      [job("Unreal Engine 5 Technical Designer or Technical Artist, Blueprint, Niagara, Materials (US-based, part-time)", ["Unreal Engine", "Game Development Skills"], "Web, Mobile & Software Dev"), "Game development"],
      [job("Unreal Engine 5 Gameplay Programmer, C++ and Gameplay Ability System", ["Unreal Engine", "Game Development Skills"], "Web, Mobile & Software Dev"), "Game development"],
      [job("Trademark Attorney to File USPTO Applications for Healthcare SaaS", ["Trademark Law", "Trademark Search"], "Legal"), "Legal"],
      [job("Life Science Copywriter - Physical Sciences", ["Research & Development", "Cellular Biology", "Copywriting", "Life Science", "SEO Writing", "Proofreading"]), "Writing & editing"],
      [job("URGENT: Photoshop compositing and upscale for trade show backdrop", ["Adobe Photoshop", "Print Design", "Adobe Illustrator", "Photo Retouching"], "Design & Creative"), "Design & photo editing"],
      [job("Supply chain/warehouse ERP expert needed to write an educational course", ["Supply Chain Management", "Technical Writing", "Oracle Fusion Applications"], "Admin Support"), "Writing & editing"],
      [job("4Allfamily Customer Support Representative/Order Management", ["Customer Support"], "Customer Service"), "Customer service"],
      [job("US-Based EA/CPA for LLC Tax Strategy", ["Tax Preparation", "Tax Law", "CPA"], "Accounting & Consulting"), "Accounting & tax"],
      [job("Logo Designer for Maritime Technology Startup", ["Logo Design", "Graphic Design", "Adobe Photoshop"], "Design & Creative"), "Design & photo editing"],
      [job("AI-Assisted Podcast Video Editor — 60+ Episodes", ["Video Editing", "Podcast Editing", "Adobe Premiere Pro"], "Design & Creative"), "Video editing"],
      [job("Independent Sales Representative — Laboratory Technology", ["AI Product Sales", "B2B Marketing", "High-Ticket Closing"], "Sales & Marketing"), "Sales & PR roles"],
    ];
    for (const [j, field] of off) {
      const f = assessProfileFit(j);
      expect([j.title, f.verdict, f.field]).toEqual([j.title, "off", field]);
    }
  });

  it("keeps David's real fields in", () => {
    const mine = [
      job("Freelance python developer", ["OpenAI API", "Python", "Web Development", "LLM API Integration"], "Web, Mobile & Software Dev"),
      job("ML Engineer: fine-tune and measure a small Arabic diacritization model", ["PyTorch", "Natural Language Processing", "Deep Learning"], "Data Science & Analytics"),
      job("Senior Data Scientist / ML Expert – Kaggle Competition Experience", ["Data Science", "Python", "Machine Learning"], "Data Science & Analytics"),
      job("Paid Ads & Performance Marketing — Meta, Google, Retargeting", ["paid ads"]),
      job("Independent Blockchain Engineer for RealX", ["Blockchain", "Solidity", "Hardhat"], "Web, Mobile & Software Dev"),
      job("AI Video Automation Engineer | High-Volume Content Repurposing", ["Adobe Flash", "ActionScript"], "Data Science & Analytics"),
      job("AI Trading Assistant Agent", ["AI Trading", "AI Chatbot"]),
      job("AIOps engineer: alert correlation and auto-remediation", []),
      job("Zoho CRM - Remove Duplicates", ["Zoho CRM", "Zoho Creator", "Automation", "Data Entry", "Customer Relationship Management", "CRM Software"]),
      job("Record linkage / entity resolution across 3 customer databases", ["Python", "Data Entry"]),
      job("LLMOps / AI deployment engineer for inference on Kubernetes", []),
      job("Cloud / Deployment Engineer (Nigeria)", ["Cloud Architecture", "Cloud Engineering", "Amazon Web Services"], "IT & Networking"),
      job("Vapi voice agent for a dental clinic", []),
      job("AI Overhaul for Executive search", ["Claude", "AI Agent Development"], "Accounting & Consulting"),
      job("Higgsfield AI Video & Prompt Specialist for Beauty App", ["Graphic Design", "Adobe Illustrator", "Adobe Photoshop"], "Design & Creative"),
    ];
    for (const j of mine) expect([j.title, assessProfileFit(j).verdict]).toEqual([j.title, "core"]);
  });

  it("counts 3D work (Blender, 3ds Max, configurators) as his, but not game-dev roles with 3D tags", () => {
    expect(assessProfileFit(job("3D Artist / Blender Modeler", ["Autodesk 3ds Max", "Blender", "3D Modeling", "3D Design"], "Design & Creative"))).toMatchObject({ verdict: "core", field: "AI video, image & 3D" });
    expect(assessProfileFit(job("Product visualization renders", ["Cinema 4D", "KeyShot"], "Design & Creative")).verdict).toBe("core");
    expect(assessProfileFit(job("Unreal Engine level designer", ["Unreal Engine", "3D Modeling"], "Design & Creative"))).toMatchObject({ verdict: "off", field: "Game development" });
  });

  it("covers his 2026-10-15 list: sales analysis, secure LLM, compliance APIs, Figma-to-app", () => {
    for (const j of [
      job("Sales analysis and forecasting dashboard for a retail chain", ["Microsoft Excel"]),
      job("Secure LLM deployment with guardrails for a bank", []),
      job("HIPAA-compliant REST API for a telehealth app", ["Node.js"]),
      job("Figma to React: build our SaaS dashboard", ["Figma"]),
    ]) expect([j.title, assessProfileFit(j).verdict]).toEqual([j.title, "core"]);
    expect(assessProfileFit(job("Sales Representative for SaaS", ["Sales"], "Sales & Marketing")).verdict).toBe("off");
  });

  it("counts AI accounting systems as his (8 years accounting incl. EY), but not bookkeeping roles", () => {
    expect(assessProfileFit(job("Build an AI-powered accounting automation platform", ["Python", "OpenAI API"]))).toMatchObject({ verdict: "core", field: "AI accounting & finance systems" });
    expect(assessProfileFit(job("AI agent for invoice reconciliation", ["QuickBooks"], "Accounting & Consulting")).verdict).toBe("adjacent");
    expect(assessProfileFit(job("Bookkeeper for monthly reconciliations", ["Bookkeeping", "QuickBooks Online"], "Accounting & Consulting")).verdict).toBe("off");
  });

  it("lets the AI decide when the title mixes both or nothing is clear", () => {
    expect(assessProfileFit(job("AI Video Editor Needed — $500/Month | Long-Term Position")).verdict).toBe("adjacent");
    expect(assessProfileFit(job("Creative Strategist for Meta ads - Senior Direct Response Copywriter")).verdict).toBe("adjacent");
    expect(assessProfileFit(job("Salesforce Revenue Cloud Advanced (RCA) Solution Architect", ["Salesforce CRM"], "IT & Networking")).verdict).toBe("adjacent");
  });

  it("uses Upwork's subcategory: Game Design is out, AI Apps is in", () => {
    const sub = (title: string, skills: string[], subcategory: string) => ({ title, skills, category: "Web, Mobile & Software Dev", subcategory });
    expect(assessProfileFit(sub("Senior engineer for a multiplayer project", ["C++"], "Game Design & Development"))).toMatchObject({ verdict: "off", field: "Game development" });
    expect(assessProfileFit(sub("Creative assistant for our team", ["Graphic Design"], "AI Apps & Integration")).verdict).toBe("core");
    expect(assessProfileFit(sub("Book 20 sales calls a week", [], "Lead Generation & Telemarketing")).verdict).toBe("off");
  });

  it("applies David's own lists from Settings → Your fields", () => {
    const spec = buildFieldSpec({ never: ["WordPress"], alsoMine: ["Chrome extension"] });
    expect(assessProfileFit(job("WordPress site refresh", ["WordPress"]), spec).verdict).toBe("off");
    expect(assessProfileFit(job("Build a Chrome extension", []), spec)).toMatchObject({ verdict: "core", field: "Your list" });
    expect(assessProfileFit(job("Shopify theme tweaks", ["Shopify"]), buildFieldSpec(null, ["Shopify"])).verdict).toBe("core");
  });
});

describe("rule category guess", () => {
  const d = (description: string, title = "Contract role", skills: string[] = []) => detectCategory({ title, description, skills });
  it("no longer calls game, design or legal text AI work", () => {
    expect(d("Script enemy AI behaviour trees and rag doll physics in UE5.", "Gameplay programmer", ["Unreal Engine"])).not.toBe("ai");
    expect(d("Use Generative Fill to extend the backdrop, vector illustration welcome.", "Photoshop compositing")).not.toBe("ai");
    expect(d("You will act as our agent of record before the USPTO.", "Trademark filing")).not.toBe("ai");
  });
  it("still recognises real AI and data work, including stems like fine-tuning and data scientist", () => {
    expect(d("We need fine-tuning of a model on our support tickets.")).toBe("ai");
    expect(d("Looking for a data scientist to build churn models.")).toBe("data");
    expect(d("", "AI Voice Agent Developer")).toBe("ai");
  });
});

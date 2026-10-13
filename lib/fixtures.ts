import type { Job } from "./types";

/*
 * Made-up jobs for demo mode (DEMO_MODE=1), used before the API key is approved.
 * They follow the shape of a real search result, so the scorer, notifiers and every screen
 * can be exercised end to end. They are not Upwork data.
 */
type Seed = Omit<Job, "id" | "ciphertext" | "publishedAt"> & { ageMin: number };

const seeds: Seed[] = [
  {
    title: "Voice AI agent for inbound sales calls (Retell / Vapi)",
    description: "We need an experienced engineer to build a voice agent that qualifies inbound leads, books meetings in Google Calendar and logs to HubSpot. Must have shipped Retell or Vapi agents before.",
    skills: ["Retell AI", "Python", "Twilio", "OpenAI API", "HubSpot"], jobType: "HOURLY", amount: null,
    hourlyMin: 60, hourlyMax: 95, experienceLevel: "EXPERT", totalApplicants: 4, category: "AI Apps & Integration",
    client: { paymentVerified: true, identityVerified: true, totalSpent: 184_000, totalHires: 41, totalPostedJobs: 52, totalReviews: 33, totalFeedback: 4.9, country: "United States", hasFinancialPrivacy: false },
    ageMin: 3,
  },
  {
    title: "Next.js dashboard for logistics telemetry",
    description: "Build a responsive dashboard over our REST API: fleet map, vehicle drill-down, alerts. Tailwind + TypeScript. Figma ready.",
    skills: ["Next.js", "TypeScript", "Tailwind CSS", "React"], jobType: "FIXED", amount: 4_500,
    hourlyMin: null, hourlyMax: null, experienceLevel: "INTERMEDIATE", totalApplicants: 12, category: "Web Development",
    client: { paymentVerified: true, identityVerified: true, totalSpent: 62_500, totalHires: 18, totalPostedJobs: 25, totalReviews: 14, totalFeedback: 4.7, country: "Germany", hasFinancialPrivacy: false },
    ageMin: 11,
  },
  {
    title: "LLM agent to triage support tickets (LangGraph)",
    description: "Agent that reads Zendesk tickets, classifies, drafts replies and escalates. Evaluation harness required.",
    skills: ["LangChain", "Python", "OpenAI API", "Zendesk"], jobType: "HOURLY", amount: null,
    hourlyMin: 45, hourlyMax: 70, experienceLevel: "EXPERT", totalApplicants: 9, category: "AI Apps & Integration",
    client: { paymentVerified: true, identityVerified: true, totalSpent: 23_000, totalHires: 7, totalPostedJobs: 11, totalReviews: 6, totalFeedback: 4.6, country: "United Kingdom", hasFinancialPrivacy: false },
    ageMin: 26,
  },
  {
    title: "Quick fix: WordPress contact form not sending",
    description: "Contact form 7 stopped sending emails. Need someone today. Small budget.",
    skills: ["WordPress", "PHP"], jobType: "FIXED", amount: 40,
    hourlyMin: null, hourlyMax: null, experienceLevel: "ENTRY_LEVEL", totalApplicants: 38, category: "Web Development",
    client: { paymentVerified: false, identityVerified: false, totalSpent: 0, totalHires: 0, totalPostedJobs: 1, totalReviews: 0, totalFeedback: 0, country: "Canada", hasFinancialPrivacy: false },
    ageMin: 44,
  },
  {
    title: "Telegram bot with payments and admin panel",
    description: "Bot for a subscription community: Stripe payments, invite links, admin dashboard in React.",
    skills: ["Telegram API", "Node.js", "Stripe", "React"], jobType: "FIXED", amount: 2_200,
    hourlyMin: null, hourlyMax: null, experienceLevel: "INTERMEDIATE", totalApplicants: 17, category: "Web Development",
    client: { paymentVerified: true, identityVerified: true, totalSpent: 8_900, totalHires: 5, totalPostedJobs: 9, totalReviews: 4, totalFeedback: 5, country: "Australia", hasFinancialPrivacy: false },
    ageMin: 58,
  },
  {
    title: "Senior Python engineer – data pipelines on GCP",
    description: "Long-term contract. Airflow, BigQuery, dbt. 30 hrs/week.",
    skills: ["Python", "Google Cloud Platform", "Apache Airflow", "BigQuery"], jobType: "HOURLY", amount: null,
    hourlyMin: 55, hourlyMax: 80, experienceLevel: "EXPERT", totalApplicants: 21, category: "Data Engineering",
    client: { paymentVerified: true, identityVerified: true, totalSpent: 410_000, totalHires: 96, totalPostedJobs: 120, totalReviews: 71, totalFeedback: 4.8, country: "Netherlands", hasFinancialPrivacy: false },
    ageMin: 95,
  },
  {
    title: "Write 50 SEO blog posts about crypto",
    description: "Content writing, 1500 words each.",
    skills: ["Content Writing", "SEO"], jobType: "FIXED", amount: 300,
    hourlyMin: null, hourlyMax: null, experienceLevel: "ENTRY_LEVEL", totalApplicants: 50, category: "Writing",
    client: { paymentVerified: true, identityVerified: false, totalSpent: 1_200, totalHires: 3, totalPostedJobs: 14, totalReviews: 2, totalFeedback: 3.1, country: "India", hasFinancialPrivacy: false },
    ageMin: 130,
  },
  {
    title: "Retell voice agent: appointment reminders for dental clinics",
    description: "Outbound calls to confirm/reschedule. Integrate with our booking API via webhooks.",
    skills: ["Retell AI", "Node.js", "Webhooks", "REST API"], jobType: "FIXED", amount: 3_000,
    hourlyMin: null, hourlyMax: null, experienceLevel: "INTERMEDIATE", totalApplicants: 6, category: "AI Apps & Integration",
    client: { paymentVerified: true, identityVerified: true, totalSpent: 15_400, totalHires: 9, totalPostedJobs: 12, totalReviews: 8, totalFeedback: 4.9, country: "United States", hasFinancialPrivacy: false },
    ageMin: 7,
  },
  {
    title: "React Native app – fitness tracker MVP",
    description: "MVP with Expo, HealthKit, subscriptions. Designs ready.",
    skills: ["React Native", "Expo", "TypeScript"], jobType: "HOURLY", amount: null,
    hourlyMin: 35, hourlyMax: 50, experienceLevel: "INTERMEDIATE", totalApplicants: 28, category: "Mobile Development",
    client: { paymentVerified: true, identityVerified: true, totalSpent: 3_100, totalHires: 2, totalPostedJobs: 6, totalReviews: 1, totalFeedback: 4, country: "Spain", hasFinancialPrivacy: false },
    ageMin: 170,
  },
];

export function demoJobs(now = Date.now(), batch = String(now).slice(-6)): Job[] {
  return seeds.map(({ ageMin, ...s }, i) => ({
    ...s,
    id: `demo-${batch}-${i + 1}`,
    ciphertext: `~demo${batch}${i + 1}`,
    publishedAt: new Date(now - ageMin * 60_000).toISOString(),
  }));
}

export const demoSearches = [
  { kind: "search" as const, name: "Voice & AI agents", enabled: true,
    skills: ["Retell AI", "OpenAI API", "Python", "Twilio", "LangChain"], query: "",
    jobType: "ANY" as const, minHourly: 50, minBudget: 1500, experienceLevel: "ANY" as const,
    verifiedPaymentOnly: true, maxProposals: 30, excludeKeywords: ["wordpress"], excludeCountries: [],
  },
  { kind: "search" as const, name: "Full-stack web", enabled: true,
    skills: ["Next.js", "React", "TypeScript", "Node.js"], query: "",
    jobType: "ANY" as const, minHourly: 40, minBudget: 1000, experienceLevel: "ANY" as const,
    verifiedPaymentOnly: false, maxProposals: null, excludeKeywords: ["seo", "blog"], excludeCountries: [],
  },
];

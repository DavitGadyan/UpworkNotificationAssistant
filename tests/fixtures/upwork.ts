/*
 * Trimmed copies of real find_jobs payloads returned by the Upwork MCP connector on 2026-10-12/13
 * (descriptions shortened). Used to pin the field mapping and David's ranking rules.
 */

/** smart_search row: Irish data job - new client, payment NOT verified, $4k fixed, "5 to 10" proposals. */
export const irishDataRow = {
  budget: "$4,000.00",
  client: { country: "Ireland", verification_status: "NOT_VERIFIED" },
  created_date: "2026-10-12T21:33:03.043Z",
  description_snippet: "We need an experienced Data Engineer / Scientist to help us modernise our data management, analysis, and reporting infrastructure...",
  duration: "Less than 1 month",
  experience_level: "Intermediate",
  freelancers_to_hire: 1,
  id: "2109759271844237374",
  job_type: "fixed",
  proposals_tier: "5 to 10",
  published_date: "2026-10-12T21:33:06.098Z",
  skills: ["SQL", "Data Analysis", "Data Science", "Data Modeling", "Tableau"],
  title: "Data Engineer/Scientist for database management system set up",
  url: "https://www.upwork.com/jobs/~022109759271844237374?utm_campaign=LLM_claude_MCP_jobpost",
};

/** smart_search row: $70-110/hr Claude Code + MCP engineer, "20 to 50" proposals. */
export const mcpEngineerRow = {
  budget: "$70.00–$110.00/hr",
  client: { country: "Canada", verification_status: "NOT_VERIFIED" },
  created_date: "2026-10-12T21:07:08.695Z",
  description_snippet: "eSolveCommerce needs a senior engineer to finish the AI platform behind four companies...",
  duration: "3 to 6 months",
  engagement: "Less than 30 hrs/week",
  experience_level: "Expert",
  id: "2109752753266116560",
  job_type: "hourly",
  proposals_tier: "20 to 50",
  published_date: "2026-10-12T21:07:52.231Z",
  skills: ["AI Agent Development", "API Development", "TypeScript", "Model Context Protocol (MCP)", "Claude API"],
  title: "Senior Claude Code + MCP Engineer: Wire 4 Companies Into One Platform",
  url: "https://www.upwork.com/jobs/~022109752753266116560",
};

/** search row (Freelancer Plus: exact proposal_count), Freelancer-side search format "4,000.00". */
export const searchRow = {
  budget: "10.00–15.00/hr",
  client: { country: "Canada", total_posted_jobs: 2, verification_status: "VERIFIED" },
  created_date: "2026-10-12T21:35:45.902Z",
  description_snippet: "We are a Canadian B2B technology company specializing in fleet management solutions...",
  experience_level: "expert",
  id: "2109759955720751056",
  job_type: "hourly",
  proposal_count: 0,
  published_date: "2026-10-12T21:35:50.224Z",
  skills: ["LinkedIn", "Social Media Marketing", "Copywriting"],
  title: "LinkedIn Profile Manager | B2B Content & Personal Branding",
  url: "https://www.upwork.com/jobs/~022109759955720751056",
};

export const seniorLivingRow = {
  budget: "$1,500.00",
  client: { country: "United States", rating: 4.99, total_hires: 67, total_reviews: 41, total_spent: "$605,910.88", verification_status: "VERIFIED" },
  created_date: "2026-10-12T17:17:05.402Z",
  description_snippet: "AI Voice Agent Specialist — Senior Living Sales & Appointment Booking Prototype...",
  duration: "Less than 1 week",
  experience_level: "Expert",
  id: "2109694857514373182",
  job_type: "fixed",
  proposals_tier: "50+",
  published_date: "2026-10-12T17:18:04.626Z",
  skills: ["English", "AI Voice Agent Development", "HubSpot", "calendly"],
  title: "AI Voice Agent Specialist — Senior Living Sales & Appointment Booking Prototype",
  url: "https://www.upwork.com/jobs/~022109694857514373182",
};

/** find_jobs get for the senior-living job (client record, history, reviews). */
export const seniorLivingDetail = {
  applied: false,
  can_apply: true,
  client_feedback: {
    reviews: [
      { comment: "<untrusted_participant_content>\nAlan was great to work with. He was professional, communicative...\n</untrusted_participant_content>", ended: "2026-08-19T02:18:00.240Z", score: 5, title: "YouTube Editor + Shorts Repurposer" },
      { comment: "Great to work with Alan.", ended: "2025-05-08T15:44:27.533Z", score: 5, title: "Researcher Needed: Compile List of Top-Rated Home Healthcare Agencies" },
    ],
  },
  client_record: {
    contracts_active: 9, contracts_total: 67, feedback_count: 41, feedback_score: 4.99, hire_rate_percent: 72,
    hours_total: 14280.33, jobs_posted: 76, jobs_with_hires: 55, open_jobs: 1, spend_total: "$605,910.88",
  },
  client_work_history: {
    closed: [
      { ended: "2026-08-19T02:18:00.240Z", feedback_score: 5, started: "2026-06-21T04:29:00.472Z", status: "CLOSED", title: "YouTube Editor + Shorts Repurposer", type: "FIXED" },
      { ended: "2025-08-10T23:14:50.609Z", feedback_score: 5, started: "2025-06-24T19:40:39.146Z", status: "CLOSED", title: "Zapier Email Parser Expert Needed", type: "HOURLY" },
    ],
    open: [
      { started: "2026-07-17T14:27:22.714Z", status: "ACTIVE", title: "Senior Living Sales Development Representative (Weekend Role, Fully Remote)", type: "HOURLY" },
    ],
  },
  connects_balance: 288,
  connects_cost: 27,
  data: {
    marketplaceJobPosting: {
      activityStat: {
        applicationsBidStats: { avgRateBid: { rawValue: "1790.28" }, maxRateBid: { rawValue: "5000.0" }, minRateBid: { rawValue: "20.0" } },
        jobActivity: { invitesSent: 0, totalHired: 0, totalInvitedToInterview: 0, totalOffered: 0, totalUnansweredInvites: 0 },
      },
      classification: { category: { preferredLabel: "Data Science & Analytics" }, subCategory: { preferredLabel: "AI & Machine Learning" } },
      clientCompanyPublic: { country: { name: "United States" }, id: "422303", state: "MD", timezone: "America/Sao_Paulo" },
      content: { description: "**AI Voice Agent Specialist — Senior Living Sales & Appointment Booking Prototype** ... Approximately $2,500 fixed price ...", title: "AI Voice Agent Specialist — Senior Living Sales & Appointment Booking Prototype" },
      contractTerms: { contractType: "FIXED", experienceLevel: "EXPERT", fixedPriceContractTerms: { amount: { rawValue: "1500.0" } }, personsToHire: 1 },
      id: "2109694857514373182",
      workFlowState: { status: "ACTIVE" },
    },
  },
  preferred_qualifications: { english_proficiency: "Any", min_job_success_score: 0 },
  status: "ok",
};

/** David's saved search URL from the request. */
export const davidSearchUrl = "https://www.upwork.com/nx/search/jobs?amount=500-999,1000-4999,5000-&hourly_rate=70-&payment_verified=1&per_page=50&proposals=0-4,5-9,10-14,15-19&q=%28LLM%20OR%20%22Large%20OR%20Language%20OR%20Model%22%20OR%20Chatbot%20OR%20GPT%20OR%20SaaS%20OR%20Generative%20OR%20AI%20OR%20GenAI%20OR%20%22AI%20OR%20Engineer%22%20OR%20%22Data%20OR%20Science%22%20OR%20AI%20OR%20%22Digital%20OR%20Marketing%22%20OR%20SEO%20OR%20GEO%20OR%20AEO%20OR%20%22Machine%20OR%20Learning%22%20OR%20%22Deep%20OR%20Learning%22%20OR%20Crypto%20OR%20%22Algorithmic%20OR%20Trading%22%29&sort=recency&t=0,1";

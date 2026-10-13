import type { Tone } from "../theme";
import type { ProposalStatus } from "../types";

export const PROPOSAL_STATUS: Record<ProposalStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  needs_loom: { label: "Needs Loom", tone: "warn" },
  ready: { label: "Ready to approve", tone: "info" },
  approved: { label: "Approved", tone: "info" },
  previewed: { label: "Previewed", tone: "good" },
  submitted: { label: "Submitted", tone: "good" },
  discarded: { label: "Discarded", tone: "neutral" },
};

/** Stepper: Draft → Loom → Approved → Preview → Submitted. Returns the index of the current step. */
export const STEPS = ["Draft", "Loom", "Approved", "Preview", "Submitted"] as const;
export function stepIndex(s: ProposalStatus): number {
  switch (s) {
    case "draft": case "needs_loom": return 0;
    case "ready": return 1;
    case "approved": return 2;
    case "previewed": return 3;
    case "submitted": return 4;
    default: return -1;
  }
}

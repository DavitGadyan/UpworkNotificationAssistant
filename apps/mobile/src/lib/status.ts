import type { Tone } from "../theme";
import type { ProposalStatus } from "../types";

/* "needs_loom" is the status of a fresh draft (kept for compatibility); a Loom video is optional (David, 2026-10-20). */
export const PROPOSAL_STATUS: Record<ProposalStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  needs_loom: { label: "To review", tone: "warn" },
  ready: { label: "Ready to approve", tone: "info" },
  approved: { label: "Approved", tone: "info" },
  previewed: { label: "Previewed", tone: "good" },
  submitted: { label: "Submitted", tone: "good" },
  discarded: { label: "Discarded", tone: "neutral" },
};

/** Stepper: Draft → Approved → Preview → Submitted. Returns the index of the last completed step. */
export const STEPS = ["Draft", "Approved", "Preview", "Submitted"] as const;
export const LAST_STEP = STEPS.length - 1;
export function stepIndex(s: ProposalStatus): number {
  switch (s) {
    case "draft": case "needs_loom": case "ready": return 0;
    case "approved": return 1;
    case "previewed": return 2;
    case "submitted": return 3;
    default: return -1;
  }
}

/** What David does next, in one line - the editor's hero card. */
export function nextStep(s: ProposalStatus, loom: boolean): { title: string; hint: string } {
  switch (s) {
    case "draft": case "needs_loom": case "ready":
      return { title: "Review and approve", hint: loom ? "Loom attached. Read the letter, then approve." : "Read the letter and approve it. A Loom video is optional but usually preferred - without one the Loom line is simply left out." };
    case "approved": return { title: "Build the Upwork preview", hint: "Asks Upwork for the Connects cost and any unmet requirements. Nothing is sent yet." };
    case "previewed": return { title: "Submit to Upwork", hint: "Check the preview, then type SUBMIT. This spends Connects." };
    case "submitted": return { title: "Sent", hint: "Follow the client's reply in Closer." };
    default: return { title: "Discarded", hint: "Kept for the feedback loop." };
  }
}

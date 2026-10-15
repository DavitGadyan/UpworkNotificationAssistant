import type { OutcomeLabel } from "../types";

/** Shared labels for proposal outcomes (web + phone copy kept in step). Both losses are negative feedback. */
export const OUTCOME_LABEL: Record<OutcomeLabel, { label: string; cls: string; hint: string }> = {
  win: { label: "Client replied", cls: "pill-good", hint: "Client wrote back, interviewed, offered or hired" },
  loss_viewed: { label: "Viewed, no reply", cls: "pill-bad", hint: "Opened but never answered: the letter, bid or proof didn't convince" },
  loss_unviewed: { label: "Not viewed", cls: "pill-warn", hint: "Never opened: job choice, timing, crowding or the first line" },
  pending: { label: "Waiting", cls: "pill-neutral", hint: "Sent less than 7 days ago, no reply yet" },
  void: { label: "No signal", cls: "pill-neutral", hint: "Withdrawn, or the client deleted the job" },
};

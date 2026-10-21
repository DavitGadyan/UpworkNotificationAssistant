import type { Job, JobEnrichment } from "../types";
import { knownHires } from "./rules";

/*
 * Fake-job malware lures (David, 2026-10-20). "Blockchain AI Developer for Crypto Tracker" (job 2112214027538569768)
 * was an attack: the client opened with "Hi, how are you?" and then shared a GitHub repo to clone and run - the repo
 * carried malicious code (the well-known "fake interview" campaign aimed at developers' wallets, keys and sessions).
 * The post itself looked like a normal $50-90/hr crypto job; the tells were the client, not the text:
 *   crypto / web3 subject, hiring several freelancers, 6 jobs posted with 0 hires, 20 interviews and 0 offers.
 * Pure and deterministic; the rules engine turns a hit into a red "malware_lure" flag, auto-apply and auto-draft skip
 * it, and a client reply that hands over a repo or asks to run code gets a loud Telegram warning.
 */

export const CRYPTO = /\b(crypto\w*|blockchain|web3|defi|dapps?|nfts?|tokens?|tokenomics|smart contracts?|solidity|wallets?|dex|memecoins?|airdrops?|staking|ethereum|solana|bitcoin|btc|evm|on-?chain|trading bots?|sniper bots?|copy.?trading)\b/i;

/** The post asks the freelancer to clone, download, install or run the client's code as a test or first step. */
export const REPO_ASK = new RegExp([
  String.raw`\b(clone|download|pull|fork|run|install|set\s?up|build|start|launch|debug|test|review|check out)\b[^.\n]{0,60}\b(our|the|this|my|attached|shared)\s+(repo(sitory)?|code\s?base|project|source code|app)\b[^.\n]{0,40}\b(locally|on your (machine|computer|pc|laptop)|and run|then run)`,
  String.raw`\b(github|gitlab|bitbucket)\.(com|org|io)\/[\w.-]+\/[\w.-]+`,
  String.raw`\bnpm\s+(i|install|run|start)\b`,
  String.raw`\b(yarn|pnpm)\s+(install|dev|start)\b`,
  String.raw`\btake.?home\s+(test|task|assignment)\b[^.\n]{0,60}\b(repo|github|code)`,
].join("|"), "i");

/** A message (client reply) that hands over a repo or code bundle, or asks to run something locally. */
export const REPLY_LURE = new RegExp([
  String.raw`\b(github|gitlab|bitbucket)\.(com|org|io)\/`,
  String.raw`\b(drive\.google\.com|dropbox\.com|mega\.nz|we\.tl|wetransfer\.com)\/`,
  String.raw`\.(zip|rar|7z|tar\.gz|exe|msi|dmg|scr)\b`,
  String.raw`\bnpm\s+(i|install|run|start)\b`,
  String.raw`\b(clone|download|run|install|set\s?up|test)\b[^.\n]{0,50}\b(repo(sitory)?|code\s?base|project|app)\b[^.\n]{0,40}\b(locally|on your (machine|computer|pc|laptop))`,
].join("|"), "i");

/**
 * red   "malware_lure"      crypto/web3 + a hollow client (3+ jobs and 0 hires, or 10+ interviews and no offer), or a
 *                           request to run their code from a crypto or no-history client. Auto-draft / auto-apply skip it.
 * amber "malware_lure_risk" crypto/web3 from a client with no spend and no hires when the jobs-posted count is unknown
 *                           (Best Matches rows omit it - the reported job looked exactly like this), or a client with real
 *                           history who wants their app run locally (a code review can be legit - use a throwaway VM).
 */
export interface LureVerdict { code: "malware_lure" | "malware_lure_risk"; severity: "red" | "amber"; label: string; reasons: string[] }

export function malwareLure(job: Pick<Job, "title" | "description" | "skills" | "client">, e?: JobEnrichment | null): LureVerdict | null {
  const text = `${job.title}\n${e?.description || job.description}\n${job.skills.join(", ")}`;
  const crypto = CRYPTO.test(text);
  const repo = REPO_ASK.test(text);
  const posted = e?.record.jobsPosted ?? job.client.totalPostedJobs ?? 0;
  const hires = knownHires(job, e);
  const zeroHires = hires === 0 || e?.record.hireRatePercent === 0;
  const noHistory = hires === 0 && (e?.record.totalSpent ?? job.client.totalSpent ?? 0) <= 0;
  const act = e?.activity;
  const red: string[] = [], amber: string[] = [];
  if (crypto && zeroHires && posted >= 3) red.push(`${posted} jobs posted, 0 hires`);
  if (crypto && act && act.interviewed >= 10 && act.hired === 0 && act.offered === 0) red.push(`${act.interviewed} interviews, no offer`);
  if (repo) (crypto || noHistory ? red : amber).push("asks you to clone or run their code");
  if (crypto && noHistory && posted < 3 && !red.length) amber.push("no spend and no hires yet");
  const tag = crypto ? " (crypto/web3)" : "";
  if (red.length) return { code: "malware_lure", severity: "red", reasons: [...red, ...amber],
    label: `Possible fake-job malware lure${tag}: ${[...red, ...amber].join("; ")} - never clone, install or run the client's code` };
  if (amber.length) return { code: "malware_lure_risk", severity: "amber", reasons: amber,
    label: `Malware-lure risk${tag}: ${amber.join("; ")} - run any client code or files only in a throwaway VM, never on your own machine` };
  return null;
}

/** Why a client message looks like the lure's second step (repo / file / "run it locally"), or null. */
export function replyLure(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(REPLY_LURE);
  return m ? m[0].slice(0, 80) : null;
}

import { latestReport, saveReport } from "../db";
import { callTool } from "../upwork/mcp/client";

/*
 * Ideal Client Profile: who paid David the most. Built from the last 12 months of transactions
 * (Service Fee rows carry contract id, title, client and the gross amount), keeping the top 40 % of
 * contracts by value, then enriching those contracts with whatever client details Upwork returns.
 * Refreshed monthly by the worker; injected into the JobRankingAssistant prompt.
 */

export interface IcpContract { contractId: string; title: string; client: string; gross: number; last: string; country: string | null; type: string | null }
export interface Icp {
  builtAt: string;
  windowFrom: string;
  totalGross: number;
  contracts: number;
  top: IcpContract[];
  countries: Record<string, number>;
  avgTopContract: number;
  notes: string[];
}

type TxRow = { accountingSubtype?: string; description?: string; transactionCreationDate?: string; assignmentCompanyName?: string };

export function parseServiceFees(rows: TxRow[]): Map<string, IcpContract> {
  const byContract = new Map<string, IcpContract>();
  for (const r of rows) {
    if (r.accountingSubtype !== "Service Fee" || !r.description) continue;
    const id = r.description.match(/Contract ID:\s*(\d+)/)?.[1];
    if (!id) continue;
    const title = r.description.match(/Contract title:\s*(.+)/)?.[1]?.trim() ?? "";
    const client = r.description.match(/Client:\s*(.+)/)?.[1]?.trim() ?? r.assignmentCompanyName ?? "";
    const gross = Number(r.description.match(/\$([\d,.]+)\s*USD\s*x/)?.[1]?.replace(/,/g, "") ?? 0);
    const cur = byContract.get(id) ?? { contractId: id, title, client, gross: 0, last: "", country: null, type: null };
    cur.gross += gross;
    if ((r.transactionCreationDate ?? "") > cur.last) cur.last = r.transactionCreationDate ?? "";
    byContract.set(id, cur);
  }
  return byContract;
}

const findKey = (o: unknown, key: RegExp, depth = 0): unknown => {
  if (!o || typeof o !== "object" || depth > 6) return undefined;
  for (const [k, v] of Object.entries(o)) {
    if (key.test(k) && v != null && typeof v !== "object") return v;
    if (key.test(k) && v && typeof v === "object" && "name" in (v as object)) return (v as { name: unknown }).name;
  }
  for (const v of Object.values(o)) {
    const r = findKey(v, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
};

export async function buildIcp(now = new Date()): Promise<Icp> {
  const from = new Date(now.getTime() - 365 * 864e5).toISOString().slice(0, 10);
  const tx = await callTool<{ data?: { transactionHistory?: { transactionDetail?: { transactionHistoryRow?: TxRow[] } } } }>(
    "get_profile", "transactions", { from_date: from, limit: 200 },
  );
  const rows = tx.data?.transactionHistory?.transactionDetail?.transactionHistoryRow ?? [];
  const all = [...parseServiceFees(rows).values()].sort((a, b) => b.gross - a.gross);
  const topN = Math.max(1, Math.ceil(all.length * 0.4));
  const top = all.slice(0, Math.min(topN, 15));
  const notes: string[] = [];
  for (const c of top) {
    try {
      const d = await callTool("list_contracts", "get", { contract_id: c.contractId });
      c.country = (findKey(d, /^country$/i) as string | undefined) ?? null;
      c.type = (findKey(d, /^(contractType|deliveryModel|type)$/i) as string | undefined) ?? null;
    } catch (e) {
      notes.push(`contract ${c.contractId}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  const countries: Record<string, number> = {};
  top.forEach((c) => { const k = c.country ?? "unknown"; countries[k] = (countries[k] ?? 0) + c.gross; });
  const icp: Icp = {
    builtAt: now.toISOString(),
    windowFrom: from,
    totalGross: Math.round(all.reduce((a, c) => a + c.gross, 0)),
    contracts: all.length,
    top,
    countries,
    avgTopContract: Math.round(top.reduce((a, c) => a + c.gross, 0) / Math.max(1, top.length)),
    notes,
  };
  await saveReport("icp", icp);
  return icp;
}

export const currentIcp = async () => await latestReport<Icp>("icp");

export async function icpDigest(): Promise<string> {
  const r = await currentIcp();
  if (!r) return "Not built yet (run Insights → Rebuild client profile). Prefer US/UK/EU/Gulf/AU clients with large budgets for end-to-end AI builds.";
  const i = r.data;
  return [
    `Last 12 months: $${i.totalGross.toLocaleString("en-US")} across ${i.contracts} contracts. Top 40% average $${i.avgTopContract.toLocaleString("en-US")}.`,
    `Revenue by client country (top contracts): ${Object.entries(i.countries).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} $${Math.round(v)}`).join(", ")}`,
    "Top contracts: " + i.top.slice(0, 10).map((c) => `"${c.title}" (${c.client}, $${Math.round(c.gross)})`).join("; "),
  ].join("\n");
}

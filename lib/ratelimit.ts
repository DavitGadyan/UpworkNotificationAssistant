import { config } from "./config";
import { bumpDailyRequests, dailyRequests } from "./db";

/** Sliding one-minute window in-process, plus a persisted daily counter. */
const stamps: number[] = [];

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

export class RateLimitError extends Error {}

export async function acquire(now = Date.now()): Promise<void> {
  if ((await dailyRequests(today(new Date(now)))) >= config.limits.perDay) {
    throw new RateLimitError(`Daily cap of ${config.limits.perDay} requests reached`);
  }
  while (stamps.length && now - stamps[0] > 60_000) stamps.shift();
  if (stamps.length >= config.limits.perMinute) {
    const wait = 60_000 - (now - stamps[0]) + 50;
    await new Promise((r) => setTimeout(r, wait));
    return acquire();
  }
  stamps.push(now);
  await bumpDailyRequests(today(new Date(now)));
}

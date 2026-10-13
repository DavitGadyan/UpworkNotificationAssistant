import { config } from "../config";
import { acquire, RateLimitError } from "../ratelimit";
import { accessToken } from "./oauth";

export class UpworkApiError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

/** POST a GraphQL operation to Upwork. Retries 429 / 5xx with exponential backoff (max 4 tries). */
export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let delay = 2_000;
  for (let attempt = 1; ; attempt++) {
    await acquire();
    const headers: Record<string, string> = {
      Authorization: `bearer ${await accessToken()}`,
      "Content-Type": "application/json",
    };
    if (config.upwork.tenantId) headers["X-Upwork-API-TenantId"] = config.upwork.tenantId;

    const res = await fetch(config.upwork.graphqlUrl, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retryAfter = Number(res.headers.get("retry-after")) * 1000;
      await new Promise((r) => setTimeout(r, retryAfter || delay));
      delay *= 2;
      continue;
    }
    if (res.status === 429) throw new RateLimitError("Upwork returned 429 after retries");
    const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
    if (!res.ok) throw new UpworkApiError(`GraphQL HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, res.status);
    if (body?.errors?.length) throw new UpworkApiError(body.errors.map((e) => e.message).join("; "));
    if (!body?.data) throw new UpworkApiError("Empty GraphQL response");
    return body.data;
  }
}

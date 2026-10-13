/** Server-only configuration. Every value comes from the environment (see .env.example). */
export const config = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Upwork Assistant",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3010",
  dbPath: process.env.DB_PATH ?? "./data/jobpulse.db",
  demoMode: process.env.DEMO_MODE === "1",
  upwork: {
    clientId: process.env.UPWORK_CLIENT_ID ?? "",
    clientSecret: process.env.UPWORK_CLIENT_SECRET ?? "",
    tenantId: process.env.UPWORK_TENANT_ID ?? "",
    authorizeUrl: "https://www.upwork.com/ab/account-security/oauth2/authorize",
    tokenUrl: "https://www.upwork.com/api/v3/oauth2/token",
    graphqlUrl: "https://api.upwork.com/graphql",
  },
  mcp: {
    url: process.env.UPWORK_MCP_URL ?? "https://mcp.upwork.com/mcp",
    /** Freelancer org from list_accounts. Empty = first TALENT account. */
    orgUid: process.env.UPWORK_ORG_UID ?? "",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  },
  tokenEncKey: process.env.TOKEN_ENC_KEY ?? "",
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  },
  retell: {
    apiKey: process.env.RETELL_API_KEY ?? "",
    agentId: process.env.RETELL_AGENT_ID ?? "",
    fromNumber: process.env.RETELL_FROM_NUMBER ?? "",
    toNumber: process.env.RETELL_TO_NUMBER ?? "",
  },
  /** GraphQL hard ceilings, comfortably inside Upwork's 300 req/min/IP and 40k req/day. */
  limits: { perMinute: 250, perDay: 30_000 },
  /** Upwork data nobody acted on is purged after 24h. Jobs with a draft/proposal are kept. */
  retentionMs: 24 * 60 * 60 * 1000,
};

const base = () => config.publicBaseUrl.replace(/\/$/, "");
export const redirectUri = () => `${base()}/api/auth/callback`;
export const mcpRedirectUri = () => `${base()}/api/mcp/callback`;

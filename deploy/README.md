# Deploy to the GCP VM

1. DNS (Namecheap): add `A  jobs  35.209.49.25` (the VM that already serves `api.improvtalk`). Keep the hostname neutral; never put "upwork" in it.

2. On the VM:
   ```bash
   git clone <this repo> ~/upwork-assistant && cd ~/upwork-assistant
   cp .env.example .env && nano .env    # PUBLIC_BASE_URL, DASHBOARD_PASSWORD, TOKEN_ENC_KEY, ANTHROPIC_API_KEY, Telegram, (Retell)
   docker compose up -d --build
   ```
3. Reverse proxy: check which one is already running (`systemctl status caddy nginx`) and add the matching snippet from this folder. This only adds a new site block.
4. Open https://jobs.s1mpleai.org/about (public), then https://jobs.s1mpleai.org/ (basic auth). On your phone, use "Add to Home Screen" to install it as an app.
5. **Connect Upwork:** Settings → Connect Upwork (MCP) → log in → approve.
   - The OAuth callback is `https://jobs.s1mpleai.org/api/mcp/callback`. It is registered automatically through dynamic client registration.
   - Tokens are stored encrypted in `data/jobpulse.db` and refresh on their own.
6. **Telegram:**
   - Add the bot as an **admin** of the channel, with *Post messages* and *Edit messages of others*.
   - Put the channel id in `TELEGRAM_CHAT_ID` (`/api/telegram/discover` shows it).
   - Then register the button webhook:
     `curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://jobs.s1mpleai.org/api/telegram/webhook&secret_token=$TELEGRAM_WEBHOOK_SECRET&allowed_updates=%5B%22callback_query%22%5D"`
7. **Feeds:** Feeds → paste your three Upwork links:
   - `https://www.upwork.com/nx/find-work/most-recent`
   - `https://www.upwork.com/nx/find-work/`
   - your saved `https://www.upwork.com/nx/search/jobs?…` link
8. **Check before turning alerts on:** run `docker compose exec worker npx tsx worker/index.ts --once --dry-run`. It ranks the jobs without sending anything. Then watch Overview → Upwork calls for an hour.
9. **Optional fallback:** once the Marketplace API key is approved, put the client id/secret in `.env` and use Settings → Connect account. Set Settings → Data source to `auto` or `graphql`.

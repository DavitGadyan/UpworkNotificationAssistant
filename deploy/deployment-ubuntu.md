> **Superseded:** use [deploy/ubuntu/README.md](ubuntu/README.md) for the current 24/7 Ubuntu setup. This file is kept for reference.

# Deploying on Ubuntu (22.04 / 24.04)

Target: the GCP VM `35.209.49.25`, which already serves `api.improvtalk.s1mpleai.org`. The app gets its own hostname, **`jobs.s1mpleai.org`**, and nothing existing on the box is touched. Keep the hostname and app name neutral: never put "upwork" in them.

There are two ways to run it. Pick one:

| | A. Docker Compose (recommended) | B. Node + systemd |
|---|---|---|
| Setup | `docker compose up -d --build` | Node 22, `npm ci`, two systemd units |
| Restart on crash or stuck cycle | `restart: unless-stopped` | `Restart=always` |
| "Load via Claude" button | ✗ (no Claude Code CLI in the image) | ✓ (if you install and log in to `claude` on the VM) |

Everything else works identically in both: polling, ranking, alerts, proposals, Closer and insights.

**Data lives in Supabase**, not on the VM. Moving from your Mac to the VM means copying `.env` (same `TOKEN_ENC_KEY` and `SUPABASE_DB_URL`). The Upwork login, feeds, jobs and drafts all carry over, and only one worker should run at a time: stop the Mac services first with `launchctl unload ~/Library/LaunchAgents/org.s1mpleai.pulse.*.plist`.

---

## 0. DNS and firewall
1. At Namecheap, add the record **A `jobs` → `35.209.49.25`**. Check it with `dig +short jobs.s1mpleai.org`.
2. In GCP → VPC firewall, allow **tcp:80 and tcp:443** to the VM (they're probably open already for `api.improvtalk`). Port 3010 stays private: the app binds to 127.0.0.1 only.

## 1. Base packages
```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl ca-certificates sqlite3 ufw
sudo timedatectl set-timezone Asia/Yerevan      # optional; the app uses UTC internally
```

## 2. Get the code and configure
```bash
sudo mkdir -p /opt/upwork-assistant && sudo chown $USER /opt/upwork-assistant
git clone <this repo> /opt/upwork-assistant && cd /opt/upwork-assistant
cp .env.example .env && chmod 600 .env && nano .env
```
Fill in at least these values:

| Variable | Value |
|---|---|
| `PUBLIC_BASE_URL` | `https://jobs.s1mpleai.org` |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | basic-auth login for the dashboard (**required** on a public host) |
| `TOKEN_ENC_KEY` | **copy the value from your Mac's `.env`**: the Upwork tokens in Supabase are encrypted with it |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | from Supabase → Project Settings → API keys |
| `SUPABASE_DB_URL` | the `pulse_app` pooler URL from your Mac's `.env` (session mode, port 5432) |
| `OWNER_EMAIL` | the only account allowed to sign in to the mobile app |
| `ANTHROPIC_API_KEY` | a **fresh** key (rotate the one shared in chat) |
| `TELEGRAM_BOT_TOKEN` | **rotated** token from @BotFather |
| `TELEGRAM_CHAT_ID` | `-1004472397819` (the private channel UpworkNotifications) |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 24` |
| `UPWORK_ORG_UID` | `970231216424468481` (your freelancer org) |
| `DEMO_MODE` | `0` |

---

## 3A. Docker Compose (recommended)
```bash
# Docker Engine + compose plugin (official repo)
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker

cd /opt/upwork-assistant
mkdir -p data
docker compose up -d --build
docker compose ps                     # web shows "healthy" after the first successful polls
docker compose logs -f worker         # feed "Most Recent" (mcp) {returned: 10, ...}
```
Updating later:
```bash
cd /opt/upwork-assistant && git pull && docker compose up -d --build
```

## 3B. Node + systemd (enables "Load via Claude" on the server)
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs build-essential python3
cd /opt/upwork-assistant && npm ci && npm run build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && cp -r knowledge_base .next/standalone/
```
Create the two services (replace `ubuntu` with your user):
```bash
sudo tee /etc/systemd/system/pulse-web.service >/dev/null <<'EOF'
[Unit]
Description=Pulse Assistant web
After=network-online.target
[Service]
User=ubuntu
WorkingDirectory=/opt/upwork-assistant
EnvironmentFile=/opt/upwork-assistant/.env
Environment=NODE_ENV=production PORT=3010 HOSTNAME=127.0.0.1 DB_PATH=/opt/upwork-assistant/data/jobpulse.db
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/pulse-worker.service >/dev/null <<'EOF'
[Unit]
Description=Pulse Assistant polling worker
After=network-online.target pulse-web.service
[Service]
User=ubuntu
WorkingDirectory=/opt/upwork-assistant
EnvironmentFile=/opt/upwork-assistant/.env
Environment=NODE_ENV=production DB_PATH=/opt/upwork-assistant/data/jobpulse.db
ExecStart=/usr/bin/npx tsx worker/index.ts
# The worker exits on a stuck cycle (15-min watchdog); systemd restarts it.
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload && sudo systemctl enable --now pulse-web pulse-worker
journalctl -u pulse-worker -f
```
Updating later:
```bash
cd /opt/upwork-assistant && git pull && npm ci && npm run build && \
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && cp -r knowledge_base .next/standalone/ && \
sudo systemctl restart pulse-web pulse-worker
```

**Optional: the "Load via Claude" button on the server (3B only).**
```bash
curl -fsSL https://claude.ai/install.sh | bash        # installs ~/.local/bin/claude
claude                                                # log in once with your Claude account, then /exit
claude mcp add --transport http -s user upwork https://mcp.upwork.com/mcp
claude                                                # run /mcp → upwork → authenticate (opens a URL to approve), then /exit
claude mcp list                                       # upwork: ✔ Connected
```
If `claude` isn't at `~/.local/bin/claude` for the service user, set `CLAUDE_BIN=/path/to/claude` in `.env`.

---

## 4. HTTPS reverse proxy
Check which proxy is already serving `api.improvtalk`: run `systemctl status caddy nginx`. Then add **one new site** to it.

**Caddy** (automatic TLS): append `deploy/Caddyfile.snippet` to `/etc/caddy/Caddyfile`, then reload:
```bash
sudo tee -a /etc/caddy/Caddyfile < deploy/Caddyfile.snippet && sudo systemctl reload caddy
```
**nginx + certbot:**
```bash
sudo cp deploy/nginx.conf.snippet /etc/nginx/sites-available/jobs.s1mpleai.org
sudo ln -s /etc/nginx/sites-available/jobs.s1mpleai.org /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt -y install certbot python3-certbot-nginx && sudo certbot --nginx -d jobs.s1mpleai.org
```
The nginx snippet already sets `proxy_read_timeout 600s`, because drafting a proposal or running "Load via Claude" can take a few minutes.

## 5. First-run checklist
1. **About page:** open `https://jobs.s1mpleai.org/about`. It's public; check that it loads.
2. **Log in:** open `https://jobs.s1mpleai.org/` with the basic-auth login.
3. **Connect Upwork:** Settings → **Connect Upwork (MCP)** → log in to Upwork → approve.
   - The callback is `https://jobs.s1mpleai.org/api/mcp/callback`, registered automatically. Moving from localhost re-registers on its own.
4. **Feeds:** check that Most Recent, Best Matches and your saved search are listed and enabled. Import them on the Feeds page if they're missing.
5. **Telegram buttons:** 👍/👎/Dismiss go through the webhook in production. Register it once:
   ```bash
   source .env
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://jobs.s1mpleai.org/api/telegram/webhook&secret_token=$TELEGRAM_WEBHOOK_SECRET&allowed_updates=%5B%22callback_query%22%5D"
   ```
   The worker detects the webhook and stops long-polling. Telegram allows only one of the two at a time, so stop any local worker you still run on your Mac.
6. **Dry run first** (ranks without sending anything):
   - Docker: `docker compose exec worker npx tsx worker/index.ts --once --dry-run`
   - systemd: `npx tsx --env-file=.env worker/index.ts --once --dry-run`
7. **Costs:** open Settings → AI models and enter your Anthropic prepaid credit. Overview → Costs & balance then shows the remaining credit.
8. **Install on your phone:** open the site → Share → **Add to Home Screen**.

## 6. Keep it healthy
- **Polling goal:** every feed fetched successfully within the poll interval. A feed late by more than 15 minutes posts "⏰ Polling behind" to Telegram, and "✅ recovered" when it's back.
- **Uptime monitor:** point UptimeRobot, Better Stack or similar at `https://jobs.s1mpleai.org/api/health`. It's public, returns 200 when on time and 503 when late, and reveals no feed names.
- **Logs:** `docker compose logs -f worker` or `journalctl -u pulse-worker -f`.
- **Backups:** the database is Supabase. Use the project's daily backups (Supabase → Database → Backups), or run `pg_dump "$SUPABASE_DB_URL" > backup.sql` for a local copy.
- **Firewall:** run `sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable` only if ufw isn't already managed on this VM.
- **Secrets:** `.env` is `chmod 600` and never committed. Rotate the Telegram and Anthropic keys if they were ever shared.

## 7. Troubleshooting
| Symptom | Fix |
|---|---|
| Overview: "Upwork not connected" | Settings → Connect Upwork. If you see "state mismatch", start the login again from the same browser |
| "Upwork login expired" message in Telegram | Settings → Connect Upwork again. Tokens refresh on their own, but a revoked or unused refresh token needs a fresh login |
| "Paused until … after repeated errors" | The circuit breaker tripped (Upwork 429/5xx). It resumes after 30 minutes, or press Reset on Settings once things look fine |
| No Telegram alerts | Run `curl .../api/telegram/discover` (needs basic auth). The bot must be an **admin** of the channel with "Post messages" and "Edit messages of others" |
| Buttons do nothing | The webhook isn't registered (step 5.5), or `TELEGRAM_WEBHOOK_SECRET` differs from the one used in setWebhook |
| "Daily LLM budget reached" | Raise Settings → AI models → Daily budget. Alerts keep working on the rules-only score |
| `better-sqlite3` build error (3B) | `sudo apt -y install build-essential python3 && npm rebuild better-sqlite3` |

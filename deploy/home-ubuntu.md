# Run Up Assistant on a home Ubuntu machine

No static IP, port forwarding or domain is needed. The home machine only makes **outbound** connections:

```
Upwork MCP ◄── worker (home Ubuntu) ──► Supabase ◄── iPhone app
                    │                       ▲
                    └──► Telegram           └── phone actions (draft, Loom, approve, Closer…) go into
                                                public.action_requests; the worker picks them up,
                                                runs them and writes the result back
```

- **Jobs, proposals, alerts and watches** are written to Supabase, and the app reads them directly (realtime).
- **Phone actions** go into a Supabase queue that the worker drains every 3 s. Submitting still needs a Loom link, then approval, then the Upwork preview, then typing `SUBMIT`. The worker never submits anything by itself.
- **Health and costs** come from `public.worker_status`, which the worker refreshes every minute. The app shows "Home worker offline" when that row is older than 3 minutes.
- **Only one machine polls at a time.** The worker holds a lease in Supabase. If the Mac and the Ubuntu box both run, the second one logs `Standby - <host> is polling` and only processes phone actions. Stop the Mac services anyway once Ubuntu works (step 6).

## 1. Base packages (Ubuntu 22.04 / 24.04)
```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl build-essential python3 rsync
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v   # v22.x
sudo timedatectl set-timezone <Your/Zone>   # e.g. Europe/Berlin; the worker uses DEFAULT_TIMEZONE for quiet hours
```

## 2. Copy the code and the `.env`
The repo isn't pushed yet, so copy it from the Mac (run this **on the Mac**; replace `user@home-box`):
```bash
rsync -av --exclude node_modules --exclude .next --exclude 'apps/mobile/node_modules' --exclude 'apps/mobile/ios' \
  --exclude data/*.log ~/Desktop/Github/UpworkNotificationAssistant/ user@home-box:/opt/upwork-assistant/
```
(Once it's on GitHub: `sudo mkdir -p /opt/upwork-assistant && sudo chown $USER /opt/upwork-assistant && git clone <repo> /opt/upwork-assistant`, then copy only `.env`.)

The `.env` must be **the same as on the Mac**, especially:

| Key | Why |
|---|---|
| `TOKEN_ENC_KEY` | The Upwork login is stored encrypted in Supabase with this key. Keep it the same and you won't have to log in again. |
| `SUPABASE_DB_URL` | Transaction pooler, port **6543** (`aws-1-eu-west-1.pooler.supabase.com:6543`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alerts and button taps (long-poll; no webhook or public URL needed) |
| `ANTHROPIC_API_KEY` | Ranking and drafts |
| `PUBLIC_BASE_URL` | Leave `http://localhost:3010` |

```bash
chmod 600 /opt/upwork-assistant/.env
cd /opt/upwork-assistant && npm ci
```

## 3. The worker as a systemd service (required)
Replace `david` with your Linux user:
```bash
sudo tee /etc/systemd/system/upwork-worker.service >/dev/null <<'EOF'
[Unit]
Description=Up Assistant worker (polling, alerts, phone actions)
Wants=network-online.target
After=network-online.target
[Service]
User=david
WorkingDirectory=/opt/upwork-assistant
ExecStart=/usr/bin/npx tsx --env-file=.env worker/index.ts
# Exits on a stuck cycle (15-min watchdog); systemd restarts it.
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now upwork-worker
journalctl -u upwork-worker -f      # expect: worker started (… db=supabase …), then feed lines every ~4 min
```

## 4. Web dashboard on your LAN (optional)
The phone app doesn't need it. It's useful from a laptop at home, and for an Upwork re-login.
```bash
cd /opt/upwork-assistant && npm run build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && cp -r knowledge_base .next/standalone/
sudo tee /etc/systemd/system/upwork-web.service >/dev/null <<'EOF'
[Unit]
Description=Up Assistant web dashboard
After=network-online.target
[Service]
User=david
WorkingDirectory=/opt/upwork-assistant
EnvironmentFile=/opt/upwork-assistant/.env
Environment=NODE_ENV=production PORT=3010 HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now upwork-web
```
It listens on 127.0.0.1 only. From your laptop: `ssh -L 3010:localhost:3010 david@home-box`, then open http://localhost:3010.

**From outside home (optional):** install [Tailscale](https://tailscale.com/download/linux) on the box and on your phone or laptop (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`). Set `HOSTNAME=0.0.0.0` and a `DASHBOARD_PASSWORD`, then open `http://home-box:3010` over the tailnet. Still no port forwarding.

## 5. "Load via Claude" button (optional)
This uses your Claude subscription instead of API credit. Do it once, as the service user:
```bash
curl -fsSL https://claude.ai/install.sh | bash
claude                       # log in, then /exit
claude mcp add --transport http -s user upwork https://mcp.upwork.com/mcp
claude                       # /mcp → upwork → authenticate, then /exit
```
If `claude` isn't at `~/.local/bin/claude`, set `CLAUDE_BIN=` in `.env`.

## 6. Switch over from the Mac
1. Check the Ubuntu worker: `journalctl -u upwork-worker -n 50`. You should see feed lines and no `Standby`. (If the Mac still holds the lease, it shows `Standby` for up to ~12 min.)
2. On the Mac, stop and disable its services:
   ```bash
   launchctl bootout gui/$(id -u)/org.s1mpleai.pulse.worker
   launchctl bootout gui/$(id -u)/org.s1mpleai.pulse.web
   ```
   Within one lease period (3 × poll interval ≈ 12 min), the Ubuntu worker takes over polling.
3. In the app: Overview → Polling health should show the Ubuntu host's fetches, and the "Home worker offline" banner should be gone.

## 7. If Upwork ever asks you to log in again
The token refreshes itself. If it's revoked, start the web dashboard (step 4), open the tunnel (`ssh -L 3010:localhost:3010 …`), then run on the box:
```bash
cd /opt/upwork-assistant && npm run mcp:login
```
Open the printed URL **on the laptop** that has the tunnel. Upwork redirects to `localhost:3010/api/mcp/callback`, which the tunnel forwards to the box.

## 8. Updating
```bash
cd /opt/upwork-assistant && git pull     # or rsync again from the Mac (step 2)
npm ci && sudo systemctl restart upwork-worker
# dashboard too: npm run build && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && cp -r knowledge_base .next/standalone/ && sudo systemctl restart upwork-web
```

## Troubleshooting
| Symptom | Check |
|---|---|
| App says "Home worker offline" | `systemctl status upwork-worker`; internet up; `journalctl -u upwork-worker -n 100` |
| Log shows `Standby - X is polling` forever | Another machine (X) still runs the worker; stop it |
| `query timed out` in the log | The Supabase pooler dropped a reply. The query is cancelled and retried next loop. If it repeats, check `SUPABASE_DB_URL` uses port 6543. |
| Phone action stuck as "queued" | The worker isn't running. Actions left "running" for 15 min are failed automatically, and you can retry them. |
| Upwork "opened too quickly" | Normal back-off. The guard spaces calls 1.5–3.5 s apart and pauses on errors. |
| Box asleep | `sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target` |

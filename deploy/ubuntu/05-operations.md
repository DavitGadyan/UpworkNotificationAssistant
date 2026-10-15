# 5. Running it day to day

## Updating the code
Make changes on the Mac, commit and push, then on the box:
```bash
/opt/up-assistant/deploy/ubuntu/update.sh
```
It runs `git pull`, then `npm ci`, a typecheck, the build (only when the dashboard service is enabled) and a restart, and prints the first log lines.
If you copy the code with rsync instead (02, option B): rsync from the Mac, then run `update.sh --no-pull`.

**Database migrations** (a new `supabase/migrations/0xx_*.sql`) are still applied **from the Mac** with `npm run migrate` and a temporary `SUPABASE_ACCESS_TOKEN`; the app role cannot run DDL. Apply them before updating the box.

The phone app (EAS / TestFlight) and the system PDF (`npm run docs`, needs pandoc + Chrome) are still built on the Mac.

## Knowing it's alive
The worker posts `⏰ Polling behind` / `✅ Polling recovered` to Telegram on its own, and the phone shows "Home worker offline" when the worker's status row is older than 3 minutes. Neither helps if the whole box is dead (power, disk, network), so add an outside dead-man's switch:

1. Create a free check at [healthchecks.io](https://healthchecks.io): period 10 min, grace 10 min. Add your Telegram or email as the alert channel. Copy the ping URL.
2. On the box (needs the web service, which serves `/api/health`):
   ```bash
   echo 'HC_URL=https://hc-ping.com/<your-uuid>' | sudo tee /etc/up-assistant-healthcheck.env
   sudo tee /etc/systemd/system/up-assistant-healthping.service >/dev/null <<'EOF'
   [Unit]
   Description=Ping healthchecks.io when Up Assistant is on time
   [Service]
   Type=oneshot
   EnvironmentFile=/etc/up-assistant-healthcheck.env
   ExecStart=/bin/sh -c 'if curl -fsS -m 15 http://127.0.0.1:3010/api/health >/dev/null; then curl -fsS -m 10 --retry 3 "$HC_URL" >/dev/null; else curl -fsS -m 10 --retry 3 "$HC_URL/fail" >/dev/null; fi'
   EOF
   sudo tee /etc/systemd/system/up-assistant-healthping.timer >/dev/null <<'EOF'
   [Unit]
   Description=Up Assistant health ping every 5 min
   [Timer]
   OnBootSec=5min
   OnUnitActiveSec=5min
   [Install]
   WantedBy=timers.target
   EOF
   sudo systemctl daemon-reload && sudo systemctl enable --now up-assistant-healthping.timer
   systemctl list-timers | grep healthping
   ```
`/api/health` returns 503 when the worker is stale or any feed has had no successful fetch for 12 minutes. In that case the timer pings `/fail` and you're told straight away; when the box is down, the missing ping tells you after about 20 minutes.

## Logs
```bash
journalctl -u up-assistant-worker -f                       # live
journalctl -u up-assistant-worker --since "1 hour ago"
journalctl -u up-assistant-worker --since today | grep -E "error|Standby|login expired|Paused"
journalctl -u up-assistant-web -n 100
```
They're capped at 500 MB / 30 days (01, step 9).

## Upwork asks to log in again
The token refreshes itself. A fresh login is only needed when Upwork revokes it: you get a "Upwork login expired" message in the log and Telegram.
The registered callback is `http://localhost:3010/api/mcp/callback`, so do the login through a tunnel from the Mac:
```bash
# Mac, terminal 1: forward the box's dashboard port (stop any Mac web service using 3010 first)
ssh -N -L 3010:localhost:3010 david@upbox.local
```
Then open http://localhost:3010 on the Mac → Settings → **Connect Upwork** → log in → approve.
(From a terminal on the box: `cd /opt/up-assistant && npm run mcp:login`, then open the printed URL **on the Mac** while the tunnel runs.)
Upwork redirects to `localhost:3010` on the Mac and the tunnel forwards it to the box. The new token is saved in Supabase, encrypted.

## Rotating secrets
- Edit `/opt/up-assistant/.env` (keep `chmod 600`). Then `sudo systemctl restart up-assistant-worker`, and for `NEXT_PUBLIC_*` keys run `npm run build && sudo systemctl restart up-assistant-web`.
- **Never change `TOKEN_ENC_KEY`** unless you're prepared to log in to Upwork again.
- Keep the Mac's `.env` in sync if you might roll back.

## Backups
Everything lives in Supabase (project `odijvbiyojhklxffgufs`); the box keeps nothing that isn't in git or `.env`.
- Supabase → Database → Backups: daily backups on paid plans. On the free plan, take your own.
- Your own copy (from the Mac or the box; `sudo apt -y install postgresql-client`, matching the server's major version): use the **session** pooler (port 5432) with the `postgres` connection string from Supabase → Connect, not the app's 6543 URL:
  ```bash
  pg_dump "postgresql://postgres.odijvbiyojhklxffgufs:<password>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres" \
    --schema=public --schema=private --no-owner -Fc -f up-assistant-$(date +%F).dump
  ```
- Keep a copy of `.env` in your password manager. Without `TOKEN_ENC_KEY` the stored Upwork login can't be decrypted.

## Moving to another machine later
Repeat 01-03, copy the same `.env`, stop the old box (`sudo systemctl disable --now up-assistant-worker up-assistant-web`), then start the new one (04). Give each machine its own hostname.

## Troubleshooting
| Symptom | Likely cause → fix |
|---|---|
| Phone: "Home worker offline" | Worker down or no internet. Check `systemctl status up-assistant-worker`, `journalctl -u up-assistant-worker -n 100`, `ping -c3 1.1.1.1`. |
| Log: `Standby - <host> is polling` that doesn't go away after 12 min | Another machine (`<host>`) still runs the worker. Stop it (04, step 2). If it's this box's old name, clear the lease (04, step 3). |
| Log: `network blip (ignored): ENOTFOUND …` | A short DNS/Wi-Fi drop. Harmless if it's occasional. If constant: `resolvectl status`, or use a wired connection. |
| Log: `query timed out after … s` | The Supabase pooler dropped a reply; the query is retried next loop. If it repeats, check `SUPABASE_DB_URL` uses port **6543**. |
| Log: `Upwork login expired` / `Upwork is not connected` | Log in again (above). If it happens right after the move, `TOKEN_ENC_KEY` differs from the Mac's. |
| Log: `Paused until … after repeated errors` | Upwork's circuit breaker (429/5xx). It resumes by itself after 30 min. Don't restart repeatedly: that doesn't bypass it. |
| Log: `Daily cap of N Upwork calls reached` | The guard's daily cap (Settings → Upwork guard). Polling resumes the next day. Raise the cap only with care. |
| Telegram: 👍/👎 buttons do nothing | Another process (usually the Mac worker) is long-polling the same bot, and Telegram allows only one. Stop it (04, step 2). |
| No alerts, but jobs show up in the app | Working as intended: your rules and the field gate hide most jobs, and with the AI on nothing is alerted on rules alone. Check the job's "why" in the app. AI budget: Settings → AI models. |
| Jobs stuck as "awaiting AI"; Telegram says AI ranking paused | The $5/day AI budget is used up (or the Anthropic key/credit failed). Jobs are ranked once the budget resets the next day, or raise it in Settings → AI models. |
| `npm ci` fails building `better-sqlite3` | `sudo apt -y install build-essential python3 && npm rebuild better-sqlite3` |
| `next build` killed (out of memory) | Add swap: `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' \| sudo tee -a /etc/fstab` |
| Worker restarts in a loop | `journalctl -u up-assistant-worker -n 200`. A crash other than a network blip exits on purpose so systemd restarts it cleanly; `systemctl show up-assistant-worker -p NRestarts` counts the restarts. |
| Port 3010 already in use (web) | `sudo ss -ltnp \| grep 3010`. Another `next` is running. |
| Box came back after a power cut but nothing runs | `systemctl is-enabled up-assistant-worker` should say `enabled`. Check that the network-online wait is enabled (01, step 6). |

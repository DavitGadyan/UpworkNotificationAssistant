# Upwork API gateway on the GCP VM (gw.s1mpleai.org)

`gateway/server.ts` is a small service that holds your Upwork API tokens and forwards GraphQL calls from the app. It also serves the **Callback URL** of your API key.

- **No dependencies.** It uses only Node built-ins, so the VM needs nothing but Node ≥ 22.18.
- **The Callback URL is not a webhook.** Upwork only uses it once, when you click "Connect".

| Route | Use |
|---|---|
| `GET /oauth/start` | Connect once in your browser. It asks for `GATEWAY_ADMIN_TOKEN`. |
| `GET /oauth/callback` | The API key's Callback URL: `https://gw.s1mpleai.org/oauth/callback` |
| `POST /graphql` | What the app calls, with `Authorization: Bearer GATEWAY_TOKEN` |
| `GET /status` | Connected?, account, token expiry, calls today (bearer) |
| `POST /admin/resume?t=ADMIN` | Clear a "restricted" stop after Upwork support restores access |
| `GET /health` | `{"ok":true}` |

**Limits:**
- 250 calls a minute and 5,000 a day (Upwork allows 40,000).
- 429 and 5xx answers are retried once.
- If Upwork reports a restriction or suspension, the gateway stops forwarding (HTTP 423) and the app's pacing governor stops everything too.

## 1. DNS
At Namecheap, add an A record: `gw` → `35.209.49.25`. Wait until `dig +short gw.s1mpleai.org` shows that IP. Ports 80 and 443 are already open for Caddy.

## 2. Install on the VM
```bash
# from your PC: copy the service file and units
scp gateway/server.ts gateway/package.json deploy/gateway/gw.service deploy/gateway/gw.env.example deploy/gateway/Caddyfile.snippet <you>@35.209.49.25:~

# on the VM
node -v                                   # needs v22.18 or newer (else: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs)
sudo useradd --system --home /opt/gw --shell /usr/sbin/nologin gw
sudo mkdir -p /opt/gw && sudo cp ~/server.ts ~/package.json /opt/gw/ && sudo chown -R gw:gw /opt/gw
sudo cp ~/gw.env.example /etc/gw.env && sudo chmod 600 /etc/gw.env && sudo nano /etc/gw.env   # fill in (openssl rand -hex 32 for the three secrets)
sudo cp ~/gw.service /etc/systemd/system/gw.service
sudo systemctl daemon-reload && sudo systemctl enable --now gw
curl -s localhost:8787/health             # {"ok":true}

# Caddy: append the snippet and reload
cat ~/Caddyfile.snippet | sudo tee -a /etc/caddy/Caddyfile && sudo systemctl reload caddy
curl -s https://gw.s1mpleai.org/health    # {"ok":true} over HTTPS
```

## 3. Connect (after the API key is approved and enabled)
1. Open `https://gw.s1mpleai.org/oauth/start`, enter `GATEWAY_ADMIN_TOKEN`, and approve on Upwork. You should see "Connected as …".
2. In the app's `.env` on your PC, set:
   - `UPWORK_GATEWAY_URL=https://gw.s1mpleai.org`
   - `UPWORK_GATEWAY_TOKEN=<GATEWAY_TOKEN>`

   Then restart: `systemctl --user restart up-assistant-web up-assistant-worker`.
3. Run `npm run api:schema`. It dumps the live schema to `docs/upwork-graphql-schema.json` and prints the job-details fields and proposal mutations. Use it to confirm `JOB_DETAILS` in `lib/upwork/queries.ts`.
4. In Settings → Ban-safety limits → **Upwork connection**, choose **Official API**, and set **Who searches Upwork** to **Worker**.

## Operate
```bash
sudo systemctl status gw
sudo journalctl -u gw -f                  # one line per call: operation, status, ms
curl -s -H "Authorization: Bearer $GATEWAY_TOKEN" https://gw.s1mpleai.org/status
sudo systemctl restart gw                 # after copying a new server.ts
```
- **Updating:** copy the new `server.ts` to `/opt/gw/`, then `sudo systemctl restart gw`.
- **Tokens:** stored encrypted in `/var/lib/gw/tokens.json` and refreshed automatically; the refresh token is renewed at least daily.
- **If it's ever restricted:** contact Upwork support first. Only after they restore access, run `curl -X POST "https://gw.s1mpleai.org/admin/resume?t=$GATEWAY_ADMIN_TOKEN"`, then `npm run governor -- resume` in the app.

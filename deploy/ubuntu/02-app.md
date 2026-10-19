# 2. Install the app

## 1. Folder
```bash
sudo mkdir -p /opt/up-assistant && sudo chown david:david /opt/up-assistant
```

## 2. Get the code
**Option A: from GitHub** (`DavitGadyan/UpworkNotificationAssistant`). If the repo is private, use a read-only deploy key:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/up-assistant-deploy -N "" -C "upbox deploy key"
cat ~/.ssh/up-assistant-deploy.pub
# GitHub → repo → Settings → Deploy keys → Add key → paste it; leave "Allow write access" OFF
printf 'Host github.com\n  IdentityFile ~/.ssh/up-assistant-deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
git clone git@github.com:DavitGadyan/UpworkNotificationAssistant.git /opt/up-assistant
```

**Option B: copy from the Mac.** Run this **on the Mac**:
```bash
rsync -av --delete \
  --exclude node_modules --exclude .next --exclude data --exclude .env \
  --exclude apps/mobile --exclude .playwright-mcp --exclude tsconfig.tsbuildinfo \
  ~/Desktop/Github/UpworkNotificationAssistant/ david@upbox.local:/opt/up-assistant/
```
The phone app (`apps/mobile`, about 660 MB) is not needed on the box: it's built with EAS from the Mac.

## 3. Copy `.env` from the Mac
Run this **on the Mac**; scp sends it encrypted:
```bash
scp ~/Desktop/Github/UpworkNotificationAssistant/.env david@upbox.local:/opt/up-assistant/.env
```
Then **on the box**:
```bash
chmod 600 /opt/up-assistant/.env
```
Use the Mac's file unchanged. These keys matter most:

| Key | Must be | Why |
|---|---|---|
| `TOKEN_ENC_KEY` | **identical to the Mac** | The Upwork login in Supabase is encrypted with it. If it's different, you have to log in to Upwork again and the old token is unreadable. |
| `SUPABASE_DB_URL` | the `pulse_app` URL on the **session pooler, port 5432** (`aws-1-eu-west-1.pooler.supabase.com:5432`; a 6543 URL is switched to 5432 automatically) | The same database as now. Never use the `postgres` superuser here. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `OWNER_EMAIL` | same | Push notifications and phone sign-in checks |
| `ANTHROPIC_API_KEY` | same (or a rotated one) | Ranking, drafts, lessons |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | same | Alerts. Button taps arrive by long-poll; no webhook or public URL needed. |
| `UPWORK_ORG_UID` | `970231216424468481` | Your freelancer account |
| `PUBLIC_BASE_URL` | `http://localhost:3010` | The registered Upwork OAuth callback is `http://localhost:3010/api/mcp/callback`. Keeping it means no re-registration (re-login works through an SSH tunnel; see 05). |
| `DEFAULT_TIMEZONE` | `Asia/Yerevan` | Quiet hours and the daily caps |
| `DEMO_MODE` | `0` | Real data |
| `DB_POOL_MAX` | `3` | Small per process; web and worker share the pooler |

Not needed on the box:
- `SUPABASE_ACCESS_TOKEN`: only `npm run migrate` uses it, and the token should be revoked.
- `DB_PATH`: SQLite is only used in demo/local mode.

If you'll open the dashboard over Tailscale instead of an SSH tunnel, also set `DASHBOARD_USER` and `DASHBOARD_PASSWORD`. Without a password, the dashboard only answers on localhost.

## 4. Install and build
```bash
cd /opt/up-assistant
npm ci --no-audit --no-fund
npm run typecheck          # optional sanity check
npx vitest run             # optional: should show 82 passed (the SUBMIT-gate test can time out once; rerun)
npm run build              # only needed for the dashboard; reads NEXT_PUBLIC_* from .env at build time
```

## 5. Dry run
This ranks one round of jobs and prints what it **would** send, without sending anything and without taking the polling lease:
```bash
cd /opt/up-assistant
npx tsx --env-file=.env worker/index.ts --once --dry-run
```
What to expect:
- `worker started (… db=supabase …)`, then one block per feed: `feed "Most Recent" (mcp) { returned: 10, fresh: …}`.
- `Upwork is not connected` or `Upwork login expired` right away means `TOKEN_ENC_KEY` differs from the Mac's: fix `.env`, don't log in again yet.
- `ENOTFOUND` / `ECONNREFUSED` for `pooler.supabase.com` means DNS or network trouble on the box.

**Upwork token warning:** the dry run uses the shared Upwork token. Run it once, then go straight on to step 3/4. Don't leave the Mac and the box both polling for hours: if one refreshes the token while the other still holds the old one, Upwork can revoke both and you'd have to log in again.

Next: [03-services.md](03-services.md)

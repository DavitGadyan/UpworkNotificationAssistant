# Up Assistant on an Ubuntu machine, 24/7

This folder moves the worker (and optionally the dashboard) from the Mac to an always-on Ubuntu box.
Everything that matters is already in Supabase, so the move only copies the code and `.env`.

| Step | File | Time |
|---|---|---|
| 1. Prepare the machine (Ubuntu, Node 22, no sleep, auto power-on) | [01-server.md](01-server.md) | 30 min |
| 2. Install the app and its `.env` | [02-app.md](02-app.md) | 15 min |
| 3. Run it as systemd services | [03-services.md](03-services.md) | 10 min |
| 4. Switch over from the Mac (and roll back if needed) | [04-switch-over.md](04-switch-over.md) | 15 min |
| 5. Day-to-day: updates, logs, re-login, backups, troubleshooting | [05-operations.md](05-operations.md) | reference |

Files used by the steps:
- `systemd/up-assistant-worker.service`: the poller. **Required.**
- `systemd/up-assistant-web.service`: the dashboard. Optional, bound to `127.0.0.1`.
- `update.sh`: pull, install, build and restart in one command.

## How it fits together

```
                    ┌──────────── home Ubuntu box (outbound connections only) ────────────┐
Upwork MCP  ◄────── │  up-assistant-worker  ── ranks (Claude), searches only if selected,  │ ──► Telegram
(read-only)         │                          alerts, drafts, reply tracking, phone queue │
                    │  up-assistant-web     ── dashboard on 127.0.0.1:3010 (optional)      │
                    └───────────────────────────────┬──────────────────────────────────────┘
                                                    ▼
                         Supabase Postgres (jobs, drafts, tokens*, settings, action queue)
                                                    ▲
                                          iPhone app (reads Supabase, queues actions)
```
\* The Upwork login is stored in `private.kv`, encrypted with `TOKEN_ENC_KEY`.

- **No port forwarding, no domain, no static IP.** The box only makes outbound connections. The phone talks to Supabase, not to the box.
- **Only one poller at a time.** The worker takes a lease in Supabase, owned by the machine's hostname. A second machine stays in `Standby`. Still, never run the Mac and Ubuntu together for long (see step 4: the Upwork token and Telegram long-poll must have one owner).
- **Nothing changes in behaviour.** Your rules, fields, AI gating, the $5/day AI budget and the Upwork call guard all live in Supabase settings. The submit gate stays the same: Loom link, approve, Upwork preview, typed `SUBMIT`. The worker never submits.

## Minimum machine
- Ubuntu Server 24.04 LTS (22.04 also works), x86-64 or ARM64.
- 2 CPU cores, 4 GB RAM (`next build` needs about 2 GB; at runtime the worker and web use about 300-500 MB together), 10 GB free disk.
- Wired Ethernet is preferred. Wi-Fi works; the worker treats short drops as "network blips" and carries on.

## Quick checklist
- [ ] BIOS: "Restore on AC power loss" = **Power On** ([01](01-server.md#2-bios-power-on-after-a-power-cut))
- [ ] Sleep and suspend masked ([01](01-server.md#4-never-sleep))
- [ ] Node 22 installed: `node -v` shows `v22.*`
- [ ] Code in `/opt/up-assistant`, `.env` copied from the Mac, `chmod 600`
- [ ] `npm ci && npm run build` succeed; dry run ranks jobs ([02](02-app.md#5-dry-run))
- [ ] Mac services stopped, then Ubuntu services enabled ([04](04-switch-over.md))
- [ ] `journalctl -u up-assistant-worker` shows no `Standby` (and `feed "…" (mcp)` lines at most every 5 min only when Settings → Who searches Upwork is "worker")
- [ ] Phone app: no "Home worker offline" banner; Polling health shows "All on time"
- [ ] Revoke the Supabase personal access tokens (not needed on the box)

# 3. Run it as systemd services

The unit files are in `deploy/ubuntu/systemd/`. They run as your user (no root), restart forever on a crash or a watchdog exit, and start on boot once the network is up.

**Don't enable them yet if the Mac is still polling.** Install them now, then enable them during the switch-over in [04-switch-over.md](04-switch-over.md).

## 1. Install the units
```bash
cd /opt/up-assistant
for u in worker web; do
  sed "s/__USER__/$USER/g" deploy/ubuntu/systemd/up-assistant-$u.service | sudo tee /etc/systemd/system/up-assistant-$u.service >/dev/null
done
sudo systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/up-assistant-*.service    # no output = fine
chmod +x deploy/ubuntu/update.sh
```

## 2. Start them (during the switch-over)
```bash
sudo systemctl enable --now up-assistant-worker
sudo systemctl enable --now up-assistant-web        # optional dashboard (needs `npm run build`)
```

## 3. Check them
```bash
systemctl status up-assistant-worker
journalctl -u up-assistant-worker -f                 # live log, Ctrl+C to leave
curl -s http://127.0.0.1:3010/api/health; echo       # {"ok":true,"workerStale":false,"lateFeeds":0,...}
```
With the default searcher (Settings → Who searches Upwork = "chat") the worker never searches, so it logs no feed lines. When the searcher is "worker", a healthy log looks like this, each feed at most every 5 minutes:
```
worker started (… db=supabase …)
feed "Most Recent" (mcp) { returned: 10, fresh: 1, enriched: 1, ranked: 1, … calls: 2 }
feed "Best Matches" (mcp) { … }
feed "Search: LLM, Large, Language, Model…" (mcp) { … }
feed "Scout: SaaS, automation, web3, 3D, specs" (mcp) { … }
```
Every 3 hours a `periodic proposal_outcomes` line follows (reply tracking). Daily jobs log `periodic profile_sync`, `periodic ghosts` and so on.

## 4. Useful commands
| What | Command |
|---|---|
| Restart the worker | `sudo systemctl restart up-assistant-worker` |
| Stop everything | `sudo systemctl stop up-assistant-worker up-assistant-web` |
| Don't start on boot | `sudo systemctl disable up-assistant-worker up-assistant-web` |
| Last 200 lines | `journalctl -u up-assistant-worker -n 200 --no-pager` |
| Errors only, today | `journalctl -u up-assistant-worker --since today -p warning` |
| Restarts so far | `systemctl show up-assistant-worker -p NRestarts` |
| Memory use | `systemctl status up-assistant-worker \| grep Memory` |
| Prove it survives a reboot | `sudo reboot`, then `systemctl is-active up-assistant-worker` after ~1 min |

## 5. Dashboard from the Mac
The dashboard listens on the box's localhost only. Tunnel to it:
```bash
ssh -N -L 3010:localhost:3010 david@upbox.local      # leave it running
```
Then open http://localhost:3010 on the Mac. Stop the Mac's own web service first (step 4), or the port is taken.

Next: [04-switch-over.md](04-switch-over.md)

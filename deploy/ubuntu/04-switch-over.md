# 4. Switch over from the Mac

Stop the Mac first, then start the box. This order matters for three reasons:
- **Upwork token.** Both machines share one Upwork login (in Supabase). Two machines refreshing it at the same time can get it revoked.
- **Telegram.** Only one process may long-poll the bot for button taps; the second one gets `409 Conflict`.
- **Lease.** The Mac's polling lease lasts up to ~15 min (3 × poll interval). While the Mac holds it, the box shows `Standby`.

Expect 5-15 minutes without polling. Jobs posted in that window are still picked up on the first poll, as long as they're on the feeds' first page.

## 1. Before you start
- [ ] Steps 1-3 done; the dry run worked on the box.
- [ ] No proposal is half-way through on the phone or dashboard (queued actions survive the switch, but a running draft is marked "Worker restarted - please retry").

## 2. Stop the Mac (on the Mac)
```bash
launchctl bootout gui/$(id -u)/org.s1mpleai.pulse.worker
launchctl bootout gui/$(id -u)/org.s1mpleai.pulse.web
# Keep them from coming back at the next login (copies also live in deploy/macos/):
mkdir -p ~/LaunchAgents-disabled
mv ~/Library/LaunchAgents/org.s1mpleai.pulse.*.plist ~/LaunchAgents-disabled/
pkill caffeinate || true          # the Mac may sleep again now
launchctl list | grep pulse       # no output = stopped
```

## 3. Hand over the lease (optional, saves up to 12 min)
The Mac's lease runs out by itself. To hand it over immediately, clear it **after** the Mac worker is stopped:
```bash
# on the box
cd /opt/up-assistant
cat > /tmp/release-lease.ts <<'EOF'
import { query } from "/opt/up-assistant/lib/pg";
query("delete from private.kv where key = 'worker_lease'").then(() => { console.log("lease cleared"); process.exit(0); });
EOF
npx tsx --env-file=.env /tmp/release-lease.ts && rm /tmp/release-lease.ts
```

## 4. Start the box
```bash
sudo systemctl enable --now up-assistant-worker
sudo systemctl enable --now up-assistant-web      # optional
journalctl -u up-assistant-worker -f
```
Within one poll cycle (≥ 5 min, or ≤ 15 min without step 3) you should see no `Standby`, and `feed "…" (mcp)` blocks if Settings → Who searches Upwork is "worker".

## 5. Verify end to end
1. **Phone app:** the "Home worker offline" banner is gone, and Home → Polling health shows "All on time".
2. **Health:** `curl -s http://127.0.0.1:3010/api/health` returns `"ok":true` and `"workerStale":false` (only if the web service runs).
3. **Phone queue:** on the phone, run any action (for example Rewrite on a draft, or Insights → refresh a report). It goes from queued to done within seconds, because the box drains the queue every 3 s.
4. **Telegram:** the next alert arrives as usual. Tap 👍 on any old alert; the log shows the tap was picked up.
5. **Reply tracking:** within 3 hours a `periodic proposal_outcomes` line appears in the log.
6. **Reboot test:** `sudo reboot`. About a minute later `systemctl is-active up-assistant-worker` shows `active` and polling continues.

## 6. Roll back to the Mac (if needed)
```bash
# on the box
sudo systemctl disable --now up-assistant-worker up-assistant-web
# on the Mac
mv ~/LaunchAgents-disabled/org.s1mpleai.pulse.*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/org.s1mpleai.pulse.worker.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/org.s1mpleai.pulse.web.plist
caffeinate -dimsu &           # keep the Mac awake again
```
The Mac takes the lease back once the box's lease expires (≤ 12 min), or right away if you clear it as in step 3.

## 7. After a week of quiet running
- Revoke the Supabase personal access tokens (supabase.com → Account → Access Tokens). The box never needs them.
- Optional: on the Mac, delete `node_modules` and `.next` in the project folder to free space. Keep the code: you still build the phone app from it.

Next: [05-operations.md](05-operations.md)

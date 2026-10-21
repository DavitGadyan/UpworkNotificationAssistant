#!/usr/bin/env bash
# Up Assistant watchdog (David, 2026-10-20: "add watcher for supabase as well to make sure it is restarted when failed").
# Runs every 2 min from up-assistant-watchdog.timer. It probes the dashboard's public /api/health, which runs a real
# Supabase query (healthReport), so a dead database connection shows up here as a timeout or a non-JSON answer.
#   - web probe fails twice in a row      -> restart up-assistant-web.service
#   - health says the worker is stale twice -> restart up-assistant-worker.service
#   - a unit that is not active            -> start it (systemd's Restart= covers crashes; this covers "stopped")
# At most one restart per unit per 10 min, so a Supabase outage does not turn into a restart storm. Each restart is
# logged to the journal and, when upwork-watch/notify.sh exists, sent to Telegram.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${UP_WEB_PORT:-3011}"
STATE="${XDG_RUNTIME_DIR:-/tmp}/up-assistant-watchdog"
mkdir -p "$STATE"
NOTIFY="$ROOT/upwork-watch/notify.sh"

log() { echo "watchdog: $*"; }
notify() { [ -x "$NOTIFY" ] && "$NOTIFY" "$1" >/dev/null 2>&1 || true; }
fails() { local f="$STATE/$1.fails" n; n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$f"; echo "$n"; }
clear_fails() { rm -f "$STATE/$1.fails"; }
# True when the unit was restarted by us less than 10 min ago.
recently_restarted() { local f="$STATE/$1.restarted"; [ -f "$f" ] && [ $(( $(date +%s) - $(cat "$f") )) -lt 600 ]; }
restart() {
  local unit="$1" why="$2"
  if recently_restarted "$unit"; then log "$unit still failing ($why) - restarted <10 min ago, waiting"; return; fi
  log "restarting $unit: $why"
  systemctl --user restart "up-assistant-$unit.service"
  date +%s > "$STATE/$unit.restarted"
  clear_fails "$unit"
  notify "♻️ <b>Watchdog</b> restarted the ${unit} — ${why}"
}

# 1. Units that are not running at all.
for unit in web worker; do
  if ! systemctl --user is-active --quiet "up-assistant-$unit.service"; then
    log "up-assistant-$unit.service is $(systemctl --user is-active "up-assistant-$unit.service") - starting"
    systemctl --user start "up-assistant-$unit.service"
    notify "♻️ <b>Watchdog</b> started the ${unit} (it was not running)"
  fi
done

# 2. Dashboard + database probe. 200 = healthy, 503 = alive but a feed/pacing problem (still a valid JSON answer).
resp=$(curl -s -m 25 -w $'\n%{http_code}' "http://127.0.0.1:$PORT/api/health" 2>/dev/null)
code="${resp##*$'\n'}"
body="${resp%$'\n'*}"
if [[ "$code" =~ ^(200|503)$ ]] && printf '%s' "$body" | jq -e 'has("ok")' >/dev/null 2>&1; then
  clear_fails web
else
  n=$(fails web)
  log "web probe failed ($n/2): http=${code:-none} body=$(printf '%s' "$body" | head -c 120)"
  [ "$n" -ge 2 ] && restart web "dashboard /api/health answered ${code:-nothing} twice (database connection dead?)"
fi

# 3. Worker heartbeat, as the dashboard sees it in the database.
if [ -n "$body" ] && [ "$(printf '%s' "$body" | jq -r '.workerStale' 2>/dev/null)" = "true" ]; then
  n=$(fails worker)
  log "worker heartbeat stale ($n/2)"
  [ "$n" -ge 2 ] && restart worker "heartbeat stale twice in a row"
else
  clear_fails worker
fi
exit 0

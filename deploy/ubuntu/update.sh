#!/usr/bin/env bash
# Update Up Assistant on the Ubuntu box: pull, install, test types, build, restart.
# Usage: /opt/up-assistant/deploy/ubuntu/update.sh            (git pull)
#        /opt/up-assistant/deploy/ubuntu/update.sh --no-pull  (code was rsynced from the Mac)
set -euo pipefail
cd /opt/up-assistant

if [[ "${1:-}" != "--no-pull" ]]; then
  git pull --ff-only
fi
npm ci --no-audit --no-fund
npm run typecheck
if systemctl list-unit-files up-assistant-web.service >/dev/null 2>&1 && systemctl is-enabled --quiet up-assistant-web 2>/dev/null; then
  npm run build
  sudo systemctl restart up-assistant-web
fi
sudo systemctl restart up-assistant-worker
sleep 20
systemctl --no-pager --lines=0 status up-assistant-worker | head -5
journalctl -u up-assistant-worker -n 15 --no-pager
if systemctl is-active --quiet up-assistant-web; then
  curl -fsS http://127.0.0.1:3010/api/health && echo
fi

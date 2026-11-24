#!/bin/bash
# /opt/flops/deploy.sh — run as the flops user. The GitHub Actions deploy key is forced to this
# script via authorized_keys (command=...), so the key can do nothing else.
set -euo pipefail
exec 9>/tmp/flops-deploy.lock
flock -n 9 || { echo "deploy already running"; exit 1; }

APP=/opt/flops/app
cd "$APP"
git fetch -q origin main
git reset -q --hard origin/main
SHA=$(git rev-parse HEAD)
echo "deploying $SHA"

cd server
nice -n 10 npm ci --omit=dev --no-audit --no-fund --loglevel=error
GIT_COMMIT="$SHA" node scripts/write-build-info.js

sudo /usr/bin/systemctl restart flops.service

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:10000/health | grep -q "$SHA"; then
    echo "healthy at $SHA"
    exit 0
  fi
  sleep 2
done
echo "health check failed after restart" >&2
sudo /usr/bin/systemctl status flops.service --no-pager -n 30 >&2 || true
exit 1

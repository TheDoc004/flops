# FLOPS API on the OVH VPS

The API runs on the same OVH VPS as the Minecraft server (`ubuntu@40.160.148.13`, layout documented in
the `The205MCserver` repo). It replaced Render in November 2026.

| | |
|---|---|
| URL | `https://api.useflops.com` (Cloudflare DNS A record, **DNS only** — Caddy needs direct ACME) |
| Code | `/opt/flops/app` (git clone of `main`, owned by user `flops`) |
| Data | `/var/lib/flops/nutrition.db` (`DB_PATH` in `/etc/flops/flops.env`, root:flops 640) |
| Service | `flops.service` — Node 24, port 10000, `MemoryMax=768M`, `CPUWeight=50` (Minecraft keeps the default 100) |
| Proxy | Caddy, `/etc/caddy/Caddyfile`, auto HTTPS; access log `/var/log/caddy/flops-access.log` |
| Firewall | ufw: 80/443 for Caddy (plus the Minecraft/SSH ports) |
| Backups | `flops-backup.timer` 03:30 PT → `/var/lib/flops/backups/flops-*.db.gz` (keep 14), pulled to the Mac at 06:00 by `~/MinecraftBackups/pull-backups.sh` into `~/MinecraftBackups/flops/`; OVH also snapshots the whole VPS daily |

## Deploys

Push to `main` touching `server/**` → `.github/workflows/deploy-vps.yml` SSHes in as `flops` with
`FLOPS_DEPLOY_KEY`. That key is forced to `/opt/flops/deploy.sh` in `authorized_keys`, so it can only
deploy: fetch + hard reset to `origin/main`, `npm ci --omit=dev`, write `build-info.json`, restart,
wait for `/health` to report the new SHA. Run by hand: Actions → "Deploy API to VPS" → Run workflow.

## Everyday commands (from `ssh ubuntu@40.160.148.13`)

```bash
systemctl status flops                      # running?
sudo journalctl -u flops -f                 # app logs
sudo systemctl restart flops                # restart the API (Minecraft unaffected)
sudo systemctl start flops-backup           # backup now
sudoedit /etc/flops/flops.env && sudo systemctl restart flops   # change an env var
```

## Restore

```bash
sudo systemctl stop flops
gunzip -c /var/lib/flops/backups/flops-YYYY-MM-DD_HHMM.db.gz | sudo -u flops tee /var/lib/flops/nutrition.db.restore >/dev/null
sudo -u flops mv /var/lib/flops/nutrition.db.restore /var/lib/flops/nutrition.db
sudo rm -f /var/lib/flops/nutrition.db-wal /var/lib/flops/nutrition.db-shm
sudo systemctl start flops
```

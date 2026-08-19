# Deploy checklist (you do these steps)

_Code scaffolding is in the repo (`render.yaml`, `client/vercel.json`, `scripts/backup-sqlite.sh`). Accounts, keys, DNS, and DB upload are yours._

Goal: **HTTPS URL that works on phone Safari** without your laptop running.

## 1. Render (API + SQLite)

1. Create a [Render](https://render.com) account; pick a region near you.
2. New **Web Service** from this GitHub repo (or Blueprint via `render.yaml`).
   - Root: `server`
   - Build: `npm install`
   - Start: `npm start` (not `dev`)
   - Health: `/health`
3. Attach a **persistent disk** (~1 GB) mounted at `/var/data`.
4. Env vars:
   - `NODE_VERSION=20`
   - `NODE_ENV=production`
   - `DB_PATH=/var/data/nutrition.db`
   - `ALLOWED_ORIGIN=` (fill after Vercel exists — exact origin, no trailing slash)
   - `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`
   - **Email OTP (pick one):**
     - `RESEND_API_KEY=re_...` (recommended — see below), optional `MAIL_FROM`
     - or `SMTP_URL=smtp://...`
   - Optional: `AI_MONTHLY_CAP=200`
   - Do **not** set `AUTH_DEV`
5. Deploy; confirm `https://YOUR-SERVICE.onrender.com/health` returns `{"status":"ok"}`.

### Resend setup (recommended mailer)

1. Create an account at [resend.com](https://resend.com).
2. **API Keys** → Create → copy `re_...`.
3. On Render, add `RESEND_API_KEY` with that value.
4. Optional: `MAIL_FROM=FLOPS <onboarding@resend.dev>` (default). Without a verified domain, Resend only delivers to **your Resend account email** — fine for personal testing. To email any address, verify a domain in Resend and set `MAIL_FROM` to an address on that domain.
5. Redeploy / restart after adding the key.

## 2. Upload your existing database

Your local DB is gitignored. Without this step, the cloud app is empty.

1. On your Mac: copy `~/dev/FLOPS/server/nutrition.db`.
2. Use Render Shell / SFTP / `scp` to place it at `/var/data/nutrition.db` on the disk.
3. Restart the Web Service.

## 3. Vercel (frontend)

1. Create a [Vercel](https://vercel.com) project rooted at `client`.
2. Build settings: Vite defaults (`npm run build` → `dist`).
3. Env (build-time): `VITE_API_BASE_URL=https://YOUR-SERVICE.onrender.com` (no trailing slash).
4. Deploy. Note the URL (e.g. `https://flops.vercel.app`).
5. Set Render `ALLOWED_ORIGIN` to that exact URL; **redeploy** the API.

## 4. Verify on phone

1. Open the Vercel URL in **Safari** (not LAN HTTP).
2. Email OTP should arrive via SMTP (no `dev_code` in the network response).
3. Log a meal, flip days with ←/→, open Review — charts should load without empty flash.
4. Barcode camera needs this HTTPS context.

## 5. Backups

On Render cron or manual Shell:

```bash
DB_PATH=/var/data/nutrition.db BACKUP_DIR=/var/data/backups bash scripts/backup-sqlite.sh
```

Copy `/var/data/backups` off-box weekly (R2, Drive, private GitHub, etc.). Disk alone is not a backup.

## 6. Optional next

- Custom domain + DNS on both Render and Vercel.
- Only after phone browser works: Capacitor / TestFlight — see [`docs/app-store-path.md`](./app-store-path.md).

## Done when

You can bookmark a public URL and use FLOPS from your phone with your laptop asleep.

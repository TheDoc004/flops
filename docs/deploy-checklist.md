# Deploy checklist (you do these steps)

_Code scaffolding is in the repo (`render.yaml`, `client/vercel.json`, `scripts/backup-sqlite.sh`). Accounts, keys, DNS, and DB upload are yours._

**Canonical app URL:** [https://useflops.com](https://useflops.com)  
**API:** `https://flops-c6ic.onrender.com`  
**Backup frontend URL:** `https://flops-amber.vercel.app` (keep until custom domain is stable)

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
   - `ALLOWED_ORIGIN=` — see [Custom domain](#7-custom-domain-useflopscom) (exact origins, no trailing slash; comma-separated)
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
3. Env (build-time): `VITE_API_BASE_URL=https://flops-c6ic.onrender.com` (no trailing slash).
4. Deploy. Note the default URL (e.g. `https://flops-amber.vercel.app`).
5. Attach the custom domain (next section); set Render `ALLOWED_ORIGIN` to match; **redeploy** the API.

## 4. Verify on phone

1. Open **https://useflops.com** in **Safari** (not LAN HTTP). Until DNS is live, use `https://flops-amber.vercel.app`.
2. Email OTP should arrive via Resend/SMTP (no `dev_code` in the network response).
3. Log a meal, flip days with ←/→, open Review — charts should load without empty flash.
4. Barcode camera needs this HTTPS context.
5. **Add to Home Screen** from Safari → Share → Add to Home Screen.

## 5. Backups

On Render cron or manual Shell:

```bash
DB_PATH=/var/data/nutrition.db BACKUP_DIR=/var/data/backups bash scripts/backup-sqlite.sh
```

Copy `/var/data/backups` off-box weekly (R2, Drive, private GitHub, etc.). Disk alone is not a backup.

## 6. Optional next

- Only after phone browser works on the custom domain: Capacitor / TestFlight — see [`docs/app-store-path.md`](./app-store-path.md).

## 7. Custom domain (`useflops.com`)

Domain registrar: **Porkbun**. Frontend host: **Vercel**. API stays on Render (`flops-c6ic.onrender.com`).

### Buy (Porkbun)

1. Register `useflops.com` for 1 year.
2. Skip web hosting / email hosting upsells (Vercel + Resend cover those).
3. Keep Porkbun nameservers unless you deliberately move DNS elsewhere.

### Attach on Vercel

1. Project → **Settings → Domains**.
2. Add `useflops.com` and `www.useflops.com`.
3. Prefer apex as primary (or follow Vercel’s redirect suggestion). Copy the **exact** DNS values from the domain card.

### DNS on Porkbun

In Domain Management → `useflops.com` → **DNS**:

1. Remove conflicting apex `A` / `AAAA` / `CNAME` and `www` records (Porkbun parking IPs block Vercel).
2. Add what Vercel shows — typically:
   - **A** `@` → `76.76.21.21` (or the IP on your Vercel domain card)
   - **CNAME** `www` → `cname.vercel-dns.com` (or the target on your domain card)
3. Wait until Vercel shows **Valid** / SSL issued (minutes to ~1 hour).

### CORS on Render

Set `ALLOWED_ORIGIN` (no trailing slashes):

```text
https://useflops.com,https://www.useflops.com,https://flops-amber.vercel.app
```

Restart or redeploy the Web Service. Confirm login works from `https://useflops.com`.

## Done when

You can bookmark **https://useflops.com**, Add to Home Screen, and use FLOPS from your phone with your laptop asleep.

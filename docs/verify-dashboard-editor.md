# Verify the Today dashboard layout editor in one go

Use this when edit mode feels broken (huge cards, no drag/resize). One command runs unit tests + browser checks on **desktop and mobile**, writes JSON reports, and exits `0` only if everything passes.

---

## Quick start (local)

```bash
cd client
npm install
npx playwright install chromium   # first time only
npm run verify:layout-editor
```

Starts API + Vite automatically (`AUTH_DEV=1`). Reports land in `client/e2e/reports/`.

**Watch the browser:**

```bash
npm run verify:layout-editor:headed
```

---

## Verify production (www.useflops.com)

1. Log in at https://www.useflops.com in Chrome.
2. DevTools → **Application** → **Local Storage** → copy `flops_auth_token`.
3. Run:

```bash
cd client
export FLOPS_E2E_TOKEN="paste-token-here"
npm run verify:layout-editor -- --production
```

This hits live with your session — no OTP email needed.

---

## Parameters (environment variables)

Copy `client/e2e/.env.example` or export before running:

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLOPS_BASE_URL` | `http://localhost:5173` | App URL |
| `FLOPS_API_BASE` | `http://localhost:3001` | API URL (local dev) |
| `FLOPS_E2E_EXTERNAL` | `0` | `1` = don't start local servers |
| `FLOPS_E2E_TOKEN` | — | **Required for production** — Bearer token |
| `FLOPS_LAYOUT_MACROS_MAX_HEIGHT` | `280` | Max macros card height (px) in edit mode |
| `FLOPS_LAYOUT_MIN_DRAG_DELTA` | `20` | Min drag movement (px) |
| `FLOPS_LAYOUT_MAX_H_SCROLL` | `4` | Max horizontal overflow (px) |
| `FLOPS_VERIFY_DESKTOP_ONLY` | — | Skip mobile project |
| `FLOPS_VERIFY_MOBILE_ONLY` | — | Skip desktop project |
| `FLOPS_VERIFY_VIDEO` | — | `1` = record video on failure |

**Example — stricter macros cap:**

```bash
FLOPS_LAYOUT_MACROS_MAX_HEIGHT=200 npm run verify:layout-editor
```

---

## What gets checked

| Check | Meaning |
|-------|---------|
| `profile-layout-readable` | `/api/profile` returns `dash_layout_json` |
| `saved-macros-not-inflated` | Warns if saved `macros.h > 8` |
| `edit-banner` | "Customizing Today" visible |
| `edit-canvas` | Grid edit mode mounted |
| `macros-compact` | Macros card height under threshold |
| `drag-handle-visible` | Six-dot handle present |
| `resize-handles` | Corner handles present |
| `no-horizontal-overflow` | No sideways scroll (mobile) |
| `drag-moves-card` | Desktop only — drag changes position |
| `no-console-errors` | No `console.error` during test |

Reports: `client/e2e/reports/layout-editor-report-chromium-desktop.json` and `...-mobile.json`.

---

## If verification fails

### 1. Hard refresh after deploy

`Cmd+Shift+R` on https://www.useflops.com — old JS bundle is a common cause.

### 2. Inspect saved layout

In DevTools → Network → `GET /api/profile`, look at `dash_layout_json`. Inflated `h` values (e.g. `macros.h: 20`) mean a bad save; **entering edit mode should still compact** — if not, that's a bug.

### 3. Reset layout (nuclear option)

In edit mode: rearrange cards → **Save & close**. Or clear `dash_layout_json` on your profile via API/DB.

### 4. Chrome DevTools MCP (your machine)

With MCP connected, ask Cursor:

> Open `/?editLayout=1` on useflops.com. Report computed height of `.react-grid-item[data-card-id="macros"]`, count of `.react-resizable-handle`, and any console errors.

### 5. Share artifacts

Send the two JSON reports from `e2e/reports/` plus a 10s screen recording if still broken.

---

## Other test commands

```bash
npm run test:e2e              # all Playwright specs
npm run test:e2e:ui           # interactive Playwright UI
npm test -- dashboardLayout   # unit tests only
```

---

## CI

```bash
cd client && CI=1 npm run verify:layout-editor
```

# FLOPS — Handoff / Current State

_Last updated: 2026-08-23_

> **▶ Product north star:** FLOPS is a **notebook** — see **`docs/philosophy-notebook.md`**.
> Viewing day does not auto-flip at midnight; coach tools are read + summarize.
>
> **Auth / onboarding / coach** are live: Bearer sessions (email OTP + Apple/dev),
> first-run onboarding, invite codes, consent scopes, Coach roster + soft suggestions.
>
> **Deploy:** **LIVE** — see [Deploy (live)](#deploy-live) below and **`docs/deploy-checklist.md`**.

Snapshot of where the app stands so any session (human or Claude Code) can pick up quickly.
For conventions, architecture, and the phase vision, see **`CLAUDE.md`** — this file is the
_current-state_ companion to it.

> **⚠️ Canonical repo:** **`~/dev/FLOPS`**. Do **not** work from
> `~/Documents/FLOPS workspace/` — that folder is stale / iCloud-adjacent and may
> not match what is deployed. Claude Code should `cd ~/dev/FLOPS`.

---

## Deploy (live)

| What | Where |
|---|---|
| **App** | [https://www.useflops.com](https://www.useflops.com) |
| **API** | `https://flops-c6ic.onrender.com` |
| **Frontend host** | Vercel (`client/`, auto-deploy on push to `main`) |
| **Backend host** | Render Web Service (`server/`, persistent disk at `/var/data/nutrition.db`) |
| **Backup Vercel URL** | `https://flops-amber.vercel.app` |

**Workflow:** commit + push to **`main`** → Vercel production deploy within ~1 min.
Render redeploys on push if connected to the same repo (confirm in Render dashboard if API changes don't appear).

**Verify a deploy:** `gh api repos/TheDoc004/flops/deployments --jq '.[0] | {env:.environment, sha:.sha[0:7], created:.created_at}'`

---

## 1. What FLOPS is (one line)

A personal nutrition + training tracker, built toward eventually connecting the two
(the "bridge", Phase 3). Nutrition and Training are developed as **separate domains** —
do not import one domain's business logic into the other.

Phases: **1 Nutrition** (feature-complete), **2 Training** (gym dashboard rebuilt — see below),
**3 Bridge** (future, not started).

---

## 2. How to run

Repo root: **`~/dev/FLOPS`**. One-shot: `bash ~/dev/FLOPS/start-app.sh`. Or two terminals:

```bash
cd ~/dev/FLOPS

# Terminal 1 — API (port 3001)
cd server && npm run dev

# Terminal 2 — client (Vite, port 5173, proxies /api → 3001)
cd client && npm run dev
```

SQLite DB: `server/nutrition.db` (ignore stale copy at repo root). Multi-user with auth:
Bearer session on `/api/*`; ownership via `req.user.id`. Schema + migrations are inline in
`server/db.js` (`PRAGMA table_info` + conditional `ALTER TABLE`).

> If a running API server predates a schema/route change, **restart it** — a plain
> `node index.js` will not pick up new code or run new migrations on its own.

**Tests:** `npm test --prefix server` · `npm test --prefix client` · `npm run build --prefix client`

---

## 3. Current state by area

### Nutrition (Phase 1) — solid / feature-complete

Dashboard, Recipe Library, Ingredient Library (OCR + barcode), Meal Builder, History/Review,
Goals, Report, Profile, Adherence, supplements, prep strip, coach, and AI Estimate all work.

**Today dashboard actions:** `AI Estimate` (`btn-ai`) and `+ Log a Meal` (`btn-primary`) in
`Dashboard.jsx` → `AiLoggerModal` / `LogMealModal`. **Training** hop (`Link` to `/training`)
lives beside them — Training is **not** in the nutrition navbar tabs.

**Log Meal vs AI Estimate:** Log a Meal is a **receipt** (optional recipe seed + library foods).
AI Estimate is speak/type natural language. See `docs/log-once-vs-save-as-recipe.md`.

### Notebook-day UI (off-today on Dashboard) — important for styling work

When the user views a date other than calendar-today on **`/`**, `Dashboard.jsx` sets
`html[data-notebook-day="past"|"future"]` on `<html>` and clears it on unmount.

**Theme:** `client/src/styles/index.css` (~lines 132–164) overrides design tokens to charcoal
surfaces + light text. **Today** keeps warm beige tokens.

**Gotchas discovered 2026-08-23:**

1. **Native `<dialog>` stays browser-white** unless styled. Off-today tokens make labels/titles
   light-on-white → invisible. Fix: `html[data-notebook-day] dialog { … }` block in `index.css`
   (~979+) — dialog surface, nested `.card`, inputs, utility classes.
2. **`--color-primary` becomes sky blue (`#60a5fa`)** on notebook days (for links). Default
   `.btn-primary` (white on sky blue) and `.btn-ai` washes out on charcoal. Fix: notebook-day
   overrides for `.btn-primary` / `.btn-ai` (~639+).
3. **Hardcoded light inline colors in modals** (e.g. `#f9fafb`, `#eff6ff`) break on notebook days.
   Prefer CSS variables or classes: `modal-subpanel`, `modal-highlight-panel`, `modal-loading-overlay`.

**Files:** `Dashboard.jsx` (attribute toggle), `index.css` (tokens + notebook rules),
`LogMealModal.jsx`, `AiLoggerModal.jsx`, `AiMacroLogger.jsx`.

Only the **Dashboard** page sets notebook-day — Recipes/Review/Training stay beige unless you
extend the pattern deliberately.

### Training / Gym (Phase 2) — rebuilt 2026-08-23

Nutrition logging is **untouched**. Training is a separate **gym dashboard** at `/training`.

| Route | Page | Role |
|---|---|---|
| `/training` | `GymToday` | Start/finish sessions, per-set logging, rest timer, activity sessions |
| `/training/schedule` | `GymSchedule` | Assign workout templates to weekdays |
| `/training/workouts` | `GymWorkouts` | Template list, muscle-grouped exercises, set/rep/weight targets |
| `/training/progress` | `GymProgress` | Charts, filters, last-session comparison, 1RM estimates |

**Shell:** `TrainingLayout.jsx` — gym title + **Nutrition** hop back. Gym tabs live in
`Navbar` / `BottomNav` (Today / Schedule / Workouts / Progress) when on `/training/*`.
Nutrition nav does **not** include Training as a tab.

**Backend:** new `/api/gym/*` in `server/routes/gym.js` — exercises, templates, sessions, sets,
schedule, 1RM helpers, duration-based activity sessions. Tests: `server/gym.test.js`.

**Client:** `client/src/features/training-workouts/` — `GymApp.jsx` routes by pathname;
`SetKeypad.jsx` for paper-style entry. Old monolithic `TrainingWorkouts.jsx` logger removed.

**Setgraph parity goal:** live per-set logging, templates, schedule, progress, rest timer from
template `rest_sec`, repeat-last-set, previous comparison, plate helper / XRM tables.

Legacy `server/routes/training.js` + `workouts.js` still exist; new gym UI uses **`gym.js`**.

### Supplements, barcode, AI logger, auth, coach

Unchanged from prior handoff detail — still accurate. See sections in git history or ask;
highlights: DSLD name lookup, label scan, dose vs serving, micronutrients v2, barcode via OFF,
multi-user auth, coach invite codes.

---

## 4. Git state

**Branch:** `main` · **Remote:** `origin/main` (GitHub `TheDoc004/flops`) · **in sync**

Recent production commits (newest first):

```
b933166 fix(dashboard): consistent modal colors on notebook days
45e4580 fix(dashboard): readable Log Meal and AI buttons off today
c333bea feat(gym): rebuild Training as a set logger
9799104 feat(gym): store sets, sessions, and templates
7337416 feat(training): swap chrome between nutrition and gym
```

Working tree should be clean before starting new work. **One topic per commit**; push to `main`
for live deploy unless explicitly working on a feature branch.

---

## 5. Known issues & tech debt

- **Oversized components:** `AiMacroLogger.jsx`, `Ingredients.jsx`, `MealBuilder.jsx`,
  `LogMealModal.jsx`, `ManageSupplementsModal.jsx`. Extract hooks to `client/src/shared/hooks/`.
- **Pre-existing lint:** duplicate `fontWeight` in inline styles (`Ingredients.jsx`,
  `ManageSupplementsModal.jsx`); `Profile.jsx` static-components warnings.
- **Client component tests** — sparse except utils and a few modals. Server routes well tested.
- **No in-app data export** — SQLite on Render disk; use `scripts/backup-sqlite.sh`.
- **Meal Builder browser history** — mode/step changes push history entries (fix: `{ replace: true }`).
- **Conditional inline style shorthand/longhand trap** — see old handoff note; grep when styling bugs appear.
- **AiMacroLogger** still has many hardcoded light-theme inline colors in review/expand panels —
  only the input card + loading overlay were fixed for notebook-day modals; deeper AI review UI
  may need the same token/class treatment if opened off-today.

---

## 6. Parked / deliberately deferred

- Goals & Profile restructure (Plan shell organization).
- AI Logger per-unit "1 g" bug — needs live repro.
- AI Logger recipe "one-shot invert" (estimate primary, saved recipe as suggestion).
- Phase 3 bridge — do not start until both domains feel solid independently.
- Nutrition refactors — opportunistic when touching files.

---

## 7. How work happens here (quick reminders)

- Beginner-friendly: explain non-obvious decisions; prefer the smallest change that works.
- Mobile-first always (test mentally at 390px).
- One topic per commit; don't bundle unrelated changes.
- Feature Brief before building a new feature; verify in browser, not just tests.
- **Do not put the repo back in iCloud-synced `~/Documents`.**
- For UI/theming: read **`docs/design-system.md`** and the notebook-day section above before
  touching `index.css` or modal components.

---

## 8. Moving to Claude Code (terminal)

1. `cd ~/dev/FLOPS` — not the Documents workspace copy.
2. Claude Code reads **`CLAUDE.md`** automatically; check **`HANDOFF.md`** (this file) for current state.
3. **`AGENTS.md`** — UI/design agent guide (some dashboard order notes are stale; trust this file for state).
4. Live changes: commit → `git push origin main` → confirm Vercel production deploy.
5. Local dev: two terminals (server + client) or `start-app.sh`.

**Session context (2026-08-23):** Fixed off-today readability for Log Meal / AI Estimate toolbar
buttons and modal interiors (charcoal notebook theme). Gym/set-logger rebuild shipped earlier
same week. User may continue gym UX polish (Setgraph-like live logging flow) or nutrition edges.

# FLOPS — Handoff / Current State

_Last updated: 2026-08-26_

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

### Marketing landing (unauthenticated) — refreshed 2026-08-26

When signed out, `/` shows the English landing and `/es` the Spanish one
(`client/src/features/marketing/`). Copy lives in `landingCopy.js` (flip-flops line,
mission, how it works, today vs Phase 3 vision, About Diego). Footer: Terms/Privacy
“Coming soon”, phone `925-286-6097` (no email on page). Social proof gated by
`SHOW_SOCIAL_PROOF` (false until real quotes). Primary CTA → `/login`.

**Auth UX:** web Login is email OTP only (Apple button removed; it 503’d in prod).
OTP send failures use clearer “email delivery may still be setting up” copy. Live OTP
still needs Resend domain verification on Diego’s side.

### Nutrition (Phase 1) — solid / feature-complete

Dashboard, Recipe Library, Ingredient Library (OCR + barcode), Meal Builder, History/Review,
Goals, Report, Profile, Adherence, supplements, prep strip, coach, and AI Estimate all work.

**Today dashboard actions:** `AI Estimate` (`btn-ai`) and `+ Log a Meal` (`btn-primary`) in
`Dashboard.jsx` → `AiLoggerModal` / `LogMealModal`. Meal rows’ ⋯ menu includes **Edit meal**
(opens the receipt editor on the existing entry — tweak amounts / drop a sauce after
copy-paste), plus Copy / Save as Recipe / Remove. **Training** hop (`Link` to `/training`)
lives beside them — Training is **not** in the nutrition navbar tabs. **Customize** toggles
layout edit mode (`?editLayout=1`) — drag/resize cards on desktop; mobile stacks by order.

**Dashboard canvas (Pass 2, 2026-08):** Today is a card canvas, not a fixed section order.
Registry cards: macros (pinned), supplements, weight, weight trend mini-chart, meals.
Layout in `user_profile.dash_layout_json`; show/hide via Profile toggles
(`dash_weight_enabled`, `dash_meals_enabled`, `dash_weight_chart_card_enabled`,
`dash_supplements_enabled`). Full weight history stays on Review; the mini-chart is optional
on Today. Implementation: `DashboardCanvas.jsx`, `dashboardLayout.js`, `WeightTrendMini.jsx`.

**Prepped ingredient batches (Pass 1, 2026-08):** Cooked batches with known total weight +
macros (`prepped_batches` table). Log by grams in Log a Meal; pool depletes on POST/PUT/DELETE
and hides when empty. Separate from limited-use **meal prep recipes** (`remaining_uses`) and
from **Augment meal prep** (add ingredients to an equal-split prep template in Recipe Library).
Entry: Ingredients → "Prep a batch". API: `/api/prepped-batches`.

**Augment meal prep:** Recipe Library → **Add to prep** on equal-split limited recipes with
`remaining_uses > 0`. Adds batch-level ingredients split across containers; does not change
`remaining_uses` or past log entries.

**Log Meal vs AI Estimate:** Log a Meal is a **receipt** (optional recipe seed + library foods).
AI Estimate is speak/type natural language. See `docs/log-once-vs-save-as-recipe.md`.
A receipt — or an already-logged meal — can be **captured as a recipe**; see
*Units & recipes from a receipt* below.

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

### Units & recipes from a receipt — added 2026-08-25

Two things shipped together: a **unit conversion layer**, and the ability to **save a receipt
or a logged meal as a recipe**.

**Conversion.** A saved ingredient can now be logged in any unit it can actually be measured
in — a milk saved as "1 cup" takes 200 ml, 7 fl oz, or 245 g. Rules live in
`client/src/shared/utils/unitConvert.js` + its CommonJS twin `server/unitConvert.js`; see
CLAUDE.md § Critical Conventions for the family model and the twin-file rule. The bridge across
families is `grams_per_unit`, a column that had been on `label_ingredients` all along and was
read by nothing until now. The log modal's unit dropdown offers only units that resolve, and
switching it *restates* the amount (1 cup → 236.59 ml) rather than reinterpreting the number.

**The AI logger sees the ingredient library.** `buildUserContent()` in `aiMacroService.js` now
sends each saved ingredient with the unit it is measured in, forbids converting the unit the
user said, and asks the model to name the ingredient it matched (`savedIngredient`). That name
is resolved against the real library and ignored when it isn't genuinely there, so a
hallucinated match yields nothing rather than wrong macros. This is what stopped
"1 filet of salmon" coming back as 100 g.

**Save as Recipe / Meal Prep** has two entry points, both producing library-backed lines so the
saved recipe stays editable in the Meal Builder:

| Where | Behaviour |
|---|---|
| Under `Log Meal` in `LogMealModal` | **Save as Recipe** or **Save as Meal Prep**; checkbox + equal N-way split; advanced custom % per container (creates one 1-use limited recipe per container) |
| `⋯` menu on a logged meal (`LogEntryRow`) | `SaveMealAsRecipeDialog` — name + optional equal meal-prep split |

Meal prep saves a **limited-use** template (`recipe_kind: 'limited'`, `meal_builder_meta.source: 'log_meal_prep'`), same accounting as AI logger meal prep: logging a serving decrements uses. Equal split = one recipe with N uses; custom % = N separate 1-use recipes.

A logged entry stores its ingredient rows **per serving**, so servings are deliberately not
applied when saving a normal recipe — saving a two-serving log produces a recipe for one.

**Traps worth remembering:**

- **Hybrid ingredient rows.** Both write handlers used to default `tracking_type` to `'weight'`,
  so a unit-shaped serving with no grams became permanently unloggable while looking complete
  in the library list — the symptom was *"needs grams per serving"* on an ingredient whose
  macros were saved. Fixed at the write path and repaired at boot.
- **The remembered-amounts memo** (last-used amounts per recipe, in localStorage) must
  round-trip the real unit. It briefly collapsed to g/oz on write, which re-seeded a meal logged
  as "200 ml" as "200 cup".
- **Placeholder units.** `unit`, `serving`, `portion`, `each` are interchangeable *only* when
  the ingredient's own unit is also a placeholder. A real unit never absorbs a vague one — one
  serving of a spray may be ten sprays.

**Not visually verified.** The unit dropdown, the ingredient-form hint, the Save as Recipe
button and its dialog are covered by tests and a clean build, but were never seen rendered —
the agent had no signed-in session. Worth an eyeball pass.

### Site chrome & link previews — added 2026-08-25

Sharing a Flops link (iMessage, Slack, WhatsApp) shows a navy wordmark card instead of a bare
blue link. Everything lives in `client/index.html`'s `<head>` plus two files in `client/public/`:

| File | What | Notes |
|---|---|---|
| `og-image.png` | 1200x630 link-preview card | Navy `#1e3a8a`, "Flops" in DM Serif Display, paper `#f3ede3` |
| `apple-touch-icon.png` | 180x180 home-screen icon | Navy tile + serif F, matches `favicon.svg` |

**Rules that are easy to get wrong:**

- `og:image` must be an **absolute** `https://` URL. A relative `/og-image.png` silently fails
  in iMessage.
- Must be a real bitmap. **SVG does not render** in link previews.
- Keep it under ~300KB (currently 208KB). iMessage abandons slow fetches and falls back to
  the plain text bubble with no error.
- **Bump `?v=` in the `og:image` URL whenever the artwork changes.** iMessage caches previews
  per-device essentially forever; without a new query string, nobody who already saw the old
  card will ever see the new one. To test, send yourself `useflops.com/?v=2`.

**Debugging trap:** `vercel.json` rewrites `/(.*)` to `/index.html`. Vercel checks the
filesystem first, so real assets serve correctly — but a **missing** asset returns
`200 text/html`, not a 404. A typo'd filename therefore hands iMessage an HTML page where it
expects a PNG, and the preview just silently goes blank. If a preview breaks, `curl -I` the
image URL and check the content-type before anything else.

**Regenerating the card:** it was rendered by headless Chrome from an HTML file (so DM Serif
Display loads from Google Fonts), screenshotted at `--force-device-scale-factor=2`, then
downsampled with `sips --resampleHeightWidth 630 1200`. Rendering at 2x and halving is what
keeps the serif edges clean.

---

## 4. Git state

**Branch:** `main` · **Remote:** `origin/main` (GitHub `TheDoc004/flops`) · **in sync**

Recent production commits (newest first):

```
e24bc27 feat(recipes): save a receipt or a logged meal as a recipe
a4fbfde test(dashboard): match the weigh-in tests to the settled card
772a7cd fix(ingredients): repair saved ingredients that could never be logged
4c9dee9 feat(nutrition): log a saved ingredient in any unit it can reach
f4750a8 Add link preview card and Apple touch icon
```

Working tree should be clean before starting new work. **One topic per commit**; push to `main`
for live deploy unless explicitly working on a feature branch.

---

## 5. Known issues & tech debt

- **Email OTP / Resend** — codes fail in production until the Resend sending domain is
  verified (and `RESEND_API_KEY` / `MAIL_FROM` are set on Render). Login UI copy now
  hints at setup; do not treat a code change as fixing delivery.
- **Oversized components:** `AiMacroLogger.jsx`, `Ingredients.jsx`, `MealBuilder.jsx`,
  `LogMealModal.jsx`, `ManageSupplementsModal.jsx`. Extract hooks to `client/src/shared/hooks/`.
- **Pre-existing lint:** duplicate `fontWeight` in inline styles (`Ingredients.jsx`,
  `ManageSupplementsModal.jsx`); `Profile.jsx` static-components warnings.
- **Client component tests** — still thin, but no longer bare: `test-setup.js` now stubs
  `matchMedia` (jsdom ships none), which was silently blocking any test that rendered
  `LogEntryRow` or anything else behind `useMediaQuery`. Suite is green: 332 client, 296 server.
- **Stale tab after a units deploy** — a cached bundle can send `g` for a count-tracked
  ingredient that has a gram equivalent, and the server will now read that as grams. Hard-refresh
  after deploying anything touching `unitConvert`. Narrow window; only affects ingredients with a
  gram equivalent recorded.
- **No in-app data export** — SQLite on Render disk; use `scripts/backup-sqlite.sh`.
- **Meal Builder browser history** — mode/step changes push history entries (fix: `{ replace: true }`).
- **Conditional inline style shorthand/longhand trap** — see old handoff note; grep when styling bugs appear.
- **Stale brand asset:** `flops-badge.png` (Navbar, Login, Landing) is still the old amber
  "Fuel your day" lightbulb from before the nutrition/training split, and clashes with the
  navy/paper identity in `styles/index.css`. It is also a 2MB 1536x1024 file rendered at badge
  size. Replacing it is its own pass — the 2026-08-25 link-preview work deliberately left it alone.
- **AiMacroLogger** still has many hardcoded light-theme inline colors in review/expand panels —
  only the input card + loading overlay were fixed for notebook-day modals; deeper AI review UI
  may need the same token/class treatment if opened off-today.

---

## 6. Parked / deliberately deferred

- Goals & Profile restructure (Plan shell organization).
- AI Logger per-unit "1 g" bug — **probably closed** by the 2026-08-25 units work (the model
  now keeps the unit you said, and the matcher converts instead of refusing). Re-check against
  a real library before deleting this line.
- AI Logger recipe "one-shot invert" (estimate primary, saved recipe as suggestion).
- Phase 3 bridge — do not start until both domains feel solid independently.
- Nutrition refactors — opportunistic when touching files.

---

## 7. How work happens here (quick reminders)

- Beginner-friendly: explain non-obvious decisions; prefer the smallest change that works.
- Mobile-first always (test mentally at 390px).
- One topic per commit; don't bundle unrelated changes.
- Feature Brief before building a new feature; verify in browser, not just tests.
- **Do not put the repo back in iCloud-synced `~/Documents`.** Related: **launch Claude Code
  from `~/dev/FLOPS`**, not the workspace folder — project hooks and settings only load for the
  directory the session started in.
- **This file is enforced, not suggested.** `.claude/hooks/check-handoff.sh` runs on the `Stop`
  event: it diffs everything since the session's starting commit (commits *and* working tree)
  and blocks once if source changed while `HANDOFF.md` did not. `.claude/hooks/session-base.sh`
  records that baseline at `SessionStart` — which is why a working-tree-only check is not enough,
  since work that has already been committed leaves a clean tree.
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

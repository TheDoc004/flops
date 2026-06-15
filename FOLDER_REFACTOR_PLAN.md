# Folder-Structure Refactor Plan

> **Status:** Planning only. No app source files have been moved, renamed, deleted, or edited.
> **Goal:** Reorganize `client/src` from a by-type layout into a feature-based layout with clear
> ownership boundaries, so multiple Claude Code / Cursor agents can work in parallel terminals
> without touching the same files.
> **Branch:** `refactor/folder-structure`

---

## 1. Current Structure Summary

The repo has three top-level zones:

```
FLOPS/
├── server/          # Express + SQLite API — already cleanly feature-partitioned
├── client/          # React 19 + Vite SPA — flat "by-type" structure (the refactor target)
├── docs/            # design system + specs
├── AGENTS.md, CLAUDE.md, start-app.sh, nutrition.db (stale root copy)
```

**Server** is already organized by feature. Each route file maps 1:1 to a domain, over two shared modules:

```
server/
├── index.js                 # entry, CORS, route mounting        [APP SHELL]
├── db.js                    # schema + all migrations            [SHARED / PROTECTED]
├── recipeIngredients.js     # variable-slot logic                [SHARED — used by log + recipes]
└── routes/
    ├── recipes.js  log.js  goals.js  profile.js
    ├── training.js  workouts.js  labelIngredients.js
```

**Client** is the problem. It is organized *by file type* (`pages/`, `components/`, `utils/`, `api/`, `hooks/`),
not by feature. Every agent working on any feature reaches into the same four folders — the exact collision
risk this refactor eliminates.

Key metrics from the audit:

| Concern | Finding |
|---|---|
| Pages | 11 files, 5,017 lines. `MealBuilder.jsx` (1,112) and `TrainingWorkouts.jsx` (905) are oversized. |
| Components | 21 files, 3,914 lines. `LogMealModal.jsx` (669) is a large shared component. |
| Utils | 21 source files + 10 colocated `.test.js` files (tests live next to code — keep this). |
| API | 8 thin fetch wrappers (`base.js` + 7 route clients). Inherently cross-feature. |
| Hooks | 3 hooks, all genuinely shared. (`hooks/` is **not** empty — CLAUDE.md/AGENTS.md are out of date.) |
| Context | `MacroUnitsContext` only. |

Notes / drift found during audit:
- **Two dead files** (no references anywhere): `components/IngredientCreateModal.jsx`, `components/GoalAdherencePanel.jsx`. Both are still advertised as "reusable" in `AGENTS.md`. **Confirm before deleting.**
- **Stale DB:** root `nutrition.db` is unused; the server uses `server/nutrition.db`.
- **Doc drift:** CLAUDE.md/AGENTS.md describe `hooks/` as empty; it has 3 hooks.
- **No `jsconfig.json` / `tsconfig.json`** yet — relevant to path aliases (see Migration Step 0).

---

## 2. Proposed Target Folder Structure

**Design principle:** organize `client/src` by *feature*; give each cross-cutting module its own folder with a
**public API barrel (`index.js`)**; concentrate everything global in `shared/` and `app/`. Agents edit inside
one feature folder and may *import* another feature only through its barrel — never reach into its internals.

```
client/src/
├── app/                          # APP SHELL — owner: "shell" agent / protected
│   ├── App.jsx                   # router + providers
│   ├── main.jsx
│   ├── routes.jsx                # (optional) extract <Routes> out of App.jsx
│   └── layouts/
│       └── PlanLayout.jsx        # was pages/Plan.jsx
│
├── shared/                       # PROTECTED — cross-feature primitives
│   ├── api/
│   │   ├── base.js
│   │   └── {log,profile,goals,recipes,training,workouts,labelIngredients}.js
│   ├── hooks/
│   │   └── useDropdownPlacement.js  useMediaQuery.js  usePaginationAnchor.js
│   ├── context/
│   │   └── MacroUnitsContext.jsx
│   ├── ui/                       # generic, presentational, feature-agnostic
│   │   ├── MacroTotals.jsx  RangeSelector.jsx
│   │   └── Navbar.jsx  BottomNav.jsx (+ .module.css)
│   └── utils/
│       ├── dateLocal.js  weekday.js  macros.js
│       ├── macroUnits.js  bodyUnits.js  colors.js
│       └── *.test.js (stay colocated)
│
├── features/
│   ├── dashboard/
│   │   ├── Dashboard.jsx
│   │   ├── components/ DashboardAdherenceSection, DashboardWeightTrend,
│   │   │               DashboardWeightRow, MealFuelReadinessCard,
│   │   │               DailyTrainingContextBanner
│   │   └── index.js
│   │
│   ├── meal-logging/             # CROSS-CUTTING — owner: one agent
│   │   ├── components/ LogMealModal.jsx  LogEntryRow.jsx
│   │   ├── utils/ quickFoods.js  recipeLogMacros.js  recipeLoggingSlots.js
│   │   └── index.js              # exports LogMealModal, LogEntryRow
│   │
│   ├── adherence/                # CROSS-CUTTING
│   │   ├── components/ GoalAdherenceDayDetailDialog.jsx  (GoalAdherencePanel?*)
│   │   ├── utils/ goalAdherence.js  statusMeta.js
│   │   └── index.js
│   │
│   ├── recipes/        Recipes.jsx, RecipeRow, utils/recipeSearch, index.js
│   ├── meal-builder/   MealBuilder.jsx, RecipeForm, IngredientCombobox, index.js
│   ├── ingredients/    Ingredients.jsx, index.js
│   ├── label-ocr/      LabelCropModal, labelOcr, labelParse, labelImagePreprocess,
│   │                   labelMacro, mergeNutritionParseIntoIngredientForm, index.js
│   ├── history/        History.jsx, RangeSelector*, AdherenceCalendarMonth, index.js
│   ├── goals/          Goals.jsx, index.js
│   ├── training-fuel/  Training.jsx, RecipeCombobox, mealTrainingReadiness,
│   │                   trainingFuel, index.js
│   ├── training-workouts/  TrainingWorkouts.jsx, ExerciseCombobox, index.js
│   ├── report/         Report.jsx, buildNutritionReportPdf, reportStats, index.js
│   └── profile/        Profile.jsx, index.js
│
└── styles/
    ├── index.css                 # PROTECTED design tokens
    └── App.css
```

> `*` Open decisions: where `RangeSelector` lives (history-only today → recommend `shared/ui` since it's generic),
> and whether `GoalAdherencePanel` / `IngredientCreateModal` survive at all (currently dead code).

**Server** needs little structural change — it is already feature-partitioned. Optional polish only: group
`db.js` + `recipeIngredients.js` under `server/shared/` to mirror the client's protected zone.

---

## 3. Feature Ownership Map

Verified by tracing actual imports. Consumer counts in parentheses.

### Feature-owned (single consumer — safe to fully own)

| Feature | Files |
|---|---|
| **dashboard** | `pages/Dashboard.jsx`, `DashboardAdherenceSection`, `DashboardWeightTrend`, `DashboardWeightRow`, `MealFuelReadinessCard`, `MacroTotals`, `DailyTrainingContextBanner` |
| **recipes** | `pages/Recipes.jsx`, `RecipeRow`, `utils/recipeSearch` |
| **ingredients** | `pages/Ingredients.jsx` |
| **meal-builder** | `pages/MealBuilder.jsx`, `RecipeForm`, `IngredientCombobox` |
| **history** | `pages/History.jsx`, `RangeSelector`, `AdherenceCalendarMonth` |
| **goals** | `pages/Goals.jsx` |
| **training-fuel** | `pages/Training.jsx`, `RecipeCombobox` |
| **training-workouts** | `pages/TrainingWorkouts.jsx`, `ExerciseCombobox` |
| **report** | `pages/Report.jsx`, `utils/buildNutritionReportPdf`, `utils/reportStats` |
| **profile** | `pages/Profile.jsx` |
| **app shell** | `App.jsx`, `main.jsx`, `Plan.jsx`, `Navbar`, `BottomNav` |

### Cross-cutting modules (own folder, single owning agent, consumed via public barrel)

| Module | Files | Consumed by |
|---|---|---|
| **meal-logging** | `LogMealModal` (669), `LogEntryRow`, `utils/quickFoods`, `recipeLogMacros`, `recipeLoggingSlots` | Dashboard, History, Recipes |
| **adherence** | `goalAdherence` (5), `statusMeta` (4), `GoalAdherenceDayDetailDialog`, `GoalAdherencePanel`* | Dashboard, History, AdherenceCalendarMonth |
| **label/OCR** | `labelOcr`, `labelParse`, `labelImagePreprocess`, `labelMacro`, `mergeNutritionParseIntoIngredientForm`, `LabelCropModal` | MealBuilder, Ingredients |
| **training-fuel logic** | `mealTrainingReadiness`, `trainingFuel` | Dashboard, Training (fuel) |

### App-level / config / storage

- **Routing & providers:** `App.jsx` (router + `MacroUnitsProvider`), `Plan.jsx` (nested layout), `main.jsx`.
- **Global styles:** `index.css` (design tokens), `App.css`.
- **Build config:** `vite.config.js` (proxy + Vitest), `eslint.config.js`, `package.json`. No `jsconfig`/`tsconfig` yet.
- **Client data layer:** `api/*` (HTTP boundary).
- **Server storage:** `server/db.js` (schema + migrations), `server/nutrition.db` (live), root `nutrition.db` (**stale**), `server/recipeIngredients.js`.

---

## 4. Shared / Protected Files

These have app-wide blast radius. **No feature agent edits them unilaterally** — changes route through the
integration/shell agent (see §7).

| File | Consumers | Role |
|---|---|---|
| `styles/index.css` | global | Design tokens — highest blast radius. |
| `utils/dateLocal` | **10** | Local-date helpers — most-imported file. |
| `utils/weekday` | 6 | ISO weekday labels/helpers. |
| `utils/macros` | 5 | `sumMacros`, `groupByDate`. |
| `utils/macroUnits`, `colors`, `bodyUnits` | 3 each | Unit/format/color primitives. |
| `api/base.js` | all api modules | Foundation of every fetch wrapper. |
| `api/{log,profile,goals,recipes,training,workouts,labelIngredients}.js` | 2–7 each | Thin clients; multiple features call each. |
| `hooks/useDropdownPlacement` | 3 comboboxes | Shared hook. |
| `hooks/useMediaQuery`, `usePaginationAnchor` | 1–2 | Shared hooks. |
| `context/MacroUnitsContext` | many (via App) | Only React context. |
| `server/db.js` | all routes | Schema + inline migrations; one editor at a time. |
| `server/recipeIngredients.js` | log + recipes | Variable-slot logic. |

---

## 5. Risky / High-Import Files

Ordered by blast radius (change with care, smoke-test broadly):

1. **`index.css`** — global tokens; a change can visually break every page. Highest risk.
2. **`utils/dateLocal.js`** (10 importers) — signature changes ripple across nearly every page.
3. **`api/base.js`** — underpins all API calls.
4. **`context/MacroUnitsContext.jsx`** — consumed app-wide; depends on `api/profile`.
5. **`utils/macros.js`, `utils/weekday.js`, `utils/goalAdherence.js`** (5–6 importers each).
6. **`components/LogMealModal.jsx`** (669 lines, 3 pages) — large *and* shared; most likely real-world merge-conflict hotspot.
7. **`server/db.js`** — every route depends on it; inline migrations make it edit-sensitive.

---

## 6. Recommended Migration Order

The enabling move is **path aliases first** — without them, every file move rewrites a web of `../../` relative
imports, which is exactly where agents conflict and break things.

**Step 0 — Add path aliases (foundation; do before any move).**
Add `resolve.alias` in `vite.config.js` (`@app`, `@shared`, `@features`) and a `jsconfig.json` so the editor +
Vitest resolve them. Makes feature folders relocatable and ownership *visible in every import line*. Verify the
app still builds and tests pass with zero moves yet.

**Step 1 — Carve out `shared/` and `app/`.**
Move global primitives (`utils/dateLocal`, `weekday`, `macros`, `macroUnits`, `bodyUnits`, `colors`, all `api/`,
`hooks/`, `context/`, `Navbar`/`BottomNav`, `MacroTotals`, `RangeSelector`) and the shell (`App.jsx`, `main.jsx`,
`Plan.jsx`). Repoint imports to `@shared/...`. Run tests. **Done once, by one person, before parallel work begins**
— it touches everything.

**Step 2 — Establish cross-cutting modules** (`meal-logging`, `adherence`, `label-ocr`), each with an `index.js`
barrel. Repoint consumers to the barrel. Settle these before fan-out because they are shared.

**Step 3 — Move leaf features (parallelizable, one agent per feature).**
`report` → `profile` → `goals` → `recipes` → `training-workouts` → `training-fuel` → `ingredients` →
`meal-builder` → `history` → `dashboard`. Each is self-contained at this point. Dashboard goes last because it
depends on the most modules.

**Step 4 — Cleanup & docs.**
Resolve dead files (confirm first), delete stale root `nutrition.db`, update `CLAUDE.md` + `AGENTS.md` file maps.

Rationale: shared-first means every later move only fixes imports *into* stable alias paths, never into another
in-flight folder.

---

## 7. Multi-Agent Workflow Rules

**One agent = one feature folder.** Rules that make parallelism safe:

1. **An agent may freely edit only files inside its assigned `features/<x>/` folder.**
2. **Cross-feature use goes through the barrel.** Import `LogMealModal` as `@features/meal-logging`, never
   `@features/meal-logging/components/LogMealModal`. This lets the owning agent refactor internals without breaking anyone.
3. **`shared/`, `app/`, and `styles/index.css` are protected.** No feature agent edits them unilaterally — changes
   route through a designated **integration/shell agent** (or the project owner), because they have app-wide blast radius.
4. **Cross-cutting modules (`meal-logging`, `adherence`, `label-ocr`) each have a single owner.** Consumers request
   additions to the public API rather than editing internals.
5. **Server agents** map to route files (already isolated); `db.js` and `recipeIngredients.js` are protected like client `shared/`.
6. **One feature per commit.** Run build + tests after each move before pushing.

Suggested terminal assignment for parallel work:

| Terminal | Agent owns |
|---|---|
| A | `features/dashboard` + `features/meal-logging` (tightly coupled) |
| B | `features/recipes` + `features/meal-builder` + `features/label-ocr` |
| C | `features/training-workouts` + `features/training-fuel` |
| D | `features/history` + `features/goals` + `features/adherence` |
| E | `features/profile` + `features/report` + `features/ingredients` |
| Integration | `app/`, `shared/`, `styles/`, server `db.js` |

---

## 8. Manual Testing Checklist

Run after **each** migration step (especially Step 1 and Step 3). Both servers running:
`cd server && npm run dev` and `cd client && npm run dev`.

**Automated gates (run first):**
- [ ] `cd client && npm run build` — succeeds with no unresolved imports.
- [ ] `cd client && npm test` (Vitest) — all client tests pass.
- [ ] `cd server && npm test` (Jest) — all server tests pass.
- [ ] No ESLint errors introduced (`npm run lint` if configured).

**Per-route smoke test (click through each):**
- [ ] `/` Dashboard — meals list, macro totals, weight row, weight/calorie trend chart, training context banner, fuel readiness card, 7-day adherence strip all render.
- [ ] `/` Dashboard — log a meal via modal; quick-food log; delete an entry.
- [ ] `/recipes` — list, search, archive, soft-delete, log directly.
- [ ] `/ingredients` — list, OCR label scan + crop flow, manual create, pagination.
- [ ] `/meal-builder` — label (OCR → ingredient → recipe) and manual modes; ingredient slot swap; save permanent + limited-use template.
- [ ] `/history` — charts, calendar month drill-down, edit + delete past entries.
- [ ] `/training` — workout presets, exercise combobox, logging, progress.
- [ ] `/plan/goals` — view + save weekly macro targets (min/max).
- [ ] `/plan/fuel` — digestion pref, training goal, recipe combobox, saved fuel shortcuts.
- [ ] `/plan/report` — PDF export over a date range downloads correctly.
- [ ] `/plan/profile` — physical stats, unit toggles (metric/US), dashboard widget toggles.

**Cross-cutting checks:**
- [ ] Navbar + BottomNav render and navigate on every route.
- [ ] Back-compat redirects work: `/goals`, `/fuel`, `/report`, `/profile` → `/plan/*`.
- [ ] Unit toggle (MacroUnitsContext) updates macro + weight displays app-wide.
- [ ] Mobile layout sane at 390px wide (per project mobile-first rule).
- [ ] Browser console clean (no errors, no leftover `console.log`).

---

## 9. Rollback Strategy

All work happens on the `refactor/folder-structure` branch; `main` is never touched directly.

**Per-step safety:**
- Commit after each migration step with a clear message (e.g. `refactor: move shared utils to shared/`).
  Each commit is independently revertable with `git revert <sha>` or `git reset --hard <sha>`.
- Tag the pre-refactor state for a fast escape hatch:
  `git tag pre-refactor-baseline` (on the commit before Step 0).

**If a step breaks the build/tests:**
1. Do not push. Run `git status` / `git diff` to see what moved.
2. Prefer `git restore <file>` / `git checkout -- <path>` to undo specific files, or
   `git reset --hard HEAD` to discard the whole uncommitted step.
3. If a bad commit was already made: `git revert <sha>` (keeps history) or
   `git reset --hard <previous-sha>` (local only, before push).

**Worst case (abandon refactor entirely):**
- `git checkout main && git branch -D refactor/folder-structure` — discards all refactor work; `main` is untouched.
- Or `git reset --hard pre-refactor-baseline` to return the branch to the starting point.

**Multi-agent coordination:**
- Agents work on separate feature folders to minimize conflicts; if two touch a shared/protected file, the
  integration agent resolves and the conflicting feature commit is rebased, not force-merged.
- Keep Step 1 (shared/app carve-out) as a single isolated commit so it can be reverted without unwinding feature moves.

---

## 10. What Should NOT Be Moved Yet

- **Nothing, until Step 0 (path aliases) lands and the app builds + tests pass.** Moving files before aliases
  exist multiplies relative-import churn and conflict risk.
- **`server/db.js` and `server/recipeIngredients.js`** — leave in place; server is already well-structured. Any
  server reorg is optional polish, done last and separately.
- **Dead files** (`IngredientCreateModal.jsx`, `GoalAdherencePanel.jsx`) — do **not** delete until the owner
  confirms they are truly unused (they are still listed as reusable in `AGENTS.md`).
- **Stale root `nutrition.db`** — leave until cleanup Step 4; confirm the server points at `server/nutrition.db`.
- **`index.css` / design tokens** — do not split or restructure during the move; relocating the file is fine,
  but content changes are a separate task with their own review.
- **Large oversized pages** (`MealBuilder.jsx` 1,112 lines, `TrainingWorkouts.jsx` 905 lines) — **move them as-is.**
  Extracting custom hooks / splitting them is a separate refactor; do not combine it with the folder move.
- **`CLAUDE.md` / `AGENTS.md` file maps** — update only in Step 4, after the structure is final, so docs don't
  drift mid-migration.

---

---

## Appendix A — Step 1A Execution Detail (shared/ carve-out)

> Scope locked to the **shared foundation only**. Step 1B (`app/` shell, `main.jsx`,
> `index.html`, global styles) is explicitly deferred. Pages and feature components are NOT moved.
> Builds on Step 0 path aliases (commit `39ce894`).

### Pre-flight — delete dead files
Both are referenced nowhere and are importers of modules being moved:
- `client/src/components/IngredientCreateModal.jsx` (imports `api/labelIngredients`)
- `client/src/components/GoalAdherencePanel.jsx` (imports `utils/weekday`, `utils/statusMeta`)

### Files moved (via `git mv`, history preserved)

| Destination | Files |
|---|---|
| `shared/utils/` | `dateLocal.js` `weekday.js` `macros.js` `macroUnits.js` `bodyUnits.js` `colors.js` + colocated tests: `dateLocal.test.js` `weekday.test.js` `macros.test.js` `macroUnits.test.js` `bodyUnits.test.js` |
| `shared/api/` | `base.js` `log.js` `profile.js` `goals.js` `recipes.js` `training.js` `workouts.js` `labelIngredients.js` |
| `shared/hooks/` | `useDropdownPlacement.js` `useMediaQuery.js` `usePaginationAnchor.js` |
| `shared/context/` | `MacroUnitsContext.jsx` |
| `shared/ui/` | `MacroTotals.jsx` `RangeSelector.jsx` `Navbar.jsx` (+`Navbar.module.css`) `BottomNav.jsx` (+`BottomNav.module.css`) |

### Import rewrites (suffix-based, location-independent)
All consumers + the moved files' own internal imports are rewritten to aliases:
- `…/utils/{dateLocal,weekday,macros,macroUnits,bodyUnits,colors}` → `@shared/utils/<name>`
- `…/api/{log,profile,goals,recipes,training,workouts,labelIngredients}` → `@shared/api/<name>`
- `…/hooks/{useDropdownPlacement,useMediaQuery,usePaginationAnchor}` → `@shared/hooks/<name>`
- `…/context/MacroUnitsContext` → `@shared/context/MacroUnitsContext`
- `…/components/{MacroTotals,RangeSelector,Navbar,BottomNav}` → `@shared/ui/<name>`

Untouched on purpose: `./base` (api siblings move together), `./*.module.css` (move with their
component), `./<name>` inside util test files (sibling source moves with the test).

### Explicitly NOT in 1A
`App.jsx`, `main.jsx`, `index.html`, `pages/Plan.jsx`, `index.css`/`App.css`, all feature pages,
and the cross-cutting modules (`meal-logging`, `adherence`, `label-ocr`) and their utils.

### Verification
`cd client && npm run build` (authoritative), plus a grep sweep confirming no stale relative paths
to moved modules remain.

---

*Generated as a planning artifact. No source files were modified to produce this document.*

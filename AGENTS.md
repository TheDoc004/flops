# AGENTS.md — Flops AI Design Guide

> **Current state & deploy:** read **`HANDOFF.md`** first. Canonical repo: **`~/dev/FLOPS`**. Live at **https://www.useflops.com** (push `main` → Vercel).

This file defines how AI agents (Claude Code, Cursor, Copilot, etc.) should think about this codebase.
Read it before making any UI or architectural decisions.

---

## What This App Is

Flops is a personal fitness app that connects nutrition and training data intelligently.
It has two sides — a nutrition tracker and a workout tracker — that will eventually share data
to surface insights automatically. Think: your nutritionist and personal trainer in one app,
sharing the same client file.

**Current focus:** Gym dashboard (`/training`) — set-by-set logging, templates, schedule, progress.
Nutrition is feature-complete; polish and notebook-day UI consistency are ongoing.

---

## UI Philosophy

This app aspires to feel like Linear, Raycast, or Apple Health — clean, fast, intentional.
Every screen should feel like it was designed for one job, not assembled from parts.

**Principles:**
- **Clarity over cleverness.** If a layout needs explanation, it's wrong.
- **Mobile-first, always.** Design for 390px wide before thinking about desktop.
- **Data should feel alive.** Charts, progress bars, and numbers are the product — treat them with care.
- **Whitespace is structure.** Don't fill space. Let content breathe.
- **Touch targets ≥ 44px.** Every interactive element. No exceptions.

---

## Coding Philosophy

- One component = one job. If it fetches, manages state, AND renders — split it.
- No CSS frameworks. Use the existing plain CSS system in `client/src/styles/index.css`.
- Reuse before you create. Check `client/src/shared/ui/` and the relevant `features/<name>/` before writing a new component.
- Recharts for all charts, always inside `<ResponsiveContainer width="100%" height={N}>`.
- SQLite is synchronous — no `.then()` on DB calls, no async/await on `better-sqlite3`.
- Soft deletes only. Never hard-delete anything that log entries could reference.
- **Auth is live** — multi-user Bearer sessions; never assume `user_id = 0`. See `CLAUDE.md`.

## Reusable Components (check these before building new ones)

| Component | What it does |
|---|---|
| `ExerciseCombobox` | Searchable dropdown for the exercise library |
| `IngredientCombobox` | Searchable dropdown for label ingredients |
| `RecipeCombobox` | Searchable dropdown for recipes |
| `MacroTotals` | Macro progress bars with min/max goal ranges |
| `AdherenceCalendarMonth` | Monthly calendar with per-day color coding |
| `GoalAdherencePanel` | 7-day adherence strip for the Dashboard |
| `LabelCropModal` | OCR label scan and crop flow |
| `IngredientCreateModal` | Create a new ingredient inline |
| `DailyTrainingContextBanner` | Training context selector (rest / cardio / lifting) |

---

## What NOT to Do

- Don't add Tailwind, Bootstrap, or any CSS framework.
- Don't migrate the database — SQLite is intentional.
- Don't rebuild working features to fix small bugs.
- Don't start Phase 3 (bridge features) until Phase 2 gym UX feels solid.
- Don't leave `console.log` in finished code.
- Don't write comments that describe what the code does — only write them when the WHY is non-obvious.
- **Notebook-day UI:** when touching Dashboard modals or `index.css` buttons, test a **past day** —
  native `<dialog>` and `.btn-primary` / `.btn-ai` need explicit off-today rules (see `HANDOFF.md`).

---

## File Map (quick orientation)

```
server/
  db.js                  — schema + all migrations inline
  routes/
    recipes.js           — recipe CRUD
    log.js               — meal log
    goals.js             — versioned macro targets
    profile.js           — user profile + body weights
    training.js          — schedule, overrides, daily context, feedback
    workouts.js          — presets, exercise library, logs, progress
    labelIngredients.js  — ingredient library

client/src/
  app/                   — App.jsx (router + MacroUnitsProvider), main.jsx, layouts/
  styles/                — index.css (design system), App.css
  shared/                — cross-feature foundation: api/, utils/, hooks/, context/, ui/
  features/<name>/       — one folder per feature; <Page>.jsx + index.js barrel,
                           colocated components/utils. Cross-cutting modules live here too
                           (label-ocr, adherence, meal-logging).
```

Import conventions: cross-feature imports use aliases (`@app`, `@shared`, `@features`, `@` → src);
within a feature use relative paths. Import cross-cutting modules via their barrel, never internals.

---

## Layout Constraints

- **Content max-width: 900px**, centered, `padding: 24px 16px`. Set in `App.jsx`.
- **Navbar inner content must also be constrained to 900px** and centered. The nav spans the full viewport for the background/shadow, but the inner wrapper is bounded. This keeps nav items visually aligned with page content — don't break this.
- Page content and nav share the same horizontal rail. Any change to one should be reflected in the other.

---

## Dashboard Section Order (nutrition `/`)

Order evolves — verify in `Dashboard.jsx` before changing. Roughly:
1. Date toolbar + **AI Estimate** / **Log a Meal** / **Training** hop
2. Off-today banner (when not calendar-today)
3. Macro rings + supplements strip + weight row
4. Today's meals list

Charts, adherence, and micronutrient review live on **`/history`**, not Today.

**Gym `/training`:** separate shell — `TrainingLayout` + gym tabs in nav (Today / Schedule / Workouts / Progress).

---

## Design Tokens (use these, don't invent new ones)

See `docs/design-system.md` for the full token set.

Primary action: `#2563eb`
Destructive: `#dc2626`
Background: `#f9fafb`
Card surface: `#ffffff`
Border: `#f3f4f6` (internal dividers), `#e5e7eb` (card borders)
Text primary: `#111827`
Text muted: `#9ca3af`

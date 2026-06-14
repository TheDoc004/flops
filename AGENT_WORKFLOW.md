# Agent Workflow Rules — Flops

> Practical rules for AI agents (Claude Code, Cursor, Copilot, etc.) working on Flops, especially when
> **multiple agents run in parallel terminals**. Read this before editing anything.
> Companion document: [`FOLDER_REFACTOR_PLAN.md`](./FOLDER_REFACTOR_PLAN.md) (the target structure and ownership map).

---

## 1. Purpose

Flops is being reorganized into a **feature-based folder structure** so that multiple agents can work on
different parts of the app at the same time without colliding. This file defines the operating rules that make
that safe:

- Each agent owns one folder and stays in it.
- Shared, service, and app-shell files are protected and changed only with coordination.
- Every agent ends with a structured report and a clean git checkpoint.

If a rule here conflicts with a casual instruction in a prompt, **follow this file and flag the conflict** before proceeding.

---

## 2. Golden Rule — Stay in Your Assigned Folder

**An agent may freely create, edit, and delete files only inside its single assigned feature folder**
(e.g. `client/src/features/dashboard/`).

- You are told your feature at the start of the session. If you were not, **stop and ask** which folder you own.
- Do **not** edit files in another feature's folder. If you need behavior from another feature, import it through
  that feature's **public barrel** (`@features/<name>`), never by reaching into its internals
  (`@features/<name>/components/...`).
- If your task seems to require editing outside your folder, that is a signal — see §6 (requesting protected/cross-folder edits).
- Moving or renaming files counts as editing. The same boundaries apply.

---

## 3. Protected Folders & Files

These have app-wide blast radius. **Do not edit them unilaterally.** Edits require the process in §6 and are
normally performed by the **integration/shell agent** (or the project owner).

| Protected area | Why |
|---|---|
| `client/src/shared/**` (shared utils, hooks, context, ui) | Imported across many features; ripple risk. |
| `client/src/shared/api/**` *(service/data layer)* | The HTTP contract every feature depends on. |
| `client/src/app/**` (App shell, routing, providers, layouts) | Breaking it breaks navigation app-wide. |
| `client/src/styles/index.css` *(and any global CSS)* | Design tokens — affects every page visually. |
| `client/src/styles/App.css` | Global layout styles. |
| `package.json` / `package-lock.json` (client **and** server) | Dependency + script changes affect everyone. |
| `vite.config.js` *(a.k.a. vite.config.ts)* | Build, proxy, aliases, test config. |
| `jsconfig.json` / `tsconfig.json` | Path-alias + resolution config. |
| `eslint.config.js` | Lint rules for the whole repo. |
| `server/db.js` | SQLite schema + inline migrations; one editor at a time. |
| `server/recipeIngredients.js` | Shared variable-slot logic (used by log + recipes). |

### High-risk files (from the refactor plan — extra caution even within the above)

1. `styles/index.css` — global design tokens. Highest blast radius.
2. `shared/utils/dateLocal.js` — **10 importers**; most-imported file in the app.
3. `shared/api/base.js` — underpins all API calls.
4. `shared/context/MacroUnitsContext.jsx` — consumed app-wide.
5. `shared/utils/macros.js`, `weekday.js`, `goalAdherence.js` — 5–6 importers each.
6. `features/meal-logging/components/LogMealModal.jsx` — 669 lines, used by 3 pages. Likely conflict hotspot.
7. `server/db.js` — every route depends on it.

---

## 4. Shared File Rules

"Shared" = anything under `client/src/shared/**` plus the cross-cutting feature modules
(`features/meal-logging`, `features/adherence`, `features/label-ocr`).

- **Read freely, edit by request only.** Consuming a shared util/component is always fine. Changing its
  implementation or signature is not, unless you own it or have followed §6.
- **Each cross-cutting module has a single owner.** If you need new behavior from `meal-logging`, `adherence`, or
  `label-ocr`, request an addition to its public API (its `index.js` barrel) rather than editing internals.
- **Never change a shared function's signature** to suit one caller. Add a new function or an optional parameter
  with a safe default, and call out the change in your final report.
- **Import only through barrels.** This keeps the owning agent free to refactor internals.

---

## 5. App-Level File Rules

App-level = `client/src/app/**` (router, providers, layouts), global CSS, and all build/config files in §3.

- These are owned by the **integration/shell agent**. Feature agents do not edit them as part of feature work.
- Adding a new route, provider, or global style is an **app-shell task**, not a feature task — route it to the
  shell agent (see §6).
- If your feature needs a new route entry, describe the exact `<Route>` you need in your final report; do not
  edit `app/App.jsx` or `routes.jsx` yourself unless you are the shell agent.
- Do not add dependencies (`package.json`) or change `vite.config.js` to make a feature work without explicit
  approval — these affect every agent and the build.

---

## 6. How to Request / Justify a Protected-File Edit

If your task genuinely requires touching a protected or cross-folder file, **do not just do it.** Stop and produce
a short change request, then wait for approval (from the project owner or integration agent):

```
PROTECTED EDIT REQUEST
File(s):        <exact path(s)>
Why needed:     <what your feature can't do without it>
Proposed change: <precise diff or description — signature, lines, behavior>
Blast radius:   <who else imports this; from FOLDER_REFACTOR_PLAN.md §4–5>
Safer alternative considered: <e.g. add new fn vs. change existing; why rejected>
Rollback:       <how to revert if it breaks>
```

Guidance:
- Prefer **additive** changes (new function, new optional prop) over modifying shared behavior.
- If the change is purely to add a route/provider/global style, hand it to the **shell agent** instead of editing.
- Never bundle a protected-file edit into an unrelated feature commit.

---

## 7. Required Final Report Format

End every session with this report so the owner and other agents can review without re-reading the diff:

```
SESSION REPORT
Agent / feature owned: <feature folder>
Task:                  <one-line goal>

Files created:         <paths>
Files edited:          <paths>
Files moved/renamed:    <from → to>
Files deleted:         <paths, with reason>

Protected files touched: <none | list + link to approved request>
Shared API changes:    <none | additive fn/prop added; who it affects>
New routes/deps needed: <none | hand-off to shell agent>

Tests:                 <build pass/fail; client tests; server tests>
Manual checks done:    <which routes from §9 were clicked through>
Console clean:         <yes/no — no leftover console.log or errors>

Follow-ups / known issues: <anything left undone or newly discovered>
Git: <branch, commit sha(s), or "uncommitted — awaiting review">
```

---

## 8. Conflict Prevention Checklist

Before you start editing:

- [ ] I know exactly which feature folder I own (asked if unsure).
- [ ] I pulled the latest `refactor/folder-structure` branch (or current working branch).
- [ ] No other active agent is assigned my folder or a file I must touch.
- [ ] My task does not require editing a protected file (if it does → §6 first).

While editing:

- [ ] I only created/edited files inside my folder.
- [ ] Cross-feature needs are imported via barrels (`@features/<name>`), not deep paths.
- [ ] I did not change a shared function signature (added new/optional instead).
- [ ] I did not add dependencies or edit `package.json` / `vite.config.js` / config.

Before finishing:

- [ ] `git status` shows changes only in my expected paths.
- [ ] No unrelated files moved or reformatted.
- [ ] Final report (§7) written.

---

## 9. Manual Testing Checklist

Run after your change. Both servers up: `cd server && npm run dev` and `cd client && npm run dev`.

**Automated gates (run first):**
- [ ] `cd client && npm run build` — succeeds, no unresolved imports.
- [ ] `cd client && npm test` (Vitest) — passes.
- [ ] `cd server && npm test` (Jest) — passes.
- [ ] No new ESLint errors.

**Smoke test the routes your change can affect (at minimum your own):**
- [ ] `/` Dashboard — meals, macro totals, weight row + trend chart, training context banner, fuel card, adherence strip.
- [ ] `/` Dashboard — log a meal, quick-food log, delete entry.
- [ ] `/recipes` — list, search, archive, soft-delete, log.
- [ ] `/ingredients` — list, OCR scan + crop, manual create, pagination.
- [ ] `/meal-builder` — label + manual modes, ingredient slot swap, save permanent + limited template.
- [ ] `/history` — charts, calendar drill-down, edit/delete past entries.
- [ ] `/training` — presets, exercise combobox, logging, progress.
- [ ] `/plan/goals` — view + save weekly macro targets.
- [ ] `/plan/fuel` — digestion pref, training goal, recipe combobox, saved fuel shortcuts.
- [ ] `/plan/report` — PDF export downloads.
- [ ] `/plan/profile` — stats, unit toggles, dashboard toggles.

**Cross-cutting:**
- [ ] Navbar + BottomNav navigate on every route.
- [ ] Back-compat redirects work: `/goals`, `/fuel`, `/report`, `/profile` → `/plan/*`.
- [ ] Unit toggle (MacroUnitsContext) updates macros + weights app-wide.
- [ ] Layout sane at 390px wide (mobile-first).
- [ ] Browser console clean.

---

## 10. Git Checkpoint After Each Feature Migration

Work on the `refactor/folder-structure` branch. **One feature = one commit.**

- Before starting the whole refactor, tag the baseline once:
  `git tag pre-refactor-baseline`
- After each feature migration **that builds and passes tests**, commit immediately:
  ```
  git add <your feature paths>
  git commit -m "refactor: move <feature> into features/<feature>"
  ```
- Keep commits scoped to one feature so any single step is independently revertable
  (`git revert <sha>` or `git reset --hard <sha>`).
- Do **not** commit a broken build. If tests fail, fix or `git restore` before committing.
- Do **not** push to `main`. Push the refactor branch only when a coherent set of steps is green.
- If something breaks badly: `git reset --hard pre-refactor-baseline` returns the branch to the start;
  `git checkout main && git branch -D refactor/folder-structure` abandons the refactor entirely (`main` is untouched).

---

*This is a living document. Update it when the folder structure, protected list, or agent assignments change.*

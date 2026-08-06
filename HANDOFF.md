# FLOPS — Handoff / Current State

_Last updated: 2026-08-06_

> **▶ Next up: deploy + MCP connector.** Plan is written and decisions are made —
> see **`docs/future/deployment-and-mcp.md`**. Three steps: (1) auth + rate limiting,
> (2) Render/Vercel deploy with backups, (3) MCP server so meals can be logged from the
> Claude app on the phone. Start at step 1. That plan also carries a 2026-08-02 codebase
> audit (what's safe, what breaks once public) so it need not be re-derived.

Snapshot of where the app stands so any session (human or Claude) can pick up quickly.
For conventions, architecture, and the phase vision, see `CLAUDE.md` — this file is the
_current-state_ companion to it.

> **⚠️ Repo location changed (2026-07-25):** the project now lives at **`~/dev/FLOPS`**.
> It used to be under `~/Documents/FLOPS workspace/…`, which macOS was syncing to iCloud
> with "Optimize Mac Storage" on. iCloud evicted files to placeholders, so `node_modules`
> re-downloaded on demand and the API took ~60s to boot — the frontend timed out with
> **"Failed to fetch."** Moving out of iCloud fixed it (cold boot is now instant; Vite
> ~525ms). **Do not put this project back in `~/Documents` or any cloud-synced folder.**

---

## 1. What FLOPS is (one line)

A personal nutrition + training tracker, built toward eventually connecting the two
(the "bridge", Phase 3). Nutrition and Training are developed as **separate domains** —
do not import one domain's business logic into the other.

Phases: **1 Nutrition** (feature-complete), **2 Training** (frontend now built out — see below),
**3 Bridge** (future, not started).

---

## 2. How to run

Repo root: **`~/dev/FLOPS`**. One-shot: `bash ~/dev/FLOPS/start-app.sh`. Or two terminals:

```bash
cd ~/dev/FLOPS

# Terminal 1 — API (port 3001)
cd server && npm run dev        # plain `node --watch index.js`; does NOT auto-restart if launched as `node index.js`

# Terminal 2 — client (Vite, port 5173, proxies /api → 3001)
cd client && npm run dev
```

SQLite DB: `server/nutrition.db` (a stale copy at repo root — ignore it). Single user,
`user_id = 0` hardcoded, no auth (intentional while localhost-only — changes at deploy,
see `docs/future/deployment-and-mcp.md`). Schema + migrations are inline in
`server/db.js` (`PRAGMA table_info` + conditional `ALTER TABLE`).

> If a running API server predates a schema/route change, **restart it** — a plain
> `node index.js` will not pick up new code or run new migrations on its own.

---

## 3. Current state by area

### Nutrition (Phase 1) — solid / feature-complete
Dashboard, Recipe Library, Ingredient Library (OCR label scan + **barcode scan**), Meal Builder
(wizard + slots), History, Goals (versioned weekly min/max), Report (PDF), Profile, Adherence,
and the AI Macro Logger all work. Rough edges are **code-size/debt**, not missing features.

**Log a Meal — compacted, and scoped to logging (2026-08-06).** The "Customize this log"
ingredient list is now **one line per ingredient** — name | amount | unit — inside a single
divided list (`.slot-list` / `.slot-row` in `index.css`), with the field captions in one header
row instead of repeating per ingredient. Six ingredients went from ~1,000px of scrolling to
~330px, so you can check portions and reach the Log button without hunting. Time + Notes share a
row for the same reason. Each row shows **one** name: the slot's own label wins, the library
ingredient name + brand only fill in when the slot has no label (full name lives in the row's
`title`), and names ellipsize rather than wrap so rows stay a uniform height.

Two features came out in the process:

- Per-ingredient "Use recipe amount" buttons → **one "Use recipe amounts" reset** beside the
  "Customize this log" heading, shown only when something differs; it resets every slot at once.
  List-wide actions belong in the section header, not interleaved with the rows you're reading.
- **"Save amounts to the recipe" is gone.** Reshaping a recipe belongs to the recipe editor /
  Meal Builder — offering it mid-log was overengineering, and it needed two lines of explanation
  to justify itself. `buildRecipeAmountUpdate` (and its tests) went with it; the surviving
  `recipeAmountUpdate.js` just answers "do these amounts differ from the recipe's?", which gates
  the reset button. Amounts still carry over to your next log of that recipe via localStorage.

**Design rule this established:** the Log a Meal modal is for *logging*. Before adding to it, ask
whether the thing serves **this log**; if it shapes the recipe, it goes to the editor. See the
"Dense edit list" pattern in `docs/design-system.md`.

**AI Macro Logger — recipe saving fixed (2026-07-26).** "Save as recipe" (and meal-prep
save) now back each ingredient with an Ingredient Library entry and record the link in
`meal_builder_meta.lines`, so the saved recipe's amounts are **editable at log time** (the
same slot mechanism Meal Builder uses) instead of a frozen macro total. Rows logged "as
estimated" stay as plain text lines. Relatedly, when you provide explicit macros that
identically match a saved ingredient (name + macros), the resolver now reuses that saved
item instead of spawning a duplicate on save. Files: `features/ai-macro-logger/AiMacroLogger.jsx`,
`ingredientSource.js`.

### Training (Phase 2) — backend complete; frontend built out this session
Backend was 100% done with client API wrappers already written. As of this session the
frontend covers: workout logging (mobile grid fixed), **weekly Schedule tab**, **post-workout
Feedback card**, **inline progressive-overload sparkline**, and **one-off day Overrides**.
All under `client/src/features/training-workouts/` (new pieces in `components/`).

### Supplements (Nutrition) — shipped, extended 2026-07-26
Dashboard "Supplements today" checklist; each supplement can optionally **count its
calories/macros toward the day's totals** (per-item flag). Server: `supplements` +
`supplement_log` tables, `routes/supplements.js`. Client: `features/supplements/`.
Profile has a show/hide toggle.

**Micronutrients (2026-07-26).** Supplements can carry **label-exact micronutrients** (the
canonical key set — 28 keys since the 2026-07-30 v2 expansion) in a new `supplements.micros_json` column, stored at HIGH confidence (unlike
AI-estimated food micros). Auto-count rule: values present + supplement checked → they count.
They fold into the **daily micronutrient totals in History** (micros stay a History-only
feature) via `GET /api/supplements/range` (taken supplements' micros grouped by date) and the
shared helper `sumDayTotalMicros({entries, supplements})` in `shared/utils/microNutrients.js`.
`supplement_log` makes past days accurate retroactively. The micro panel shows a "+ N
supplements" badge; the Dashboard has a "View micronutrients →" link to `/history#micronutrients`.

**Find by name (2026-07-26).** The primary way to add a supplement: type the product name in
Manage Supplements → results from the **NIH Dietary Supplement Label Database** (`dsldService.js`,
free, no API key) → pick one → name/dose/macros/micros prefill for review. Because DSLD holds
transcribed label data, a match stores at **high** confidence, same as a photo scan. IU values are
converted (vitamin A assumes retinol, which is why every conversion is flagged) and the note lists
nutrients on the label the schema drops (few, since the v2 expansion). When DSLD has nothing,
`POST /api/supplements/estimate` (`supplementEstimateService.js`) estimates from the name — capped
at **medium** confidence in the service *and* the route, so a guess can never masquerade as label
data. All three sources return the same shape, so they share one prefill path in the modal.

**Micronutrients v2 (2026-07-30).** The key set went 12 → 28 (B-complex, E/K, selenium, copper,
manganese, phosphorus, iodine, choline, and omega-3 ALA/EPA/DHA). One config drives it —
`client/src/shared/config/microNutrients.js` + the server mirror — and AI prompt schemas are
generated from `MICRO_KEYS`, but **DSLD `GROUP_TO_KEY` and OFF `MICRO_SOURCES` must be taught new
nutrient names by hand**. DSLD parsing now walks `nestedRows`, without which fish-oil labels
(EPA/DHA nested under Total Fat) imported nothing. Centrum Men Under 50 went from 10 to 23
captured nutrients. Existing supplements gain the new nutrients only on a label refresh; old log
entries keep their v1 blobs.

**Per-meal micros (2026-07-30).** Meal rows have a **Macros | Micros** toggle instead of a
chevron, with a directional page-flip between panels (`--dur-swipe`). The Micros panel
(`features/meal-logging/MealMicrosPanel.jsx`) bars each nutrient as a share of the DAY's target
— "this breakfast is 50% of your vitamin A" — using a neutral accent rather than the day panel's
status palette, and hides contributions under 10% behind a "show smaller" toggle. The Review
panel is sectioned: an attention chip strip, then collapsible categories with "n of m on track".

**Dose vs label serving (2026-07-27).** Stored macros/micros describe ONE label serving, so a
supplement now also records `label_serving_qty`/`label_serving_unit` and `dose_qty` (what you
take), and everything scales by the ratio — day totals, History micros, the row display. Before
this, taking 3 softgels of a 2-softgel serving silently counted 2. The modal states both amounts
plainly; the dashboard checklist has −/+ steppers writing `supplement_log.dose_qty` for that day
only (NULL = usual dose), so an unusual day never rewrites your default or past days. Existing
rows were backfilled with dose = label serving, so every multiplier started at 1 and no total
moved (asserted in `supplementDose.test.js`).

**Manage dialog (2026-07-27).** Converted from the app's last hand-rolled bottom sheet to the
native `<dialog>` used by Log a Meal, then reorganised: serif section headings, the name lookup
and photo scan framed as alternatives in one block (available while editing, to refresh an entry
from a label), an explicit "Editing X" bar, and the house text scale.

**Label scanning (2026-07-26).** "📷 Scan Supplement Facts label" in Manage Supplements: photo →
crop (reuses `LabelCropModal`) → `POST /api/supplements/scan-label` → AI **vision** transcribes
the panel (per-serving, absolute amounts not %DV, IU→mcg) → prefills the form for review (never
auto-saves). The image posts as a raw binary body (`express.raw`, like `/api/ai/transcribe`) to
skip the 1 MB global JSON limit. Service: `server/supplementLabelService.js`. **Needs an AI
provider key** (same one the AI Macro Logger uses).

### Cross-cutting foundation — healthy
Mobile nav works (`Navbar` → `BottomNav` switch at 768px, 44px+ targets). Shared UI in
`shared/ui`, hooks in `shared/hooks`, utils in `shared/utils` (well unit-tested). Server routes
are all Jest-tested. **`server/aiClient.js` now supports vision** — `callProviderJson({imageDataUrl})`
attaches a base64 image for OpenAI (`image_url`) or Anthropic (base64 `image` block); reusable
by any future feature (e.g. barcode/label flows).

---

## 4. Git state

> **⚠️ Uncommitted work in the tree (as of 2026-08-06).** Nothing has been committed since
> `edb06ca`, but `git status` shows ~25 modified files and ~12 untracked ones spanning the AI
> logger (`ConversationThread.jsx`, `FollowUpComposer.jsx`, `RecipeFixUpList.jsx`,
> `recipePersist.js`, `recipeCommand.js`), meal logging (`ViewToggle.jsx`, `LogMealModal.jsx`,
> micros panel), the library sub-nav, and the server (`mealMicros.js`, `routes/log.js`,
> `routes/recipes.js`, `db.js`). **Review and commit in coherent chunks before starting anything
> new** — several sessions' work is stacked here. The Log-a-Meal compaction above is the one piece
> already committed, on branch **`feature/log-modal-compact`** (its `index.css` hunk was staged
> on its own, so the rest of that file's edits are still uncommitted alongside everything else).

`main` was **pushed and in sync with `origin/main`** as of 2026-07-30 (before the work above).
Server **223** tests, client **154** at that point; the meal-logging suite and the client build
are green as of 2026-08-06 (client meal-logging: 26 tests after the amount-update tests came out).

Merged 2026-07-30: the **Today tab slimmed down** (adherence moved off it, weight raised under
the supplement strip, supplements became a compact strip rather than a section), the **weight
trend chart moved to History** (where its range follows the days selected there), and
**micronutrients v2** — see below. Merged that day as `--no-ff` merge commits with their
branches deleted:

- **Barcode scanning** — section 7
- **Supplement lookup by name** — NIH DSLD, above. A follow-up made the results tellable apart:
  rows carry dose form / bottle size / nutrient count, repeat label versions of one product
  collapse under the newest (with an "earlier labels" expander), and picking a product previews
  its micros before anything fills the form.
- **Supplement dose vs label serving**, plus the manage dialog rework — both above
- plus a fix making logged unit-ingredients display their own unit ("3 eggs", not "3 g"), with a
  boot-time repair of older entries

Earlier the same day, three more features merged the same way:

- **AI-logger editable recipes** — editable AI-saved recipe amounts + provided-macro dedup
- **Supplement micronutrients** — supplements contribute exact micros to History
- **Supplement label scan** — AI vision reads a Supplement Facts photo into the form

Prior session (already in `main`): training Phase 2 UI, supplement tracker, ai-logger source
consolidation. That tree passed server 112 / client 105.

**Deploy:** paused. Only `server/.env.example` exists; no Render/Vercel/Docker config
(the Render+Vercel plan was paused on ~$7/mo persistent-disk cost).

---

## 5. Known issues & tech debt

- **Oversized components** (refactor when next touched): `AiMacroLogger.jsx` (~1,360),
  `TrainingWorkouts.jsx` (~900), `Ingredients.jsx` (~777, grew with the barcode entry point),
  `MealBuilder.jsx` (~720), `LogMealModal.jsx` (~645). `ManageSupplementsModal.jsx` (~393) is
  borderline after the micro + label-scan additions. `client/src/hooks/` is empty; extract
  custom hooks here.
- **Pre-existing lint errors** in `Profile.jsx` (`H3`/`UnitOption` components declared inside
  render — `react-hooks/static-components`). Not from recent work; fix by hoisting them out.
- **Barely any client component tests** — `BarcodeScannerModal.test.jsx` is the first one
  (Testing Library was already installed, unused). Pages (Dashboard, Recipes, History) still
  have none. Utils/server are well covered.
- **Test/placeholder recipes** ("c", "c2", "c6") still in the DB — clean before polishing the
  Recipe Library UI.
- Two React pitfalls worth remembering: `{0 && <x>}` renders a stray `0` (use `n > 0 &&`);
  ESLint here enforces `react-hooks/set-state-in-effect` (don't call setState synchronously in
  an effect body).
- **No backups and no data export.** 609 log entries + 284 recipes live in one SQLite file.
  On the Mac, Time Machine/iCloud is the only safety net; there is nothing in the app itself.
  This becomes urgent at deploy — see `docs/future/deployment-and-mcp.md` step 2.
- **No rate limiting anywhere**, and `/api/ai/*` calls OpenAI/Anthropic on the server's own
  key (`/transcribe` takes 25 MB uploads). Harmless on localhost; a billing risk the moment
  the API is public.
- **No `engines` pin** in either `package.json`, though `server/index.js` needs Node ≥ 20.12
  for `process.loadEnvFile`. Fine locally; a coin-flip on a host that picks its own default.
- Low-severity `body-parser` advisory — `npm audit fix` clears it.
- **Meal Builder pushes a history entry per mode/step change.** `setSearchParams` is
  called without `{ replace: true }` in `MealBuilder.jsx` (the `goToStep` callback and
  the two mode buttons), so toggling "Build from ingredients" / "Known macros" a few
  times stuffs browser history with builder states and hardware/gesture back gets
  tedious. It also rules out `navigate(-1)` for "Exit edit" — that's why the exit target
  is carried in router state instead (2026-08-02). Switching those three calls to
  `replace` is the fix; it changes back-button behaviour, so it wants its own commit and
  a check that nothing depends on stepping back through steps.
- **Conditional inline styles can mix a shorthand with a longhand — sweep for it.**
  React removes style properties that disappear between renders, and removing a
  *longhand* does not restore what a *shorthand* originally set; it falls through to
  `currentColor` / the initial value. Hit in `LogEntryRow`'s Macros/Micros toggle:
  `base` set `border`, the active state set only `borderColor`, so collapsing left the
  button outlined in text colour instead of grey (fixed 2026-08-02). Rule: **if two
  style objects are merged conditionally, both must set the same property.** Same trap
  applies to `background`/`backgroundColor`, `padding`/`padding*`, `font`/`fontSize`.
  Not yet swept — this codebase styles almost everything with conditional inline
  objects, so expect more instances. Grep for `borderColor`/`backgroundColor` inside
  objects that are spread conditionally.

---

## 6. Parked / deliberately deferred

- **Goals & Profile needs a restructure (raised 2026-08-02).** The section is three
  sub-tabs (Goals / Report / Profile) that don't obviously belong together, and Profile
  is now thinner after the weight trend chart and "Log body weight" card were removed
  (both duplicated Review and Today). What's left is three settings tiles + a personal
  stats form. Worth rethinking as a whole — what belongs in "Plan", whether Report is a
  sub-tab or lives elsewhere, and whether unit toggles and dashboard prefs want to be
  Settings rather than Profile. Not urgent; no behaviour is broken.

- **AI Logger — per-unit "1 g" bug**: count foods (egg/slice) occasionally undercount to ~1
  cal when the AI emits `1 g` and the per-unit library match is skipped. Intermittent; needs a
  live repro to decide AI-prompt vs matcher fix.
- **AI Logger — recipe "one-shot" invert**: make the AI estimate the primary result and the
  matched saved recipe a one-tap suggestion (instead of the recipe hijacking the flow).
  Discussed, not built.
- **Training — Daily Training Context UI**: backend exists; fold into a future "Training Today"
  view (low value before the bridge).
- **Nutrition refactors** (the oversized files above) — do opportunistically.

---

## 7. Barcode scanning — shipped (2026-07-26)

Scan a product barcode in the **Ingredient Library** add form → the form prefills for review.
Built as agreed: **no MCP, no self-hosted product database**.

- **Server.** `GET /api/barcode/:code` (`routes/barcode.js` + `openFoodFactsService.js`)
  proxies Open Food Facts (free, no key, Node's global `fetch`) and normalizes the very uneven
  response. `basis` reports where the numbers came from — `serving` (listed per serving),
  `serving_derived` (scaled from per-100 g), `100g` (no serving on record), `none` (no
  nutrition data). Handles kJ→kcal and retries a 12-digit UPC as a 13-digit EAN.
- **Client.** `features/barcode/` — `BarcodeScannerModal` (camera + always-available manual
  number entry), `barcodeReader` (native `BarcodeDetector`, else lazily imported
  `@zxing/browser` — iPhone Safari has no native API; the library sits in its own 444 KB chunk,
  not the initial bundle), `gtin` (check-digit validation so a misread frame is ignored instead
  of coming back as "not found"), and `mergeBarcodeProductIntoIngredientForm` (fills the form,
  highlights what to check — never overwrites a typed name/brand, never auto-saves).
- **Schema.** `label_ingredients.barcode` (+ index) and `source_type = 'barcode'`. Re-scanning a
  saved product **opens that entry** instead of creating a near-duplicate. An edit that omits
  the field keeps the stored code (`COALESCE`).

Coverage is uneven — niche and store-brand products are often missing, so OCR and manual entry
stay as fallbacks and the not-found message points at them. Open Food Facts is crowd-sourced,
so the review box always says to check the numbers against the packaging.

**Micronutrients from the label (2026-07-27).** Barcode import also captures OFF's
micronutrients into `label_ingredients.micros_json` (per serving, high confidence). At log time
`server/labelMicros.js` prefers those measured values over AI estimates, asking the AI only about
ingredients with nothing stored and merging **per nutrient**. A meal built entirely from barcoded
ingredients makes **no AI call at all**. Coverage varies by product and, since the v2 key
expansion (28 keys incl. omega-3s, B-complex, E/K, trace minerals), fortified foods and
supplements capture far more of their panel — Centrum went from 10 to 23 captured nutrients.

> **Typing a barcode already works** (the scanner modal has a number box), which is what makes
> this usable on desktop. But it only helps for *food*: supplement micros cannot be reached by
> barcode — the NIH database isn't UPC-searchable (digit queries return 0 hits, there is no `upc`
> parameter, and querying the stored formatted string returns unrelated products), and Open Food
> Facts' supplement records carry no vitamins or minerals. Use the name lookup for supplements.

**Known limits / next steps:** camera needs a secure context, so scanning from a phone over the
LAN dev IP won't work (localhost and real HTTPS do). Supplements do not have barcode scanning
yet — deliberately deferred, and OFF coverage is weakest there. Values are **as-sold**, which
runs into the existing dry/cooked basis gap: a dry-basis product scanned and later logged by
cooked weight still overcounts.

---

## 8. How work happens here (quick reminders)

- Beginner-friendly: explain non-obvious decisions; prefer the smallest change that works.
- Mobile-first always (test mentally at 390px).
- One topic per commit; don't bundle unrelated changes.
- Feature Brief before building a new feature; verify changes by running the app, not just tests.

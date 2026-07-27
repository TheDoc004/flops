# FLOPS — Handoff / Current State

_Last updated: 2026-07-26_

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
`user_id = 0` hardcoded, no auth (intentional). Schema + migrations are inline in
`server/db.js` (`PRAGMA table_info` + conditional `ALTER TABLE`).

> If a running API server predates a schema/route change, **restart it** — a plain
> `node index.js` will not pick up new code or run new migrations on its own.

---

## 3. Current state by area

### Nutrition (Phase 1) — solid / feature-complete
Dashboard, Recipe Library, Ingredient Library (OCR label scan + **barcode scan**), Meal Builder
(wizard + slots), History, Goals (versioned weekly min/max), Report (PDF), Profile, Adherence,
and the AI Macro Logger all work. Rough edges are **code-size/debt**, not missing features.

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

**Micronutrients (2026-07-26).** Supplements can carry **label-exact micronutrients** (the 12
canonical keys) in a new `supplements.micros_json` column, stored at HIGH confidence (unlike
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
nutrients on the label that the 12-key schema drops. When DSLD has nothing,
`POST /api/supplements/estimate` (`supplementEstimateService.js`) estimates from the name — capped
at **medium** confidence in the service *and* the route, so a guess can never masquerade as label
data. All three sources return the same shape, so they share one prefill path in the modal.

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

`main` is **pushed and in sync with `origin/main`** (2026-07-26). Server **170** tests, client
**132**, all passing; client builds clean. Merged that day as `--no-ff` merge commits with their
branches deleted:

- **Barcode scanning** — section 7
- **Supplement lookup by name** — NIH DSLD, above. A follow-up made the results tellable apart:
  rows carry dose form / bottle size / nutrient count, repeat label versions of one product
  collapse under the newest (with an "earlier labels" expander), and picking a product previews
  its micros before anything fills the form.
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
  `MealBuilder.jsx` (~720), `LogMealModal.jsx` (~567). `ManageSupplementsModal.jsx` (~393) is
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

---

## 6. Parked / deliberately deferred

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
ingredients makes **no AI call at all**. Coverage varies: Honey Nut Cheerios gives 9 of 12
nutrients, Oreo 7, Pringles 4, Nutella 1 — fortified foods do best.

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

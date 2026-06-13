# Nutrition Tracker — Design Spec
**Date:** 2026-04-09

## Overview

A personal, single-user web app for logging meals/recipes with caloric and macro data, and tracking nutrition over time. No authentication. Data persists locally via SQLite.

---

## Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Frontend   | React (Vite), React Router        |
| Backend    | Node.js + Express                 |
| Database   | SQLite via `better-sqlite3`       |
| Charts     | `recharts`                        |

### Project Structure

```
nutrition-tracker/
  client/       # React SPA
  server/       # Express API + SQLite DB file
```

---

## Data Model

### `recipes` table

| Column        | Type    | Notes                          |
|---------------|---------|--------------------------------|
| id            | INTEGER | Primary key, autoincrement     |
| name          | TEXT    | e.g. "Chicken Rice Bowl"       |
| serving_size  | TEXT    | e.g. "1 cup", "200g"           |
| calories      | REAL    | Per serving                    |
| protein_g     | REAL    | Per serving                    |
| carbs_g       | REAL    | Per serving                    |
| fat_g         | REAL    | Per serving                    |
| fiber_g       | REAL    | Per serving, nullable          |

### `log_entries` table

| Column     | Type    | Notes                                     |
|------------|---------|-------------------------------------------|
| id         | INTEGER | Primary key, autoincrement                |
| recipe_id  | INTEGER | Foreign key → recipes.id                  |
| date       | TEXT    | ISO format: YYYY-MM-DD                    |
| servings   | REAL    | Multiplier applied to recipe macros       |
| notes      | TEXT    | Optional free text                        |

**Computed macros:** All macro totals are calculated at query time as `recipe_value × servings`. Recipes are reusable — editing a recipe updates its data everywhere it appears in logs.

---

## API Endpoints

### Recipes
- `GET    /api/recipes`            — list all recipes
- `POST   /api/recipes`            — create a recipe
- `PUT    /api/recipes/:id`        — update a recipe
- `DELETE /api/recipes/:id`        — delete a recipe

### Log Entries
- `GET    /api/log?date=YYYY-MM-DD`    — get all entries for a date (with joined recipe data)
- `GET    /api/log?start=...&end=...`  — get entries over a date range (for history/charts)
- `POST   /api/log`                    — create a log entry
- `DELETE /api/log/:id`                — delete a log entry

---

## Pages & Features

### 1. Dashboard (`/`)
- Displays today's log entries (meal name, servings, calories, macros per entry)
- Daily totals: sum of calories, protein, carbs, fat for the day
- Optional daily targets stored in localStorage: `{ calories, protein_g, carbs_g, fat_g }` — each nullable; if null, no target indicator is shown for that macro
- "Log a meal" button → opens a modal to pick a recipe and enter servings

### 2. Recipe Library (`/recipes`)
- Searchable list of all saved recipes showing macros per serving
- Add recipe form (inline or modal): name, serving size, calories, protein, carbs, fat, fiber
- Edit and delete existing recipes
- Recipes used in log entries are not deleted outright — show a warning if a recipe has log history

### 3. History & Trends (`/history`)
- Date picker to view the log for any past day
- Line chart: daily calorie totals over the past 30 days (default)
- Stacked bar chart: daily macro breakdown (protein/carbs/fat) over the same range
- Range selector: 7 days / 30 days / 90 days

---

## Navigation

Simple fixed top navbar with links: Dashboard | Recipes | History

---

## Error Handling

- API returns standard HTTP status codes (400 for bad input, 404 for not found, 500 for server errors)
- Frontend shows inline error messages on form validation failures
- Empty states shown when no recipes or log entries exist yet

---

## Out of Scope

- User authentication / multi-user support
- Food database / barcode scanning (recipes entered manually)
- Mobile app / PWA
- Data export/import
- Cloud sync

# FLOPS

A personal nutrition and training notebook.

FLOPS holds what you eat, what you lift, and what your body does over time. You write the entries; AI helps when you ask it to. It does not nag, auto-advance your day, or invent work you did not ask for. See [docs/philosophy-notebook.md](docs/philosophy-notebook.md) for the design philosophy.

## What it does

**Nutrition**

- Log meals from saved recipes or describe them in plain language (AI Estimate).
- Ingredient library with nutrition-label photo scanning (OCR) and barcode lookup via Open Food Facts.
- Recipes with a meal builder, variable ingredient slots, and limited-use templates.
- Meal prep mode with container tracking.
- Supplements tracking with dose scaling and NIH label database lookup.
- Micronutrient tracking across meals and supplements.
- Body weight log with trends.
- Diet phases (cut, bulk, maintenance) as calendar annotations.
- Weekly macro goals with min/max ranges.
- Adherence charts, history review, and PDF export.

**Training**

- Gym dashboard with set-by-set workout logging.
- Workout templates and a weekly schedule.
- Exercise library with muscle groups and equipment tags.
- Progress charts and estimated 1RM tracking.

**Other**

- Multi-user auth with invite codes.
- Coach view: read-only access to a client's log.
- Mobile-first, works at 390px.

## Setup

You need Node.js and npm.

```bash
# Install dependencies
cd server && npm install
cd ../client && npm install
```

## Running locally

```bash
# Terminal 1 — API server (port 3001)
cd server && npm run dev

# Terminal 2 — Vite dev server (port 5173)
cd client && npm run dev
```

The client proxies `/api` requests to `localhost:3001` in development.

## Tech stack

- **Frontend:** React, React Router, Vite
- **Backend:** Node.js, Express
- **Database:** SQLite via better-sqlite3 (synchronous)
- **Testing:** Jest + Supertest (server), Vitest + Testing Library (client), Playwright (e2e)
- **Styling:** Plain CSS, no framework

## Tests

```bash
cd server && npm test
cd client && npm test
cd client && npx playwright test
```

## License

[MIT](LICENSE)

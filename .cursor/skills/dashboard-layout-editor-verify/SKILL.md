---
name: dashboard-layout-editor-verify
description: Verify the Today dashboard layout editor (/?editLayout=1) — compact cards, drag, resize, and profile layout sync. Use after changing Dashboard.jsx, DashboardCanvas.jsx, dashboardLayout.js, or edit-mode CSS.
---

# Dashboard layout editor verification

Run this skill after any change to the Today layout editor or when the user reports oversized / immovable cards in edit mode.

## Prerequisites

- Fix branch merged to `main` (or test locally on the fix branch)
- `AUTH_DEV=1` on the API (default in local dev)
- Desktop width **≥768px** for drag-handle chrome

## Step 1 — Automated tests

```bash
cd client && npm test -- src/features/dashboard/dashboardLayout.test.js
cd client && npm run test:e2e
```

E2E covers: compact macros card height, visible resize handles, drag via handle, resize via SE corner.

If E2E fails on `dev_code missing`, ensure the server runs with `AUTH_DEV=1`.

## Step 2 — Manual / browser checks

1. Open **Profile → Customize dashboard** (or `/?editLayout=1`)
2. Confirm **Customizing Today** banner
3. Macros card should **not** fill the viewport
4. Drag **Weight** card by the six-dot handle — position should change
5. Resize **Macros** from bottom-right corner — height should grow
6. Toggle a card off/on via toolbar chips — animate without breaking grid

## Step 3 — If still broken on production

Collect for the user or from Chrome DevTools MCP:

| Signal | Where |
|--------|--------|
| `dash_layout_json` | Network → `GET /api/profile` |
| Console errors | DevTools Console |
| Grid item height | Elements → `.react-grid-item[data-card-id="macros"]` computed height |
| Resize handles in DOM | `.react-resizable-handle-se` count > 0 |

Inflated saved layout example: `{ id: "macros", h: 20 }` → ~720px tall before `layoutForEditSession` runs.

## Step 4 — Chrome DevTools MCP (optional)

If `chrome-devtools` MCP is connected (see `docs/chrome-devtools-mcp-setup.md`):

```
Navigate to http://localhost:5173/?editLayout=1 (after login).
Report console errors and the computed height of .react-grid-item[data-card-id="macros"].
```

## Pass criteria

- E2E suite green
- Macros grid item height **< 280px** on entry
- Drag changes `y`; resize increases `height`
- No console errors from RGL during drag/resize

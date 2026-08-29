# Chrome DevTools MCP for FLOPS

Lets Cursor agents drive a **real Chrome** instance: console errors, network failures, computed styles, screenshots, and performance — not just static screenshots.

Official package: [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)

---

## 1. Prerequisites

- **Google Chrome** installed on the machine running Cursor (your Mac, not the cloud VM)
- **Node.js 18+** (20+ recommended)
- **Cursor 0.43+** with MCP support

No API key required.

---

## 2. Install in Cursor (one-time)

### Option A — One-click (easiest)

Open this link in Cursor (from the [official repo README](https://github.com/ChromeDevTools/chrome-devtools-mcp)):

**[Add chrome-devtools MCP to Cursor](https://cursor.com/en/install-mcp?name=chrome-devtools&config=eyJjb21tYW5kIjoibnB4IC15IGNocm9tZS1kZXZ0b29scy1tY3BAbGF0ZXN0In0%3D)**

Restart Cursor completely after install.

### Option B — Manual (`~/.cursor/mcp.json`)

Cursor Settings → **MCP** → edit config, or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

Merge with existing servers (e.g. `figma`, `browser-mcp`) — do not replace the whole file.

### Option C — Repo template (merge into your user config)

This repo includes `.cursor/mcp.json` as a **reference**. Cursor may load project-level MCP on some setups; if tools do not appear, copy the `chrome-devtools` block into your **user** `~/.cursor/mcp.json` (same pattern as `docs/figma-setup.md`).

---

## 3. Verify connection

1. Restart Cursor
2. Settings → **MCP** → `chrome-devtools` should show **connected** (green)
3. In Agent chat, try:

   > Open http://localhost:5173 and list any console errors.

For FLOPS layout editor specifically:

   > After I log in, open `/?editLayout=1` and report the computed height of `.react-grid-item[data-card-id="macros"]` and whether `.react-resizable-handle` elements exist.

---

## 4. Attach to your existing Chrome (optional)

If you already use Chrome with remote debugging (extensions, logged-in session):

1. Quit Chrome completely
2. Start Chrome with debugging port:

   ```bash
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   ```

3. MCP config:

   ```json
   "chrome-devtools": {
     "command": "npx",
     "args": [
       "-y",
       "chrome-devtools-mcp@latest",
       "--browser-url=http://127.0.0.1:9222"
     ]
   }
   ```

Useful when you want the agent to see **your** logged-in www.useflops.com session.

---

## 5. Troubleshooting

| Symptom | Fix |
|---------|-----|
| MCP shows disconnected / spawn ENOENT | Use full path to npx: `/usr/local/bin/npx` or `which npx` |
| Tools missing after edit | Full Cursor restart (not just reload window) |
| Chrome does not launch | Install Chrome; on macOS grant Cursor **Full Disk Access** if prompted |
| Works in terminal, not Cursor | Check MCP logs: Settings → MCP → chrome-devtools → Show Logs |

---

## 6. What agents should use it for (FLOPS)

- Dashboard edit mode: grid item heights, resize handle presence, `pointer-events`
- Login / auth flows on production
- Network tab: failed `/api/profile` or 401s during edit mode
- Regression after deploy to www.useflops.com

Pair with **Playwright E2E** (`cd client && npm run test:e2e`) for CI-style checks; use DevTools MCP for interactive debugging on your machine.

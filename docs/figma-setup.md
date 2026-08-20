# Figma setup for FLOPS

Optional for now. **Skills + `docs/design-system.md` are still the primary design source.** Use Figma when you want visual frames the Agent can implement from a link.

Official remote MCP (recommended by Figma): `https://mcp.figma.com/mcp`  
Docs: [Figma MCP remote server](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) · [Cursor setup](https://help.figma.com/hc/en-us/articles/39889260656407-Cursor-and-Figma-Set-up-the-MCP-server)

---

## 1. Create a free Figma account

1. Go to [figma.com](https://www.figma.com/) and sign up (email or Google).
2. Skip team invites if you are just starting.

**MCP note:** Figma MCP works after OAuth on free/Starter, but tool calls are heavily rate-limited (a few per month). A Dev/Full seat on Professional+ has normal API rate limits. For early FLOPS work, the free account is fine for drawing; don’t rely on MCP for heavy daily use until you need it.

---

## 2. Install Figma desktop or use the browser

- **Browser:** [figma.com](https://www.figma.com/) works for creating files and copying frame links.
- **Desktop (optional):** [Figma downloads](https://www.figma.com/downloads/) — nicer for long design sessions.

You do **not** need the desktop MCP (`127.0.0.1:3845`) for normal Cursor use. Prefer the remote server.

---

## 3. Create a FLOPS file / project

1. In Figma: **New design file**.
2. Name it something clear, e.g. `FLOPS`.
3. Optional: create a team/project folder later if you share with others.
4. Add frames for screens (Today, Library, Coach, etc.). Use Auto layout and semantic layer names (`MealCard`, not `Group 12`).

Keep tokens and UI rules in `docs/design-system.md` as the source of truth until Figma variables catch up.

---

## 4. Connect Figma MCP in Cursor (OAuth)

Config is already merged into your **user** Cursor MCP file (`~/.cursor/mcp.json`):

- Kept existing `browser-mcp`
- Added official remote server:

```json
"figma": {
  "url": "https://mcp.figma.com/mcp"
}
```

**You must authenticate once:**

1. Open **Cursor Settings → Tools & MCP** (or **MCP**).
2. Find **figma** in Installed MCP Servers.
3. Click **Connect** (or **Authenticate**).
4. Browser opens → sign in to Figma → **Allow access**.
5. Back in Cursor, figma should show as connected (green / tools listed).

Optional nicer path later: in Agent chat run `/add-plugin figma` to also install Figma’s Agent skills. Manual URL config above is enough to connect.

If tools disappear later, re-click **Connect** — OAuth sessions expire.

---

## 5. How to use with the Agent

1. In Figma, select a frame → **Copy link** (right-click or share).
2. In Cursor Agent, paste the link and ask clearly, for example:
   - “Implement this frame in the FLOPS client, matching `docs/design-system.md`.”
   - “Get design context for this frame and update `Dashboard.jsx` only.”
   - “Extract variables from this selection and map them to our CSS tokens.”
3. Prefer small frames (one component or one screen), not a whole multi-page file.

The Agent uses Figma MCP tools (e.g. design context / screenshot) under the hood. You do not open the Figma URL in a browser for the Agent — the link’s `node-id` is what matters.

---

## 6. Priority reminder

| Source | Role |
|--------|------|
| `docs/design-system.md` + skills | Primary — use every day |
| Figma + MCP | Optional — frames/links when you want visual handoff |

Do not block FLOPS UI work on Figma being fully set up.

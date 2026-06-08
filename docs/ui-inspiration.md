# UI Inspiration

Reference apps and what we're borrowing from each. Not copying — extracting the *why*.

---

## Linear

**What makes it feel premium:**
Linear uses extreme whitespace discipline. Every list item has breathing room. The typography scale is tight — they use maybe three font sizes across the whole app. Actions appear only when needed (hover states, contextual menus) so the interface at rest feels completely calm.

**What we take from it:**
- Calm default state. Controls appear on hover or focus, not all at once.
- Dense-but-not-crowded data rows. Enough padding to feel comfortable, not so much that lists feel empty.
- Consistent left-alignment. Everything lines up on a single vertical rail.
- Subtle separators — a 1px border at 10% opacity, not a heavy line.

---

## Raycast

**What makes it feel premium:**
Speed and keyboard-first thinking. Every action is one step, never two. The visual hierarchy is so clear you never wonder where to look. Icons are functional, not decorative. The search/command palette pattern teaches users that the app can do more than it shows at first glance.

**What we take from it:**
- Every action should be reachable in one or two taps/clicks — no buried menus.
- Iconography is purposeful. Don't add an icon just to have one.
- Instant feedback. Loading states are brief and intentional, not spinners that linger.
- The most common action should be the most obvious thing on the screen.

---

## Whoop

**What makes it feel premium:**
Data is the hero. Numbers are large, labels are small. Color is used with restraint — mostly to communicate status (good/neutral/bad), not decoration. The dashboard feels like a live system readout, not a report.

**What we take from it:**
- Macro and calorie numbers should be large and easy to scan. The label is secondary.
- Use color to communicate state: on-target (green/blue), approaching limit (amber), over (red). Not for style.
- Charts should be readable at a glance — no legends if the axis and tooltip are enough.
- Progress rings and bars communicate more intuitively than raw numbers alone.

---

## Cron (now Notion Calendar)

**What makes it feel premium:**
Time is treated as a first-class visual element. The calendar grid is clean enough that the events themselves carry the visual weight. Density is managed carefully — the same amount of information is always present, just compressed or expanded based on context.

**What we take from it:**
- Calendar and date-based views (adherence calendar, history) should be visually quiet. Color does the communication.
- Consistent column widths. Don't let content size control layout.
- Today should always feel anchored — a clear visual distinction from past and future.

---

## Apple Health

**What makes it feel premium:**
Hierarchy and categorization are crystal clear. Every metric lives somewhere logical and stays there. The summary/detail pattern — a card on the dashboard, a full page when you tap — is deeply consistent. Nothing feels like a dead end.

**What we take from it:**
- Dashboard cards are summaries. Tapping opens the full view. Never dump everything on the dashboard.
- Group related metrics visually. Macros belong together. Training context belongs with training.
- Color coding is semantic and consistent across the whole app — a color means one thing, everywhere.
- Empty states are not errors. No data yet = a clear, calm prompt to add some.

---

## Common Thread

Every one of these apps does the same core thing: **they make the user feel in control**.

That comes from:
1. Predictable layout — the user always knows where things are
2. Honest feedback — the app tells you exactly what's happening
3. Earned complexity — advanced features exist but don't get in the way
4. Restraint — every element on screen earned its place

Flops should feel like that. Not a form with charts bolted on — a system that makes your data feel meaningful.

---

## Lessons From Implementation (applied patterns)

These are principles discovered through actual UI iteration — not theory, but things that were tested and confirmed to work.

**Section labels create progression.** Small uppercase labels (`TODAY'S MEALS`, `TRENDS`) between dashboard sections are the primary mechanism for visual rhythm. Without them, a stacked dashboard feels like one long undifferentiated scroll. With them, users mentally "complete" a section before moving to the next. Apple Health uses this exact pattern throughout its dashboard.

**Bounded navigation aligns the layout.** When the navbar content isn't constrained to the same max-width as the page content, the nav feels like it belongs to a different layout than the content below. Constraining the nav inner container to match the content column (900px) creates a unified vertical rail — the brand, links, and content all share the same horizontal boundaries.

**Grouped lists beat individual cards.** A list of related items (meals, log entries, exercises) should live inside one shared card with row dividers — not as separate floating cards per item. Individual cards per row creates visual noise and makes each item feel detached. One card, many rows, clear dividers: this is the pattern that gives a list visual weight as a unit.

**Stats need to fill their column.** In a 900px content container, a primary stat number needs to be at least `36px` to feel like a data hero rather than formatted text. Smaller than that and numbers read as labels, not information.

---

## Future Feature Ideas

Ideas captured for future implementation. Do not build until explicitly scheduled.

**Ingredient-level macro breakdown in meal expansion (Dashboard)**
Currently, expanding a logged meal shows a pie/donut chart of protein/carbs/fat calorie share. A more useful view would break down each macro by ingredient contribution — e.g. "eggs contribute 18g of protein, toast contributes 4g, yogurt contributes 12g." This would give users actionable insight into which ingredients are driving their macro profile per meal, not just the totals. Implementation note: the ingredient data is already stored in `log_entries.slot_selections_json` and the recipe's ingredient slots — the display layer is the only missing piece. Consider a stacked horizontal bar per macro (protein/carbs/fat), segmented by ingredient, as an alternative to or extension of the existing pie chart.

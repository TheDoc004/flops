# Design System — Flops

The visual foundation for every screen. Refer here before making any styling decision.

The app should feel **calm, precise, and physical** — like something an athlete would trust.
Not a startup dashboard. Not a productivity tool. A fitness system that respects the user's data.

---

## Guiding Principle

**Restraint is the design.**

Every color, shadow, and spacing decision should reduce noise, not add personality.
The data is the personality. The UI is the frame.

When in doubt: more whitespace, less visual weight, simpler hierarchy.

---

## Colors

The palette is intentionally narrow. Add color only when it carries meaning.

### Core
| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#1d4ed8` | Primary actions only. One per view. |
| `--color-primary-hover` | `#1e40af` | Hover/active state |
| `--color-primary-subtle` | `#eff6ff` | Selected rows, active backgrounds |

### Semantic (data states)
Color communicates status, not decoration. Use these and nothing else for state.

| Token | Value | Use |
|---|---|---|
| `--color-positive` | `#16a34a` | On-target, complete, good |
| `--color-caution` | `#b45309` | Approaching a limit, worth noting |
| `--color-negative` | `#dc2626` | Over limit, destructive action |

### Surfaces
| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#f9fafb` | Page background |
| `--color-surface` | `#ffffff` | Cards, modals, inputs |
| `--color-surface-muted` | `#f3f4f6` | Hover rows, subtle inset areas |
| `--color-border` | `#e5e7eb` | Borders and dividers |

### Text
| Token | Value | Use |
|---|---|---|
| `--color-text` | `#111827` | Primary content |
| `--color-text-secondary` | `#4b5563` | Labels, supporting text |
| `--color-text-muted` | `#9ca3af` | Placeholders, timestamps, disabled |

### Macro Colors
Fixed. Never change per-macro color mid-screen.

| Macro | Value |
|---|---|
| Calories | `#f59e0b` |
| Protein | `#3b82f6` |
| Carbs | `#10b981` |
| Fat | `#f97316` |
| Fiber | `#8b5cf6` |

**No gradients.** No color transitions on data elements. Flat color only.

---

## Spacing

Base unit: `4px`. Multiples only — no arbitrary values.

| Scale | Value | Typical use |
|---|---|---|
| `4px` | `4px` | Icon gaps, inline tight spacing |
| `8px` | `8px` | Internal padding, compact rows |
| `12px` | `12px` | Input padding, button padding |
| `16px` | `16px` | Gap between related elements |
| `24px` | `24px` | Between sections within a card |
| `28px` | `28px` | **Inter-section gap on the dashboard** — the confirmed rhythm value |
| `32px` | `32px` | Between unrelated major sections |
| `48px` | `48px` | Page-level vertical rhythm |

Cards use `20–28px` padding. Never less than `16px`.

Generous internal spacing is what makes content feel premium, not the design itself.

**Inter-section rhythm:** 28px between dashboard sections. 16px feels too tight (sections blur together). 32px feels spread out. 28px is the sweet spot — sections are clearly separated without the page feeling like a list of isolated widgets.

---

## Typography

System UI only. No custom fonts, no web fonts, no importing. The device's native sans-serif renders crisply and feels native.

| Role | Size | Weight | Line height |
|---|---|---|---|
| Page title | `28px` | `700` | `1.1` |
| Section heading | `16px` | `600` | `1.3` |
| Section label | `11px` | `600` | `1` |
| Body | `15px` | `400` | `1.6` |
| Label | `13px` | `500` | `1.4` |
| Caption | `12px` | `400` | `1.4` |
| Stat — primary | `36px` | `700` | `1` |
| Stat — secondary | `24px` | `600` | `1` |

**Rules:**
- Stats and numbers use `font-variant-numeric: tabular-nums` so digits don't shift as values change.
- Page titles use `letter-spacing: -0.02em`. Stats use `-0.02em`. Body text: default.
- Section labels use `text-transform: uppercase; letter-spacing: 0.07em; color: #9ca3af`. Use `.section-label` CSS class.
- Don't use `font-weight: 800` or `900`. `700` is the ceiling for UI text.
- Secondary text should feel clearly lighter — don't fight the hierarchy.
- At `900px` content width, stat numbers below `36px` feel like text, not data. `36px` is the minimum for primary stats.

---

## Border Radius

Consistent, not generous. Rounded enough to feel modern, not so rounded it looks playful.

| Name | Value | Use |
|---|---|---|
| `sm` | `4px` | Badges, tags, inline chips |
| `md` | `8px` | Inputs, buttons |
| `lg` | `12px` | Cards |
| `xl` | `16px` | Modals, sheets |
| `full` | `9999px` | Progress bars, pills |

Don't mix radius values within a single component.

---

## Shadows

Shadows define depth. Use them to separate layers, not to style elements.

| Name | Value | Use |
|---|---|---|
| `sm` | `0 1px 3px rgba(0,0,0,0.07)` | Cards at rest |
| `md` | `0 4px 16px rgba(0,0,0,0.07)` | Dropdowns, popovers |
| `lg` | `0 8px 32px rgba(0,0,0,0.10)` | Modals |
| `focus` | `0 0 0 3px rgba(29,78,216,0.2)` | Keyboard focus ring |

The shadow values are intentionally soft — lower opacity, slightly more blur than typical.
This keeps surfaces feeling grounded without visual noise.

**No layered shadows. No colored shadows. One shadow per element.**

---

## Component Philosophy

### Buttons
Three types. That's it.
- **Primary** — filled, `--color-primary`. One per screen context. The clearest action.
- **Secondary** — bordered, transparent fill. Supporting actions.
- **Danger** — filled, `--color-negative`. Irreversible actions only (delete, remove).

Height: `40px` desktop, `44px` mobile minimum. Padding: `12px 20px`.
Never use icon-only buttons without a tooltip. Never disable a button without explaining why.

### Cards
`background: white`, `border-radius: 12px`, `box-shadow: 0 1px 4px rgba(0,0,0,0.06)`, `padding: 20–28px`.

A card contains one topic. If you're adding a second unrelated thing to a card, make a second card.
Cards should not feel like containers — they should feel like documents.

**Grouped list card pattern:** When displaying a list of related items (e.g. today's meal entries), render them as rows inside a single shared card with `1px solid #f3f4f6` dividers between rows — not as individual cards per item. Individual cards per list item creates a stack of floating bubbles with no visual cohesion. The grouped card gives the section weight as a unit.

Each row in a grouped card: `padding: 16px 20px`. No card shadow per row. The outer card holds the shadow. Last row has no border-bottom.

**Dense edit list pattern:** When the list is something you *edit* mid-task rather than read — the ingredient amounts in Log a Meal, say — compress it further. Reference implementation: `.slot-list` / `.slot-row` in `index.css`.

- **One line per item.** Name left, fields right, in a grid (`minmax(0,1fr) 74px 64px`). A stack of labelled cards turns six ingredients into a thousand pixels of scrolling; rows turn it into three hundred.
- **Field captions go in one header row**, not above every field. Per-row `<label>`s become `aria-label`s so screen readers keep them.
- **One name per row.** Two names (our label for it + the library's name for it) reads as clutter. Pick the one the user named it, put the fuller name in `title`, and `text-overflow: ellipsis` rather than wrap — a wrapped name makes its row taller than its neighbours and the column stops scanning.
- **List-wide actions live in the section header**, not inside rows. A "reset" that appears under whichever row you touched interrupts the thing you're reading and reflows the list as you type.
- Controls may shrink to `38px` on desktop, but come back to the `44px` touch target under `480px`. Hide number spinners: they eat a narrow column, and amounts are typed.

The trade to keep in mind: this pattern buys speed by removing explanation, so it only suits fields whose meaning is already obvious from the column header.

### Section Labels
Use `.section-label` (defined in `index.css`) before any dashboard section group. This is the primary tool for creating visual progression between sections — it acts as a signpost so the user mentally completes one section before moving to the next.

```css
.section-label {
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin: 0 0 10px;
}
```

Don't use section labels inside cards — only between top-level dashboard sections.

### Inputs
- Height: `40px`. Font size: `15px` desktop, `16px` mobile (prevents iOS zoom).
- Border: `1px solid var(--color-border)`.
- Focus: border → `--color-primary`, shadow → `var(--shadow-focus)`.
- Error: border → `--color-negative`, message below in `12px` `--color-negative`.
- Label always above. Placeholder is a hint, not a label.

### Modals
- Mobile: bottom sheet. `position: fixed; bottom: 0; left: 0; right: 0; border-radius: 16px 16px 0 0`.
- Desktop: centered, `max-width: 520px`, `border-radius: 16px`, dimmed backdrop.
- Always dismissible: X button, ESC, clicking outside.
- One primary action. One cancel.

### Empty States
Every list or chart that can be empty must have a designed empty state.
- One short line: what's missing.
- One action: what to do about it (if applicable).
- No error iconography. Emptiness is a valid state.

### Progress Bars
Height: `6px` resting, `8px` when prominent (macro bars on Dashboard).
Background: `--color-surface-muted`. Fill: macro color. Radius: `full`.
Never animate on every render — only animate on value change.

---

## Data Visualization Philosophy

Charts are not decorations. Every chart should answer a specific question.

**Rules:**
- If a chart needs a legend to be understood, reconsider the chart.
- Axes should be minimal — one x, one y, light grid lines at `rgba(0,0,0,0.05)`.
- Tooltips are the detail layer. Don't show data on both the axis and the tooltip.
- Use color sparingly in charts. One series = one color. Two series max before it gets noisy.
- Always `<ResponsiveContainer width="100%" height={N}>`. Never fixed pixel widths.
- Chart height on mobile: reduce by 25–30% from desktop. `200px` is often enough.

Recharts is the standard. Don't introduce other charting libraries.

---

## Dashboard Philosophy

The Dashboard has one job: answer *"How am I doing today?"* in under three seconds.

**Section order (fixed — do not reorder):**
1. **Macro totals** — always first, always visible
2. **TODAY'S MEALS** — grouped list card, immediately below macros
3. **Training context** — compact single-row card
4. **TRENDS** — weight/calorie chart + weight entry row
5. **7-day adherence** — weekly context, lowest priority

Section labels (`TODAY'S MEALS`, `TRENDS`) appear before their section group. They are the mechanism for creating visual progression — without them, sections blur together into one undifferentiated scroll.

**Rules:**
- No widget that requires explanation. If it needs a tooltip to be understood, redesign it.
- The dashboard must feel complete even when nothing has been logged yet.
- Widgets are user-controlled from Profile. Don't force information on users who don't want it.
- Dense data ≠ useful data. Surface only what changes today.
- The dashboard should produce a natural scroll at 100% zoom on a standard laptop — not everything above the fold, not so spread out it feels empty.

The Dashboard should feel like a morning glance at your stats — calm, clear, immediately actionable.

---

## Mobile-First Rules

Design for 390px wide first. Desktop is an enhancement.

- Write base CSS for mobile. Add `@media (min-width: 768px)` for desktop overrides.
- Touch targets ≥ `44px` in both height and width. This includes log rows, nav items, icon buttons.
- No horizontal scroll at any viewport width. Ever.
- Stacked layouts are the default. Side-by-side is the override.
- Font sizes floor at `13px`. Never smaller.
- Input `font-size` ≥ `16px` on mobile — prevents iOS Safari auto-zoom.
- Bottom sheet modals on mobile. Centered floating modals feel wrong on small screens.
- Navigation: the current top navbar needs a mobile treatment. Design every new nav item with a bottom tab bar in mind.

Mobile is not a constraint. It's the primary surface.

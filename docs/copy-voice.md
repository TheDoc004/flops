# FLOPS copy voice

Lead with a **question** when a feature is not self-explanatory. Skip the question when the UI already says what it does (e.g. "+ Log a Meal").

## Pattern

| When | Headline | Body |
|------|----------|------|
| Empty state | Problem as question | One-line answer + optional CTA |
| Modal intro | Optional subline under title | What this solves |
| Profile toggle | Question in description | What happens when enabled |
| Secondary action | Tooltip or helper | Why you'd use it |

## Examples

- **Ingredients (empty):** "Cook the same protein every week?" → "Save it once and log by weight."
- **AI Estimate:** "Had a meal you didn't weigh?" → "Describe it and we'll estimate the macros."
- **Supplements toggle:** "Take the same stack daily?" → "Tick them off under your macros."
- **Meal prep:** "Portioned ahead?" → "Log one container at a time — we'll track what's left."
- **Prepped batch:** "Cooked a batch with fixed macros?" → "Prep it here and log by weight until it's gone."

## Don't

- Invent questions for obvious actions
- Use feature jargon in the headline ("receipt editor", "limited-use template")
- Add sparkles, emoji, or lavender AI chrome

## Component

Use [`FeaturePrompt`](../client/src/shared/ui/FeaturePrompt.jsx) for consistent styling.

# Coach Layer + Voice Onboarding — Idea Capture

_Written 2026-08-09. Revised the same day with the scope, platform, AI-cost, distribution and
sponsorship decisions below. Not started. This is a strategy note, not an approved plan._

## The one-sentence version

Turn FLOPS from a personal nutrition/training app into a **coach-facing product**: gyms and
coaches pay to see their clients' nutrition, training and activity data in one place, and the
thing that makes it work is that FLOPS' AI logging makes clients actually log.

**Scope is the whole picture, not just food.** What a coach should be able to read at a glance:
what the client eats (macros *and* micros), how often they train, how hard, whether the weight on
the bar is going up, what the scale is doing, and how active they are outside the gym — steps,
sport, conditioning. Nutrition is the part that already exists and the part competitors are worst
at, so it is the **wedge**, not the whole product.

---

## Why coach-facing, not consumer

Consumer nutrition apps are a graveyard — MyFitnessPal, MacroFactor and Cronometer own the
category and users churn in weeks. Coach-facing flips every unit economic:

- The coach pays, not the client.
- One coach brings 20+ clients at once (distribution solved).
- Retention is tied to the coaching relationship, not to the app's stickiness.

### The wedge (this part matters)

Trainerize, TrueCoach and Everfit **already** do "coach sees client data." That is not the
differentiator. What they are bad at is nutrition depth and data capture — their food logging
is an afterthought, so clients don't log, so coaches fly blind.

The actual pitch is:

> **Your clients actually log, because logging is a voice note. And you get a weekly AI summary
> per client instead of 20 dashboards to read.**

The second half is what a coach pays for. A coach with 25 clients does not want more charts —
they want **triage**: who drifted this week, who is under protein, who hasn't logged in 4 days.
FLOPS' AI layer already produces exactly that shape of output. Nobody in the space does it well.

### Pricing shape — flat per gym, not per seat

Revised 2026-08-09. Original note said per-active-client seat; that is right for an **independent
coach** with ~20 clients, wrong for a gym.

Sell a gym **one flat monthly line item** (order of $150–300/mo), unlimited members. Reasons:

- Gyms want a predictable cost, not a metered one.
- Per-seat gives the gym an incentive to **ration** access — the opposite of the behaviour we
  want, since the product only works if lots of clients log.
- Flat pricing means onboarding more members doesn't punish us commercially.

Free for the client, always. Do **not** try to charge consumers.

**Pitch it as retention, not software.** Gyms do not buy nutrition trackers — that reads as a
cost. They buy:

> "Your trainers can show clients their progress in numbers. Members who can see it working renew."

### The white-label trap (concrete)

Co-branding — the gym's logo and colours inside the app — is genuinely attractive to gyms and is a
modest lift (theming + an asset upload). **But do not ship a separate App Store listing per gym.**
Apple's guidelines on template and duplicate apps (**4.2.6**, **4.3**) reject exactly that pattern,
and it is a common way to lose a developer account. One app; the gym's branding appears **after**
the client joins with an invite code. Safer and less work.

---

## Platform decisions (2026-08-09)

### Wearables: integrate HealthKit, not Whoop/Garmin individually

Whoop, Garmin, Oura, Fitbit, Peloton, Strava and the iPhone's own pedometer **all write to Apple
Health**. Reading from HealthKit gets every one of them through one integration — no per-vendor
OAuth, no partner-approval process (Garmin's Connect API in particular is restrictive), and no API
that can be revoked out from under us. Android's equivalent later is Health Connect.

Two consequences:

- **HealthKit is native-only.** There is no web access. This makes the **Capacitor** wrap a hard
  requirement rather than a cost optimisation, and moves it up the roadmap.
- **It is also the App Store Guideline 4.2 answer.** An app that reads Apple Health and writes
  nutrition back to it is unambiguously a native app, not a wrapped website. That was the main
  rejection risk; HealthKit largely removes it.

Note MCP does **not** apply here — MCP connects *Claude* to a data source; wearable data arrives
through the OS. Different mechanism, and the OS one is better.

### Distribution: TestFlight first, App Store later

For a single-gym pilot the App Store may not be needed at all. TestFlight's **public link supports
up to 10,000 testers**, needs only a lightweight Beta App Review rather than full App Store review,
and allows same-day builds. Builds expire every 90 days — that just means a quarterly rebuild.

That is the right vehicle for "walk into a San Diego gym and hand it to their coaches." A full App
Store listing becomes a later, optional step once the thing is known to work.

Because the near-term product is **free**, StoreKit / subscriptions / RevenueCat drop out of the
roadmap entirely — weeks of work and a whole extra review surface, gone.

### Doctors: a PDF, not a portal

"Share with your coach" and "share with your doctor" sound similar and are not. Fitness apps are
not HIPAA covered entities, but anything presenting as a *clinical* tool invites scrutiny this
project does not want. The cheap version already exists — **`jspdf` report generation**. "Export a
report to bring to your doctor" captures ~90% of the value with none of the regulatory surface.
Save the *portal* for coaches.

---

## AI cost model — we pay, BYO-AI rejected as the primary path

Considered and rejected 2026-08-09: having users connect their own Claude/ChatGPT/Gemini
subscription via MCP so FLOPS pays nothing.

**Why rejected — it contradicts the wedge.** The thesis is *"clients actually log, because logging
is a voice note."* BYO-AI requires a gym client to (a) already pay for an LLM subscription,
(b) know what an MCP connector is, and (c) configure one before their first meal. That is the
highest-friction setup step in consumer software, gating the product's only real differentiator.

**Decision: FLOPS eats the AI cost; logging is free and instant for clients.** Keep the MCP
connector anyway — it is already step 3 of `deployment-and-mcp.md`, costs nothing extra, and is a
genuinely good power-user feature. It is *a door*, not *the strategy*.

BYO-AI also structurally cannot cover anything that runs without a user in a chat window:

| Feature | BYO-AI works? | Why |
|---|---|---|
| "Log my lunch" from the Claude app | yes | User's session, user's subscription |
| Asking questions about your own data | yes | Same |
| In-app AI Macro Logger | **no** | Server-side call, no chat session |
| **Weekly per-client coach summary** | **no** | It is a cron job — no user in the loop |
| Voice onboarding transcription | **no** | Server-side |

The weekly summary is the sellable artifact, and it can never be BYO.

### The numbers (rough, one gym, ~100 active clients)

| | Volume | Cost |
|---|---|---|
| Macro estimates (4 logs/day/client) | ~12,000/mo | ~$40 |
| Weekly coach summaries | ~400/mo | ~$5 |
| Voice transcription | modest | ~$5–10 |
| **One gym, heavy usage** | | **~$50–75/mo** |

A gym at $150–300/mo is comfortably profitable. **Ten gyms is ~$500–750/mo** — that is where free
stops working.

> **Guardrail — write the number down before it is needed.** "Free while it grows" fails at
> exactly the moment success makes it unaffordable to turn off. **Trigger: at 3 gyms, or $200/mo
> in AI spend, charging starts.** Future-me does not get to renegotiate this.

### The cost control is already built

Logging a **saved recipe** makes zero AI calls. A meal built entirely from **barcoded ingredients**
makes zero AI calls. The recipe-slot system means a client's *repeat* meals — most meals, and
nearly all meals for batch-cookers — cost nothing. AI spend concentrates in first-time and
improvised logging. **Pushing clients to save recipes is a cost lever, not just a UX nicety.**

### What this adds to the build

1. **Per-user AI metering with a hard cap** (`ai_usage` table): a monthly ceiling per user and a
   kill switch, so one runaway loop cannot become the bill. Build it in step 1 alongside rate
   limiting — same seam in the code.
2. **Model routing as config, not hardcoded.** Cheap fast model for macro estimates; the better
   model only for weekly summaries. This will be retuned repeatedly.
3. **The data model gains "organization."** Not just users and coaches — a *gym*. Client belongs to
   org, coach belongs to org, coach sees clients in their org. Far cheaper to decide once during
   the auth migration than to retrofit after a pilot.

---

## The gate: none of this is safe on today's architecture

As of 2026-08-09:

- No auth. `user_id` is hardcoded `0` at ~208 call sites (33 references in `server/db.js` alone,
  across all 20 tables: `recipes`, `log_entries`, `body_weights`, `training_*`, `supplements`, …).
- One SQLite file on a Render disk, **no backups**.
- **No rate limiting** on the AI endpoints, which spend real money on the server's own key.

That is fine for a personal app. It is a **completely different risk tier** the moment one person
can see another person's health data. A single missing `WHERE user_id = ?` leaks a stranger's
weight and food history, and there is no undo on that.

### Step zero, before any coach UI

1. **Real auth** + per-user isolation (the `user_id` plumbing already exists, so this is a
   migration, not a rewrite — see `deployment-and-mcp.md`).
2. **An isolation test suite** whose specific job is to prove user A's token cannot reach user B's
   row, on every endpoint. Not incidental coverage — a dedicated suite.
3. **Backups** and **rate limiting** on `/api/ai/*`. Already flagged in `deployment-and-mcp.md` as
   the most likely and most expensive failure modes respectively.

Unglamorous, and it is the entire foundation. Every path below needs it.

---

## Coach layer design (keep the surface small)

- **Read-only v1.** Coaches see, they do not write. Halves the risk surface.
- **Client-initiated consent.** Invite code → client explicitly accepts. Scoped toggles
  (nutrition / training / weight / photos), revocable at any time, with a persistent
  "your coach can see X" indicator in the client's app. Consent is a *feature* clients care
  about, not just legal cover.
- **Roster-first dashboard.** Signal and flags, not a data dump. Adherence %, last-logged,
  weight trend, protein hit-rate, drift flags.
- **Weekly per-client AI summary.** This is the sellable artifact. It is what saves a coach
  ~5 hrs/week.

### Housekeeping that comes with handling other people's health data

Privacy policy, ToS, data export, data delete. Generally *not* HIPAA territory (fitness coaching
apps aren't covered entities), but it changes if a coach is a dietitian billing insurance.
Not a blocker — just don't skip it.

---

## Voice onboarding

Right instinct (inspired by a dating app that runs onboarding as an AI voice call — answering
by voice is a lower barrier than typing, so fewer people abandon the questionnaire), with one
correction.

**Voice is great for narrative, bad for numbers.** Injury history, food preferences, schedule,
what's failed on past diets — voice wins. Weight, height, target macros — transcribing "one
seventy-four" into a number field and then correcting it by voice is *worse* than tapping.

→ **Voice for narrative, tap for numbers.** Or voice-first with a form filling in live beside it
that the user can correct by hand.

### Build the cheap version first

A full realtime voice agent is meaningful cost, latency and infra. Push-to-talk per question →
transcribe → structured extract gets ~80% of the drop-off improvement, and
**`server/aiTranscribe.js` already exists**, so the pipeline is mostly built. Ship that, measure
completion rate, and only go realtime if the data says the remaining friction is worth it.

### Why it connects to the coach layer

Onboarding output = a structured client profile that **both the AI helper and the coach consume**.
That is the connective tissue between the two ideas — they are really one idea.

---

## Sponsorship and merch (long-horizon, notes only)

Captured 2026-08-09. **Nothing here happens before there is an established user base.**

### Sponsor category: apparel, never nutrition

Deliberate constraint: **no supplement or nutrition-brand sponsorship.** A nutrition app whose
reporting is funded by a supplement company has a bias problem baked in, and trust in the numbers
is the product. An **apparel** brand (Gymshark, Young LA, and the like) has no editorial stake in
a macro figure, so it is clean.

### How apparel sponsorship actually works — the realistic ladder

Big apparel brands do not sponsor apps; their spend goes to athletes and creators with audiences,
not B2B software partnerships. So:

1. **Affiliate, available early.** Join the affiliate program, users get a discount code, we take a
   cut. Small money, zero cost, real.
2. **A local San Diego apparel brand next.** Far more reachable than Gymshark and it *aligns with
   the gym strategy* — a local brand cares about a local gym partnership in a way a global one
   never will.
3. **A real brand deal only once there is distribution they want** — thousands of engaged users.
   What is being sold is access to a targeted fitness audience, so the metric to build toward is
   **"N people who log 5+ times a week,"** not signups.

**Do not put brand placement inside the app.** It is a tool opened four times a day; ads are
friction. The shape that works is a **perk** — a discount code unlocked as a milestone reward.
Same money, reads as a benefit instead of an ad.

### The flip-flops idea

Give branded flip-flops to trainers — the name pun (FLOPS → flip-flops) is memorable, merch that
explains the product's name is free brand recall, and gym + flip-flops is a *coherent* pairing
(locker rooms, showers, pool decks) rather than a random tchotchke. San Diego helps.

Three things to get right:

- **Fix the trigger.** Rewarding raw *client signups* scales badly and invites gaming — a trainer
  "signs up" 30 fake clients and we ship 30 pairs. Tie it to something unfakeable that we actually
  want: *"your 5th client who has logged 30 days straight."* That rewards retention, which the
  whole product lives on.
- **It is a pilot tool, not a growth program.** Sizing, addresses, shipping, returns — charming at
  30 pairs, miserable at 500. Walking into the first three San Diego gyms with branded flip-flops
  is a great door-opener; scaling it as a referral engine is not.
- **Print nothing until the product retains.** Merch on a leaky product buys nothing.

> Minor but worth knowing before printing 500 pairs: **"flop" means failure.** The pun is good and
> worth doing, but a skeptical trainer being pitched on *showing results* will make that joke
> first. Have a one-liner ready. Not a reason to rename.

---

## What to do next

The riskiest assumption is **not technical**. It is whether coaches will switch and pay.

1. **Manual pilot before any dashboard.** Find 2–3 real coaches. Their clients use FLOPS; you
   hand the coach a weekly summary **generated by hand**. If they shrug, the dashboard won't save
   you. If they fight you for it, you know exactly what to build.
2. **In parallel:** auth + isolation + backups + rate limiting. Every path needs it regardless.

Do not build the coach dashboard first.

### Amended engineering sequence (2026-08-09)

1. **Deploy** — steps 1–2 of `deployment-and-mcp.md`: auth secret, rate limiting, Render/Vercel,
   backups. *Milestone: FLOPS on the phone's browser.*
2. **MCP connector** — step 3. Now the BYO-AI *door*, not the AI strategy.
3. **Capacitor + HealthKit** — promoted, because wearable/activity data is now central to the
   thesis and HealthKit is native-only.
4. **Real auth + per-user isolation + the isolation test suite** — the hard gate. No other
   person's data touches the app before this lands.
5. **TestFlight public link → single-gym pilot.**
6. **Coach layer** — manual weekly summaries first, dashboard only once coaches ask for it.

Steps 1–3 are worth doing regardless of whether the coach product ever ships — they are what puts
FLOPS on Diego's own phone.

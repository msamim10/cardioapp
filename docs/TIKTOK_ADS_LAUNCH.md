# CardioSurf — TikTok Ads Launch Plan

Research current as of **2 September 2026**. This is the *how to run campaigns* document.
The *how to wire the plumbing* document is [`TIKTOK_ADS_SETUP.md`](./TIKTOK_ADS_SETUP.md) — Singular ↔ TikTok
integration, SKAN identifiers, event mapping, conversion models. Nothing here repeats it;
where the two touch, this doc links to the step number.

**App:** CardioSurf · App Store ID `6794463238` · v1.0.2 live
**TikTok App ID:** `7679491368565194773` · **MMP:** Singular (Managed Mode)
**Pricing:** $14.99/month (no trial, bills immediately) · $39.99/year (3-day free trial) · hard paywall

---

## The bottom line, before you read 400 lines

1. **Your unit economics are tight to the point of being the main risk.** At $39.99/year with
   base-case conversion rates, you break even at roughly **$1.10 per install**. Published TikTok
   CPIs for US iOS subscription fitness apps run **$1.75–$4.00**. The gap is not closed by better
   campaign settings. It gets closed by unusually cheap installs (great creative), unusually
   good install→paid conversion, or a higher price. Read §2 before you spend anything.

2. **Optimize for Install, not Subscribe.** The article suggests "Subscribe OR Install." At your
   budget, Subscribe is not a viable optimization target — you will not produce enough events to
   train on, and SKAN will not even reliably report them inside your 3-day measurement window.
   Full reasoning in §4.

3. **Do not turn on Goal Based Budget Increase at launch.** In TikTok's current implementation it
   requires goal-based bidding you have no data to set, and it is capped differently from what the
   article says. §3.6 and §9.

4. **Creative is the gating item and the deciding variable.** Everything else in this doc is worth
   maybe 20% of the outcome. The creative is worth the other 80%. Do not launch on 2 videos.

5. **Budget $3,000 you can lose.** Apple pays 33 days after the *fiscal* month closes, so money
   from a sale can be 33–63 days away while your card is charged daily. §7.

---

## 1. Pre-launch checklist

Everything here must be true before the first dollar. Roughly in order.

### 1.1 BLOCKER — Set the Singular SKAdNetwork conversion model

This is the one outstanding technical item. It must be done **before** launch, not after: per
`TIKTOK_ADS_SETUP.md` Step 12, changing an *active* model triggers a 48-hour migration in which
the **first 24 hours record no conversion values at all, permanently**. Doing it now costs nothing.

Singular → **SKAdNetwork → Model Configuration** → CardioSurf → the model → set the funnel steps to:

| Slot | Event | Note |
| --- | --- | --- |
| 1 | `sng_complete_registration` | Account created |
| 2 | `paywall_viewed` | Hard paywall is the last onboarding step, before camera calibration |
| 3 | `sng_start_trial` | **Insert once the event has registered in Singular.** Until then, leave the slot out and shift 3–5 up by one. |
| 4 | `onboarding_complete` | Camera calibration — only reachable with an active entitlement |
| 5 | `first_run_complete` | First workout |
| 6 | `sng_subscribe` | Bonus signal; see caveat below |

Two things to know:

- **This order is correct and it differs from `TIKTOK_ADS_SETUP.md` Step 13.** That step lists
  onboarding before the paywall. The app has since moved the paywall to the end of onboarding,
  ahead of calibration — see the ladder comment in `src/lib/conversionValue.ts`. Use the order
  above; the setup doc's Step 13 ordering is stale.
- **Measurement period: 3 days** (as in the setup doc). Keep it. But accept the consequence:
  `sng_subscribe` fires on day 3+ of a 3-day trial, right at or past the window edge, and in
  Managed Mode the app must be *open* for the SDK to push a raised value. You will see slots 1–3
  routinely, slots 4–5 sometimes, and slot 6 rarely. Do not build decisions on slot 6.

Toggle the model **On**, save, then confirm under **Preview Conversion Values** that the CSV
reflects the order above.

### 1.2 Confirm events actually arrive in TikTok Events Manager

Not Singular — TikTok. The badge is the only true end-to-end proof.

- [ ] TikTok Ads Manager → **Tools → Events** (or **Events Manager**) → your app shows
      **Verified**, not *Pending Verification*. If it is still pending, "Send all unattributed
      events" is probably off — see `TIKTOK_ADS_SETUP.md` Steps 9 and 15.
- [ ] In the app's event list, confirm you can see the mapped names arriving: `Registration`,
      `ViewContent`, `CompleteTutorial`, `StartTrial`, `Subscribe`. An event that is not visible
      here cannot be optimized toward, no matter what Singular shows.
- [ ] `StartTrial` specifically. Make a sandbox purchase on a real device and watch for it. This
      is the event you will graduate onto later, and it is the one most likely to be missing.

### 1.3 Confirm the live build carries the code

Ads that point at a store build without the Singular SDK and SKAN entries attribute nothing.

- [ ] App Store Connect → CardioSurf → the **currently downloadable** version is 1.0.2 (or later)
      and was built *after* the Singular SDK and the five SKAdNetwork IDs went into `app.json`.
      If 1.0.2 predates that work, you must ship a build before spending — this is the one
      pre-launch item that can require a release.
- [ ] Install CardioSurf **from the App Store** (not TestFlight, not a dev build) on a clean
      device, run through onboarding, and confirm the events land in Singular **Export Logs**
      (~1 hour lag). This is the single check that validates the whole chain as users will
      experience it.

### 1.4 Confirm you are enrolled in the Small Business Program

The economics in §2 assume a **15% Apple commission**. That is not automatic — you have to enroll,
and it takes effect 15 days after the end of the fiscal month in which enrollment is approved.

- [ ] App Store Connect → **Business** → App Store Small Business Program → status is *Approved*.
- [ ] If it is not, enroll today and **redo the math in §2 at 30%**. At 30%, your break-even CPI
      falls from ~$1.10 to ~$0.90 and TikTok stops being viable at almost any realistic CPI.
      This single checkbox is worth more than every campaign setting in this document.

### 1.5 Housekeeping that takes 20 minutes and protects the spend

- [ ] **Comment keyword filters.** TikTok account **Settings → Privacy → Comment filters** (in the
      TikTok app, on the account whose posts you will Spark). Block at minimum: `scam`, `fake`,
      `ad`, `paid`, `bot`, `ai`, `cash grab`, `sub`, `subscription`, `expensive`, `price`, `cost`,
      `money`, `free?`, `paywall`, `trash`, `mid`. Comments calling the ad an ad, or complaining
      about price, measurably drag conversion. Leave comments *on* — engagement helps distribution;
      just filter the poison.
- [ ] **Spark Ads authorization.** For every creator video you intend to run as a Spark Ad, the
      creator must generate a post authorization code in the TikTok app
      (**Profile → Settings and privacy → Creator tools → Ad settings → Ad authorization**, then
      per-post authorize and copy the code). Add this to the creator brief and to the payment
      conditions — a $20 video you cannot run as an ad is a wasted $20. Confirm the exact menu path
      with your first creator; TikTok moves these labels.
- [ ] **Account spending limit.** In Ads Manager billing/payment settings, set an account-level
      spending limit at your reserve for the test (e.g. $2,500). This is your protection against a
      misconfigured budget or a Goal Based Budget Increase runaway.
- [ ] **Apple Ads $100 credit.** Unrelated to TikTok but free money, and it needs no creative:
      Apple gives eligible new accounts a one-time **$100 credit** (confirmed live as of Aug 2026;
      requires being the App Store Connect Account Holder and linking your *top-level* Apple Ads
      account, not a campaign group). Note it is **Apple Ads** now, not Apple Search Ads — renamed
      April 2025. Claim it while you wait on creative.

### 1.6 Do NOT do these

- Do not install the TikTok SDK. `TIKTOK_ADS_SETUP.md` point 2 explains why.
- Do not upload a conversion schema in TikTok Events Manager. Singular owns conversion values.
- Do not change the Singular model after launch unless you accept losing 24 hours of data.

---

## 2. Unit economics, computed for your numbers

Everything in this section is arithmetic on top of assumptions. **The assumptions are the weak
part.** They are flagged 🔧 and every one of them must be replaced with your own RevenueCat data
within 30 days of launch. Treat this section as a spreadsheet you inherited, not as findings.

### 2.1 What you actually keep

| | Sticker | Apple takes 15% | You net |
| --- | --- | --- | --- |
| Yearly | $39.99 | −$6.00 | **$33.99**, all up front |
| Monthly | $14.99 | −$2.25 | **$12.74** per month, as it accrues |

Adjustments to keep in mind, not modelled above: US sales tax is remitted by Apple in taxable
states and takes a further 0–7% off proceeds depending on the buyer's state; RevenueCat costs 0
under its free tier and ~1% of tracked revenue above it; refunds and chargebacks run a few percent
in fitness. The model below applies a flat 5% haircut for refunds and ignores the rest. If you are
*not* in the Small Business Program, replace $33.99 with $27.99 and $12.74 with $10.49.

### 2.2 The funnel, three ways

🔧 **Every number in the table below is an assumption.** They are anchored on RevenueCat's *State of
Subscription Apps 2026* (Health & Fitness download-to-trial median 6.9%; trial-to-paid median
37.7%; but trials of ≤4 days convert at a 25.5% median versus 42.5% for 17–32 day trials, and
55.4% of 3-day trials are cancelled on day 0) and then discounted, because paid TikTok traffic is
lower-intent than the blended traffic those medians describe.

| Assumption | Bear | Base | Bull |
| --- | --- | --- | --- |
| Install → purchase decision (trial start *or* direct monthly buy) | 4% | 7% | 12% |
| Share choosing yearly (i.e. entering the trial) | 70% | 70% | 70% |
| Trial → paid | 20% | 30% | 40% |
| Monthly payments collected, average per monthly subscriber | 2.0 | 2.5 | 3.0 |

There is a CardioSurf-specific reason to lean bear rather than base. Your activation requires
camera permission, standing up, and physical space in front of a phone. A TikTok user who installs
while lying in bed at 11pm is a materially worse activation prospect than one installing a calorie
tracker. Your install→paywall rate may look normal; your install→*decision* rate is the one at
risk.

### 2.3 Net revenue per install

Per 1,000 installs, first 12 months, after Apple's 15% and a 5% refund haircut:

| | Bear | Base | Bull |
| --- | --- | --- | --- |
| Paid yearly subscribers | 5.6 | 14.7 | 33.6 |
| Yearly revenue | $181 | $475 | $1,085 |
| Direct monthly subscribers | 12 | 21 | 36 |
| Monthly revenue (Y1) | $290 | $635 | $1,307 |
| **Total net revenue** | **$471** | **$1,110** | **$2,392** |
| **Net revenue per install (RPI)** | **$0.47** | **$1.11** | **$2.39** |

Sanity check against outside data: RevenueCat puts Health & Fitness median *gross* revenue per
install at $0.48 by D14 and $0.66 by D60. Our base case ($1.11 net over 12 months) is therefore
somewhat *optimistic* relative to the category median, not conservative. Bear is the honest
planning case.

### 2.4 Target CPA, three ways to express it

Break-even means CPA = net revenue. A 30% margin — the article's stated realistic ceiling and a
fair target — means CPA ≤ 70% of net revenue.

| Metric | Bear | Base | Bull |
| --- | --- | --- | --- |
| Break-even **cost per install** | $0.47 | $1.11 | $2.39 |
| **Target CPI** (30% margin) | $0.33 | **$0.78** | $1.67 |
| Break-even **cost per trial start** | $6.46 | $9.69 | $12.92 |
| **Target cost per trial start** | $4.52 | **$6.78** | $9.04 |
| Break-even **cost per paid subscriber** (blended) | $27 | $31 | $34 |
| **Target cost per paid subscriber** | $19 | **$22** | $24 |

**Working targets to run against, pending real data:**

- **CPI ≤ $1.20** — good, keep going. **$1.20–$2.00** — marginal, only justified if your live
  install→decision rate is running ≥10%. **> $2.50 sustained** — stop, the creative is not working.
- **Cost per trial start ≤ $8.** Above $15, stop.
- **Cost per paid subscriber ≤ $22.** Above $31, stop.

### 2.5 The uncomfortable part

Published CPI ranges for US iOS health & fitness on TikTok in 2026: **$1.75–$4.00** (Airbridge),
**$2–$5** (LaunchShots), **$1.20–$2.40** (RocketShip / Business of Apps). Realistically, a new
account at low budget lands at the top of those ranges before creative learning kicks in.

Set that against a base-case break-even of $1.11 and the conclusion is blunt: **at $39.99/year,
base-case economics do not clear published CPIs — they miss by roughly 2–3×.** Three ways out, in
order of how much they're in your control:

1. **Creative-driven cheap installs.** This is the real hope and it is not fantasy. CPI is
   `CPM ÷ (CTR × CVR)`. At a $5 CPM, 2% CTR and 25% click→install, CPI is **$1.00**. CardioSurf is
   unusually demo-able — camera-tracked body movement controlling an on-screen runner is a *visual
   novelty*, which is exactly what produces freakishly high CTR on TikTok. If any creative gets a
   3% CTR you are in business. This is why creative is 80% of the outcome.
2. **Price.** You moved yearly from $69.99 to $39.99, which cut your CPA headroom roughly in half.
   Inverting the model: at a $3.00 CPI, you need a **19% install→decision rate** to break even —
   near top-decile. At a 7% decision rate, you'd need net revenue per decision of ~$43 versus
   today's ~$16, i.e. prices roughly 2.7× higher. Neither is reachable from here. Before scaling
   spend, A/B $39.99 against $59.99 in RevenueCat (no build needed) and watch refund rate alongside
   conversion. **If paid UA is the growth plan, $39.99 is probably the wrong price.**
3. **Conversion rate work.** Onboarding and paywall optimization is free relative to ad spend and
   compounds on every dollar you'll ever spend. The `funnelStore` counters already in the app give
   you install→paywall→trial→paid without any dashboard.

None of this means don't launch. It means launch as a **priced experiment to learn your real
conversion rates and your real CPI**, with a fixed loss limit, not as a growth engine you expect to
profit in month one.

---

## 3. Campaign structure and exact settings

One campaign. One ad group. Five to six ads. That is the whole structure, and at your budget any
more is actively harmful — splitting spend splits your SKAN signal below Apple's crowd-anonymity
thresholds and you end up with null conversion values everywhere.

### 3.1 Campaign

| Setting | Value |
| --- | --- |
| Objective | **App Promotion → App Install** |
| App | CardioSurf (iOS) |
| **iOS 14.5+ dedicated campaign** | **ON** — without it you can only reach ≤ iOS 14.4, i.e. nobody |
| Advanced Dedicated Campaign / iOS real-time reporting | **ON if offered** — see §3.2 |
| Campaign Budget Optimization | ON |
| Budget type | **Daily** — you cannot switch to lifetime later |
| Daily budget | **$70** (floor is >$50) |
| Goal Based Budget Increase | **OFF at launch** — see §3.6 |
| Campaign name | `CS_iOS_US_Install_v1` |

### 3.2 Look for "your app is eligible for iOS real-time reporting"

This is the single most valuable 2026 change relative to the article, and the article predates it.
When you create the dedicated campaign, TikTok may show a banner saying your app is eligible for
**iOS real-time conversion reporting** (API name: *Advanced Dedicated Campaign*). If it appears,
turn it on. It gives you near-real-time conversion data in Ads Manager instead of waiting on
SKAN's 24–72 hour aggregate, which changes how fast you can read a test from "about a week" to
"about two days."

If the banner does not appear, your app has insufficient data signals yet. The path is to run a
plain Install campaign for 3–4 days to feed TikTok data and check again. **Do not** disable SKAN to
chase it — that requires allowlisting, and it would blind Singular.

### 3.3 Ad group

| Setting | Value | Why |
| --- | --- | --- |
| Optimization event | **Install** | §4 — this is the most important decision in the doc |
| Bid strategy | **Maximum Delivery** (formerly *Lowest Cost*; the article calls this *Maximum Results*) | Max volume, max learning signal. Do not set a bid cap on day one. |
| Placement | **Manual → TikTok only** | Turn **off** Pangle, Lemon8, Global App Bundle. Leave Search Feed on if offered. |
| Location | **United States only** | Highest iOS spend, no VAT drag, and your creative will be English-language UGC |
| Language | English | |
| Age | **18+** (recommend 18–44) | 18+ is *mandatory* under TikTok's Weight Management and Body Image policy for anything fitness-claim adjacent |
| Gender | All | |
| Interests / behaviors | **Empty** | Broad beats interest-targeting for fitness apps when creative carries the signal; research puts it 18–32% cheaper on CPA |
| Audience expansion / automatic targeting | Off | Keep the geo/age/language guardrails manual, stay broad inside them |
| Device / OS | Leave default (dedicated campaign handles iOS 14.5+) | |
| Dayparting | All day | |
| Schedule | Start tomorrow, no end date | |
| Ad group budget | Managed by campaign CBO | |
| Ad group name | `AG_Broad_18-44_Install` | |

**A deliberate departure from `TIKTOK_ADS_SETUP.md`:** that doc recommends auto-placement, which is
TikTok's advice and correct when you're managing 15 campaigns against a quota. You are running one.
Pangle is third-party in-app rewarded and interstitial inventory; for a hard-paywalled $39.99/year
subscription it typically converts far worse than TikTok feed, and at your volume it would pollute
the only conversion signal you have. Go TikTok-only. The Pangle SKAN IDs in the binary just sit
unused, which is harmless.

### 3.4 Ads

| Setting | Value |
| --- | --- |
| Ad format | **Spark Ads** wherever you have creator authorization; standard In-Feed video otherwise |
| Number of ads | **5–6** |
| Aspect | 9:16, 1080×1920 |
| CTA | **Install Now** (or Download). Dynamic CTA is fine to leave on |
| Destination | App Store, direct. No deep link at launch |
| Comments / sharing | **Allowed** — with the keyword filters from §1.5 in place |
| Ad names | `[concept]_[creator]_[hooklength]`, e.g. `challenge_maya_15s` |

**Automatic enhancements — turn all of these OFF:**

- Automated Creative Optimization / Smart Creative
- Automatic creative generation, text generation, AI voiceover, music replacement
- "Add recommended videos" / automatic video selection
- Selling points / interactive add-ons / stickers
- Smart fix suggestions

**Leave ON:** the CTA enhancement only. This matches the article and it is still right — TikTok's
enhancements substitute machine-generated variations for the exact thing you are trying to measure,
and at 5 creatives you cannot afford ambiguity about which one performed.

### 3.5 Creative policy landmines (fitness-specific)

Get this wrong and you lose days to ad review, or worse.

- **No before/after body imagery.** Prohibited in paid ads under TikTok's misleading-content and
  body-image policies. This includes split-screens and sequential transformation shots. Note that
  "before/after transformation" is one of the top-performing fitness formats *elsewhere* — you
  cannot use it here.
- **No weight-loss claims, no time-bound promises**, no "lose X lbs," no implied ideal body type.
- **Frame it as play, not fat loss.** "Cardio that doesn't feel like cardio," "can you beat my
  score," "my legs are dead" — which is what your existing creator brief already says. Your brief
  is policy-safe as written. Keep it that way.
- Age-gate to 18+ regardless.
- Each ad is reviewed separately, usually under 24 hours. **Editing a live ad re-triggers review**,
  so do not nudge ads — swap them.

### 3.6 Goal Based Budget Increase — what the article gets wrong

The article calls GBBI "the setting that gave me financial freedom" and says to set it to "20%
increase up to 20 times," which on $70 scales to $350/day. **Per TikTok's own documentation (last
updated August 2026), that is not how it works:**

- The increment is **fixed at 20% of the original budget** — not configurable.
- It can fire **up to 10 times per day**, not 20. Your $70 tops out at **$210/day**, not $350.
- It **resets to your manual budget every morning** and rebuilds from there.
- It requires **goal-based bidding** — *Target Cost per Result* or *Target/Minimum ROAS*. It does
  **not** work with Maximum Delivery, so the article's "use it with Maximum Results" is impossible.
- It requires a **Smart+** objective (Smart+ App Promotion) and a **daily** budget.
- **"Not available to all advertisers at this time."** It may simply not be in your account.

**Recommendation: leave it off for weeks 1–2.** To use it you must name a Target Cost per Result,
and you have no validated CPI to name. Set it too low and delivery stalls at near-zero spend; set
it too high and you have bought a budget escalator with no brake. Once you have a creative holding
a known CPI for 5+ days (§5), then: duplicate the winner into a Smart+ App Promotion campaign,
set Target Cost per Result at ~1.2× your proven CPI, turn GBBI on, and keep the account spending
limit from §1.5 in place. Firing it can triple a day's spend without you present.

---

## 4. The optimization event decision

**Recommendation: launch on Install. Graduate to a mid-funnel event around week 3–4. Do not
optimize for Subscribe at this budget, probably not this year.**

The article says "In-app event → Subscribe OR Install" and leaves the choice open. For you it is
not open, for four independent reasons.

**1. Volume. TikTok's learning phase needs conversions you cannot produce on Subscribe.** TikTok's
documentation says volatility declines after ~25 campaign results or 7 days, and practitioner
consensus puts real stability at ~50 conversions per week on the optimization event. At $70/day and
a $2.50 CPI you generate ~28 installs/day — **196 installs/week**, comfortably past 50. Run the same
budget against Subscribe and base-case conversion (7% × 70% × 30% + monthly) and you get roughly
**5–7 paid subscribers per week**. That is not a training signal, it is noise. The algorithm would
spend your money essentially at random while reporting a "learning limited" ad group.

**2. SKAN's crowd anonymity punishes low install volume specifically.** Apple decides how much data
to return based on install count *at time of install*, per campaign — not on how many downstream
events you get. TikTok's own guidance is **90+ installs per day per iOS campaign** to stay above
the threshold. At $2.50 CPI that requires **$225/day**. You will be below it, which means expect
coarse or null conversion values on a meaningful share of postbacks, and expect TikTok's reported
iOS conversions to be partly modelled rather than measured. Everything about this argues for
consolidating all spend into one campaign optimizing the *highest-frequency* event available.

**3. Your 3-day trial lands `sng_subscribe` at the edge of the measurement window.** With a 3-day
Singular measurement period, a trial that converts on day 3 or 4 is at or past the boundary — and
in Managed Mode the app must be open for the SDK to raise the value. Even when a subscribe happens,
SKAN often will not tell you. Optimizing toward an event the measurement system structurally
under-reports is optimizing toward a censored target.

**4. Attribution delay caps your decision speed regardless.** SKAN postbacks are delayed 24–72
hours, and TikTok explicitly recommends **no campaign changes for the first 72 hours after launch
and after each subsequent change**. So: no decisions before day 4. If iOS real-time reporting
(§3.2) is available to you, that shortens to roughly 48 hours for install-level reads — but revenue
truth still comes from RevenueCat on its own timeline.

### The graduation path

| Phase | When | Optimize for | Requires |
| --- | --- | --- | --- |
| **1. Install** | Day 1 → ~day 14 | `Install` | Nothing. Start here. |
| **2. Mid-funnel** | Once installs are stable and you're clearing ~150+/week | `Registration` (`sng_complete_registration`) or `CompleteTutorial` | ~50+ of that event per week. At 60–70% of installs passing registration, you clear this comfortably at $70/day. |
| **3. StartTrial** | Only when trial starts exceed ~50/week | `StartTrial` | At base conversion (trials ≈ 4.9% of installs) that needs ~1,000 installs/week ≈ **$350/day**. Realistically month 2–3, if at all. |
| **4. Subscribe** | Not at this budget | `Subscribe` | ~$1,000/day-equivalent volume. Ignore until then. |

Moving between phases restarts learning. Do it by **duplicating** the campaign with the new
optimization event and running both for 3–4 days, not by editing the live one — you keep a working
campaign while the new one learns, and you get a comparison instead of a cliff.

One honest caveat on Install optimization: it buys installs, and some of those users were never
going to pay. That is the known cost, and multiple 2026 sources correctly warn about it. You are
accepting worse user quality in exchange for a functioning feedback loop, and you compensate by
watching install→trial in RevenueCat as your quality gate. If install→trial collapses below ~4%,
Install optimization is buying you junk and it's time to move to Phase 2 early.

---

## 5. Creative plan

**This is the gating item and the deciding variable.** You currently have zero finished creative.
Nothing else in this document matters until that changes.

### 5.1 How many

- **Minimum to launch: 5 creatives across 5 distinct concepts.** The article ran exactly this and
  says in hindsight he should have run more. He's right.
- **Realistic to find a winner: 15–20 videos.** Plan for it. At $20 base per video that is
  $300–400 — cheap relative to $2,100 of ad spend, and it is the highest-leverage money in the plan.
- **Target: 3–4 new creatives per week ongoing.** Creative fatigue on TikTok shows up as a 20–30%
  CPA increase after 7–14 days of consistent spend on the same asset.

### 5.2 Five concepts to brief

Concept, not execution. Each concept should get 2–3 executions from different creators once it
shows promise, so that you can tell a winning *angle* from a lucky *video*.

1. **The challenge / score-beat.** "Bet you can't beat my score." Creator plays, reacts, calls out
   the viewer. Highest fit with your product's actual novelty and with TikTok's comment culture.
2. **Raw gameplay demo, no talking.** Phone propped up, split attention between the person moving
   and the screen reacting. Text overlay only. This is your "visual novelty" play and the one most
   likely to produce a freak CTR — nobody scrolling has seen a person's body control a runner.
3. **"I hate cardio" problem/solution.** First 2 seconds state the frustration ("I've cancelled 4
   gym memberships"), then the reveal. Sells the escape from boredom, not the workout.
4. **Reaction / can't-believe-it.** Creator skeptical → tries it → visibly wrecked and laughing.
   "My legs are dead" is the payoff line. Policy-safe version of a transformation story.
5. **Screen recording + voiceover walkthrough.** Cheapest to produce, works as a control. Usually
   loses, but you need one boring one to know how much the interesting ones are worth.

Deliberately **not** on the list: before/after transformation (prohibited, §3.5), and anything
AI-generated as the primary footage — platforms are cracking down and 2026 data puts fully
AI-generated video 30–50% worse on CPA for fitness than real creator footage.

### 5.3 Format and craft notes

- **9:16, 1080×1920.** 1:1 and 16:9 get letterboxed and have their reach degraded.
- **Length: test two bands.** 9–15s for the pure-hook concepts (2, 4), and 21–34s for the ones that
  need to explain (1, 3, 5). Structure for the longer band: 0–3s hook, 3–15s demonstrate, 15–25s
  social proof, 25–34s CTA.
- **Hook is the first 0.8 seconds** and should stack layers: visual movement, text overlay under
  15 words, a voice that sounds like a person, and sound that isn't stock. Sound-on is the default
  on TikTok; a silent ad forfeits a layer.
- **No logo in the first frame. No polish.** Studio-looking fitness ads underperform UGC by 40–60%
  on CPA. Phone footage, real room, natural light, visible mess is fine.
- **Show the app on screen for 3–5 seconds minimum.** People must understand what they're installing.
- **In-creative CTA beats the button.** "Try it free for 3 days" or "beat my score" outperforms
  "download the app." Pair it with the Install Now button.

### 5.4 Tie-in to the creators you're briefing now

Your brief at $20/video plus $30 per 100k views is well-structured and the framing is already
policy-safe. Three additions before it goes out:

- **Usage rights for paid advertising, stated explicitly.** Without it you cannot legally run the
  footage as ads, which is the entire point.
- **The Spark Ads authorization code** as a payment condition (§1.5). A video you can't Spark is
  worth much less to you.
- **Request raw footage and alternate takes.** One creator session should yield 3–5 ad variations
  through different cuts and hooks, which drops your effective cost per creative well below $20.

Spark Ads over uploaded video wherever possible: they inherit the creator's profile and comment
section, and 2026 data puts them 15–20% better on CPA with materially higher engagement.

---

## 6. Testing and scaling protocol

### 6.1 The first 14 days, day by day

| Day | Action |
| --- | --- |
| 0 | §1 checklist complete. 5–6 ads submitted for review (allow 24h). |
| 1 | Campaign live at $70/day. **Then do nothing.** |
| 2–3 | Look only. Do not touch. TikTok explicitly recommends no changes for 72 hours; SKAN hasn't reported yet. |
| 4 | First read. Kill any ad with **$50+ spend and zero installs**, or CPI > 2× campaign average on 1,000+ impressions. Add replacements from the queue. Do not change budget, bid, or targeting. |
| 5–7 | Let it run. Check RevenueCat daily for the first trial starts. |
| 7 | **Week 1 review** (§6.3). ~$490 spent. You should know your rough CPI and have 10–20 trial starts if things are working. |
| 8–10 | If a creative is holding CPI ≤ $1.50: hold budget, add 2–3 new executions of that *concept*. If nothing is under $2.50: keep budget flat, replace 4 of 6 creatives. Do not raise budget to fix bad creative. |
| 11–14 | First scale decision (§6.4), or first kill decision. Check the iOS real-time reporting banner again if it wasn't available at launch. |

### 6.2 Judge creatives on upper-funnel metrics, not conversions

This is a practical constraint the article skips. **At your volume you cannot attribute trials to
individual creatives.** SKAN reports at campaign level, and per-creative conversion data at 20–30
installs/day/ad will be null or coarse. So:

- **Creative-level decisions** use TikTok's own numbers: 2s/6s view rate (hook), CTR, and
  click→install CVR. These are measured, immediate, and reliable.
- **Campaign-level decisions** use trials and paid subscribers from RevenueCat.

Working thresholds for a creative that deserves to live: **CTR ≥ 1%** (a genuinely good one hits
2%+), **click→install ≥ 15%**, hook rate visibly above the ad group average.

### 6.3 Kill / keep / scale

| Signal | Read | Action |
| --- | --- | --- |
| $50 spent, 0 installs | Dead | Kill the ad. This is the article's "$50 bet" and it's correct. |
| CTR < 0.6% after 5,000 impressions | Hook fails | Kill. |
| CPI > 2.5× campaign average | Losing the auction | Kill. |
| CPI $1.20–$2.00, install→trial ≥ 8% | Marginal but real | Keep. Add executions of the same concept. |
| CPI ≤ $1.20, holding 3+ days | Winner | Scale (§6.4). |
| Whole campaign: 7 days, $490, zero trial starts | Either creative or product-market fit | Stop. Swap all creative and rerun once. If the second round also produces zero, the problem is not the campaign. |
| Whole campaign: trials arriving, cost per trial $8–$15 | Normal early state | Continue; work on onboarding conversion in parallel. |

### 6.4 Scaling a winner

- **+20–30% every 48–72 hours** while CPI holds. TikTok's user guide says no more than 50% at a
  time with 2 days between changes; 20–30% is the safer practitioner number and matches the article.
- **Or duplicate** the winner into a new campaign at a higher budget and leave the original alone.
  This preserves a known-good campaign and is how you'd introduce Target Cost per Result + GBBI
  (§3.6) without risking what already works.
- **Expect CPI to rise as you scale.** The article says so and is right. A creative profitable at
  $70/day is often marginal at $300/day, because you exhaust the cheapest slice of the audience.
- **Ceiling behaviour:** when a winner stops scaling, don't push budget further. Make 2–3 iterations
  with new hooks, music, or first frames on the same concept; iterations typically recover 70–80%
  of the original's peak.
- **Do not churn campaigns.** After hitting the iOS dedicated campaign quota you must wait 72 hours
  after pausing before a slot frees. You have 15 slots and no reason to burn them.

### 6.5 Learning phase, campaign and account

The article's claim that the *account* also has a learning phase is directionally true and worth
internalizing: every dollar you spend teaches TikTok what a CardioSurf payer looks like, and that
knowledge partially survives individual campaigns. The practical implications:

- Absorb small early losses rather than restarting constantly. Restarting throws away the signal
  you paid for.
- Consolidate. One campaign accumulating signal beats four campaigns splitting it — doubly so
  under SKAN crowd anonymity.
- The counter-implication: if you're going to quit, quit decisively at a pre-set number. "A bit
  more spend to feed the algorithm" is how a $2,000 test becomes a $6,000 one.

---

## 7. Budget reality and cash flow

### 7.1 What to have available

| Item | Amount |
| --- | --- |
| Ad spend, 30-day test at $70/day | $2,100 |
| Creative (15–20 videos at $20 + view bonuses) | $400–800 |
| Buffer for a GBBI or budget mistake | $300 |
| **Total you should be prepared to lose** | **≈ $3,000** |

If $3,000 is not available to lose, run at **$50/day** (the campaign floor) for 30 days ≈ $1,500,
accept that you'll read results more slowly, and put the Apple Ads $100 credit to work first since
it needs no creative. Do not run below $50/day — the campaign minimum blocks it, and a starved
campaign teaches you nothing anyway.

### 7.2 The cash-flow trap, concretely

Apple pays **33 days after the close of its fiscal month**, and its fiscal months are 4 or 5 weeks
long rather than calendar months. A sale early in a fiscal month can therefore be **60+ days** from
landing in your bank account. Meanwhile TikTok charges your card continuously.

Worked base case: $70/day for 30 days = $2,100 spent. At a $2.50 CPI that's 840 installs. Base
conversion gives ~12 paid annual subscribers (~$400 net) and ~18 monthly subscribers (~$220 net in
month one) — roughly **$620 collected against $2,100 spent in month one**, and that $620 does not
reach your bank for another month or more.

Even in the *bull* case where you're genuinely profitable, you fund 1.5–2 months of spend out of
pocket before the first Apple payment arrives. The article's author ran out of money and had to
pause his ads — with faster-converting products than yours. Plan the reserve for the lag, not for
the loss.

### 7.3 Margin expectations

30% margin is the realistic ceiling the article names and it is a fair number: 15% Apple, ~1%
RevenueCat, US sales tax in some states, plus your own income tax on what's left. Then note that
**your 30% would be 30% of a much thinner revenue line than his**, because $39.99/year with a
3-day trial produces less per payer than the weekly and monthly plans he was running.

Realistic expectation for month one: **a loss.** Most campaigns lose money before finding a winner,
and yours starts with less headroom than most. The purpose of month one is to learn your real CPI
and your real install→trial→paid rates. If it happens to break even, that's an excellent outcome,
not the baseline.

---

## 8. What to check, when, and where

### 8.1 Which dashboard is authoritative for what

| Dashboard | Authoritative for | Never trust it for |
| --- | --- | --- |
| **TikTok Ads Manager** | Spend, impressions, CPM, CTR, hook/view rates, click→install CVR, per-ad creative performance | Revenue. Anything financial. |
| **Singular** | Cross-network attribution, SKAN cohort reporting, blended CPI/ROAS once the cost connector is added | Real-time anything; per-creative conversion at your volume |
| **RevenueCat** | **Money.** Trials, trial→paid, refunds, MRR, plan mix, price-test results | Attribution — it can't tell you which ad produced a subscriber |
| **In-app funnel counters** (`funnelStore`) | Install→paywall→trial rates unpolluted by attribution | Absolute totals across users |

**Expect the numbers to disagree and do not try to reconcile them.** TikTok's dedicated-campaign
reporting is SKAN-only and partly modelled; Singular reports SKAN plus IDFA-based data; RevenueCat
sees every purchase but no ad. TikTok reporting 9 conversions while RevenueCat shows 6 trials is
normal, not a bug.

### 8.2 Daily (5 minutes, TikTok Ads Manager + RevenueCat)

- [ ] Spend is tracking to budget (a big underspend means the bid or audience is too tight).
- [ ] No ads rejected or in review limbo.
- [ ] Per-ad CTR and CVR — flag anything below the §6.2 floors, don't act until day 4.
- [ ] RevenueCat: trial starts yesterday. This is your real-money pulse.
- [ ] Comment sections on Spark Ads — filters working, nothing that needs a reply.

### 8.3 Weekly (30 minutes)

- [ ] **CPI** for the week, per ad and per concept. Concept-level averages matter more than
      individual ads — 3 of 4 winners in a concept means the *angle* is right.
- [ ] **Cost per trial start** = spend ÷ RevenueCat trial starts. Against the §2.4 targets.
- [ ] **Install→trial rate** = trial starts ÷ TikTok installs. Your user-quality gate.
- [ ] **Trial→paid**, as soon as you have 20+ resolved trials. Replace the §2.2 assumption with it.
- [ ] Plan mix: what share are choosing yearly? Replace that assumption too.
- [ ] Creative fatigue: is a previously winning ad's CPA drifting up 20%+? Queue iterations.
- [ ] Kill / keep / scale pass per §6.3, then don't touch for another 72 hours.

### 8.4 At 30 days — the decision

Rebuild §2's table with your real numbers first. Then:

| If | Then |
| --- | --- |
| Cost per trial ≤ $8 and trial→paid ≥ 25% | It works. Scale per §6.4, add Target Cost per Result + GBBI, keep the creative pipeline at 3–4/week. |
| Cost per trial $8–$15, trial→paid ≥ 25% | Marginal. Do **not** scale spend. Spend the next 30 days on price testing ($39.99 vs $59.99) and onboarding conversion; those move the economics more than ads can. |
| CPI never went below $2.50 across 15+ creatives | Creative isn't the problem anymore — the product's ad-market fit is. Stop TikTok, put the money into Apple Ads and organic creator content. |
| Trial→paid < 15% | The paywall and the trial are the problem, not the traffic. Fix that before spending another dollar; every ad dollar is multiplied by this number. |
| You've spent the $3,000 and are unsure | Stop. Ambiguity after $3,000 at this budget is a result, and the result is "not yet." |

---

## 9. Where the article is outdated or wrong

The article is a good playbook and mostly still applies. These specific points do not.

1. **Goal Based Budget Increase: "20% up to 20 times."** Wrong per TikTok's August 2026 doc. The
   increment is fixed at 20% of the original budget, the cap is **10 increases per day** (3× your
   budget, not 5×), it resets daily, and it requires **goal-based bidding** (Target Cost per Result
   / Target or Minimum ROAS) on a **Smart+** objective with a **daily** budget. It is also
   explicitly "not available to all advertisers." §3.6.
2. **"Use GBBI with Maximum Results."** Impossible. Maximum Delivery is not goal-based bidding, so
   the toggle won't be there.
3. **Bidding strategy names.** The article's "Maximum Results" and "Target Cost Per Result" are now
   **Maximum Delivery** (previously *Lowest Cost*) and **Target Cost per Result** (previously
   *Cost Cap*). TikTok's own docs and account UIs use both generations of naming inconsistently.
4. **"Optimization goal: Subscribe OR Install."** Not a real choice at your budget. §4.
5. **No mention of iOS real-time conversion reporting.** The biggest 2026 change for iOS app
   campaigns, and the article predates it. If your app is eligible, it removes much of the SKAN
   delay the article implicitly plans around. §3.2.
6. **No mention of SKAN crowd anonymity or TikTok's 90-installs/day guidance.** This is the
   constraint that most shapes your structure, and it's the reason to consolidate into one campaign
   and one ad group. §4.
7. **AppsFlyer recommendation.** Irrelevant to you — Singular is wired and working. Do not switch.
8. **"Don't push yearly above $50; it increases refunds."** Possibly true in his categories, but
   for an ad-funded fitness app it is directly at odds with the economics: your CPA headroom scales
   with price, and $39.99 leaves you almost none. Test upward, watching refunds. §2.5.
9. **"Before/after transformation" as a creative format.** Prohibited in TikTok paid ads for
   physical transformation as of 2026. §3.5.
10. **Apple Search Ads.** Renamed **Apple Ads** in April 2025. The $100 new-account credit he
    mentions is still live as of August 2026, with tighter eligibility conditions than the article
    implies (App Store Connect Account Holder, top-level account linkage).
11. **"$50 per creative is enough to test."** Roughly right as a *kill* threshold, and we keep it.
    But it is not enough to *validate* a winner — a creative needs $50+/day for 5+ days before you
    scale on it.
12. **"LTV will likely be $20–30, conservatively set $20."** Do not inherit this. Your Y1 net per
    *payer* is ~$31 blended and your net per *install* is ~$1.11 base-case. Those are different numbers used
    for different decisions, and the second one is the one that constrains your bids.

---

## 10. What is likely to go wrong

Read this before spending, not after.

1. **CPI comes in at $3–5, not $1–2.** The most likely single failure. iOS-only, US-only,
   subscription apps sit at the expensive end of every published range, and new accounts pay a
   premium until the algorithm has signal. At $4 CPI with base conversion you lose roughly $2.90
   per install.
2. **Install→trial comes in under 4%.** CardioSurf requires camera permission, standing up, and
   floor space. Impulse installs from a feed are structurally bad at clearing that bar. This is a
   real risk that generic benchmarks will not warn you about.
3. **The creative doesn't land.** At $20/video you should expect a wide quality distribution and
   some unusable footage. Most creators will produce nothing that beats a $2.50 CPI. Finding one
   winner out of 20 is a normal outcome, and 0 out of 20 happens.
4. **You fly blind for the first week.** SKAN delay plus low volume plus TikTok's 72-hour no-touch
   guidance means the first real read is day 4–7, and a meaningful share of your conversion values
   will be coarse or null. You will be tempted to tinker. Tinkering resets learning.
5. **The cash-flow squeeze.** Spending daily against revenue that arrives 33–63 days later. The
   article's author hit exactly this wall.
6. **Ad rejections on fitness policy.** Weight-management framing is restricted, before/after is
   prohibited, and enforcement is inconsistent. Budget a couple of days for rejection cycles, and
   don't build all 6 ads on one framing.
7. **You scale a false winner.** Three good days at 25 installs/day is well inside noise. Scaling
   on it and then watching CPA double is the most common expensive mistake in paid UA.
8. **The price is simply too low for paid acquisition.** The structural risk. $39.99/year does not
   leave enough room to buy users at market CPIs. It may be that TikTok can never work for
   CardioSurf at this price, and that the correct output of this experiment is a pricing change
   rather than a campaign optimization.

With Meta permanently closed to you, TikTok plus Apple Ads is your entire paid surface. That is a
constraint on your ceiling, not just your volume — which is an argument for treating the App Store
page, onboarding, paywall, and price as first-class growth levers rather than as things you'll get
to after the ads are running. They're free, they compound, and they multiply every ad dollar.

---

## Sources

Consulted 2 September 2026. TikTok's own pages are authoritative; third-party pages are used for
benchmarks TikTok does not publish and are labelled as such in the text.

**TikTok (official)**

- About Smart+ Goal-Based Budget Increase (upd. Aug 2026): <https://ads.tiktok.com/resources/help/article/about-smart-plus-auto-budget-increase-cost-cap-minimum-roas-target-roas>
- Create an Upgraded Smart+ Campaign (Advanced Dedicated Campaign, `postback_window_mode`): <https://business-api.tiktok.com/portal/docs?id=1843312852800706>
- How to create an iOS 14.5+ dedicated campaign: <https://ads.tiktok.com/help/article/how-to-create-an-ios-14-5-dedicated-campaign>
- iOS 14 Performance & Reporting considerations: <https://ads.tiktok.com/help/article/performance-reporting-considerations-ios14-dedicated-campaigns>
- About Budget (upd. July 2026): <https://ads.tiktok.com/help/article/budget>
- Learning phase: <https://ads.tiktok.com/help/article/learning-phase>
- TikTok Ads Manager User Guide (PDF, budget-increase guidance): <https://na.tiktokforbusiness.com/hubfs/ttam/TikTok_Ads_Manager_User_Guide.pdf>

**Apple (official)**

- App Store Small Business Program (15%, effective 15 days after fiscal month of approval): <https://developer.apple.com/app-store/small-business-program/>
- Apple Ads promo credit ($100, eligibility): <https://ads.apple.com/app-store/help/billing/0032-apple-ads-promo-credit>

**Benchmarks and third-party analysis**

- RevenueCat, State of Subscription Apps 2026 — Health & Fitness (trial-to-paid 37.7%, download-to-trial 6.9%, 3-day trial day-0 cancellation 55.4%, ≤4-day trials 25.5%, RPI D14 $0.48 / D60 $0.66, H&F 68% annual): <https://www.revenuecat.com/state-of-subscription-apps-2026-health-and-fitness/>
- Apple fiscal calendar and payment dates 2026 (33 days after fiscal month close): <https://www.revenuecat.com/blog/growth/apple-fiscal-calendar-year-payment-dates>
- Airbridge, cost per trial / cost per subscription for fitness apps (TikTok CPI $1.75–$4.00; blended CPT $20–$40): <https://www.airbridge.io/en/blog/cost-per-trial-cost-per-subscription-subscription-app-ua-metrics>
- RocketShip HQ, TikTok ads for fitness app growth 2026 (CPI $1.20–$2.40, creative formats, fatigue windows): <https://www.rocketshiphq.com/tiktok-ads-fitness-app-growth/>
- Mobile User Acquisition Show, privacy thresholds (TikTok's 90 installs/day figure): <https://mobileuseracquisitionshow.com/episode/privacy-threshold-high-cpa-skadnetwork/>
- Singular, privacy thresholds and crowd anonymity: <https://www.singular.net/glossary/privacy-thresholds/>
- Tenjin, TikTok iOS real-time conversion reporting: <https://tenjin.com/blog/latest-tiktok-feature-available-for-tenjin-advertisers-real-time-conversion-reporting-for-ios/>
- TikTok weight management and body image ad policy, 2026 summaries: <https://tikadtools.com/blog/tiktok-ads-fitness/> and <https://www.accelerateddigitalmedia.com/insights/guide-to-social-media-health-ad-restrictions-2026/>

**Not a source, but the basis of the plan:** Frederick James's $10k/month TikTok playbook, as
pasted into the 29 August 2026 conversation. Engaged with throughout; corrections in §9.

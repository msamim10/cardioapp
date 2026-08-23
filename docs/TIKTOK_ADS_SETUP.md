# TikTok iOS App-Install Ads for CardioSurf (Singular as MMP)

Research current as of **23 August 2026**. Every claim that matters is cited at the
bottom. Where TikTok's own docs disagree with each other about menu names, that is
called out inline rather than smoothed over.

**App:** CardioSurf · bundle `com.cardiosurf.app` · App Store ID `6794463238`
**MMP:** Singular, Managed Mode (`manualSkanConversion: false`)

---

## The five things that actually matter

Read these before anything else. The rest of this document is mechanics.

**1. You do NOT need a new app build.** All five SKAdNetwork IDs already in
`app.json` are correct and complete for TikTok. Verified against vendor docs:

| ID in the app | Owner | Verified |
| --- | --- | --- |
| `mj797d8u6f` | TikTok Ads | ✅ correct and current |
| `238da6jt44` | Pangle (TikTok's audience network) | ✅ correct |
| `22mmun2rn5` | Pangle (second ID) | ✅ correct |
| `v9wttpbfk9` | Meta / Audience Network | ✅ correct |
| `n38lu8286q` | Meta / Audience Network | ✅ correct |

TikTok has exactly two SKAN network identities: the TikTok placement, and Pangle.
Auto-placement draws from both. Both are covered. **Nothing to add, no build
needed.** (Sources: TikTok's campaign quota doc, Pangle's SKAN ID page, Meta's
Audience Network SKAN page, and Adjust's TikTok SKAN article which independently
confirms `mj797d8u6f`.)

**2. Do NOT install TikTok's SDK.** Your instinct is right, and TikTok's own
documentation agrees explicitly. From TikTok's App Events SDK guide, the branch
that applies to CardioSurf:

> "MMP SDK updates the conversion value (CV) and you intend to use the MMP's SKAN
> schema: Turn off SKAdNetwork support in the TikTok SDK and **do not upload a
> schema to TikTok Events Manager**. (Your MMP remains the single source of truth
> for CV updates and schema.)"

TikTok does *permit* a hybrid MMP + SDK setup, but it is not required and it is not
recommended for your case. Singular says the same thing from its side: "You can
only have one SDK managing SKAdNetwork conversion values in the same app."
Installing TikTok's SDK would need a new build **and** would fight Singular for
control of conversion values. Skip it. (Sources: TikTok's Integrate App Events SDK
article, Singular's TikTok SKAdNetwork article.)

**3. TikTok has no equivalent of Meta's "Import from Partner App" URL.** This is a
real difference from what you planned for. Meta pulls a conversion schema from an
MMP-published URL. TikTok does not work that way. Instead:

- Singular's TikTok integration decodes conversion values on TikTok's behalf
  automatically once the partner integration is live (Singular lists "Conversion
  Value Decoding: Supported").
- TikTok Events Manager *does* have a schema upload box — **do not use it.** Per
  the quote in point 2, uploading a schema there when your MMP owns the CV is
  explicitly wrong.
- SKAN 4.0 gets switched on with a single button in TikTok Ads Manager or Events
  Manager, not by importing anything.
- If a TikTok rep ever asks for your mapping, export it from Singular:
  **SKAdNetwork → Model Configuration → ⋮ → Preview Conversion Values** (downloads
  a CSV of values 0–63 and their meanings). That CSV is the closest thing to the
  Meta flow, and it is a human handoff, not an integration.

There is no Singular-published MMP URL for TikTok. (Sources: TikTok's Integrate App
Events SDK article, TikTok's SKAN 4.0 blog post, Singular's TikTok SKAdNetwork
article and SKAN Models FAQ.)

**4. ⚠️ Verify your RevenueCat → Singular revenue link before you trust it.**
This is the one thing in your existing setup I could not confirm is working, and it
could silently mean zero revenue data. RevenueCat's docs carry this warning:

> "Singular requires its Event API v2 endpoint and the Singular Device ID (SDID) for
> Singular accounts created **on or after July 15, 2026**. RevenueCat's Singular
> integration currently only supports the Event API v1 endpoint ... so it **won't
> deliver events for those newer Singular accounts yet**."

Singular confirms the cutoff independently, and adds that SDID "is not compatible
with ... third-party subscription providers (RevenueCat, Adapty)."

Your Singular account is new. Today is 23 August 2026. **If your Singular account
was created on or after 15 July 2026, RevenueCat is delivering nothing at all** —
no trial, no purchase, no revenue.

**This is now handled in the app, and needs no dashboard work.** The app sends
`sng_start_trial` and `sng_subscribe` itself, from the Singular SDK, which is
unaffected by the v1/v2 split: the SDK resolves the SDID during init on its own.
`singularConfig.revenueSource` (or `EXPO_PUBLIC_SINGULAR_REVENUE_SOURCE`) selects
the source, so exactly one of the app and RevenueCat ever reports a purchase.
Leave it on `client`.

Because Singular documents SDID as incompatible with RevenueCat outright, a
support ticket to be moved back to v1 is the *worse* option: it would trade a
working SDK path for a downgraded account. **Leave `revenueSource` on `client`
and only switch it to `revenuecat` if RevenueCat ships v2 + SDID support — and
switch it before enabling their integration, not after.** (Sources: RevenueCat's
Singular integration doc, Singular's Subscription Event guide and S2S EVENT
Endpoint reference.)

**5. Irreversible, get right the first time.** TikTok permanently locks **time
zone, currency, country/region, and legal business name** at ad-account creation.
TikTok's own FAQ: "Time zone, country/region, and currency cannot be edited. We
suggest that you create another account." Also note TikTok's **legacy MMP
integration was discontinued 31 March 2025** — new apps must use the **SAN**
integration, and the legacy option will appear greyed out. (Sources: TikTok's
account setup FAQ, Ad Account Information FAQ, and SAN integration article.)

---

## Part A — Before any spend

### Phase 1: TikTok account (Steps 1–4)

**Step 1 — Create the account.** Go to `ads.tiktok.com`, click **Get Started**.
Sign up with email or phone, verify with the code.

**Step 2 — Fill in business info. STOP AND CHECK THIS SCREEN.** You will be asked
for: Country/Region, Currency, Time Zone, Account Name, Contact Name, Email, and
**Company website** (required — TikTok will not approve an account without a real
website; a social profile does not count). Then click **Register**.

Time zone, currency, country and business name are **permanent**. Pick the time
zone your reporting day should roll over in, and the currency you actually want to
be billed and reported in. Getting this wrong means abandoning the account.

**Step 3 — Wait for account review.** Most reviews complete in **under 24 hours**;
you get an email. Check status at **Tools → Settings → Account setup**. If it is
still not approved after 24h, fix your business details and click **Request
review**; if still rejected, raise an Account Review ticket within 3 working days.

Business verification is a *separate* gate and can take **up to 2–3 business days**.
Ad review is a *third* separate gate that happens per-creative after you build ads.
Budget roughly **1–3 days** end to end, more if verification documents get queried.

**Step 4 — Add a payment method.** Required before anything can deliver. Options
vary by country (card, or manual top-up).

### Phase 2: Register CardioSurf with TikTok (Steps 5–7)

> **Menu-name warning.** TikTok's own help articles disagree here. The SAN
> article says **Tools → Events**. The TikTok App ID article (updated June 2026,
> the newest source) says **Tools → Events Manager**. Third-party guides say
> **Assets → Events**. They are the same destination. Hover **Tools** in the top
> bar and look for whichever of *Events* / *Events Manager* exists in your account.

**Step 5 — Connect the app.**

1. Log in to **TikTok Ads Manager**.
2. **Tools → Events** (or **Events Manager**).
3. Click **Connect data source**.
4. Select **App**.
5. Enter the App Store URL: `https://apps.apple.com/app/id6794463238`
6. Select **Singular** as your Mobile Measurement Partner, and choose the
   **TikTok for Business (SAN)** integration option.

The **TikTok for Business legacy integration will be greyed out** — that is
correct and expected, not an error.

**Step 6 — Confirm there is nothing to configure on TikTok's side.** TikTok's SAN
article lists per-MMP requirements. Adjust needs a link token, Branch needs a key,
Kochava needs an App GUID. For **Singular: "No additional configuration
required."** There is no URL or token to paste. If TikTok's UI asks you for one,
something is wrong — stop and check you picked Singular + SAN.

**Step 7 — Generate the TikTok App ID.** You must be an **Admin** of the ad
account for this option to appear.

1. **Tools → Events Manager**
2. Click on your app
3. Click **Tracking Settings**
4. Click **Copy the TikTok App ID**

Keep this on your clipboard for Step 8. It is not the same as your App Store ID or
your ad account ID. It will show **Pending Verification** — that is expected and
resolves in Step 15.

### Phase 3: Connect Singular to TikTok (Steps 8–11)

**Step 8 — Create the partner configuration in Singular.**

1. In Singular: **Attribution → Partner Configuration** → **Add a Partner**
2. Type "TikTok" and select **TikTok Ads**
3. Select the CardioSurf app and app site (the iOS one)
4. In the **TikTok App ID** box, paste the ID from Step 7

There is no OAuth and no API key for the attribution side. (Separately, **Data
Integrations → Data Connectors** with a TikTok OAuth login is how you pull *cost*
data for spend reporting — worth doing, but it is not required to launch and is
listed as optional in Part C.)

**Step 9 — Set the attribution settings.** Singular and TikTok jointly recommend:

| Setting | Set to | Why |
| --- | --- | --- |
| Include View-Through Attributions | **Enable** | Attribute on impressions as well as clicks |
| Include Re-Engagement Attributions | **Enable** | Needed later for retargeting |
| Send event postbacks to TikTok for all Installs | **Enable / "Send All"** | **Required** to verify your app (Step 15) |

**Step 10 — Set attribution windows to match TikTok's defaults.** This is what
prevents the reporting discrepancies you will otherwise spend a week chasing:

- **Click-through (install) lookback: 7 days** — TikTok's recommended alignment
- **View-through (install) lookback: 1 day** — TikTok's recommended alignment
- Re-engagement click-through: 7 days; re-engagement view-through: 1 day

These figures are TikTok's stated recommendations, documented in AppsFlyer's and
Branch's TikTok setup pages (both MMPs publish the same numbers, which is good
cross-confirmation). Singular's own article gives the toggles but not the numeric
windows, so match the 7d/1d convention.

Even with perfect alignment, **expect residual discrepancy**. TikTok says so
directly: its dedicated-campaign reporting is SKAN-only, while Singular reports
both SKAN and IDFA-based data. Do not treat a gap as a bug.

**Step 11 — Map the events.** In the **Events Postbacks** section of the same
partner configuration, map each Singular SDK event to a TikTok SAN event name.
TikTok's supported list is fixed — there is no `CompleteRegistration`, it is
`Registration`. Recommended mapping:

| CardioSurf event (Singular) | TikTok event name | Notes |
| --- | --- | --- |
| `sng_complete_registration` | `Registration` | Account created |
| `onboarding_complete` | `CompleteTutorial` | First calibration — closest semantic fit |
| `first_run_complete` | `UnlockAchievement` | First workout ever |
| `run_complete` | `AchieveLevel` | Every workout; the retention signal |
| `paywall_viewed` | `ViewContent` | |
| `sng_start_trial` | `StartTrial` | **The key optimisation event** |
| `sng_subscribe` | `Subscribe` | Trial → paid |

`onboarding_complete`, `first_run_complete` and `run_complete` have no exact
TikTok equivalent; the mappings above are reasoned fits, not official
prescriptions. What matters is that they are mapped to *something* and that you
stay consistent, because TikTok can only optimise toward names on its list.
Singular is explicit that **every event used in your conversion model must also be
mapped here.**

### Phase 4: The Singular conversion model (Steps 12–14)

> **⚠️ Get this right before launch.** Changing the settings of an *active* model
> triggers a migration that takes **48 hours**, of which the **first 24 hours
> record no conversion values at all — that data is permanently lost.** Singular's
> exact words: "No conversion values are sent or recorded for 24 hours.
> Measurement data is lost." Configuring a model *before* any campaign runs costs
> nothing. Changing it after launch costs two days of blind spend.

**Step 12 — Create the model.** Singular: **SKAdNetwork → Model Configuration** →
select CardioSurf → **Add Conversion Model**.

**Step 13 — Recommended configuration for CardioSurf.**

**Measurement period: 3 days.** This matches your free-trial length, and Singular's
own guidance is to "select the shortest measurement period possible" that still
captures the ideal journey. A 3-day period reserves 2 of the 6 bits for retention
tracking (3 needs 2 bits in binary), leaving **16 usable conversion values** — ample
for this funnel.

**Model type: Funnel.** CardioSurf has a genuinely ordered journey, which is
exactly the condition where a Funnel model beats a Conversion Events model — it
encodes one step per value instead of burning one bit per event. Suggested steps,
lowest to highest:

1. `sng_complete_registration`
2. `onboarding_complete`
3. `first_run_complete`
4. `paywall_viewed`
5. `sng_start_trial`  ← the real quality signal
6. `sng_subscribe`

**Do not put `sng_subscribe` at the top and expect to see it.** Two independent
constraints work against it: a 3-day trial converts to paid on day 3+, right at
the edge of the measurement period; and in Managed Mode the Singular SDK must
actually run in the app to push the updated value to Apple, so a user who does not
reopen CardioSurf never gets their value raised. Singular warns that even a 7-day
period may only report 2 days of activity for this reason. **Treat
`sng_start_trial` as your practical optimisation target and `sng_subscribe` as a
bonus when it lands.**

Before saving, expand **Analyze Model** to see a simulated report against your real
data. Then toggle the model **On** and click **Submit** / **Save**.

**Step 14 — Set up the SKAN 4.0 coarse schema.** TikTok specifically calls this
out: MMPs auto-copy your existing schema into a SKAN 4 *fine-grained* schema, but
you must **confirm a coarse schema exists**. Without it you get high null rates and
lose the 2nd and 3rd measurement windows (TikTok exposes 2 / 7 / 35-day windows
under SKAN 4).

Singular supports SKAN 4 and the React Native SDK is on Managed Mode by default, so
this should be a dashboard check rather than new work. Note that Singular's newer
**SKAN 4 Funnel** model (which allows revenue buckets *inside* the funnel) is
flagged in Singular's docs as **beta, requiring you to contact your Customer
Success Manager** — so the plain Funnel model above is the safe launch choice.

### Phase 5: Verify before spending (Steps 15–17)

**Step 15 — The single best pre-spend check: the "Verified" badge.** This is
genuine end-to-end proof that Singular is successfully posting to TikTok, because
the badge is set by TikTok when it receives real data from Singular.

With "Send All" unattributed events enabled (Step 9), open CardioSurf on a real
device and trigger some events. Then in **TikTok Events Manager**, watch your app's
status change from **Pending Verification** to **Verified**. Singular: "Once TikTok
receives the first event, your app will be verified and you can start running
campaigns."

TikTok recommends leaving unattributed events on permanently, and you *must* have
them on for iOS-dedicated campaigns. Leave them on.

**Step 16 — Verify Singular is receiving events. Not with TestFlight.** You were
already sent down this path once, so to be explicit about why: Singular's Testing
Console **does not support TestFlight builds**, because TestFlight resets the IDFV
on every launch and the console keys off a fixed device ID. It is documented as
incompatible. It is not a matter of trying harder.

What actually works:

- **A development build run from Xcode, or an ad-hoc / internal-distribution
  build** — IDFV stays stable, so the Testing Console works normally. Log the IDFV
  in a debug build, paste it into the Testing Console under a device name, and
  confirm the 🟢 **Live** indicator. Note the console is **live-only** — it shows
  no history, so events must fire while you are watching.
- **The Singular Device Assist app** (iOS) to read identifiers off a device.
- **Export Logs** — dashboard-side, works regardless of build type, available
  after roughly **1 hour**. This is your TestFlight-safe option. It also has an
  **App Tracking Transparency status** field: value `0` (Undetermined) means the
  ATT prompt never appeared. Worth confirming, since your prompt fires at the end
  of onboarding and some users will quit before reaching it.
- **SDK Audit / SDK Console** in the Singular dashboard for integration health.

**Step 17 — Verify revenue specifically.** Make a sandbox purchase, then look in
**Export Logs** for the events. Expect:

- a **`sng_start_trial`** event when the purchase starts a free trial. It carries
  no revenue amount by default — Singular's own subscription guide prescribes a
  plain event here, because the trial has produced no money yet. If TikTok
  insists on a dollar value on trial starts, set
  `EXPO_PUBLIC_SINGULAR_TRIAL_START_REVENUE=price`, accepting that a converting
  trial then counts its price twice.
- a **`sng_subscribe`** event carrying revenue when a purchase is paid outright.

Both come from the app's own Singular SDK, so a sandbox SDK key in RevenueCat's
integration settings is irrelevant to them. Note Export Logs takes about an hour,
and that the app must be open for the SDK to send — the SDK cannot see a trial
convert to paid days later while the app is closed.

---

## Part B — Launching the campaign

**Step 18 — Create an iOS-dedicated campaign.** Without the dedicated toggle you
can only target **up to iOS 14.4**, which is effectively nobody.

1. **Campaign** tab → **Create**
2. Objective: **App promotion**, then **App install**
3. Turn **on** the **iOS 14.5+ dedicated campaign** toggle
4. Select CardioSurf from the iOS app list

The toggle's exact label varies by source between "iOS 14.5+ dedicated campaign"
and "iOS 14+ Dedicated Campaign" — TikTok's own February 2025 help article says
**iOS 14.5+ dedicated campaign**, so trust whatever wording appears next to a
toggle on that screen. It is the only toggle there.

Notes: **Split testing is not available** for dedicated campaigns (except in beta,
where it consumes 2 of your 15 slots). Only *App promotion → App install* and
*Product sales → Catalog* support dedicated campaigns.

**Step 19 — Budgets.** TikTok's floors, from its official budget doc:

- **Campaign daily budget: must exceed $50**
- **Ad group daily budget: must exceed $20**
- Lifetime at ad group level = $20 × scheduled days (a 31-day ad group needs $620)

⚠️ **You cannot switch between daily and lifetime budget after a campaign or ad
group goes live.** Choose daily unless you have a reason not to.

These are floors, not strategy. Practitioner consensus (not official TikTok
guidance — treat as a rule of thumb) is that a genuine test needs roughly $500+
total, and daily budget in the region of 20× your target cost per install for the
algorithm to have anything to learn from.

**Step 20 — Structure and the learning phase.** This is where TikTok differs from
Meta most expensively:

- **Quota: 15 iOS dedicated campaigns for TikTok + 15 for Pangle**, 5 ad groups
  each. More generous than Meta's nine. But the ceiling has teeth: after hitting
  the limit you must **wait at least 72 hours** after pausing/deleting a campaign
  before the slot frees up. Do not churn campaigns.
- **Use auto-placement.** TikTok explicitly recommends it as "a more efficient use
  of the 15 campaign limit," and it covers Pangle (including playable ads) without
  a second campaign. Your Pangle SKAN IDs are already in the build, so
  auto-placement is safe.
- **Do not touch anything for 72 hours.** TikTok's stated recommendation: "We
  recommend not making any campaign adjustments in the first 72 hours after
  launching the iOS 14 or higher campaign **and after each subsequent
  adjustment**." SKAN postbacks are delayed 24–72h; edits before then mean you are
  reacting to noise. If you are used to Meta's faster feedback, this will feel
  broken. It is not.
- **Consolidate geographies** into one campaign where cost tiers are similar —
  more volume per campaign means fewer privacy-threshold nulls and more granular
  SKAN data.

**Step 21 — Creative.** TikTok is creative-led in a way Meta is not; the creative
wins or loses the auction.

- **9:16 vertical, 1080×1920.** 1:1 and 16:9 are accepted but letterbox and
  underperform — they read as repurposed and reach is degraded.
- **In-feed auction ads run 5s to 10 minutes**; the direct-response sweet spot is
  widely reported as **9–15 seconds** (some sources say 15–30s for
  explanation-heavy products — for a fitness app demo, test both).
- MP4/MOV, H.264, ≤500MB, ≥516 kbps, 30fps.
- Ad description 1–100 characters; brand name 2–20.
- Consider **Spark Ads** (promoting real organic posts) — native-feeling and
  generally the strongest performer for app installs.
- Each ad gets its own review, usually **under 24 hours**. Editing creative, links
  or target location **re-triggers review**, so avoid nudging ads repeatedly.

Creative specs above are cross-checked across several current aggregator sources
rather than a single TikTok page, because TikTok's canonical spec article moved;
verify final numbers in the Ads Manager upload dialog, which enforces them live.

---

## Part C — Can wait until after launch

- **Cost/spend data into Singular** — **Data Integrations → Data Connectors**, add
  **TikTok Ads**, complete the TikTok OAuth flow. The authenticating user must
  already have permission on the advertiser account (**TikTok Business Center →
  Accounts → View → Manage Permissions**). Nice for unified ROAS reporting; not
  needed to launch.
- **TikTok Business Center** — only useful if you add teammates or an agency.
- **Retargeting / re-engagement campaigns** — the re-engagement toggle is already
  enabled in Step 9, so the data will be there when you want it.
- **In-app ad revenue** — not applicable to CardioSurf (subscription-only). For
  the record, it would require mapping `__ADMON_USER_LEVEL_REVENUE__` to
  `ImpressionLevelAdRevenue` and notifying your TikTok contact.
- **Model iteration** — you may eventually want a Mixed (Funnel + Revenue) or
  SKAN 4 Funnel model. Remember every change costs 48h with 24h of lost data.

---

## Build vs. dashboard, at a glance

| Task | Needs a new build? |
| --- | --- |
| Everything in Parts A, B and C above | **No** |
| SKAdNetwork identifiers | **No — already correct and complete** |
| Conversion model / measurement period | No — Managed Mode, server-side |
| Event → TikTok name mapping | No — Singular dashboard |
| Fixing RevenueCat revenue (if broken) | No — Singular support ticket |
| Installing TikTok's SDK | Yes — **and you should not do it** |

The in-code conversion ladder in `src/lib/conversionValue.ts` stays inert, which is
correct for Managed Mode. Leave it alone; it costs nothing and is the escape hatch
if you ever switch to manual mode.

---

## Where I am not certain

Stated plainly, since you have already lost time to a confident wrong answer:

1. **Menu naming.** TikTok's help centre is internally inconsistent about
   *Tools → Events* vs *Tools → Events Manager* vs *Assets → Events*, and its
   articles carry different "last updated" dates (Feb 2025 through June 2026).
   Navigate by hovering **Tools** and looking for the closest match.
2. **Attribution window numbers.** The 7-day click / 1-day view recommendation is
   documented on AppsFlyer's and Branch's TikTok pages as TikTok's stated
   preference. Singular's own TikTok article documents the toggles but not the
   numbers. I am confident in 7d/1d; I could not find it on a TikTok-owned page.
3. **Event mappings for `onboarding_complete`, `first_run_complete`,
   `run_complete`.** TikTok's list has no fitness-shaped events. My suggestions
   are reasoned, not authoritative.
4. **Whether your RevenueCat link works.** I established the risk precisely but
   cannot see your Singular account creation date. Step 15/17 resolves it.
5. **Creative duration guidance.** "9–15 seconds" is practitioner consensus across
   multiple 2026 aggregators, not a figure I could pull from a live TikTok page.
6. **TikTok's behaviour during a Singular model migration.** Singular documents
   that *Facebook* pauses campaigns for 72 hours when a conversion model changes.
   It says nothing about TikTok. Assume disruption, do not assume it is identical.

---

## Sources

**TikTok (official)**

- How to integrate to SAN for new apps: <https://ads.tiktok.com/help/article/integrate-to-san-for-new-apps>
- How to generate a TikTok App ID (upd. June 2026): <https://ads.tiktok.com/help/article/tiktok-app-id>
- List of supported events by Singular: <https://ads.tiktok.com/help/article/list-of-supported-events-by-singular>
- How to turn on unattributed events in Singular: <https://ads.tiktok.com/help/article/how-to-turn-on-unattributed-events-in-singular>
- Required information to set up your account: <https://ads.tiktok.com/help/article/account-setup-faq>
- Ad Account Information FAQs: <https://ads.tiktok.com/help/article/ad-account-information-faq>
- Account Approval FAQs: <https://ads.tiktok.com/help/article?aid=14122>
- About Budget (upd. July 2026): <https://ads.tiktok.com/help/article/budget>
- About daily budgets: <https://ads.tiktok.com/help/article/about-daily-budgets>
- How to create an iOS 14.5+ dedicated campaign: <https://ads.tiktok.com/help/article/how-to-create-an-ios-14-5-dedicated-campaign>
- iOS 14 Dedicated Campaign Quota Updates: <https://ads.tiktok.com/resources/help/article/about-ios-14-dedicated-campaign-quota-updates>
- iOS 14 Performance & Reporting: <https://ads.tiktok.com/help/article/performance-reporting-considerations-ios14-dedicated-campaigns>
- Integrate App Events SDK (the "do not upload a schema" quote): <https://ads.tiktok.com/help/article/how-to-integrate-tiktok-app-events-sdk>
- SKAN 4.0 on TikTok Ads Manager (blog): <https://www.tiktok.com/business/en/blog/skan-4-ios-tiktok-ads>

**Singular (official)**

- TikTok Ads Attribution Integration: <https://support.singular.net/hc/en-us/articles/7175569172891-TikTok-Ads-Attribution-Integration>
- TikTok For Business SKAdNetwork Integration: <https://support.singular.net/hc/en-us/articles/360060276171-TikTok-For-Business-SKAdNetwork-Integration>
- SKAN Models and Model Configuration FAQ (48h migration, measurement period): <https://support.singular.net/hc/en-us/articles/360052605611-SKAN-Models-and-Model-Configuration-FAQ>
- Understanding Conversion Value Management: <https://support.singular.net/hc/en-us/articles/360051200231-Understanding-Singular-s-Conversion-Value-Management>
- SKAdNetwork Reports FAQ: <https://support.singular.net/hc/en-us/articles/4408232000795-SKAdNetwork-Reports-FAQ>
- React Native SDK, Supporting SKAdNetwork: <https://support.singular.net/hc/en-us/articles/360049022091-React-Native-SDK-Supporting-SKAdNetwork>
- How to Test Your SDK Integration (TestFlight limitation): <https://support.singular.net/hc/en-us/articles/360002675072-How-to-Test-Your-Singular-SDK-Integration>
- Subscription Event Technical Implementation Guide: <https://support.singular.net/hc/en-us/articles/30301510608283-Subscription-Event-Technical-Implementation-Guide>
- S2S EVENT Endpoint API Reference (the 15 July 2026 V2 cutoff): <https://support.singular.net/hc/en-us/articles/31496864868635-Server-to-Server-EVENT-Endpoint-API-Reference>

**SKAdNetwork identifier verification**

- Pangle — SKAdNetwork IDs (`238da6jt44`, `22mmun2rn5`): <https://www.pangleglobal.com/resource/27851>
- Meta — SKAdNetwork for Audience Network (`v9wttpbfk9`, `n38lu8286q`): <https://developers.facebook.com/documentation/audience-network/setting-up/platform-setup/ios/SKAdNetwork>
- Adjust — TikTok SKAdNetwork integration, confirming `mj797d8u6f`: <https://help.adjust.com/en/article/skadnetwork-tiktok-for-business-integration>

**Other MMPs, used only to cross-check TikTok's recommended attribution windows**

- RevenueCat — Singular integration (SDID warning): <https://www.revenuecat.com/docs/integrations/attribution/singular>
- AppsFlyer — TikTok Advanced SRN setup: <https://support.appsflyer.com/hc/en-us/articles/6722785184913-TikTok-for-Business-Advanced-SRN-integration-setup>
- Branch — Enable TikTok For Business: <https://help.branch.io/v1/docs/enable-tiktok-for-business>

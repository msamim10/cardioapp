# CardioSurf — App Store Submission Packet

Everything below is ready to paste into App Store Connect. Fill the two `<…>` placeholders (your phone + email) in App Review Information.

---

## App Information
- **Name:** CardioSurf: Cardio Game
- **Subtitle:** Move to play. Cardio, gamified
- **Bundle ID:** com.cardiosurf.app
- **Primary Category:** Health & Fitness
- **Secondary Category:** Games
- **Age Rating:** 4+

---

## Promotional Text (≤170 chars)
Your body is the controller. Dodge, jump and duck through themed worlds, build your streak, and cast to your TV. Every workout feels like a game you actually want to play.

---

## Description
Your body is the controller.

CardioSurf turns cardio into a game you actually want to play. Stand a few feet from your iPhone, and the front camera tracks your movement in real time — jump, duck, lean left and lean right to surf through fast, vibrant endless-runner worlds. No dumbbells, no treadmill, no boring reps. Just move.

Pick a world, pick your intensity, and go. The faster you level up, the faster the run — so a light warm-up and a lung-busting sprint session live in the same app.

WHY YOU'LL KEEP COMING BACK
- Play by moving your body. On-device motion tracking reads your jumps, ducks and side-steps as game controls — your workout IS the gameplay.
- Themed worlds. Race through neon subway dashes, dino escapes, jungle chases, icy canyons and beat-driven runs. Fresh worlds drop regularly.
- Three intensity classes. Beginner, Intermediate and Hard change the pace — higher classes run faster for a bigger burn and bigger rewards.
- Campaign paths. Follow the path, clear each level to unlock the next, and complete a whole world.
- Streaks, XP, coins and levels. Build a daily streak, hit your weekly goal, earn coins and climb the leaderboard.
- Cast to your TV. AirPlay the run to the big screen while your phone becomes a live form-preview and stats dashboard.
- Meet the fox. Your CardioSurf mascot hypes every run.
- Friendly reminders. Optional nudges keep your streak alive (all handled on your device).

MADE TO ACTUALLY MOVE YOU
Every run counts your active minutes and estimated calories, tracks your best combos, and remembers your progress across sessions. Short on time? Most worlds run just a few minutes — perfect for a quick sweat before work or a living-room energy boost.

CARDIOSURF PRO
CardioSurf is free to download and try. CardioSurf Pro unlocks every world and level, all intensity classes, unlimited runs and full rewards — with new worlds added regularly.

- Monthly: $14.99 / month
- Yearly: $39.99 / year, including a 3-day free trial

Subscriptions are auto-renewable. Payment is charged to your Apple ID at confirmation of purchase. Your subscription automatically renews unless it is canceled at least 24 hours before the end of the current period, and your account will be charged for renewal within 24 hours before the end of the current period. You can manage or cancel your subscription anytime in your App Store account settings; any unused portion of a free trial is forfeited when you purchase a subscription.

Terms of Use: https://cardiosurf.github.io/terms.html
Privacy Policy: https://cardiosurf.github.io/privacy.html

Move more. Sit less. Have fun doing it.

---

## Keywords (≤100 chars)
cardio,workout,fitness,exercise,hiit,run,runner,move,endless,calories,burn,gym,active,home,streak

---

## URLs
- **Support URL:** https://cardiosurf.github.io/support.html
- **Marketing URL (optional):** https://cardiosurf.github.io/
- **Privacy Policy URL:** https://cardiosurf.github.io/privacy.html

---

## Screenshots (iPhone 6.9", 1320 × 2868, RGB, no alpha)
Location: `~/Desktop/cardiosurf-screenshots/` — upload in this order:
1. appstore-1-hero — "Your body is the controller"
2. appstore-2-workout — "Move to play. Cardio, gamified."
3. appstore-3-home — "Build your streak"
4. appstore-4-worlds — "Pick your world"
5. appstore-5-summary — "Every move counts"

This one 6.9" set auto-scales to all smaller iPhones. (App is iPhone-only — no iPad screenshots required.)

---

## App Privacy ("nutrition labels")
"Do you collect data from this app?" → **Yes**

**Data Used to Track You:** None (no ads, no ATT, no cross-app tracking).

**Data Linked to You** (all used for App Functionality only):
- Contact Info → Email Address (Firebase Auth account)
- Contact Info → Name (from Google/Apple sign-in)
- Identifiers → User ID (Firebase UID / RevenueCat app user ID)
- Purchases → Purchase History (subscription status via RevenueCat)
- Health & Fitness → Fitness (workout runs, calories, streaks)
- User Content → Customer Support (in-app Help & Support message form)
- Usage Data → Product Interaction (progress/level completion)

**Data NOT collected:**
- Camera / Photos / Video — motion tracking runs 100% on-device (Apple Vision, keypoints only); no image/video is transmitted.
- **User Content → Photos or Videos — NOT collected.** "Record my run" (opt-in, off by default) records the user's camera and composes a share video, but the file never leaves the device unless the user saves it to Photos or shares it through the system share sheet. Apple's definition of "collected" is data transmitted off the device to the developer or a third-party SDK; on-device-only processing that the user exports themselves is not collection. Keep the answer **No** — but the Review Notes must disclose the recording (below), and `NSCameraUsageDescription` / `NSPhotoLibraryAddUsageDescription` in `app.json` already describe it.
- Location, Diagnostics, Crash data — not collected (no analytics/crash SDK).

**Owner action when shipping run recording (docs/RUN_RECORDING.md):**
1. App Privacy → leave "Photos or Videos" unchecked (reasoning above). If you later add any upload of run videos (cloud share links, moderation), change this to *Collected, Linked to You, App Functionality* before submitting that build.
2. Re-read the camera permission string in App Store Connect's screenshots/preview if it appears in marketing material — it no longer says "never recorded".
3. Update the Review Notes with the sentence below.

---

## App Review Information

**Sign-In required:** Yes
- **Username:** appreview@cardiosurf.app
- **Password:** CardioReview2026!

**Contact Information:**
- First name: Mansoor
- Last name: Samim
- Phone: <your phone>
- Email: <your email>

**Review Notes:**
Thanks for reviewing CardioSurf!

HOW THE APP WORKS
CardioSurf is a movement-based cardio game. Stand a few feet from the device in a clear space. The front camera is used for on-device full-body motion tracking (Apple Vision) so your jumps, ducks and side-steps control an endless-runner game; by default only skeletal keypoints are processed on-device in real time and no video is stored. There is an optional, off-by-default "Record my runs" toggle in Settings (Profile) and in the run settings sheet: when the user turns it on, the camera video of each finished run is recorded to the device and composed locally into a silent share clip (game on top, camera below). Clips stay on the device (Profile → Clips keeps the latest ten) — they are never uploaded by the app — and are only exported if the user taps "Save to Photos" (add-only Photos permission) or "Share" (system share sheet). No microphone access is requested.

GETTING STARTED
1. Sign in with the provided demo account (appreview@cardiosurf.app).
2. This account has full CardioSurf Pro access already granted, so all worlds, levels and features are unlocked for your review — no purchase required.
3. From Home or Worlds, pick any world and tap to start a run. Allow the camera permission when prompted. Move your body (jump/duck/lean) to play; a live form-preview shows your tracked pose.
4. The run summary shows calories, XP, coins and combos.

SUBSCRIPTIONS
CardioSurf Pro is an auto-renewable subscription (Monthly $14.99 / Yearly $39.99 with a 3-day free trial) that unlocks all content. The demo account above is pre-granted Pro so you can review all content without purchasing.

TO VIEW AND TEST THE IN-APP PURCHASE / PAYWALL: sign out of the demo account and create a new account with any email (open registration on the sign-up screen). A new account starts as a free user, so attempting to start any locked world will immediately present the paywall showing the Monthly and Yearly subscriptions (Yearly includes a 3-day free trial). You can complete the purchase there via the standard StoreKit flow.

OTHER NOTES
- The app enables background audio so a workout can continue playing/casting to a TV via AirPlay when the screen locks. AirPlay/TV casting is optional.
- Account deletion is available in Profile.

---

## Release 1.1.0 (build 28)

Build 28 supersedes build 27 (which supersedes 26, 25 and 24; none shipped to
users). Build 28 carries the 3-second calibration hold followed by four quick
guided moves (no fail state), spoken coaching, the level brief with the cover
stat row and Top runners card, instant leaderboards (no empty state or
spinner), the clips library and the home / board polish. Over build 27 it
drops the in-run warm-up overlay (the run has no prompts over the video),
puts the home header on one row (long usernames truncate, no freeze text),
reorders Home (Recommended → This week → Today's board), fixes the clipped
"Pick your first run" cards, and shows placeholder per-move counts on the
summary while the real counts are tuned. If 1.1.0 is already "Waiting for
Review" with an earlier build, swap the build to 28 in ASC before it enters
review. Backend is
deployed (Functions `startRun` / `submitRun` / `reserveUsername` /
`onUserDeleted` / `reconcileGhosts*` / `rebuildConsensusBeatmaps*` on Node 22,
Firestore rules + indexes, TTL on `entries.expiresAt`) and the 13 composite
game clips are live under `composite/<slug>/game-576.mp4`, so "Record my run"
is enabled on every map.

**Known state at submission:** boards are live on every map. Charts are
derived from real players' moves (`docs/LEADERBOARDS.md` → "Consensus
charts"): until a map has one, runs on it post as *early* scores
(plausibility-checked by the backend, shown like any other entry); once ≥ 3
runs exist the chart is built automatically and new runs are fully verified.
The client never mentions charts or beatmaps. Usernames, public profiles,
Find friends / follow, the Beat-my-score share card and challenge links all
work today.

### What's New in 1.1.0 (paste into App Store Connect)

```
Record my run, climb the ranks, and make every workout count.

RECORD MY RUNS
Flip on "Record my runs" — in Settings or in the pre-run edit sheet — and CardioSurf builds a shareable clip of every run you finish: the map on top, you below, with your score, combo and every PERFECT lighting up as you hit it. It's made entirely on your phone — nothing is uploaded unless you save it to Photos or share it yourself. Your clips are kept in Profile → Clips. Off by default.

LEADERBOARDS, FRIENDS AND CHALLENGES
- Pick a username and set up your public runner profile.
- Find friends by username and follow them to see how you stack up.
- Beat my score: share a challenge card straight from your summary. Friends tap the link and land on the exact map to take their shot.
- Post your score to Global, Friends and Today boards on every map, and take on the daily challenge for a bonus. Ranked scoring is live and gets sharper as more people play each map.

LEVEL UP
- 50 runner levels with rewards along the way, and a new HUD theme to unlock as you climb.
- XP and coins now scale with how well you run, not just how long.
- Campaign gates, streak freeze and a daily challenge bonus keep the path moving.

BETTER TRACKING FROM THE FIRST SECOND
- Calibration is now a ~3-second hold followed by four quick guided moves — jump, duck, left, right — to get you into the controls. Nothing to pass or retry; spoken coaching walks you through it, and it's remembered, so you don't redo it on every map.
- Leaderboards open instantly on every map, with the top runners right on the level brief.
- Faster, smoother pose tracking under the hood.

Plus fixes and polish throughout. Move more, sit less, and show us your best run.
```

(≈1,850 characters; limit is 4,000.)

### Review Notes for 1.1.0 (replace the existing notes)

```
Thanks for reviewing CardioSurf 1.1.0!

DEMO ACCOUNT
Sign in with appreview@cardiosurf.app / CardioReview2026!. This account already has CardioSurf Pro, so every world, level and feature is unlocked — no purchase needed.

HOW THE APP WORKS
CardioSurf is a movement-based cardio game. Stand a few feet from the device in a clear space. The front camera runs on-device full-body motion tracking (Apple Vision) so jumps, ducks and side-steps control an endless-runner game. By default only skeletal keypoints are processed in real time and no video is stored or sent anywhere. Before the first workout a ~3-second calibration hold runs (the player stands in frame and holds still; spoken prompts guide them into position), followed by four quick guided moves — jump, duck, left, right — shown one at a time for about 2.5 seconds each. These are a walkthrough of the controls, not a test: each prompt passes on its own if the player does not move, there is no fail or retry state, and a Skip button is always available. The result is remembered, so it does not repeat on every map.

NEW IN 1.1.0 — "RECORD MY RUNS" (optional, off by default)
The "Record my runs" toggle is off by default and lives in Settings (Profile) and in the pre-run edit sheet. When the user turns it on, the camera video of each finished run is recorded to the device and composed locally into a silent share clip (game on top, camera below, with the score HUD); the latest ten are listed under Profile → Clips. The clip never leaves the device — the app does not upload it — and is only exported if the user taps "Save to Photos" (add-only Photos permission, NSPhotoLibraryAddUsageDescription) or "Share" (system share sheet). No microphone access is requested. The camera permission string discloses this recording.

NEW IN 1.1.0 — LEADERBOARDS, PROFILES AND CHALLENGES
Users pick a username (Profile → Leaderboards → Username), can find and follow other runners, and can share a "Beat my score" card that deep-links into the level (https://cardiosurf.com/l/... and cardiosurf://). Per-level boards and score submission are verified by our backend (Cloud Functions); boards are live on every map. Scores posted before a map's timing chart exists are accepted after server-side plausibility checks and are shown like any other entry. Nothing about the camera or video is involved in leaderboards — only the score, accuracy, combo and the timing of detected moves (no images) are sent.

SUBSCRIPTIONS / PAYWALL
CardioSurf Pro is an auto-renewable subscription (Monthly $14.99 / Yearly $39.99 with a 3-day free trial). The demo account is pre-granted Pro. To see the paywall: sign out and create a new account with any email (open registration). A free account is shown the paywall when starting a locked world; it can be dismissed with the Close (X) button or "Maybe later", so the reviewer is never blocked. Purchase completes through the standard StoreKit flow.

OTHER NOTES
- Background audio is enabled so a workout can keep playing / casting to a TV via AirPlay when the screen locks. AirPlay is optional.
- Account deletion is available in Profile (it also removes the user's leaderboard entries, username and public profile).
- Sign in with Apple and Google Sign-In are both offered.
```

### ASC checklist for 1.1.0 (owner)

1. App Store Connect → CardioSurf → **+ Version** `1.1.0` → **Build**: select **28**.
2. **What's New**: paste the block above.
3. **App Review Information → Notes**: replace with the 1.1.0 notes above.
   Sign-in required stays **Yes** with `appreview@cardiosurf.app`.
4. **App Privacy**: no change needed for run recording — keep *Photos or
   Videos* **not collected** (reasoning in the App Privacy section above;
   the file never leaves the device). `NSPhotoLibraryAddUsageDescription`
   and the updated `NSCameraUsageDescription` are in `app.json`. Sign in with
   Apple remains configured (`usesAppleSignIn: true`, `expo-apple-authentication`).
   **Do re-check** that the ASC privacy answers already reflect the Singular
   SDK shipped since 1.0.x: `app.json` declares `NSPrivacyTracking: true`,
   an ATT prompt, and tracking for Device ID / User ID / Product Interaction /
   Purchase History. If ASC still says "Data Used to Track You: None" (as the
   older section of this file does), update it before submitting.
5. **Screenshots**: not required for this version — the existing 6.9" set
   still reflects the core loop. Optional later: a Record-my-run and a
   Leaderboard screenshot.
6. **Submit for Review**. Leave "Release this version automatically" or hold
   for manual release as preferred.

---

## "What's New" (v1.0.0)
Welcome to CardioSurf — cardio you play by moving your body!

- Surf themed worlds using real jumps, ducks and side-steps
- Three intensity classes: Beginner, Intermediate and Hard
- Build streaks, earn XP and coins, and climb the leaderboard
- Cast your run to the TV with AirPlay
- Meet your fox mascot

Thanks for playing our very first release. Move more, sit less, and let us know what you think!

---

## Pricing (verify matches App Store Connect exactly)
- cardiosurf_pro_monthly — $14.99 / month
- cardiosurf_pro_yearly — $39.99 / year, 3-day free trial

---

## RevenueCat (done)
- Entitlement: `cardioapp_pro` (single, consolidated)
- Offering: `default` (monthly + yearly packages)
- Reviewer account `JcJZNnihikhy3Uv8ucsCk8jtml82` granted `cardioapp_pro` (expires 2027-01-23)

---

## Final build & submit
```
eas build --platform ios --profile production --auto-submit
```
(Requires your Apple ID login + 2FA the first time, and selecting/creating an App Store Connect API key for submission.)

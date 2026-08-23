# Over-the-air updates (EAS Update)

> **Status: NOT enabled. Parked on 2026-08-23.**
>
> `expo-updates` was uninstalled and the `updates` / `runtimeVersion` blocks were
> removed from `app.json`, along with the per-profile `channel` entries in
> `eas.json`. This was done to keep the next iOS build as close to the previous
> one natively as possible while a crash from a native dependency version
> mismatch is being diagnosed — adding a native module would confound that.
>
> Nothing in this document works right now. `eas update` has nothing to publish
> to, and no installed build contains the updates client.
>
> To re-enable: reinstall `expo-updates`, restore the `updates` and
> `runtimeVersion` blocks in `app.json` and the `channel` entries in `eas.json`
> (`git show 5abc1df` has the exact diff), restore
> `scripts/check-native-fingerprint.mjs` and `.fingerprintignore` if you still
> want the safety check, and then **ship a new native build**. OTA cannot reach
> anyone until a binary containing `expo-updates` is installed.

How to ship a JavaScript fix to people who already have CardioSurf installed,
without waiting for App Store review.

## The one thing to understand first

The app is two layers:

- **The binary** — everything Apple reviews. Native code, permissions, SDKs,
  Info.plist, SKAdNetwork IDs. Only changes when you ship a new build.
- **The JavaScript bundle** — screens, layout, copy, logic, images. This is what
  an over-the-air (OTA) update replaces.

An OTA update swaps the second layer only. If the new JavaScript calls native
code that isn't in the installed binary, the app crashes. Everything below
exists to stop that from happening.

## Publishing an update

```bash
npm run ota:check                                   # safety check, see below
eas update --channel production --message "Fix paywall button alignment"
```

That's it. It takes about a minute. Users get the new JavaScript the **second**
time they open the app after you publish — the first launch downloads it in the
background, the next launch runs it.

Roll it out slowly if you're not sure:

```bash
eas update --channel production --rollout-percentage 10 --message "..."
```

Then watch the dashboard at expo.dev and raise the percentage with
`eas update:edit`.

## Rolling back a bad update

```bash
eas update:rollback
```

It asks you interactively whether to go back to a previous update or to the
JavaScript that shipped inside the binary. Users pick the rollback up on their
next launch, same as any other update. Publishing again afterwards overrides it.

## What can and cannot go out over the air

**Can ship OTA** (JavaScript and assets only):

- Paywall copy, pricing text, layout, button placement
- Bug fixes in workout logic, progression, session summaries
- New screens built from components already in the app
- Analytics event names and when they fire (the Singular *calls*, not the SDK)
- Images, fonts, JSON, Lottie — anything imported from `src/`
- Firebase/Firestore query changes, RevenueCat offering handling

**Cannot ship OTA — needs a new build and App Store review:**

- Adding or upgrading any native SDK. The `singular-react-native` addition in
  commit `1a865c5` is the textbook example: it added native iOS code, an ATT
  prompt, and SKAdNetwork IDs. None of that could have gone out over the air.
- Anything in `app.json` under `ios.infoPlist`, `plugins`, or `permissions` —
  SKAdNetwork IDs, the ATT prompt text, camera permission strings
- Upgrading Expo SDK, React Native, `react-native-purchases`,
  `expo-tracking-transparency`, `expo-video`, or the `cardiosurf-pose` module
- Changes to `plugins/withNoApsEnvironment.js` or `plugins/withStoreKitConfig.js`
- App icon, splash screen, bundle ID, app name

Rule of thumb: if the change is inside `src/`, it can go OTA. If it's in
`app.json`, `package.json` dependencies, `plugins/`, or `modules/`, it can't.

Apple explicitly permits this. The Developer Program License Agreement
§3.3.1(B) allows downloading interpreted code (JavaScript) as long as it doesn't
change the app's primary purpose, doesn't bypass OS security, and doesn't create
a storefront. Bug fixes and UI refinements are fine; shipping a whole new
advertised feature that review never saw is not.

## The safety check

Runtime versions decide which builds an update is allowed to reach. This project
uses the `appVersion` policy, so the runtime version is just `version` in
`app.json` — currently `1.0.1`. An update published today reaches every
installed build whose version is `1.0.1`.

The risk: you change native code, forget to bump `version`, and publish an
update that reaches builds without that native code.

`npm run ota:check` catches this. It hashes everything that affects the native
build and compares it to what was recorded for the shipped build. If they differ
it refuses and tells you to bump `version` and rebuild.

After every production build, from the exact commit you built:

```bash
npm run ota:baseline    # then commit native-fingerprint.json
```

## Channels

Each build profile in `eas.json` points at a channel, and updates go to one
channel at a time:

| Profile                 | Channel       | What it is                    |
| ----------------------- | ------------- | ----------------------------- |
| `production`            | `production`  | TestFlight and the App Store  |
| `preview`               | `preview`     | Internal distribution testing |
| `development`           | `development` | Dev client builds             |
| `development-simulator` | `development` | Inherits from `development`   |

A safer production flow when a change is risky: publish to `preview` first, test
it on an internal-distribution build of the same version, then promote the exact
same bundle:

```bash
eas update --channel preview --message "..."
eas update:republish --destination-channel production
```

## Startup behaviour

`app.json` sets `fallbackToCacheTimeout: 0`. The app never blocks on the network
at launch — it starts instantly with the JavaScript it already has and downloads
any new update in the background. That's why updates land on the second launch.

The alternative is making the app wait at the splash screen while it downloads.
That would deliver updates one launch sooner, but every user would pay that wait
on every cold start, including in a gym with bad Wi-Fi. Not worth it for a
workout app.

## Limits (EAS free plan)

- Unlimited updates, but 1,000 monthly active users. One user = one install that
  downloads at least one update during the billing cycle. Users who don't
  download anything that month don't count.
- 100 GiB bandwidth, 20 GiB storage per month.

Most of CardioSurf's heavy media streams from Cloud Storage rather than being
bundled, so update payloads stay small. Watch the MAU number as the app grows —
that's the one that runs out first.

# Paywall

CardioSurf Pro is sold through RevenueCat (`react-native-purchases` +
`react-native-purchases-ui`). The **hosted RevenueCat paywall** (designed in
the RevenueCat dashboard, attached to the current offering) is the canonical
paywall; the in-app `src/app/paywall.tsx` screen is a **fallback** that only
appears when the hosted one cannot be shown (Expo Go / web, no key, no
offering, no paywall attached — every such case is logged at error level by
`subscriptionAccess.ts`).

Where it is presented — all through one entry point,
`useSubscription().presentPaywall(opts)` → `PaywallUIResult`
(`'purchased' | 'restored' | 'cancelled' | 'not_presented' | 'error' |
'unavailable'`):

| caller | via | `ifNeeded` | on dismiss |
| --- | --- | --- | --- |
| End of onboarding: `first-run-ready.tsx` (and the returning-user sign-in in `AccountAuthScreen.tsx`) | `onboardingOffer.ts` → `requestOnboardingSubscriptionAccess` | yes (RevenueCat decides; already entitled → `not_presented`, nothing recorded) | onboarding completes, Home stays locked (`canStartRun`) |
| Level brief Start (`level/[id].tsx`) | `requestSubscriptionAccess` | no | stays on the brief |
| Profile → upgrade row | `requestSubscriptionAccess` | yes | stays on Profile |

`logPaywallViewed('hosted')` is recorded in `subscriptionAccess.ts` only when
the paywall was actually shown (`purchased` / `restored` / `cancelled`); the
custom screen records `'custom'` itself on mount. Purchases made on the hosted
paywall are reported by `SubscriptionContext.presentPaywall` →
`reportConversionAfterPurchase` (trial start / subscribe, deduplicated).

## Hosted paywall presentation (full screen)

`RevenueCatUI.presentPaywall()` / `presentPaywallIfNeeded()` present the
paywall as an iOS **page sheet** — rounded corners, a visible strip of the
screen behind, swipe-to-dismiss. Since build 30 the paywall is presented
**full screen** instead, in our own expo-router route:

- **Route**: `src/app/hosted-paywall.tsx`, registered in `_layout.tsx` as
  `presentation: 'fullScreenModal'`, `gestureEnabled: false`,
  `headerShown: false`, `animation: 'slide_from_bottom'`. It renders the
  `Paywall` **component** from `react-native-purchases-ui`
  (`RevenueCatUI.Paywall`) edge to edge — no `SafeAreaView`, so the hero runs
  under the status bar — with `options={{ offering, displayCloseButton:
  false }}`. It is also in the root gate's `FIRST_RUN_ROUTES`, so pushing it
  from onboarding does not make the gate redirect to a checkpoint while it
  is up.
- **Presenter**: `src/lib/hostedPaywall.ts` → `presentHostedPaywallScreen(opts)`,
  called by `SubscriptionContext.presentPaywall`. Same result type and
  meaning as before, so nothing above the context changed:
  1. `isHostedPaywallViewAvailable()` — RevenueCat configured **and** the
     native `Paywall` view manager registered (lazy `require`, same pattern as
     the rest of `purchases.ts`) — else `'unavailable'` → the custom fallback,
     exactly as before.
  2. `ifNeeded` → `hasPremium(await getCustomerInfoSafe())` → `'not_presented'`
     without navigating.
  3. `offering` from the options or `getCurrentOffering()`; none → `'error'`.
  4. `paywallRequests.open({ offering })` hands out a **request id**; the
     route is pushed as `/hosted-paywall?request=<id>` and the returned
     promise is awaited.
- **Resolution** (`src/lib/paywallRoute.ts`, pure, `npm run test:paywall-route`):
  the screen reads the offering by request id and feeds the component's
  callbacks into `reducePaywallRoute`, which keeps the same running result
  RevenueCat's own proxy keeps and settles **exactly once**:
  - `onPurchaseCompleted` → `'purchased'`, settled at once (the screen pops
    without waiting for the SDK's dismissal request);
  - `onRestoreCompleted` with our entitlement active → `'restored'`, settled;
    without it the paywall stays up (RevenueCat shows its own alert) and a
    later close reports whatever was pending — never a grant;
  - `onPurchaseError` → pending `'error'`; `onPurchaseCancelled` → pending
    `'cancelled'` (the StoreKit sheet was dismissed; the paywall stays up);
  - `onDismiss` (the SDK's close, a V2 "dismiss" action, or our X) → settles
    with the pending value — `'cancelled'` when nothing else happened,
    `'error'` after a failed purchase, which is what `presentPaywall()`
    returned in that case too;
  - the screen **unmounting** for any other reason (root gate redirect, app
    relaunch on a stale route) settles `'cancelled'`, so no caller can hang.
  Once settled the screen pops itself (`router.back()`; `replace('/(tabs)')`
  only if there is nothing to go back to), so the presenting screen — level
  brief, `first-run-ready`, Profile — is what the user lands on, and those
  screens' own follow-ups (launch the run, `goHomeLocked`, `goPreflight`)
  run unchanged. The hard-gate / dismissible behaviour and the onboarding
  sequence are untouched.
- **Close button**: the SDK's `displayCloseButton` only exists for legacy
  (V1) templates, where it sits top-*left*; V2 paywalls ignore the flag and
  only have a close if the design includes one. Because the route is a
  full-screen modal with gestures off (no sheet to swipe away), it must
  always have a way out, so the SDK's button is turned **off** and the screen
  overlays its **own X** top-right inside the safe-area inset (38 pt dark
  circle, `insets.top + 8`). It reports `'cancelled'` and pops the route,
  the same as the SDK's dismissal. A V2 design that includes its own close
  keeps working (it fires `onDismiss` too); on such a design there are then
  two ways to close, which is preferable to none.
- **Fallbacks unchanged**: Expo Go / web (`react-native-purchases-ui` absent
  or the view manager missing) → `'unavailable'`; no offering → `'error'`;
  both go to the custom `/paywall` screen through `requestSubscriptionAccess`
  as before. `presentPaywallUI` (the sheet) is kept in `purchases.ts` for
  reference but no longer called.

To check on device: Level brief → Start (free account) opens the paywall
covering the whole screen with no rounded corners and no swipe-down; the X
in the top right closes it back onto the brief; buying returns to the brief
and Start proceeds to preflight; from `first-run-ready`, closing lands on
Home locked and buying launches the run, as before.

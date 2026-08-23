/**
 * RevenueCat device-identifier collection (`$idfa` / `$idfv` / `$ip`).
 *
 * RevenueCat's Singular integration only forwards events when the `$idfa` and
 * `$idfv` subscriber attributes are set — both are documented as required on
 * iOS. Nothing else in the app sets them, and the client deliberately emits
 * `client_trial_started` / `client_subscribe` rather than the canonical
 * `sng_start_trial` / `sng_subscribe` (see `analytics.ts`) so the server-side
 * integration owns those. Without the identifiers RevenueCat forwards nothing,
 * the renamed client events aren't counted as conversions, and Singular sees no
 * trial, no purchase and no revenue at all.
 *
 * This lives in its own module so both `purchases.ts` (right after configure)
 * and `analytics.ts` (once the ATT answer exists) can call it without importing
 * each other.
 *
 * IMPORTANT — crash safety. This call carries the same hazard as the Singular
 * bridge calls documented at the top of `singular.ts`.
 * `Purchases.collectDeviceIdentifiers()` is typed `Promise<void>`, but the
 * promise covers only the JS-side `throwIfNotConfigured()` guard; underneath it
 * invokes `RCT_EXPORT_METHOD(collectDeviceIdentifiers)` (RNPurchases.m), which
 * takes no resolver/rejecter block and is therefore a *void* TurboModule
 * method. On React Native 0.81 an NSException raised inside a void method
 * aborts the process and cannot be caught from JS, so the promise's `.catch`
 * is real protection against the JS-side rejection only. The same three
 * defences as `singular.ts` therefore apply: defer off the current frame and
 * past navigation commits, collapse overlapping requests into one call, and
 * never invoke the bridge while the app is backgrounded (native modules being
 * torn down with async void methods in flight is the documented trigger).
 */

import { AppState, InteractionManager, Platform } from 'react-native';
import type { NativeEventSubscription } from 'react-native';
import { isRevenueCatConfigured } from './config';

type PurchasesModule = typeof import('react-native-purchases').default;

let requested = false;
let scheduled = false;
let foregroundSubscription: NativeEventSubscription | null = null;

/** Lazily load the native SDK; null when unavailable (Expo Go / web). */
function getPurchases(): PurchasesModule | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    return (mod?.default ?? mod) as PurchasesModule;
  } catch {
    return null;
  }
}

function waitForForeground(): void {
  if (foregroundSubscription) return;
  foregroundSubscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    foregroundSubscription?.remove();
    foregroundSubscription = null;
    schedule();
  });
}

function run(): void {
  scheduled = false;
  if (!requested) return;
  if (AppState.currentState !== 'active') {
    waitForForeground();
    return;
  }
  const Purchases = getPurchases();
  if (!Purchases) {
    requested = false;
    return;
  }
  requested = false;
  try {
    // Fire-and-forget: awaiting this would only wait on the JS-side
    // "is configure done?" check, and the caller must never be blocked.
    void Purchases.collectDeviceIdentifiers().catch((error) => {
      console.warn('[purchases] collectDeviceIdentifiers failed:', error);
    });
  } catch (error) {
    console.warn('[purchases] collectDeviceIdentifiers failed:', error);
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  // runAfterInteractions keeps the call out of navigation/animation commits;
  // the extra timeout hop guarantees it never runs inside the frame (or the
  // unmount) that requested it.
  InteractionManager.runAfterInteractions(() => {
    setTimeout(run, 0);
  });
}

/**
 * Ask RevenueCat to (re-)collect the device identifiers. Fire-and-forget: never
 * throws, never rejects, never blocks the caller.
 *
 * Call this after configure and again once the ATT answer exists — before ATT
 * is resolved the IDFA is all zeros, and only the second call upgrades `$idfa`
 * to the real value. Repeated calls collapse into one, and the collection is
 * idempotent, so callers don't have to track whether it already ran.
 */
export function collectPurchasesDeviceIdentifiers(): void {
  if (!isRevenueCatConfigured) return;
  requested = true;
  schedule();
}

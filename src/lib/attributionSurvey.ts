/**
 * "Where did you hear about us?" — fan the answer out to every place it can be
 * looked up later.
 *
 *   1. Locally, as `answers.attribution` in OnboardingContext (AsyncStorage) —
 *      the source of truth on-device, and what the Firestore sync reads.
 *   2. RevenueCat, as the `acquisition_source` subscriber attribute. Visible in
 *      the RevenueCat dashboard → Customers → the customer → Attributes.
 *   3. Singular, as the custom `attribution_survey` event with `{ source }`, so
 *      self-reported channel can be broken down against measured attribution.
 *   4. Firestore, as `acquisitionSource` on `users/{uid}` — written by the
 *      regular progress sync once an account exists (see firestoreSync.ts).
 *
 * The RevenueCat attribute is set on whatever app user is current, which during
 * onboarding is still the anonymous ID. RevenueCat carries attributes across
 * the later `logIn` when the account is new, and `reapplyAttributionAttribute`
 * re-sends it after every identity sync to cover the case where it isn't.
 * Everything here is fire-and-forget and never throws into the caller.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logAttributionSurvey } from './analytics';
import type { AttributionKey } from './onboarding';
import { setPurchasesAttributes } from './purchases';

/** Name of the RevenueCat subscriber attribute (shown verbatim in the dashboard). */
export const ACQUISITION_SOURCE_ATTRIBUTE = 'acquisition_source';

/** Last answer sent, kept separately so the RevenueCat re-apply needs no React context. */
const STORAGE_KEY = 'cardiosurf.attributionSurvey.v1';

export function recordAttributionSurvey(source: AttributionKey): void {
  void (async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, source);
    } catch {
      // best-effort; the answer still lives in OnboardingContext
    }
  })();
  logAttributionSurvey(source);
  void setPurchasesAttributes({ [ACQUISITION_SOURCE_ATTRIBUTE]: source }).catch(() => {});
}

/**
 * Re-send the stored answer as a RevenueCat attribute. Called after the
 * RevenueCat identity has been (re)synchronised so the identified customer,
 * not only the pre-login anonymous one, carries it.
 */
export async function reapplyAttributionAttribute(): Promise<void> {
  try {
    const source = await AsyncStorage.getItem(STORAGE_KEY);
    if (!source) return;
    await setPurchasesAttributes({ [ACQUISITION_SOURCE_ATTRIBUTE]: source });
  } catch {
    // best-effort
  }
}

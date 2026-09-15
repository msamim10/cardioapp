/**
 * Present the hosted RevenueCat paywall FULL SCREEN, in our own expo-router
 * route (`src/app/hosted-paywall.tsx`, registered in `_layout.tsx` as a
 * `fullScreenModal` with gestures off), instead of the SDK's page sheet.
 *
 * Same contract as `presentPaywallUI` so `SubscriptionContext.presentPaywall`
 * and everything above it (`subscriptionAccess.ts`, `onboardingOffer.ts`, the
 * level gate, the profile row) are unchanged:
 *
 *   purchased / restored   the paywall was shown and the user converted
 *   cancelled              shown and closed (the SDK's close, a V2 dismiss
 *                          action, our own X, or the screen going away)
 *   not_presented          `ifNeeded` and the entitlement is already active
 *   error                  shown, a purchase failed and the user then closed
 *                          (RevenueCat's own result in that case), or the
 *                          route could not be pushed / no offering
 *   unavailable            RevenueCat not ready or the SDK view cannot render
 *                          here (Expo Go, web) → callers fall back to the
 *                          custom `/paywall` screen exactly as before
 *
 * The result travels through `paywallRoute.ts`: this registers a request,
 * pushes the route with the request id, and awaits the promise the screen
 * settles from the `Paywall` component's callbacks.
 */

import { router, type Href } from 'expo-router';
import type { PurchasesOffering } from 'react-native-purchases';
import { paywallRequests } from './paywallRoute';
import {
  getCurrentOffering,
  getCustomerInfoSafe,
  hasPremium,
  isHostedPaywallViewAvailable,
  type PaywallUIResult,
} from './purchases';

/** Route name of the full-screen paywall screen (`src/app/hosted-paywall.tsx`). */
export const HOSTED_PAYWALL_ROUTE = '/hosted-paywall' as const;
/** Route param carrying the request id. */
export const HOSTED_PAYWALL_REQUEST_PARAM = 'request' as const;

export async function presentHostedPaywallScreen(opts?: {
  ifNeeded?: boolean;
  offering?: PurchasesOffering | null;
}): Promise<PaywallUIResult> {
  if (!isHostedPaywallViewAvailable()) return 'unavailable';
  if (opts?.ifNeeded) {
    // `presentPaywallIfNeeded` semantics: already entitled → nothing to show.
    const info = await getCustomerInfoSafe();
    if (hasPremium(info)) return 'not_presented';
  }
  const offering = opts?.offering ?? (await getCurrentOffering());
  if (!offering) {
    console.warn('[purchases] hosted paywall: no offering to present');
    return 'error';
  }
  const { id, promise } = paywallRequests.open({ offering });
  try {
    // Typed routes are generated at bundle time; the same cast the other
    // out-of-group routes use (`'/first-run-ready' as Href`).
    router.push(`${HOSTED_PAYWALL_ROUTE}?${HOSTED_PAYWALL_REQUEST_PARAM}=${encodeURIComponent(id)}` as Href);
  } catch (e) {
    console.warn('[purchases] hosted paywall route could not be pushed:', e);
    paywallRequests.settle(id, 'error');
  }
  return promise;
}

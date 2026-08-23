import type { Router } from 'expo-router';
import { logPaywallViewed } from './analytics';
import { isRevenueCatConfigured } from './config';
import type { PaywallUIResult } from './purchases';

/**
 * Dev-only escape hatch for local QA. Leave commented (default off) in normal
 * work — production and dev builds with RevenueCat configured enforce the gate.
 */
// const DEV_FORCE_UNLOCK = false;

/** True when unpaid users may start runs (RevenueCat off, or dev force-unlock). */
export function allowsUnpaidAccess(): boolean {
  if (!isRevenueCatConfigured) return true;
  // if (__DEV__ && DEV_FORCE_UNLOCK) return true;
  return false;
}

/** Whether the user may proceed into preflight / a run. */
export function canStartRun(isPremium: boolean): boolean {
  return isPremium || allowsUnpaidAccess();
}

export type PaywallFlowResult = 'granted' | 'dismissed';

type PresentPaywall = (opts?: {
  ifNeeded?: boolean;
}) => Promise<PaywallUIResult>;

/**
 * Present the hosted RevenueCat paywall, falling back to the in-app gate screen
 * when native UI is unavailable. Returns `granted` when entitlement is active
 * after purchase/restore/already entitled; `dismissed` on cancel or navigation
 * to the fallback screen (outcome there is handled separately).
 */
export async function requestSubscriptionAccess(
  presentPaywall: PresentPaywall,
  router: Router,
  opts?: {
    ifNeeded?: boolean;
    preflightParams?: Record<string, string>;
  }
): Promise<PaywallFlowResult> {
  const result = await presentPaywall({ ifNeeded: opts?.ifNeeded ?? false });
  // A purchased/restored/cancelled outcome means the hosted paywall WAS shown
  // (not_presented = skipped because already entitled). Record the funnel view.
  if (result === 'purchased' || result === 'restored' || result === 'cancelled') {
    logPaywallViewed('hosted');
  }
  switch (result) {
    case 'purchased':
    case 'restored':
    case 'not_presented':
      return 'granted';
    case 'cancelled':
      return 'dismissed';
    case 'unavailable':
    case 'error':
      // Hosted UI unavailable → fall back to the custom paywall, which logs its
      // own 'custom' paywall_viewed on mount (so we don't double-count here).
      router.push({
        pathname: '/paywall',
        params: { mode: 'gate', ...opts?.preflightParams },
      });
      return 'dismissed';
    default:
      return 'dismissed';
  }
}

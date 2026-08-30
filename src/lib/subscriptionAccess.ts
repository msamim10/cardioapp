import type { Router } from 'expo-router';
import { logPaywallViewed } from './analytics';
import { isRevenueCatConfigured } from './config';
import { describePurchasesUnready, ensurePurchasesReady } from './purchases';
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
 * The single place the app presents the hosted RevenueCat paywall. Every caller
 * — onboarding, the level gate, the profile upgrade row — goes through here, so
 * readiness and diagnostics are identical everywhere.
 *
 * Readiness is awaited rather than assumed: the SDK has to be configured and the
 * current offering has to have arrived, or the UI resolves no paywall and hands
 * back an error. Anything short of a real presentation is logged at error level,
 * because the visible symptom (custom UI appears, or nothing does) otherwise
 * gives no clue which of the several possible causes was responsible.
 *
 * The funnel view is recorded only when the UI was actually shown. A
 * purchased/restored/cancelled outcome means it was; `not_presented` means
 * RevenueCat skipped it because the entitlement is already active.
 */
async function presentHostedPaywall(
  presentPaywall: PresentPaywall,
  ifNeeded: boolean
): Promise<PaywallUIResult> {
  const readiness = await ensurePurchasesReady();
  if (!readiness.ready) {
    console.error(
      `[paywall] hosted RevenueCat paywall UNAVAILABLE (${readiness.reason}): ` +
        `${describePurchasesUnready(readiness.reason)}.`
    );
    return 'unavailable';
  }
  const result = await presentPaywall({ ifNeeded });
  if (result === 'error') {
    console.error(
      '[paywall] hosted RevenueCat paywall FAILED to present despite a current offering — ' +
        'the offering most likely has no paywall attached in the RevenueCat dashboard. ' +
        'See the preceding [purchases] presentPaywall warning.'
    );
  }
  if (result === 'purchased' || result === 'restored' || result === 'cancelled') {
    logPaywallViewed('hosted');
  }
  return result;
}

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
  const result = await presentHostedPaywall(presentPaywall, opts?.ifNeeded ?? false);
  switch (result) {
    case 'purchased':
    case 'restored':
    case 'not_presented':
      return 'granted';
    case 'cancelled':
      return 'dismissed';
    case 'unavailable':
    case 'error':
      // Last resort only. The hosted paywall is the canonical one, so reaching
      // the custom screen means something above is genuinely broken (see the
      // error logged by presentHostedPaywall) rather than being a normal branch.
      // The custom screen logs its own 'custom' paywall_viewed on mount, so we
      // don't double-count here.
      console.error(
        '[paywall] falling back to the CUSTOM paywall screen — this is not the intended path'
      );
      router.push({
        pathname: '/paywall',
        params: { mode: 'gate', ...opts?.preflightParams },
      });
      return 'dismissed';
    default:
      return 'dismissed';
  }
}

export type OnboardingPaywallResult = PaywallFlowResult | 'not_shown';

/**
 * Present the offer as the last step of onboarding, before the user reaches the
 * tabs. Deliberately hosted-UI-only and router-free: onboarding still owns the
 * navigation stack at this point, so a push to `/paywall` would fight the root
 * auth gate. `not_shown` therefore means "nothing was presented" — the caller
 * leaves the one-time flag unclaimed and the reactive gate on the level screen
 * (which can reach the custom fallback safely) remains the enforcement point.
 *
 * `ifNeeded` asks RevenueCat itself whether the entitlement is already active,
 * so a reinstall or a restore that landed before this step resolves to
 * `not_presented` and no paywall (or funnel view) is recorded.
 */
export async function requestOnboardingSubscriptionAccess(
  presentPaywall: PresentPaywall
): Promise<OnboardingPaywallResult> {
  const result = await presentHostedPaywall(presentPaywall, true);
  switch (result) {
    case 'purchased':
    case 'restored':
      return 'granted';
    case 'cancelled':
      return 'dismissed';
    default:
      return 'not_shown';
  }
}

/**
 * Single entry point for attribution + funnel analytics.
 *
 * Every analytics call in the app goes through this module. It fans out to:
 *   - Singular (attribution / ad-network events) via `singular.ts`
 *   - the local on-device funnel store via `funnelStore.ts`
 *   - the SKAdNetwork conversion-value ladder via `conversionValue.ts`
 *
 * All functions are safe to call anywhere (including Expo Go / web): the
 * Singular layer no-ops when unconfigured, and the funnel store is pure JS.
 * Calls are fire-and-forget; failures are swallowed so analytics never breaks
 * a user flow.
 *
 * Event names use Singular's standard constants where they exist
 * (sng_complete_registration) and custom names otherwise (onboarding_complete /
 * first_run_complete / run_complete / paywall_viewed). See singular-react-
 * native's Events.js for the standard set.
 *
 * The revenue conversions are deliberately NOT sent under Singular's standard
 * `sng_start_trial` / `sng_subscribe` names: the RevenueCat → Singular
 * server-side integration owns those, and it also owns revenue amounts (net of
 * store commission) plus the renewal/cancellation lifecycle the client can't
 * observe. The client emits `client_trial_started` / `client_subscribe` instead
 * — non-standard, non-revenue diagnostic events that keep the local funnel and
 * the SKAN ladder moving without double-counting server-side conversions.
 */

import { Platform } from 'react-native';
import { bumpConversionValue, bumpConversionValueForRunCount } from './conversionValue';
import {
  claimAttRequest,
  markAppOpen,
  markCalibrationAttempt,
  markCalibrationFailure,
  markCalibrationSuccess,
  markOnboardingComplete,
  markOnboardingStart,
  markPaidConversion,
  markPaywallViewed,
  markRunComplete,
  markTrialStarted,
  recordReportedConversionValue,
  type CalibrationFailureReason,
} from './funnelStore';
import {
  initSingular,
  singularEvent,
  singularSetCustomUserId,
  singularUnsetCustomUserId,
} from './singular';

/** Singular event names (standard constants mirror Events.js). */
export const EVENTS = {
  completeRegistration: 'sng_complete_registration',
  onboardingComplete: 'onboarding_complete',
  firstRunComplete: 'first_run_complete',
  runComplete: 'run_complete',
  paywallViewed: 'paywall_viewed',
  // Client-only diagnostics; the RevenueCat server integration owns the
  // canonical `sng_start_trial` / `sng_subscribe` revenue events.
  clientTrialStarted: 'client_trial_started',
  clientSubscribe: 'client_subscribe',
} as const;

let initialized = false;

/**
 * Initialize analytics at app launch. Idempotent. Records the app-open (for
 * install + retention), inits Singular (which holds the install event until ATT
 * resolves), and seeds the conversion-value ladder at `install`.
 */
export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  void markAppOpen();
  initSingular({
    attTimeoutSeconds: 300,
    // Surface Singular's automatic (dashboard-managed) conversion values into
    // the local funnel so the debug screen can show them.
    onConversionValueUpdated: (value) => {
      void recordReportedConversionValue(value);
    },
  });
  void bumpConversionValue('install');
}

/**
 * Mirror the RevenueCat appUserID onto Singular's Custom User ID. Pass the exact
 * same identifier used as the RC appUserID (the Firebase UID, or null when
 * signed out / anonymous). Keeps cross-device attribution joined to billing.
 */
export function syncAnalyticsIdentity(appUserId: string | null): void {
  if (appUserId) singularSetCustomUserId(appUserId);
  else singularUnsetCustomUserId();
}

// --- Funnel events --------------------------------------------------------

/** First entry into the onboarding flow (welcome screen). */
export function logOnboardingStart(): void {
  void markOnboardingStart();
  // Separates "opened the app" from an install that never got past the icon.
  void bumpConversionValue('opened_no_calibration');
}

/** Account created (Firebase). `method` is the sign-up provider. */
export function logCompleteRegistration(method?: 'google' | 'apple' | 'email'): void {
  singularEvent(EVENTS.completeRegistration, method ? { method } : undefined);
  void markOnboardingComplete();
  // "Opened, engaged, not yet calibrated" rung of the SKAN ladder.
  void bumpConversionValue('opened_no_calibration');
}

/** A calibration attempt began (preflight camera calibration started). */
export function logCalibrationAttempt(): void {
  void markCalibrationAttempt();
}

/** Calibration reached a usable baseline (preflight countdown). Fires the
 *  `onboarding_complete` Singular event once, on the first ever success. */
export function logCalibrationSuccess(): void {
  void markCalibrationSuccess().then((wasFirst) => {
    if (wasFirst) singularEvent(EVENTS.onboardingComplete);
  });
  void bumpConversionValue('calibration_complete');
}

/** Calibration failed / timed out, with the detected reason (Phase 4). */
export function logCalibrationFailure(reason: CalibrationFailureReason): void {
  void markCalibrationFailure(reason);
}

/**
 * A workout session finished. Fires `run_complete` always and
 * `first_run_complete` once. Advances the SKAN ladder using the persisted
 * lifetime run count, so the first run lands on `one_run` and every later run on
 * `two_plus_runs` — the two highest pre-purchase rungs of the ladder, since the
 * trial-gated paywall means every run already happened inside a trial.
 */
export function logRunComplete(attrs: { durationMin: number; score: number }): void {
  singularEvent(EVENTS.runComplete, {
    duration_min: Math.round(attrs.durationMin * 100) / 100,
    score: Math.round(attrs.score),
  });
  void markRunComplete().then((count) => {
    if (count === 1) singularEvent(EVENTS.firstRunComplete);
    void bumpConversionValueForRunCount(count);
  });
}

/** The paywall was shown (hosted RevenueCat UI OR the custom fallback). */
export function logPaywallViewed(source: 'hosted' | 'custom'): void {
  singularEvent(EVENTS.paywallViewed, { source });
  void markPaywallViewed();
  void bumpConversionValue('paywall_viewed');
}

/**
 * A free trial started. Advances the local funnel + SKAN ladder and emits the
 * client-only `client_trial_started` diagnostic — the canonical
 * `sng_start_trial` comes from the RevenueCat server integration.
 */
export function logStartTrial(attrs: {
  productId: string;
  price?: number;
  currency?: string;
}): void {
  singularEvent(EVENTS.clientTrialStarted, {
    product_id: attrs.productId,
    ...(typeof attrs.price === 'number' ? { price: attrs.price } : {}),
    ...(attrs.currency ? { currency: attrs.currency } : {}),
  });
  void markTrialStarted();
  void bumpConversionValue('trial_started');
}

/**
 * A paid subscription conversion. Price/currency ride along as plain attributes
 * rather than a Singular revenue event, so Singular's revenue reporting counts
 * only RevenueCat's server-side `sng_subscribe` (net of store commission).
 */
export function logSubscribe(attrs: {
  productId: string;
  price: number;
  currency: string;
}): void {
  singularEvent(EVENTS.clientSubscribe, {
    product_id: attrs.productId,
    price: attrs.price,
    currency: attrs.currency,
  });
  void markPaidConversion();
  void bumpConversionValue('paid_conversion');
}

// --- App Tracking Transparency -------------------------------------------

type TrackingTransparencyModule = typeof import('expo-tracking-transparency');

function getTrackingModule(): TrackingTransparencyModule | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-tracking-transparency') as TrackingTransparencyModule;
  } catch {
    return null;
  }
}

/**
 * Show the App Tracking Transparency prompt — but only AFTER the user's first
 * completed run, and at most once ever. Singular's init waits for this response
 * (waitForTrackingAuthorizationWithTimeoutInterval) before sending the install,
 * so the IDFA is attached when available. Safe no-op off-iOS / in Expo Go.
 */
export async function requestTrackingAfterFirstRun(): Promise<void> {
  const mod = getTrackingModule();
  if (!mod) return;
  // Claim the one-time slot first so remounts / duplicate calls don't re-prompt.
  if (!(await claimAttRequest())) return;
  try {
    const current = await mod.getTrackingPermissionsAsync();
    // Only the OS "undetermined" state can still present the system prompt.
    if (current.status === 'undetermined') {
      await mod.requestTrackingPermissionsAsync();
    }
  } catch {
    // ignore — attribution still works without IDFA (SKAN / probabilistic)
  }
}

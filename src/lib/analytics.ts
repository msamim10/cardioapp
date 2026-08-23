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
 * WHO REPORTS REVENUE. Singular's standard `sng_start_trial` / `sng_subscribe`
 * events may only ever have one source, or Singular counts each purchase twice.
 * `singularConfig.revenueSource` picks that source, and the two modes are
 * mutually exclusive by construction — each conversion emits exactly one event,
 * under a different name in each mode:
 *
 *   'client' (default) → `sng_start_trial` / `sng_subscribe`, with revenue.
 *   'revenuecat'       → `client_trial_started` / `client_subscribe`, no
 *                        revenue, leaving RevenueCat's server-side events as
 *                        the only ones Singular counts.
 *
 * The default is 'client' because RevenueCat cannot deliver to Singular
 * accounts created on or after 2026-07-15: those require Singular's Event API
 * v2 and the Singular Device ID, which RevenueCat's integration does not yet
 * support. RevenueCat's own docs otherwise tell you to remove client-side
 * purchase tracking, and in 'revenuecat' mode we do exactly that.
 */

import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
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
import { collectPurchasesDeviceIdentifiers } from './purchasesDeviceIdentifiers';
import {
  initSingular,
  singularCustomRevenue,
  singularEvent,
  singularRevenueSource,
  singularSetCustomUserId,
  singularTrialStartRevenue,
  singularUnsetCustomUserId,
} from './singular';

/** Singular event names (standard constants mirror Events.js). */
export const EVENTS = {
  completeRegistration: 'sng_complete_registration',
  onboardingComplete: 'onboarding_complete',
  firstRunComplete: 'first_run_complete',
  runComplete: 'run_complete',
  paywallViewed: 'paywall_viewed',
  // Singular's canonical conversion events (Events.js sngStartTrial /
  // sngSubscribe), sent only when this client owns revenue reporting.
  startTrial: 'sng_start_trial',
  subscribe: 'sng_subscribe',
  // Their non-revenue stand-ins, sent instead when RevenueCat owns revenue.
  clientTrialStarted: 'client_trial_started',
  clientSubscribe: 'client_subscribe',
} as const;

let initialized = false;

/** How long Singular holds the install/session waiting for the ATT answer. */
const ATT_WAIT_TIMEOUT_SECONDS = 300;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PromiseLike<unknown>).then === 'function';

/**
 * Run an analytics side effect in total isolation. Every exported log function
 * goes through this, so neither a synchronous throw nor a rejected promise can
 * reach the caller: these fire from user-visible paths (run completion,
 * checkout, sign-up) that must survive a broken or missing SDK.
 */
function safely(label: string, run: () => unknown): void {
  try {
    const result = run();
    if (isThenable(result)) {
      Promise.resolve(result).catch((error) => report(label, error));
    }
  } catch (error) {
    report(label, error);
  }
}

function report(label: string, error: unknown): void {
  if (__DEV__) console.warn(`[analytics] ${label} failed:`, error);
}

/** Coerce to a number the native bridge can marshal (never NaN/Infinity). */
const finiteOr = (value: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return finiteOr(Math.round(finiteOr(value, 0) * factor) / factor, 0);
};

/**
 * Initialize analytics at app launch. Idempotent. Records the app-open (for
 * install + retention), inits Singular (which holds the install event until ATT
 * resolves), and seeds the conversion-value ladder at `install`.
 */
export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  safely('markAppOpen', () => markAppOpen());
  safely('initAnalytics', () => {
    const started = initSingular({
      attTimeoutSeconds: ATT_WAIT_TIMEOUT_SECONDS,
      // Surface Singular's automatic (dashboard-managed) conversion values into
      // the local funnel so the debug screen can show them.
      onConversionValueUpdated: (value) => {
        safely('recordReportedConversionValue', () => recordReportedConversionValue(value));
      },
    });
    // Ungated, unlike report(): if attribution never starts in a release build
    // there is otherwise no crash, no log and no missing-data signal anywhere,
    // and Singular's own SDK logging cannot surface it on iOS (see singular.ts).
    // Expected off-iOS/Android and in Expo Go, where there is no native module.
    if (!started) {
      console.warn('[analytics] Singular did not initialize — no attribution this session');
    }
    return bumpConversionValue('install');
  });
}

/**
 * Mirror the RevenueCat appUserID onto Singular's Custom User ID. Pass the exact
 * same identifier used as the RC appUserID (the Firebase UID, or null when
 * signed out / anonymous). Keeps cross-device attribution joined to billing.
 */
export function syncAnalyticsIdentity(appUserId: string | null): void {
  safely('syncAnalyticsIdentity', () => {
    if (typeof appUserId === 'string' && appUserId.length > 0) {
      singularSetCustomUserId(appUserId);
    } else {
      singularUnsetCustomUserId();
    }
  });
}

// --- Funnel events --------------------------------------------------------

/** First entry into the onboarding flow (welcome screen). */
export function logOnboardingStart(): void {
  safely('logOnboardingStart', async () => {
    await markOnboardingStart();
    // Separates "opened the app" from an install that never got past the icon.
    await bumpConversionValue('opened_no_calibration');
  });
}

/** Account created (Firebase). `method` is the sign-up provider. */
export function logCompleteRegistration(method?: 'google' | 'apple' | 'email'): void {
  safely('logCompleteRegistration', async () => {
    singularEvent(EVENTS.completeRegistration, method ? { method } : undefined);
    await markOnboardingComplete();
    // "Opened, engaged, not yet calibrated" rung of the SKAN ladder.
    await bumpConversionValue('opened_no_calibration');
  });
}

/** A calibration attempt began (preflight camera calibration started). */
export function logCalibrationAttempt(): void {
  safely('logCalibrationAttempt', () => markCalibrationAttempt());
}

/** Calibration reached a usable baseline (preflight countdown). Fires the
 *  `onboarding_complete` Singular event once, on the first ever success. */
export function logCalibrationSuccess(): void {
  safely('logCalibrationSuccess', async () => {
    const wasFirst = await markCalibrationSuccess();
    if (wasFirst) singularEvent(EVENTS.onboardingComplete);
    await bumpConversionValue('calibration_complete');
  });
}

/** Calibration failed / timed out, with the detected reason (Phase 4). */
export function logCalibrationFailure(reason: CalibrationFailureReason): void {
  safely('logCalibrationFailure', () => markCalibrationFailure(reason));
}

/**
 * A workout session finished. Fires `run_complete` always and
 * `first_run_complete` once. Advances the SKAN ladder using the persisted
 * lifetime run count, so the first run lands on `one_run` and every later run on
 * `two_plus_runs` — the two highest pre-purchase rungs of the ladder, since the
 * trial-gated paywall means every run already happened inside a trial.
 */
export function logRunComplete(attrs: { durationMin: number; score: number }): void {
  safely('logRunComplete', async () => {
    singularEvent(EVENTS.runComplete, {
      duration_min: roundTo(attrs?.durationMin, 2),
      score: Math.round(finiteOr(attrs?.score, 0)),
    });
    const count = await markRunComplete();
    if (count === 1) singularEvent(EVENTS.firstRunComplete);
    await bumpConversionValueForRunCount(count);
  });
}

/** The paywall was shown (hosted RevenueCat UI OR the custom fallback). */
export function logPaywallViewed(source: 'hosted' | 'custom'): void {
  safely('logPaywallViewed', async () => {
    singularEvent(EVENTS.paywallViewed, { source });
    await markPaywallViewed();
    await bumpConversionValue('paywall_viewed');
  });
}

type ConversionAttrs = { productId: string; price?: number; currency?: string };

/**
 * Emit the single Singular event for one conversion.
 *
 * `singularRevenueSource` selects the name, so the canonical `sng_*` event and
 * its `client_*` stand-in can never both fire for the same purchase. The
 * amount is attached only when this client owns revenue AND a real price is
 * known: Singular reads any event carrying an amount as revenue, so a zero
 * would register a revenue event worth nothing instead of a plain event.
 */
function logConversion(
  attrs: ConversionAttrs,
  names: { standard: string; diagnostic: string },
  withRevenue: boolean,
): void {
  const price = Number.isFinite(attrs?.price) ? (attrs.price as number) : undefined;
  const currency = attrs?.currency;
  const args = {
    product_id: attrs?.productId,
    ...(price !== undefined ? { price } : {}),
    ...(currency ? { currency } : {}),
  };
  if (singularRevenueSource !== 'client') {
    singularEvent(names.diagnostic, args);
  } else if (withRevenue && currency && price !== undefined && price > 0) {
    singularCustomRevenue(names.standard, currency, price, args);
  } else {
    singularEvent(names.standard, args);
  }
}

/**
 * A free trial started. Advances the local funnel + SKAN ladder and emits
 * `sng_start_trial` — as a plain event by default, since no money has moved
 * yet, or as revenue worth the full price when `trialStartRevenue` says so.
 */
export function logStartTrial(attrs: ConversionAttrs): void {
  safely('logStartTrial', async () => {
    logConversion(
      attrs,
      { standard: EVENTS.startTrial, diagnostic: EVENTS.clientTrialStarted },
      singularTrialStartRevenue === 'price',
    );
    await markTrialStarted();
    await bumpConversionValue('trial_started');
  });
}

/**
 * A paid subscription conversion. Emits `sng_subscribe` carrying the price the
 * customer actually paid — gross of the store's commission, since that is the
 * only figure the client can see (RevenueCat's server integration is the only
 * source that can report net proceeds).
 */
export function logSubscribe(attrs: {
  productId: string;
  price: number;
  currency: string;
}): void {
  safely('logSubscribe', async () => {
    logConversion(attrs, { standard: EVENTS.subscribe, diagnostic: EVENTS.clientSubscribe }, true);
    await markPaidConversion();
    await bumpConversionValue('paid_conversion');
  });
}

// --- App Tracking Transparency -------------------------------------------

type TrackingTransparencyModule = typeof import('expo-tracking-transparency');

/** Give a backgrounded app this long to come back before abandoning the ask. */
const ATT_FOREGROUND_TIMEOUT_MS = 15_000;

let attRequestInFlight = false;

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
 * `expo-tracking-transparency` calls EXFatal — an uncatchable native abort that
 * kills the process — when NSUserTrackingUsageDescription is missing from the
 * bundle, and it does so from BOTH the get and request calls. No JS try/catch
 * can contain that, so the only defence is to not call it unless the config
 * that writes the key is in place.
 *
 * The key reaches Info.plist via the `expo-tracking-transparency` config plugin
 * (or an explicit ios.infoPlist entry), so check for those rather than for the
 * plist value itself, which prebuild-time mods never write back to the
 * manifest. An unreadable config resolves to "configured" so a manifest quirk
 * can't silently switch attribution off in a correctly built app.
 */
function isTrackingUsageDescriptionConfigured(): boolean {
  try {
    const config = Constants.expoConfig;
    if (!config) return true;
    const declared = config.ios?.infoPlist?.NSUserTrackingUsageDescription;
    if (typeof declared === 'string' && declared.trim().length > 0) return true;
    const plugins = config.plugins;
    if (!Array.isArray(plugins)) return true;
    for (const entry of plugins) {
      const [name, options] = Array.isArray(entry) ? entry : [entry, undefined];
      if (name !== 'expo-tracking-transparency') continue;
      // Only an explicit `false` tells the plugin to strip the key; when no
      // value is given the plugin substitutes its own default string.
      const permission = (options as { userTrackingPermission?: unknown } | undefined)
        ?.userTrackingPermission;
      return permission !== false;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Resolve true once the app is foreground-active. iOS refuses to present the
 * ATT sheet unless the app is active, and the request can then hang unanswered
 * — which would burn the one-shot prompt for nothing.
 */
function waitUntilActive(timeoutMs: number): Promise<boolean> {
  if (AppState.currentState === 'active') return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (active: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.remove();
      resolve(active);
    };
    const timer = setTimeout(() => settle(false), timeoutMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') settle(true);
    });
  });
}

/**
 * Show the App Tracking Transparency prompt, at most once ever. Singular's init
 * holds the install/session for ATT_WAIT_TIMEOUT_SECONDS waiting on this answer
 * (waitForTrackingAuthorizationWithTimeoutInterval) before sending it, and the
 * IDFA it resolves to is baked into that device's attribution permanently — so
 * the caller must invoke this well inside that window. Safe no-op off-iOS / in
 * Expo Go, and it never throws or rejects: the caller may fire and forget.
 *
 * Once the answer is on file this also re-collects RevenueCat's `$idfa`/`$idfv`,
 * which is what makes RevenueCat's Singular integration forward events at all.
 */
export async function requestTrackingAuthorization(): Promise<void> {
  if (attRequestInFlight) return;
  attRequestInFlight = true;
  // Set at each point where the ATT answer is known to exist, so the `finally`
  // below refreshes the RevenueCat identifiers exactly once.
  let trackingResolved = false;
  try {
    const mod = getTrackingModule();
    if (!mod) return;
    if (!isTrackingUsageDescriptionConfigured()) return;
    if (!(await waitUntilActive(ATT_FOREGROUND_TIMEOUT_MS))) return;
    // Claim the one-time slot only once we can actually prompt, so remounts and
    // duplicate calls can't re-prompt and a backgrounded run doesn't spend it.
    if (!(await claimAttRequest())) {
      // An earlier session already spent the slot, so the answer is on file.
      trackingResolved = true;
      return;
    }
    const current = await mod.getTrackingPermissionsAsync();
    // Only the OS "undetermined" state can still present the system prompt.
    if (current.status !== 'undetermined') {
      trackingResolved = true;
      return;
    }
    await mod.requestTrackingPermissionsAsync();
    trackingResolved = true;
  } catch (error) {
    // ignore — attribution still works without IDFA (SKAN / probabilistic)
    report('requestTrackingAuthorization', error);
  } finally {
    attRequestInFlight = false;
    // Allowed or denied, re-collect: the launch-time collection ran before the
    // answer existed, so `$idfa` was captured as all zeros. Denied still needs
    // this so `$idfv` is current rather than paired with a stale `$idfa`.
    if (trackingResolved) {
      safely('collectPurchasesDeviceIdentifiers', () => collectPurchasesDeviceIdentifiers());
    }
  }
}

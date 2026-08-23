/**
 * RevenueCat wrapper (react-native-purchases + react-native-purchases-ui).
 *
 * Design goals:
 *   - Keys come from env (`config.ts`), never hardcoded.
 *   - Both native modules are loaded LAZILY via require(), so importing this file
 *     never triggers `new NativeEventEmitter()` at module load — which would crash
 *     in Expo Go / on web where the native modules are absent.
 *   - Every call no-ops gracefully when RevenueCat isn't configured (placeholder
 *     keys), the native module is missing (Expo Go / web), or configuration
 *     failed — so the paywall's "maybe later" / guest flow always completes.
 *
 * Entitlement gating uses `premiumEntitlementId` (env-driven, e.g. `cardioapp_pro`).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  CustomerInfo,
  CustomerInfoUpdateListener,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import {
  isRevenueCatConfigured,
  isRevenueCatTestStoreKey,
  premiumEntitlementId,
  revenueCatApiKey,
} from './config';
import { logStartTrial, logSubscribe } from './analytics';
import { collectPurchasesDeviceIdentifiers } from './purchasesDeviceIdentifiers';
import {
  createRevenueCatIdentityState,
  synchronizeRevenueCatIdentity,
  type RevenueCatIdentityState,
} from './revenueCatIdentity';

type PurchasesModule = typeof import('react-native-purchases').default;
type PurchasesUIModule = typeof import('react-native-purchases-ui').default;

type SharedPurchasesState = {
  configured: boolean;
  configuring: Promise<boolean> | null;
  customerInfoListeners: Set<CustomerInfoUpdateListener>;
  identity: RevenueCatIdentityState<CustomerInfo>;
  nativeCustomerInfoListener: CustomerInfoUpdateListener | null;
};

const SHARED_STATE_KEY = '__cardioSurfRevenueCatStateV1__';
const globalStore = globalThis as typeof globalThis & {
  [SHARED_STATE_KEY]?: SharedPurchasesState;
};
const sharedState =
  globalStore[SHARED_STATE_KEY] ??
  (globalStore[SHARED_STATE_KEY] = {
    configured: false,
    configuring: null,
    customerInfoListeners: new Set(),
    identity: createRevenueCatIdentityState<CustomerInfo>(),
    nativeCustomerInfoListener: null,
  });

/** Lazily load the core native SDK; returns null when unavailable (Expo Go / web). */
function getPurchases(): PurchasesModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    return (mod?.default ?? mod) as PurchasesModule;
  } catch {
    return null;
  }
}

/** Lazily load the RevenueCatUI native module; null when unavailable. */
function getPurchasesUI(): PurchasesUIModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases-ui');
    return (mod?.default ?? mod) as PurchasesUIModule;
  } catch {
    return null;
  }
}

/**
 * Configure RevenueCat once across provider remounts and Fast Refresh. The
 * native `isConfigured` check also covers a full JS reload retaining the
 * already-configured native singleton.
 */
export function configurePurchases(): Promise<boolean> {
  if (sharedState.configured) return Promise.resolve(true);
  if (sharedState.configuring) return sharedState.configuring;
  if (!isRevenueCatConfigured || !revenueCatApiKey) return Promise.resolve(false);
  const Purchases = getPurchases();
  if (!Purchases) return Promise.resolve(false);

  sharedState.configuring = (async () => {
    try {
      if (await Purchases.isConfigured()) {
        sharedState.configured = true;
        return true;
      }
      // Verbose logging is invaluable while wiring up products/offerings/paywalls.
      if (__DEV__) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { LOG_LEVEL } = require('react-native-purchases');
          if (LOG_LEVEL?.DEBUG) await Purchases.setLogLevel(LOG_LEVEL.DEBUG);
        } catch {
          // setLogLevel is best-effort; ignore if the enum isn't available.
        }
      }
      Purchases.configure({ apiKey: revenueCatApiKey });
      sharedState.configured = true;
      // `$idfa`/`$idfv` are required by RevenueCat's Singular integration, which
      // forwards nothing without them. Deferred and fire-and-forget, so it can
      // neither delay configure nor fail it (see purchasesDeviceIdentifiers.ts).
      collectPurchasesDeviceIdentifiers();
      return true;
    } catch (e) {
      console.warn('[purchases] configure failed:', e);
      return false;
    } finally {
      sharedState.configuring = null;
    }
  })();
  return sharedState.configuring;
}

/** True only when RevenueCat is configured AND the native module is present. */
export function isPurchasesReady(): boolean {
  return sharedState.configured && getPurchases() !== null;
}

/** Whether a CustomerInfo grants the premium entitlement. */
export function hasPremium(customerInfo: CustomerInfo | null | undefined): boolean {
  if (!customerInfo) return false;
  return customerInfo.entitlements.active[premiumEntitlementId] !== undefined;
}

/**
 * Subscribe to CustomerInfo changes so entitlement state stays in sync after
 * purchases, restores, renewals, or expirations (incl. events triggered by the
 * hosted Paywall UI / Customer Center). Returns an unsubscribe fn, or null when
 * RevenueCat is unavailable.
 */
export function addCustomerInfoListener(
  listener: CustomerInfoUpdateListener
): (() => void) | null {
  if (!isPurchasesReady()) return null;
  const Purchases = getPurchases();
  if (!Purchases) return null;
  try {
    sharedState.customerInfoListeners.add(listener);
    if (!sharedState.nativeCustomerInfoListener) {
      sharedState.nativeCustomerInfoListener = (info) => {
        for (const currentListener of sharedState.customerInfoListeners) {
          currentListener(info);
        }
      };
      Purchases.addCustomerInfoUpdateListener(sharedState.nativeCustomerInfoListener);
    }

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      sharedState.customerInfoListeners.delete(listener);
      if (sharedState.customerInfoListeners.size !== 0 || !sharedState.nativeCustomerInfoListener) {
        return;
      }
      try {
        Purchases.removeCustomerInfoUpdateListener(sharedState.nativeCustomerInfoListener);
      } finally {
        sharedState.nativeCustomerInfoListener = null;
      }
    };
  } catch (e) {
    sharedState.customerInfoListeners.delete(listener);
    sharedState.nativeCustomerInfoListener = null;
    console.warn('[purchases] addCustomerInfoUpdateListener failed:', e);
    return null;
  }
}

/** Current offering (or null when unavailable). */
export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!isPurchasesReady()) return null;
  const Purchases = getPurchases();
  if (!Purchases) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch (e) {
    console.warn('[purchases] getOfferings failed:', e);
    return null;
  }
}

/** The three plan tiers CardioSurf Pro is sold as. */
export type PlanKey = 'lifetime' | 'yearly' | 'monthly';

/**
 * Candidate RevenueCat package identifiers per plan. We accept both the standard
 * identifiers (`$rc_lifetime`/`$rc_annual`/`$rc_monthly`) and the custom names
 * (`lifetime`/`yearly`/`monthly`) so the offering can be configured either way.
 */
const PLAN_PACKAGE_IDS: Record<PlanKey, string[]> = {
  lifetime: ['$rc_lifetime', 'lifetime'],
  yearly: ['$rc_annual', 'annual', 'yearly'],
  monthly: ['$rc_monthly', 'monthly'],
};

/**
 * Resolve the package for a plan from an offering. Prefers RevenueCat's typed
 * convenience accessors (`offering.lifetime/annual/monthly`) and falls back to
 * identifier matching for custom-named packages.
 */
export function resolvePlanPackage(
  offering: PurchasesOffering | null | undefined,
  plan: PlanKey
): PurchasesPackage | null {
  if (!offering) return null;
  const typed =
    plan === 'lifetime' ? offering.lifetime : plan === 'yearly' ? offering.annual : offering.monthly;
  if (typed) return typed;
  const ids = PLAN_PACKAGE_IDS[plan];
  return offering.availablePackages.find((p) => ids.includes(p.identifier)) ?? null;
}

const INTRO_PERIOD_UNIT_LABELS: Record<string, string> = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  YEAR: 'year',
};

/**
 * Human-readable free-trial length derived from a package's introductory offer
 * (e.g. "3-day"), so the paywall copy always matches the actual App Store
 * Connect intro offer instead of a hardcoded duration. Returns null when the
 * package has no intro offer or an unrecognized period unit.
 */
export function describeIntroTrial(pkg: PurchasesPackage | null | undefined): string | null {
  const intro = pkg?.product?.introPrice;
  if (!intro) return null;
  const units = intro.periodNumberOfUnits;
  if (typeof units !== 'number' || !Number.isFinite(units) || units <= 0) return null;
  const unitLabel = INTRO_PERIOD_UNIT_LABELS[intro.periodUnit as string];
  if (!unitLabel) return null;
  return `${units}-${unitLabel}`;
}

export type PurchaseOutcome =
  | { status: 'purchased'; premium: boolean }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'error'; error: unknown };

/** True when an unknown thrown value looks like a user-cancelled purchase. */
function isUserCancelled(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { userCancelled?: boolean; code?: string | number };
  if (err.userCancelled) return true;
  // PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR === "1".
  return err.code === '1' || err.code === 1;
}

/**
 * Purchase the package for `plan` from the current offering. Returns a
 * discriminated outcome so callers can unlock, ignore (cancelled), or fall
 * through (unavailable → let the guest/testing flow complete).
 */
export async function purchaseByPlan(plan: PlanKey): Promise<PurchaseOutcome> {
  if (!isPurchasesReady()) return { status: 'unavailable' };
  const Purchases = getPurchases();
  if (!Purchases) return { status: 'unavailable' };
  try {
    const offering = await getCurrentOffering();
    const pkg = resolvePlanPackage(offering, plan);
    if (!pkg) return { status: 'unavailable' };
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    // Local funnel + SKAN ladder only (dedup'd); RevenueCat's server integration
    // owns the canonical Singular revenue events.
    void reportConversion(customerInfo, pkg);
    return { status: 'purchased', premium: hasPremium(customerInfo) };
  } catch (e) {
    if (isUserCancelled(e)) return { status: 'cancelled' };
    console.warn('[purchases] purchase failed:', e);
    return { status: 'error', error: e };
  }
}

/** Restore purchases; returns whether premium is now active (null if unavailable). */
export async function restorePremium(): Promise<boolean | null> {
  if (!isPurchasesReady()) return null;
  const Purchases = getPurchases();
  if (!Purchases) return null;
  try {
    const customerInfo = await Purchases.restorePurchases();
    return hasPremium(customerInfo);
  } catch (e) {
    console.warn('[purchases] restore failed:', e);
    return null;
  }
}

/** Fetch the latest CustomerInfo (null when unavailable). */
export async function getCustomerInfoSafe(): Promise<CustomerInfo | null> {
  if (!isPurchasesReady()) return null;
  const Purchases = getPurchases();
  if (!Purchases) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (e) {
    console.warn('[purchases] getCustomerInfo failed:', e);
    return null;
  }
}

/** Check current premium status (null when unavailable). */
export async function checkPremium(): Promise<boolean | null> {
  const info = await getCustomerInfoSafe();
  if (info === null) return null;
  return hasPremium(info);
}

/**
 * Reconcile Firebase's UID with RevenueCat. Repeated/concurrent auth events are
 * coalesced, and native identity is inspected before logIn/logOut so RevenueCat
 * never receives an invalid anonymous logout.
 */
export async function synchronizePurchasesIdentity(
  uid: string | null,
): Promise<CustomerInfo | null> {
  if (!(await configurePurchases())) return null;
  const Purchases = getPurchases();
  if (!Purchases) return null;
  try {
    return await synchronizeRevenueCatIdentity(
      {
        getAppUserID: () => Purchases.getAppUserID(),
        getCustomerInfo: () => Purchases.getCustomerInfo(),
        isAnonymous: () => Purchases.isAnonymous(),
        logIn: async (nextUID) => (await Purchases.logIn(nextUID)).customerInfo,
        logOut: () => Purchases.logOut(),
      },
      uid,
      sharedState.identity,
    );
  } catch (e) {
    console.warn('[purchases] identity sync failed:', e);
    return null;
  }
}

// --- Conversion analytics (trial start / paid subscribe) ------------------

/** Persisted set of already-reported conversions, so we never double-count. */
const CONVERSION_DEDUP_KEY = 'cardiosurf.analytics.conversions.v1';

async function loadReportedConversions(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(CONVERSION_DEDUP_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

async function persistReportedConversions(set: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(CONVERSION_DEDUP_KEY, JSON.stringify([...set]));
  } catch {
    // best-effort
  }
}

type ConversionProduct = { productId: string; price?: number; currency?: string };

/** Resolve product price/currency: prefer the known package, else the offering. */
async function resolveConversionProduct(
  productIdentifier: string,
  knownPackage?: PurchasesPackage | null,
): Promise<ConversionProduct> {
  const fromPackage = knownPackage?.product;
  if (fromPackage) {
    return {
      productId: fromPackage.identifier,
      price: fromPackage.price,
      currency: fromPackage.currencyCode,
    };
  }
  const offering = await getCurrentOffering();
  const match = offering?.availablePackages.find(
    (p) => p.product.identifier === productIdentifier,
  );
  if (match?.product) {
    return {
      productId: match.product.identifier,
      price: match.product.price,
      currency: match.product.currencyCode,
    };
  }
  return { productId: productIdentifier };
}

/**
 * After a successful purchase, emit exactly one analytics conversion event.
 * A TRIAL entitlement period → `client_trial_started`; a paid period →
 * `client_subscribe`. Deduplicated by product + period + purchase date so
 * listener churn / relaunches never double-fire.
 *
 * These are client-only diagnostics that drive the local funnel and the SKAN
 * conversion-value ladder; the RevenueCat → Singular server integration owns the
 * canonical `sng_start_trial` / `sng_subscribe` revenue events.
 */
async function reportConversion(
  customerInfo: CustomerInfo,
  knownPackage?: PurchasesPackage | null,
): Promise<void> {
  try {
    const entitlement = customerInfo.entitlements.active[premiumEntitlementId];
    if (!entitlement) return;
    const productIdentifier = entitlement.productIdentifier;
    const period = String(entitlement.periodType).toUpperCase(); // NORMAL | INTRO | TRIAL
    const dedupKey = `${productIdentifier}|${period}|${entitlement.latestPurchaseDate ?? ''}`;

    const reported = await loadReportedConversions();
    if (reported.has(dedupKey)) return;

    const product = await resolveConversionProduct(productIdentifier, knownPackage);
    if (period === 'TRIAL') {
      logStartTrial(product);
    } else if (typeof product.price === 'number' && product.currency) {
      logSubscribe({ productId: product.productId, price: product.price, currency: product.currency });
    } else {
      // No price resolvable (hosted purchase w/o matching offering): still record
      // the subscribe event so the funnel isn't missing a conversion.
      logSubscribe({ productId: product.productId, price: 0, currency: product.currency ?? 'USD' });
    }

    reported.add(dedupKey);
    await persistReportedConversions(reported);
  } catch (e) {
    console.warn('[purchases] reportConversion failed:', e);
  }
}

/**
 * Record a conversion for a purchase made through the hosted RevenueCat UI,
 * where we don't have the purchased package in hand. Reads the latest
 * CustomerInfo and reconstructs product details from the current offering.
 */
export async function reportConversionAfterPurchase(): Promise<void> {
  const info = await getCustomerInfoSafe();
  if (info) await reportConversion(info);
}

// --- Hosted RevenueCat UI (Paywall + Customer Center) ---------------------

export type PaywallUIResult =
  | 'purchased'
  | 'restored'
  | 'cancelled'
  | 'not_presented'
  | 'error'
  | 'unavailable';

/**
 * Map RevenueCatUI's PAYWALL_RESULT (a string enum) onto our outcome type by
 * comparing raw string values, so we never have to statically import the enum
 * (which would eagerly load the native module).
 */
function mapPaywallResult(result: string): PaywallUIResult {
  switch (result) {
    case 'PURCHASED':
      return 'purchased';
    case 'RESTORED':
      return 'restored';
    case 'CANCELLED':
      return 'cancelled';
    case 'NOT_PRESENTED':
      return 'not_presented';
    default:
      return 'error';
  }
}

/**
 * Present the RevenueCat hosted Paywall UI for the current (or given) offering.
 *
 * When `ifNeeded` is true, uses `presentPaywallIfNeeded` so already-entitled
 * users are skipped (`not_presented`). Returns `unavailable` when RevenueCat or
 * the UI module isn't ready (Expo Go / web / unconfigured), or `error` when the
 * offering has no paywall attached — letting callers fall back to custom UI.
 */
export async function presentPaywallUI(opts?: {
  ifNeeded?: boolean;
  offering?: PurchasesOffering | null;
}): Promise<PaywallUIResult> {
  if (!isPurchasesReady()) return 'unavailable';
  const UI = getPurchasesUI();
  if (!UI) return 'unavailable';
  try {
    const offering = opts?.offering ?? undefined;
    const result = opts?.ifNeeded
      ? await UI.presentPaywallIfNeeded({
          requiredEntitlementIdentifier: premiumEntitlementId,
          ...(offering ? { offering } : {}),
        })
      : await UI.presentPaywall(offering ? { offering } : undefined);
    return mapPaywallResult(result as unknown as string);
  } catch (e) {
    console.warn('[purchases] presentPaywall failed:', e);
    return 'error';
  }
}

/**
 * Present the RevenueCat Customer Center (manage subscription, restore, refunds,
 * support). Returns false when unavailable so the caller can no-op gracefully.
 */
export async function presentCustomerCenterUI(): Promise<boolean> {
  if (!isPurchasesReady()) return false;
  const UI = getPurchasesUI();
  if (!UI) return false;
  try {
    await UI.presentCustomerCenter();
    return true;
  } catch (e) {
    console.warn('[purchases] presentCustomerCenter failed:', e);
    return false;
  }
}

/** Re-export so UI can note when it's running against the Test Store. */
export { isRevenueCatTestStoreKey };

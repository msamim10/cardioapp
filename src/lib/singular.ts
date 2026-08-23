/**
 * Thin, crash-safe wrapper around `singular-react-native`.
 *
 * Mirrors the lazy pattern in `purchases.ts`: the native module is loaded via
 * require() INSIDE functions, never at import time. Importing `singular-react-
 * native` eagerly evaluates `new NativeEventEmitter(SingularBridge)`, which
 * throws on iOS when the native module is absent (Expo Go / web). Loading it
 * lazily + guarded means importing this file is always safe, and every call
 * no-ops when Singular isn't configured or the native module is missing.
 *
 * Confirmed against the installed SDK (singular-react-native@4.2.0):
 *   Singular.init(new SingularConfig(key, secret)...)
 *   Singular.setCustomUserId(id) / unsetCustomUserId()
 *   Singular.event(name) / eventWithArgs(name, args)
 *   Singular.customRevenueWithArgs(name, currency, amount, args)
 *   Singular.skanUpdateConversionValue(cv) -> boolean (iOS only)
 *   SingularConfig.withWaitForTrackingAuthorizationWithTimeoutInterval(sec)
 *   SingularConfig.withManualSkanConversionManagement()
 *   SingularConfig.withConversionValueUpdatedHandler(handler)
 */

import { Platform } from 'react-native';
import { singularConfig } from './singularConfig';

type SingularModule = typeof import('singular-react-native');
type SerializableArgs = Record<string, string | number | boolean | null>;

/** A value is "real" only if present and not a PLACEHOLDER. */
function isReal(value: string | undefined | null): value is string {
  if (!value) return false;
  const v = value.trim();
  return v.length > 0 && !/placeholder/i.test(v);
}

/** A usable native string argument: present, a string, and non-empty. */
function isUsableString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A number the native side can marshal — NaN/Infinity are not. */
function isUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Strip anything the native bridge can't marshal. The Singular SDK serializes
 * event args with NSJSONSerialization, which raises an Objective-C exception
 * (an uncatchable hard crash) on NaN/Infinity, and the TurboModule layer aborts
 * on values that don't match the generated spec. Only finite numbers, strings
 * and booleans survive; everything else — including null and undefined — is
 * dropped rather than forwarded.
 */
function sanitizeArgs(args: SerializableArgs | undefined): SerializableArgs | null {
  if (!args || typeof args !== 'object') return null;
  const clean: SerializableArgs = {};
  for (const [key, value] of Object.entries(args)) {
    if (!isUsableString(key)) continue;
    if (typeof value === 'boolean' || isUsableString(value) || isUsableNumber(value)) {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/** True when both the SDK Key and SDK Secret are real (non-placeholder) values. */
export const isSingularConfigured =
  isReal(singularConfig.sdkKey) && isReal(singularConfig.sdkSecret);

/** True when this app is configured to update SKAN conversion values in code. */
export const isManualSkanConversion = singularConfig.manualSkanConversion === true;

let cachedModule: SingularModule | null | undefined;
let inited = false;

function getModule(): SingularModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    cachedModule = null; // web / other: no native Singular bridge
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('singular-react-native') as SingularModule;
  } catch {
    cachedModule = null; // Expo Go / missing native module
  }
  return cachedModule;
}

/**
 * Initialize Singular once. `attTimeoutSeconds` maps to
 * withWaitForTrackingAuthorizationWithTimeoutInterval so Singular delays the
 * install/session until the ATT prompt is answered (or the timeout elapses).
 * Returns true when init actually ran.
 */
export function initSingular(opts: {
  attTimeoutSeconds?: number;
  onConversionValueUpdated?: (value: number) => void;
} = {}): boolean {
  if (inited) return true;
  if (!isSingularConfigured) return false;
  const mod = getModule();
  if (!mod) return false;
  try {
    const { Singular, SingularConfig } = mod;
    const attTimeout = isUsableNumber(opts.attTimeoutSeconds)
      ? Math.max(0, Math.round(opts.attTimeoutSeconds))
      : 300;
    const config = new SingularConfig(singularConfig.sdkKey, singularConfig.sdkSecret)
      .withSkAdNetworkEnabled(true)
      // Hold the install/session until ATT is resolved (Phase 2 requirement).
      .withWaitForTrackingAuthorizationWithTimeoutInterval(attTimeout);
    if (isManualSkanConversion) {
      // Opt out of Singular's automatic (dashboard-managed) conversion model so
      // our local schema drives skanUpdateConversionValue (see conversionValue.ts).
      config.withManualSkanConversionManagement();
    }
    const onConversionValueUpdated = opts.onConversionValueUpdated;
    if (onConversionValueUpdated) {
      // Invoked from the native event emitter, where a throw would surface as an
      // unhandled JS exception rather than a rejected promise.
      config.withConversionValueUpdatedHandler((value: number) => {
        try {
          onConversionValueUpdated(value);
        } catch (e) {
          console.warn('[singular] conversionValueUpdated handler failed:', e);
        }
      });
    }
    if (__DEV__) config.withLoggingEnabled();
    Singular.init(config);
    inited = true;
    return true;
  } catch (e) {
    console.warn('[singular] init failed:', e);
    return false;
  }
}

/** True when Singular has been successfully initialized this session. */
export function isSingularReady(): boolean {
  return inited && getModule() !== null;
}

export function singularSetCustomUserId(customUserId: string): void {
  if (!isUsableString(customUserId)) return;
  if (!isSingularReady()) return;
  try {
    getModule()!.Singular.setCustomUserId(customUserId);
  } catch (e) {
    console.warn('[singular] setCustomUserId failed:', e);
  }
}

export function singularUnsetCustomUserId(): void {
  if (!isSingularReady()) return;
  try {
    getModule()!.Singular.unsetCustomUserId();
  } catch (e) {
    console.warn('[singular] unsetCustomUserId failed:', e);
  }
}

export function singularEvent(eventName: string, args?: SerializableArgs): void {
  if (!isUsableString(eventName)) return;
  if (!isSingularReady()) return;
  try {
    const { Singular } = getModule()!;
    const clean = sanitizeArgs(args);
    if (clean) Singular.eventWithArgs(eventName, clean);
    else Singular.event(eventName);
  } catch (e) {
    console.warn('[singular] event failed:', e);
  }
}

/**
 * Log a currency-aware revenue event. Currently unused: subscription revenue is
 * reported by the RevenueCat → Singular server integration, so sending revenue
 * from the client too would double-count it (see `analytics.ts`).
 */
export function singularCustomRevenue(
  eventName: string,
  currency: string,
  amount: number,
  args?: SerializableArgs,
): void {
  if (!isUsableString(eventName) || !isUsableString(currency) || !isUsableNumber(amount)) {
    return;
  }
  if (!isSingularReady()) return;
  try {
    const { Singular } = getModule()!;
    const clean = sanitizeArgs(args);
    if (clean) {
      Singular.customRevenueWithArgs(eventName, currency, amount, clean);
    } else {
      Singular.customRevenue(eventName, currency, amount);
    }
  } catch (e) {
    console.warn('[singular] customRevenue failed:', e);
  }
}

/**
 * Push a SKAdNetwork conversion value to Singular (iOS only). Only meaningful
 * when the app runs in manual SKAN mode; returns whether the SDK accepted it.
 */
export function singularSkanUpdateConversionValue(conversionValue: number): boolean {
  if (!isSingularReady() || Platform.OS !== 'ios') return false;
  // A fine conversion value is 6 bits; StoreKit raises on anything outside 0–63.
  if (!isUsableNumber(conversionValue)) return false;
  const value = Math.round(conversionValue);
  if (value < 0 || value > 63) return false;
  try {
    return getModule()!.Singular.skanUpdateConversionValue(value) === true;
  } catch (e) {
    console.warn('[singular] skanUpdateConversionValue failed:', e);
    return false;
  }
}

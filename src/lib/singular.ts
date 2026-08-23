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
 *
 * IMPORTANT — why every native call below is queued rather than called inline:
 * on React Native 0.81 (New Architecture) an NSException raised inside a *void*
 * TurboModule method aborts the process and CANNOT be caught from JS.
 * RCTTurboModule.mm's performVoidMethodInvocation runs the call on an async
 * dispatch queue and, on NSException, does
 * `throw convertNSExceptionToJSError(...)` — a C++ throw on a queue with no
 * handler above it, so it unwinds to std::terminate/abort(). By then the JS
 * call has long since returned, so a try/catch around the call site catches
 * nothing. Upstream fixed this in 0.85 (facebook/react-native#56265) by logging
 * instead of rethrowing; 0.81 has no such protection.
 *
 * Every Singular method we use is a void method, so the only lever we have is
 * WHEN we call them. facebook/react-native#55390 identifies the common trigger
 * as native modules being torn down while async void methods are in flight,
 * and names analytics modules specifically. So calls are deferred off the
 * current frame, serialized, and only made while the app is foreground-active.
 */

import { AppState, InteractionManager, Platform } from 'react-native';
import type { NativeEventSubscription } from 'react-native';
import { singularConfig } from './singularConfig';

type SingularModule = typeof import('singular-react-native');
type SerializableArgs = Record<string, string | number | boolean | null>;

/**
 * Singular's session timeout, in seconds. Must be set explicitly: SingularConfig
 * defaults `sessionTimeout` to -1 ("use the SDK default"), and while the old iOS
 * bridge screens that out (`if ([sessionTimeout intValue] >= 0)`), the new-arch
 * bridge forwards it unguarded, so `[Singular setSessionTimeout:-1]` runs on
 * every launch under the New Architecture. 60s is the SDK's own default.
 */
const SESSION_TIMEOUT_SECONDS = 60;

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

/** Drop the oldest queued calls rather than grow without bound if the app never
 *  returns to the foreground. Analytics is expendable; memory is not. */
const MAX_PENDING_CALLS = 50;

type PendingCall = { run: () => void; essential: boolean };

let pendingCalls: PendingCall[] = [];
let flushScheduled = false;
let foregroundSubscription: NativeEventSubscription | null = null;

function waitForForeground(): void {
  if (foregroundSubscription) return;
  foregroundSubscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    foregroundSubscription?.remove();
    foregroundSubscription = null;
    scheduleFlush();
  });
}

function flushPendingCalls(): void {
  flushScheduled = false;
  // Never invoke the bridge while backgrounded: that's precisely when the
  // module can be torn down mid-invocation, which is the documented trigger for
  // the uncatchable void-method abort. Leave the work queued instead.
  if (AppState.currentState !== 'active') {
    waitForForeground();
    return;
  }
  const calls = pendingCalls;
  pendingCalls = [];
  for (const call of calls) {
    // Catches JS-side failures only; a native NSException from a void method
    // cannot reach here (see the file header).
    try {
      call.run();
    } catch (e) {
      console.warn('[singular] native call failed:', e);
    }
  }
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  // runAfterInteractions keeps the call out of navigation/animation commits;
  // the extra timeout hop guarantees it never runs inside the frame (or the
  // unmount) that requested it.
  InteractionManager.runAfterInteractions(() => {
    setTimeout(flushPendingCalls, 0);
  });
}

/** Queue a native Singular call for deferred, serialized, foreground-only execution. */
function enqueueNativeCall(call: () => void, essential = false): void {
  pendingCalls.push({ run: call, essential });
  if (pendingCalls.length > MAX_PENDING_CALLS) {
    // Shed the oldest expendable call. `init` must survive, or everything
    // behind it would run against an SDK that was never started.
    const expendable = pendingCalls.findIndex((entry) => !entry.essential);
    pendingCalls.splice(expendable >= 0 ? expendable : 0, 1);
  }
  scheduleFlush();
}

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
  // Both warnings are deliberately UNGATED. A release build whose attribution
  // never started looks exactly like one that started fine — no crash, no log,
  // no events — and Singular's own SDK logging cannot fill the gap on iOS (see
  // the note on withLoggingEnabled below). These two lines are the only signal
  // a TestFlight/App Store build gives that the SDK is not running at all.
  if (!isSingularConfigured) {
    console.warn('[singular] not configured — placeholder key/secret');
    return false;
  }
  const mod = getModule();
  if (!mod) {
    console.warn('[singular] native module unavailable');
    return false;
  }
  try {
    const { Singular, SingularConfig } = mod;
    const attTimeout = isUsableNumber(opts.attTimeoutSeconds)
      ? Math.max(0, Math.round(opts.attTimeoutSeconds))
      : 300;
    const config = new SingularConfig(singularConfig.sdkKey, singularConfig.sdkSecret)
      .withSkAdNetworkEnabled(true)
      .withSessionTimeoutInSec(SESSION_TIMEOUT_SECONDS)
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
    // ANDROID ONLY, and there is no JS-side fix. singular-react-native@4.2.0
    // never applies `enableLogging`/`logLevel` to the native iOS SingularConfig:
    // SingularBridgeNewArch.mm's `init:` sets fourteen other fields and skips
    // both, and SingularBridgeOldArch.m does the same. Raising the log level or
    // dropping this __DEV__ gate cannot produce iOS output — the console.warn
    // calls above and in analytics.ts are the only iOS diagnostics available.
    if (__DEV__) config.withLoggingEnabled();
    // Queued like every other native call, which also keeps init strictly
    // ordered ahead of the events queued behind it.
    enqueueNativeCall(() => Singular.init(config), true);
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
  enqueueNativeCall(() => {
    getModule()?.Singular.setCustomUserId(customUserId);
  });
}

export function singularUnsetCustomUserId(): void {
  if (!isSingularReady()) return;
  enqueueNativeCall(() => {
    getModule()?.Singular.unsetCustomUserId();
  });
}

export function singularEvent(eventName: string, args?: SerializableArgs): void {
  if (!isUsableString(eventName)) return;
  if (!isSingularReady()) return;
  // Sanitize now, while we still have the caller's values, then hand the bridge
  // only primitives it is guaranteed to be able to marshal.
  const clean = sanitizeArgs(args);
  enqueueNativeCall(() => {
    const mod = getModule();
    if (!mod) return;
    if (clean) mod.Singular.eventWithArgs(eventName, clean);
    else mod.Singular.event(eventName);
  });
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
  const clean = sanitizeArgs(args);
  enqueueNativeCall(() => {
    const mod = getModule();
    if (!mod) return;
    if (clean) {
      mod.Singular.customRevenueWithArgs(eventName, currency, amount, clean);
    } else {
      mod.Singular.customRevenue(eventName, currency, amount);
    }
  });
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
  // Unlike the void methods above, this one returns a value, so RN routes it
  // through performMethodInvocation, which converts an NSException into a
  // catchable JSError on the JS thread. A try/catch here is therefore real
  // protection, and the call does not need deferring.
  try {
    return getModule()!.Singular.skanUpdateConversionValue(value) === true;
  } catch (e) {
    console.warn('[singular] skanUpdateConversionValue failed:', e);
    return false;
  }
}

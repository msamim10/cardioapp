/**
 * Hosted paywall presented as OUR OWN full-screen route
 * (`src/app/hosted-paywall.tsx`, docs/PAYWALL.md).
 *
 * `RevenueCatUI.presentPaywall()` shows the paywall as an iOS page sheet
 * (rounded corners, swipe-to-dismiss). To get a true full-screen paywall the
 * `Paywall` component from `react-native-purchases-ui` is rendered inside an
 * expo-router `fullScreenModal` screen instead, and the promise the rest of
 * the app awaits (`SubscriptionContext.presentPaywall` → `PaywallUIResult`)
 * is resolved from the screen's callbacks.
 *
 * This file is the pure part:
 *   - `reducePaywallRoute` maps the component's callbacks onto the SAME
 *     result the SDK's `presentPaywall()` would have returned. RevenueCat's
 *     proxy keeps a running result (`cancelled` until something happens,
 *     `error` after a failed purchase, `purchased` / `restored` on success)
 *     and hands it over when the paywall closes; this does the same, and
 *     settles early on a purchase or an entitling restore so the screen can
 *     pop without waiting for the SDK's own dismissal request.
 *   - `createPaywallRequestRegistry` hands out one request id per
 *     presentation. The id travels as a route param; the screen looks up the
 *     offering by it and settles the promise exactly once. An unmount before
 *     any callback (root gate redirect, app kill) settles as `cancelled`, so
 *     no caller can hang on an abandoned screen.
 *
 * No React, no navigation, no RevenueCat import — `npm run test:paywall-route`
 * replays it in Node.
 */

import type { PurchasesOffering } from 'react-native-purchases';
import type { PaywallUIResult } from './purchases';

export type PaywallRouteEvent =
  /** `onPurchaseCompleted` */
  | { type: 'purchase_completed' }
  /** `onPurchaseError` — the paywall stays up, the user may retry or close. */
  | { type: 'purchase_error' }
  /** `onPurchaseCancelled` — the StoreKit sheet was dismissed. */
  | { type: 'purchase_cancelled' }
  /** `onRestoreCompleted`; `premium` says whether OUR entitlement is active now. */
  | { type: 'restore_completed'; premium: boolean }
  /** `onDismiss` (the SDK's close, a V2 "dismiss" action, or our own X). */
  | { type: 'dismiss' }
  /** The screen unmounted without any of the above. */
  | { type: 'unmount' };

export type PaywallRouteState = {
  /** What closing the paywall right now would report. */
  pending: PaywallUIResult;
  /** Set once; the promise resolves with this and the screen pops. */
  settled: PaywallUIResult | null;
};

export const INITIAL_PAYWALL_ROUTE_STATE: PaywallRouteState = { pending: 'cancelled', settled: null };

export function reducePaywallRoute(state: PaywallRouteState, event: PaywallRouteEvent): PaywallRouteState {
  if (state.settled !== null) return state;
  switch (event.type) {
    case 'purchase_completed':
      return { pending: 'purchased', settled: 'purchased' };
    case 'restore_completed':
      // A restore that does not carry the entitlement leaves the paywall up
      // (RevenueCat shows its own "nothing to restore" alert); closing it then
      // reports whatever was pending, never a grant.
      return event.premium ? { pending: 'restored', settled: 'restored' } : state;
    case 'purchase_error':
      return { ...state, pending: 'error' };
    case 'purchase_cancelled':
      return { ...state, pending: 'cancelled' };
    case 'dismiss':
      return { ...state, settled: state.pending };
    case 'unmount':
      return { ...state, settled: 'cancelled' };
    default:
      return state;
  }
}

export type PaywallRequestOptions = {
  offering: PurchasesOffering | null;
};

export type PaywallRequest = {
  id: string;
  promise: Promise<PaywallUIResult>;
};

export type PaywallRequestRegistry = {
  /** Register a presentation; the id goes into the route params. */
  open(options: PaywallRequestOptions): PaywallRequest;
  /** The options for an open request (the screen reads the offering), or null. */
  peek(id: string | null | undefined): PaywallRequestOptions | null;
  /** Resolve the request once. Returns false when unknown or already settled. */
  settle(id: string | null | undefined, result: PaywallUIResult): boolean;
  has(id: string | null | undefined): boolean;
  readonly size: number;
};

const defaultIdFactory = (() => {
  let counter = 0;
  return () => {
    counter += 1;
    return `paywall-${Date.now().toString(36)}-${counter}`;
  };
})();

export function createPaywallRequestRegistry(nextId: () => string = defaultIdFactory): PaywallRequestRegistry {
  type Entry = PaywallRequestOptions & { resolve: (result: PaywallUIResult) => void };
  const entries = new Map<string, Entry>();
  return {
    open(options) {
      const id = nextId();
      let resolve!: (result: PaywallUIResult) => void;
      const promise = new Promise<PaywallUIResult>((done) => {
        resolve = done;
      });
      entries.set(id, { ...options, resolve });
      return { id, promise };
    },
    peek(id) {
      if (!id) return null;
      const entry = entries.get(id);
      return entry ? { offering: entry.offering } : null;
    },
    settle(id, result) {
      if (!id) return false;
      const entry = entries.get(id);
      if (!entry) return false;
      entries.delete(id);
      entry.resolve(result);
      return true;
    },
    has(id) {
      return !!id && entries.has(id);
    },
    get size() {
      return entries.size;
    },
  };
}

/** The app-wide registry the presenter and the route share. */
export const paywallRequests = createPaywallRequestRegistry();

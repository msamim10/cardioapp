import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { isRevenueCatConfigured } from './config';
import { useAuth } from './AuthContext';
import {
  addCustomerInfoListener,
  checkPremium,
  configurePurchases,
  getCustomerInfoSafe,
  hasPremium,
  presentCustomerCenterUI,
  presentPaywallUI,
  purchaseByPlan,
  reportConversionAfterPurchase,
  restorePremium,
  synchronizePurchasesIdentity,
  type PaywallUIResult,
  type PlanKey,
  type PurchaseOutcome,
} from './purchases';
import { syncAnalyticsIdentity } from './analytics';
import type { PurchasesOffering } from 'react-native-purchases';

/**
 * Subscription state built on the RevenueCat wrapper (`purchases.ts`).
 *
 * `isPremium` is the app-wide "is subscribed" flag, gated on the env entitlement
 * (`cardioapp_pro`). It's kept in sync via a CustomerInfo update listener so it
 * reflects purchases/restores/renewals made through the hosted Paywall UI and
 * Customer Center. When RevenueCat isn't configured (placeholder keys / Expo
 * Go), everything no-ops and `isPremium` stays false — the paywall's flow still
 * completes for testing.
 */

type SubscriptionContextValue = {
  /** True once the initial entitlement check has resolved. */
  hydrated: boolean;
  /** Whether a usable RevenueCat key + native module are present. */
  isConfigured: boolean;
  isPremium: boolean;
  /** Re-check entitlement status from RevenueCat. */
  refresh: () => Promise<void>;
  /** Purchase a plan tier via the native purchase flow (custom UI path). */
  purchase: (plan: PlanKey) => Promise<PurchaseOutcome>;
  /** Returns whether premium is active after restore (null when unavailable). */
  restore: () => Promise<boolean | null>;
  /** Present the hosted RevenueCat Paywall UI. */
  presentPaywall: (opts?: {
    ifNeeded?: boolean;
    offering?: PurchasesOffering | null;
  }) => Promise<PaywallUIResult>;
  /** Present the hosted RevenueCat Customer Center. Returns false if unavailable. */
  presentCustomerCenter: () => Promise<boolean>;
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { hydrated: authHydrated, user } = useAuth();
  const [hydrated, setHydrated] = useState(false);
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      if (isRevenueCatConfigured && (await configurePurchases()) && active) {
        // Keep entitlement state live across purchases/restores/renewals.
        unsubscribe = addCustomerInfoListener((info) => {
          setIsPremium(hasPremium(info));
        });
        const premium = await checkPremium();
        if (active && premium !== null) setIsPremium(premium);
      }
      if (active) setHydrated(true);
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!authHydrated || !isRevenueCatConfigured) return;
    let active = true;
    (async () => {
      const info = await synchronizePurchasesIdentity(user?.id ?? null);
      if (active && info) setIsPremium(hasPremium(info));
    })();
    return () => {
      active = false;
    };
  }, [authHydrated, user?.id]);

  // Mirror the SAME identifier passed to RevenueCat's appUserID onto Singular's
  // Custom User ID, so attribution joins to billing. Not gated on RevenueCat
  // config — Singular identity should track auth regardless.
  useEffect(() => {
    if (!authHydrated) return;
    syncAnalyticsIdentity(user?.id ?? null);
  }, [authHydrated, user?.id]);

  const refresh = useCallback<SubscriptionContextValue['refresh']>(async () => {
    const info = await getCustomerInfoSafe();
    if (info !== null) setIsPremium(hasPremium(info));
  }, []);

  const purchase = useCallback<SubscriptionContextValue['purchase']>(async (plan) => {
    const outcome = await purchaseByPlan(plan);
    if (outcome.status === 'purchased' && outcome.premium) setIsPremium(true);
    return outcome;
  }, []);

  const restore = useCallback<SubscriptionContextValue['restore']>(async () => {
    const premium = await restorePremium();
    if (premium !== null) setIsPremium(premium);
    return premium;
  }, []);

  const presentPaywall = useCallback<SubscriptionContextValue['presentPaywall']>(
    async (opts) => {
      const result = await presentPaywallUI(opts);
      // The listener updates isPremium, but refresh immediately for snappiness.
      if (result === 'purchased' || result === 'restored') {
        await refresh();
      }
      // Local funnel + SKAN ladder for hosted-UI purchases (the custom path
      // records inline in purchaseByPlan); restores aren't new conversions.
      // RevenueCat's server integration owns the canonical Singular revenue events.
      if (result === 'purchased') {
        void reportConversionAfterPurchase();
      }
      return result;
    },
    [refresh]
  );

  const presentCustomerCenter = useCallback<
    SubscriptionContextValue['presentCustomerCenter']
  >(async () => {
    const opened = await presentCustomerCenterUI();
    if (opened) await refresh();
    return opened;
  }, [refresh]);

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      hydrated,
      isConfigured: isRevenueCatConfigured,
      isPremium,
      refresh,
      purchase,
      restore,
      presentPaywall,
      presentCustomerCenter,
    }),
    [hydrated, isPremium, refresh, purchase, restore, presentPaywall, presentCustomerCenter]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within a SubscriptionProvider');
  return ctx;
}

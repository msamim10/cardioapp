import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HOSTED_PAYWALL_REQUEST_PARAM } from '@/lib/hostedPaywall';
import {
  INITIAL_PAYWALL_ROUTE_STATE,
  paywallRequests,
  reducePaywallRoute,
  type PaywallRouteEvent,
  type PaywallRouteState,
} from '@/lib/paywallRoute';
import { getPaywallView, hasPremium } from '@/lib/purchases';
import { colors, spacing } from '@/theme';

/**
 * The hosted RevenueCat paywall, full screen (docs/PAYWALL.md → "Hosted
 * paywall presentation"). Registered in `_layout.tsx` as a `fullScreenModal`
 * with `gestureEnabled: false`, so it covers the presenting screen edge to
 * edge and cannot be swiped away half-read. Presented only through
 * `presentHostedPaywallScreen` (`hostedPaywall.ts`), which passes a request
 * id in the route params; this screen settles that request exactly once
 * from the `Paywall` component's callbacks (`reducePaywallRoute`) and pops
 * itself, so the presenting screen (level brief, first-run-ready, profile)
 * is what the user lands back on.
 *
 * Close button: the paywall fills the screen without a SafeAreaView so the
 * hero runs under the status bar. The SDK's own close button is turned off
 * (`displayCloseButton: false` — it only exists for legacy templates and
 * sits top-left; a V2 paywall ignores the flag and only has a close if the
 * design includes one), and our own X is overlaid top-right inside the
 * safe-area inset instead. With gestures off and no sheet to swipe, that X
 * is the one guaranteed way out on every template; it reports `cancelled`,
 * the same as the SDK's dismissal.
 */
export default function HostedPaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ [HOSTED_PAYWALL_REQUEST_PARAM]?: string | string[] }>();
  const raw = params[HOSTED_PAYWALL_REQUEST_PARAM];
  const requestId = Array.isArray(raw) ? raw[0] : raw;
  // Read once: the request is removed from the registry when it settles, and
  // the offering must not vanish from under the SDK view on a re-render.
  const request = useMemo(() => paywallRequests.peek(requestId), [requestId]);
  const Paywall = useMemo(() => getPaywallView(), []);

  const stateRef = useRef<PaywallRouteState>(INITIAL_PAYWALL_ROUTE_STATE);
  const poppedRef = useRef(false);

  const pop = useCallback(() => {
    if (poppedRef.current) return;
    poppedRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  const handle = useCallback(
    (event: PaywallRouteEvent) => {
      const next = reducePaywallRoute(stateRef.current, event);
      stateRef.current = next;
      if (next.settled === null) return;
      paywallRequests.settle(requestId, next.settled);
      if (event.type !== 'unmount') pop();
    },
    [pop, requestId],
  );
  const handleRef = useRef(handle);
  handleRef.current = handle;

  // Unmounting for any other reason (root gate redirect, app relaunch with a
  // stale route) still settles the caller's promise: `cancelled`. Through a
  // ref so a re-created callback can never fire it early.
  useEffect(() => () => handleRef.current({ type: 'unmount' }), []);

  // Nothing to show (no SDK view here, or a stale/unknown request id after a
  // reload): leave at once rather than sit on a black screen.
  const renderable = Paywall !== null && request !== null;
  useEffect(() => {
    if (renderable) return;
    handle({ type: 'dismiss' });
  }, [handle, renderable]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {renderable ? (
        <Paywall
          style={styles.paywall}
          options={{ offering: request.offering ?? undefined, displayCloseButton: false }}
          onPurchaseCompleted={() => handle({ type: 'purchase_completed' })}
          onPurchaseError={() => handle({ type: 'purchase_error' })}
          onPurchaseCancelled={() => handle({ type: 'purchase_cancelled' })}
          onRestoreCompleted={({ customerInfo }) =>
            handle({ type: 'restore_completed', premium: hasPremium(customerInfo) })
          }
          onDismiss={() => handle({ type: 'dismiss' })}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={10}
        onPress={() => handle({ type: 'dismiss' })}
        style={({ pressed }) => [styles.close, { top: insets.top + spacing.sm }, pressed && styles.pressed]}
      >
        <Ionicons name="close" size={22} color={colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  paywall: { flex: 1 },
  close: {
    position: 'absolute',
    right: spacing.lg,
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  pressed: { opacity: 0.75 },
});

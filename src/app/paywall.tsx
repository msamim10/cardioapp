import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/ui';
import { logPaywallViewed } from '@/lib/analytics';
import { useSubscription } from '@/lib/SubscriptionContext';
import {
  describeIntroTrial,
  getCurrentOffering,
  resolvePlanPackage,
  type PlanKey,
} from '@/lib/purchases';
import { PRIVACY_POLICY_URL, TERMS_URL, openLegalUrl } from '@/lib/legal';
import { colors, font, gradients, radius, spacing } from '@/theme';

/**
 * Dismissible subscription gate (fallback when hosted RevenueCat UI unavailable).
 *
 * Open with `?mode=gate`. Close / "Maybe later" calls `router.back()`. On
 * purchase or restore, navigates to `/preflight` when run params are present,
 * otherwise returns to the previous screen.
 */

type Plan = {
  id: PlanKey;
  title: string;
  cadence: string;
};

// Prices, per-week sub-copy, savings badge, and trial length are ALL derived
// from the live RevenueCat Offering at runtime. We deliberately do NOT hardcode
// dollar amounts here: the App Store prices changed (e.g. yearly is now $69.99),
// and flashing a stale number is worse than briefly showing a loading state.
const PLANS: Plan[] = [
  { id: 'yearly', title: 'Yearly', cadence: 'per year' },
  { id: 'monthly', title: 'Monthly', cadence: 'per month' },
];

type LivePrice = { price: string; sub?: string; trial?: string; amount?: number };

// Fallback trial length when the live RevenueCat intro offer isn't loaded yet.
// Must match the intro offer configured in App Store Connect (currently 3 days).
const DEFAULT_TRIAL_LABEL = '3-day';

const VALUE_STACK: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  { icon: 'infinite', title: 'Every world unlocked', sub: 'All levels — Neon Rails, Red Light Rush, Wild City & more' },
  { icon: 'sparkles', title: 'New worlds every week', sub: 'Fresh video levels dropped weekly' },
  { icon: 'flash', title: 'No limits', sub: 'Unlimited runs, no daily caps or ads' },
  { icon: 'trophy', title: 'Full rewards', sub: 'Every badge, coin multiplier & leaderboard' },
];

export default function PaywallScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string | string[];
    level?: string | string[];
    name?: string | string[];
    speed?: string | string[];
    duration?: string | string[];
    classKey?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const { isConfigured, purchase, restore } = useSubscription();

  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const isGate = mode === 'gate';

  const [selected, setSelected] = useState<PlanKey>('yearly');
  const [busy, setBusy] = useState(false);
  const [livePrices, setLivePrices] = useState<Partial<Record<PlanKey, LivePrice>>>({});
  // Distinguishes "still loading offering" (show skeletons) from "loaded but no
  // live prices available" (RevenueCat unconfigured / Expo Go → generic copy).
  const [pricesResolved, setPricesResolved] = useState(false);

  // The custom fallback paywall is being shown → record the funnel view once.
  useEffect(() => {
    logPaywallViewed('custom');
  }, []);

  const param = (key: keyof typeof params) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const dismiss = () => {
    router.back();
  };

  const finishGranted = () => {
    const level = param('level');
    if (isGate && level) {
      router.replace({
        pathname: '/preflight',
        params: {
          level,
          name: param('name') ?? '',
          speed: param('speed') ?? '',
          duration: param('duration') ?? '',
          ...(param('classKey') ? { classKey: param('classKey')! } : {}),
        },
      });
      return;
    }
    dismiss();
  };

  useEffect(() => {
    // Without a configured RevenueCat SDK there is no live price to fetch, so
    // resolve immediately into the "generic copy" state rather than waiting.
    if (!isConfigured) {
      setPricesResolved(true);
      return;
    }
    let active = true;
    (async () => {
      const offering = await getCurrentOffering();
      if (!active) return;
      const next: Partial<Record<PlanKey, LivePrice>> = {};
      if (offering) {
        for (const plan of PLANS) {
          const pkg = resolvePlanPackage(offering, plan.id);
          if (pkg) {
            next[plan.id] = {
              price: pkg.product.priceString,
              amount: pkg.product.price,
              sub: pkg.product.pricePerWeekString
                ? `${pkg.product.pricePerWeekString} / week`
                : undefined,
              trial: describeIntroTrial(pkg) ?? undefined,
            };
          }
        }
      }
      if (active) {
        if (Object.keys(next).length > 0) setLivePrices(next);
        setPricesResolved(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [isConfigured]);

  // Live-only price. Returns null until the real Offering price resolves so the
  // UI can render a skeleton instead of a stale/incorrect hardcoded amount.
  const priceFor = (plan: Plan): string | null => livePrices[plan.id]?.price ?? null;
  const subFor = (plan: Plan): string | null => livePrices[plan.id]?.sub ?? null;
  const selectedPlan = PLANS.find((p) => p.id === selected);
  // Trial length is read from the live intro offer; fall back to the ASC-configured
  // length only for wording (this is not a price, so it can't flash a wrong amount).
  const trialLabel =
    (selectedPlan ? livePrices[selectedPlan.id]?.trial : undefined) ?? DEFAULT_TRIAL_LABEL;

  // Accurate savings badge computed from live amounts (yearly vs 12× monthly).
  // Hidden until both live prices are known so we never assert a fabricated %.
  const yearlyAmount = livePrices.yearly?.amount;
  const monthlyAmount = livePrices.monthly?.amount;
  const savingsPercent =
    typeof yearlyAmount === 'number' &&
    typeof monthlyAmount === 'number' &&
    monthlyAmount > 0 &&
    yearlyAmount < monthlyAmount * 12
      ? Math.round((1 - yearlyAmount / (monthlyAmount * 12)) * 100)
      : null;
  const badgeFor = (plan: Plan): string | null =>
    plan.id === 'yearly' && savingsPercent && savingsPercent > 0 ? `SAVE ${savingsPercent}%` : null;

  const handlePurchase = async () => {
    if (busy || !selectedPlan) return;
    setBusy(true);
    try {
      const outcome = await purchase(selectedPlan.id);
      switch (outcome.status) {
        case 'purchased':
          finishGranted();
          break;
        case 'unavailable':
          if (!isConfigured) finishGranted();
          break;
        case 'cancelled':
          break;
        case 'error':
          Alert.alert('Purchase failed', 'Something went wrong. Please try again.');
          break;
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const premium = await restore();
      if (premium === true) {
        finishGranted();
      } else if (premium === null && !isConfigured) {
        finishGranted();
      } else {
        Alert.alert('Nothing to restore', 'No previous purchases were found for this account.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 260 }]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={dismiss} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={colors.textDim} />
        </Pressable>

        <LinearGradient colors={gradients.violet} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroEyebrow}>CARDIOSURF PRO</Text>
          <Text style={styles.heroTitle}>Unlock every world</Text>
          <Text style={styles.heroSub}>Turn every workout into a game you can&apos;t put down.</Text>
        </LinearGradient>

        <View style={styles.valueStack}>
          {VALUE_STACK.map((v) => (
            <View key={v.title} style={styles.valueRow}>
              <View style={styles.valueIcon}>
                <Ionicons name={v.icon} size={20} color={colors.lime} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.valueTitle}>{v.title}</Text>
                <Text style={styles.valueSub}>{v.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.plans}>
          {PLANS.map((plan) => {
            const active = selected === plan.id;
            const price = priceFor(plan);
            const sub = subFor(plan);
            const badge = badgeFor(plan);
            return (
              <Pressable
                key={plan.id}
                onPress={() => setSelected(plan.id)}
                style={({ pressed }) => [
                  styles.plan,
                  active && styles.planActive,
                  pressed && styles.pressed,
                ]}
              >
                {badge ? (
                  <View style={styles.planBadge}>
                    <Text style={styles.planBadgeText}>{badge}</Text>
                  </View>
                ) : null}
                <View style={styles.planLeft}>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active ? <Ionicons name="checkmark" size={14} color={colors.black} /> : null}
                  </View>
                  <View>
                    <Text style={styles.planTitle}>{plan.title}</Text>
                    <View style={styles.priceRow}>
                      {price ? (
                        <Text style={styles.planPrice}>
                          {price} <Text style={styles.planCadence}>{plan.cadence}</Text>
                        </Text>
                      ) : pricesResolved ? (
                        // Loaded, but no live price (RevenueCat unavailable): show
                        // the cadence only — never a fabricated dollar amount.
                        <Text style={styles.planCadence}>{plan.cadence}</Text>
                      ) : (
                        <View style={styles.priceSkeleton} />
                      )}
                    </View>
                  </View>
                </View>
                {sub ? (
                  <Text style={styles.perWeek}>{sub}</Text>
                ) : !pricesResolved ? (
                  <View style={styles.subSkeleton} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <LinearGradient
        colors={['rgba(10,10,15,0)', colors.bg] as const}
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
      >
        <View style={styles.trialRow}>
          <Ionicons name="lock-open" size={14} color={colors.textDim} />
          <Text style={styles.trialText}>
            {(() => {
              const selectedPrice = selectedPlan ? priceFor(selectedPlan) : null;
              // Only assert "then <price>" once the live price is known; otherwise
              // show just the trial line so we never render a stale amount.
              return selectedPrice
                ? `${trialLabel} free trial, then ${selectedPrice}`
                : `${trialLabel} free trial`;
            })()}
          </Text>
        </View>
        <GradientButton
          label={`START ${trialLabel.toUpperCase()} FREE TRIAL`}
          icon="rocket"
          accent="lime"
          onPress={handlePurchase}
        />
        <Text style={styles.disclosure}>
          Billed to your Apple ID. Your subscription renews automatically unless canceled at least 24 hours before the end of the current period. Manage or cancel anytime in your App Store account settings.
        </Text>
        <View style={styles.linksRow}>
          <Pressable onPress={handleRestore} hitSlop={8}>
            <Text style={styles.link}>Restore Purchases</Text>
          </Pressable>
          <Text style={styles.linkDot}>·</Text>
          <Pressable onPress={() => openLegalUrl(TERMS_URL)} hitSlop={8}>
            <Text style={styles.link}>Terms of Use</Text>
          </Pressable>
          <Text style={styles.linkDot}>·</Text>
          <Pressable onPress={() => openLegalUrl(PRIVACY_POLICY_URL)} hitSlop={8}>
            <Text style={styles.link}>Privacy Policy</Text>
          </Pressable>
          <Text style={styles.linkDot}>·</Text>
          <Pressable onPress={dismiss} hitSlop={8}>
            <Text style={styles.link}>Maybe later</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  close: { alignSelf: 'flex-end', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  hero: { borderRadius: radius.xl, padding: spacing.xl, marginTop: -spacing.sm },
  heroEyebrow: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: font.black, letterSpacing: 2 },
  heroTitle: { color: colors.white, fontSize: 32, fontWeight: font.black, letterSpacing: -0.6, marginTop: 4 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: font.medium, marginTop: spacing.sm, lineHeight: 21 },
  valueStack: { gap: spacing.lg },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  valueIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueTitle: { color: colors.text, fontSize: 16, fontWeight: font.bold },
  valueSub: { color: colors.textDim, fontSize: 13, fontWeight: font.medium, marginTop: 1 },
  plans: { gap: spacing.md },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  planActive: { borderColor: colors.lime, backgroundColor: colors.surface2 },
  planBadge: {
    position: 'absolute',
    top: -10,
    left: spacing.lg,
    backgroundColor: colors.lime,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  planBadgeText: { color: colors.black, fontSize: 10, fontWeight: font.black, letterSpacing: 0.5 },
  planLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  radio: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { backgroundColor: colors.lime, borderColor: colors.lime },
  planTitle: { color: colors.text, fontSize: 17, fontWeight: font.black },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, minHeight: 18 },
  priceSkeleton: {
    width: 96,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  subSkeleton: {
    width: 64,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  planPrice: { color: colors.text, fontSize: 14, fontWeight: font.bold },
  planCadence: { color: colors.textDim, fontSize: 13, fontWeight: font.medium },
  perWeek: { color: colors.textDim, fontSize: 13, fontWeight: font.bold, flexShrink: 1, textAlign: 'right' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    gap: spacing.sm,
  },
  trialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  trialText: { color: colors.textDim, fontSize: 13, fontWeight: font.semibold },
  disclosure: {
    color: colors.textFaint,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: font.medium,
    textAlign: 'center',
    marginTop: 2,
  },
  linksRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' },
  link: { color: colors.textFaint, fontSize: 12, fontWeight: font.semibold },
  linkDot: { color: colors.textFaint, fontSize: 12 },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
});

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
import { colors, font, gradients, metric, radius, spacing, type } from '@/theme';

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
  /** Explicit subscription length, required on-screen by Guideline 3.1.2. */
  length: string;
  cadence: string;
  /** Adverb form of `cadence`, for sentence-shaped renewal copy. */
  renewal: string;
};

// Prices, per-week sub-copy, savings badge, and trial length are ALL derived
// from the live RevenueCat Offering at runtime. We deliberately do NOT hardcode
// dollar amounts here: the App Store prices changed (e.g. yearly is now $69.99),
// and flashing a stale number is worse than briefly showing a loading state.
const PLANS: Plan[] = [
  { id: 'yearly', title: 'Yearly', length: '12 months', cadence: 'per year', renewal: 'yearly' },
  { id: 'monthly', title: 'Monthly', length: '1 month', cadence: 'per month', renewal: 'monthly' },
];

type LivePrice = { price: string; sub?: string; trial?: string; amount?: number };

// Fallback trial length, used only until the live intro offer resolves. The two
// products are ASYMMETRIC in App Store Connect: yearly carries a 3-day
// introductory free trial, monthly has NONE and bills immediately. Claiming a
// trial on a plan that has no intro offer is a false subscription term, so this
// map is keyed per plan and monthly is deliberately absent.
const FALLBACK_TRIAL_LABEL: Partial<Record<PlanKey, string>> = { yearly: '3-day' };

const VALUE_STACK: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  { icon: 'infinite', title: 'Every world unlocked', sub: 'All levels — Neon Rails, Red Light Rush, Wild City & more' },
  { icon: 'layers', title: 'New worlds every week', sub: 'Fresh video levels added weekly' },
  { icon: 'flash', title: 'Unlimited training', sub: 'No daily caps, no ads' },
  { icon: 'trophy', title: 'Full progression', sub: 'Every badge, coin multiplier & leaderboard' },
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

  // A subscription gate must always have a reachable way out, even when it was
  // opened as the first route of the session.
  const dismiss = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
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
  // Trial length is read from the live intro offer; the per-plan fallback only
  // supplies wording before the offering resolves, and never invents a trial for
  // a plan that doesn't have one.
  const trialFor = (plan: Plan): string | null =>
    livePrices[plan.id]?.trial ?? (pricesResolved ? null : FALLBACK_TRIAL_LABEL[plan.id] ?? null);
  const selectedPlan = PLANS.find((p) => p.id === selected);
  const selectedTrial = selectedPlan ? trialFor(selectedPlan) : null;
  const selectedPrice = selectedPlan ? priceFor(selectedPlan) : null;

  // Guideline 3.1.2 wants the length, the price per period, and — where an
  // introductory offer exists — that it auto-converts and to what. The amount is
  // only ever named once the live Offering resolves it, so the copy degrades to
  // period-only wording rather than risking a stale figure.
  const pricePerPeriod =
    selectedPrice && selectedPlan ? `${selectedPrice} ${selectedPlan.cadence}` : null;
  const summaryLine = selectedTrial
    ? `${selectedTrial} free trial, then ${pricePerPeriod ?? `billed ${selectedPlan?.renewal}`}`
    : `${pricePerPeriod ?? `Billed ${selectedPlan?.renewal}`}, charged today`;
  const termsLine = selectedTrial
    ? `Your ${selectedTrial} free trial converts to a paid ${selectedPlan?.title} subscription${
        pricePerPeriod ? ` at ${pricePerPeriod}` : ''
      } unless you cancel at least 24 hours before it ends. Billed to your Apple ID and renews automatically. Manage or cancel anytime in your App Store account settings.`
    : `Your ${selectedPlan?.title} subscription has no free trial and is billed to your Apple ID today${
        pricePerPeriod ? ` at ${pricePerPeriod}` : ''
      }. It renews automatically unless canceled at least 24 hours before the end of the current period. Manage or cancel anytime in your App Store account settings.`;

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

        <LinearGradient colors={gradients.graphite} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.hero}>
          <Text style={styles.heroEyebrow}>CardioSurf Pro</Text>
          <Text style={styles.heroTitle}>Unlock every world</Text>
          <Text style={styles.heroSub}>
            Full-body cardio you&apos;ll actually finish. Every world, every week.
          </Text>
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
            const trial = trialFor(plan);
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
                  <View style={styles.planCopy}>
                    <Text style={styles.planTitle}>
                      {plan.title} <Text style={styles.planLength}>· {plan.length}</Text>
                    </Text>
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
                    <Text style={trial ? styles.planTrial : styles.planNoTrial}>
                      {trial
                        ? `${trial} free trial, then billed ${plan.renewal}`
                        : `No free trial — billed ${plan.renewal} from today`}
                    </Text>
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
          <Ionicons name={selectedTrial ? 'lock-open' : 'card-outline'} size={14} color={colors.textDim} />
          <Text style={styles.trialText}>{summaryLine}</Text>
        </View>
        <GradientButton
          label={
            selectedTrial
              ? `START ${selectedTrial.toUpperCase()} FREE TRIAL`
              : `SUBSCRIBE ${(selectedPlan?.title ?? '').toUpperCase()}`
          }
          icon={selectedTrial ? 'arrow-forward' : 'card'}
          accent="lime"
          onPress={handlePurchase}
        />
        <Text style={styles.disclosure}>{termsLine}</Text>
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
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginTop: -spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  heroEyebrow: { ...type.label, color: colors.lime, letterSpacing: 2 },
  heroTitle: { ...type.h1, color: colors.white, fontSize: 33, lineHeight: 36, marginTop: 6 },
  heroSub: {
    ...type.body,
    color: 'rgba(255,255,255,0.78)',
    marginTop: spacing.sm,
    maxWidth: 330,
  },
  valueStack: { gap: spacing.lg },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  valueIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueTitle: { ...type.h3, color: colors.text, fontSize: 16 },
  valueSub: { ...type.bodySm, color: colors.textDim, marginTop: 1 },
  plans: { gap: spacing.md },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planActive: { borderColor: colors.lime, backgroundColor: colors.surface2 },
  planBadge: {
    position: 'absolute',
    top: -9,
    left: spacing.lg,
    backgroundColor: colors.lime,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.xs,
  },
  planBadgeText: { ...type.micro, color: colors.black },
  planLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexShrink: 1 },
  planCopy: { flexShrink: 1 },
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
  planTitle: { color: colors.text, fontSize: 17, fontWeight: font.heavy, letterSpacing: -0.3 },
  planLength: { color: colors.textDim, fontSize: 13, fontWeight: font.medium, letterSpacing: 0 },
  planTrial: { color: colors.lime, fontSize: 12, fontWeight: font.bold, marginTop: 3 },
  planNoTrial: { color: colors.textFaint, fontSize: 12, fontWeight: font.semibold, marginTop: 3 },
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
  planPrice: { ...metric, color: colors.text, fontSize: 14, fontWeight: font.bold },
  planCadence: { color: colors.textDim, fontSize: 13, fontWeight: font.medium },
  perWeek: { ...metric, color: colors.textDim, fontSize: 13, fontWeight: font.bold, flexShrink: 1, textAlign: 'right' },
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
  link: { color: colors.textDim, fontSize: 12, fontWeight: font.semibold },
  linkDot: { color: colors.textFaint, fontSize: 12 },
  pressed: { opacity: 0.72 },
});

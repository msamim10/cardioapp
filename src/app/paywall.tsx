import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/ui';
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
  defaultPrice: string;
  cadence: string;
  defaultSub: string;
  badge?: string;
  anchor?: string;
};

const PLANS: Plan[] = [
  {
    id: 'yearly',
    title: 'Yearly',
    defaultPrice: '$39.99',
    cadence: 'per year',
    defaultSub: '$0.77 / week',
    badge: 'SAVE 66%',
    anchor: '$119.88',
  },
  {
    id: 'monthly',
    title: 'Monthly',
    defaultPrice: '$9.99',
    cadence: 'per month',
    defaultSub: '$2.49 / week',
  },
];

type LivePrice = { price: string; sub?: string; trial?: string };

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
    if (!isConfigured) return;
    let active = true;
    (async () => {
      const offering = await getCurrentOffering();
      if (!active || !offering) return;
      const next: Partial<Record<PlanKey, LivePrice>> = {};
      for (const plan of PLANS) {
        const pkg = resolvePlanPackage(offering, plan.id);
        if (pkg) {
          next[plan.id] = {
            price: pkg.product.priceString,
            sub: pkg.product.pricePerWeekString
              ? `${pkg.product.pricePerWeekString} / week`
              : undefined,
            trial: describeIntroTrial(pkg) ?? undefined,
          };
        }
      }
      if (active && Object.keys(next).length > 0) setLivePrices(next);
    })();
    return () => {
      active = false;
    };
  }, [isConfigured]);

  const priceFor = (plan: Plan) => livePrices[plan.id]?.price ?? plan.defaultPrice;
  const subFor = (plan: Plan) => livePrices[plan.id]?.sub ?? plan.defaultSub;
  const selectedPlan = PLANS.find((p) => p.id === selected);
  const trialLabel =
    (selectedPlan ? livePrices[selectedPlan.id]?.trial : undefined) ?? DEFAULT_TRIAL_LABEL;

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
                {plan.badge ? (
                  <View style={styles.planBadge}>
                    <Text style={styles.planBadgeText}>{plan.badge}</Text>
                  </View>
                ) : null}
                <View style={styles.planLeft}>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active ? <Ionicons name="checkmark" size={14} color={colors.black} /> : null}
                  </View>
                  <View>
                    <Text style={styles.planTitle}>{plan.title}</Text>
                    <View style={styles.priceRow}>
                      {plan.anchor ? <Text style={styles.anchor}>{plan.anchor}</Text> : null}
                      <Text style={styles.planPrice}>
                        {priceFor(plan)} <Text style={styles.planCadence}>{plan.cadence}</Text>
                      </Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.perWeek}>{subFor(plan)}</Text>
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
            {`${trialLabel} free trial, then ${selectedPlan ? priceFor(selectedPlan) : ''}`}
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
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  anchor: { color: colors.textFaint, fontSize: 13, fontWeight: font.medium, textDecorationLine: 'line-through' },
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

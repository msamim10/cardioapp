import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlanRingGauge } from '@/components/PlanRingGauge';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import { useAuth } from '@/lib/AuthContext';
import { markPlanReviewed } from '@/lib/funnelStore';
import { onboardingProgress } from '@/lib/onboarding';
import { presentOnboardingOffer } from '@/lib/onboardingOffer';
import { buildOnboardingPlan } from '@/lib/onboardingPlan';
import { useOnboarding } from '@/lib/OnboardingContext';
import { useProgress } from '@/lib/ProgressContext';
import { useSubscription } from '@/lib/SubscriptionContext';
import { colors, radius, spacing, type } from '@/theme';

/**
 * The plan hand-off, shown between account creation and the offer.
 *
 * Deliberately a readout rather than a written summary: the gauges are computed
 * from the user's own answers (see `buildOnboardingPlan`) and sweep in on mount,
 * so the screen reads as output the app produced rather than copy someone wrote.
 * That is what has to carry credibility immediately before a price.
 *
 * The offer is still presented by the shared `presentOnboardingOffer` helper, so
 * ATT ordering and the one-time paywall claim behave exactly as they do on the
 * auth screen, and `completeOnboarding` stays off the mount path — flipping it
 * here would make the root gate redirect straight to the tabs.
 */
export default function PlanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ userId?: string }>();
  const { answers, completeOnboarding } = useOnboarding();
  const { username } = useProgress();
  const { user } = useAuth();
  const { isPremium, presentPaywall } = useSubscription();
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);

  const plan = useMemo(() => buildOnboardingPlan(answers, username), [answers, username]);

  // Three gauges share the row, so the diameter has to come off the real width
  // rather than a fixed guess that overflows its cell on the smallest phones.
  const { width } = useWindowDimensions();
  const gaugeSize = useMemo(() => {
    const cell = (width - spacing.lg * 2 - spacing.sm * 2) / plan.rings.length;
    return Math.max(72, Math.min(104, Math.floor(cell - spacing.sm)));
  }, [plan.rings.length, width]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void markPlanReviewed();
  }, []);

  const continueToOffer = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await presentOnboardingOffer({
        userId: params.userId ?? user?.id ?? null,
        isPremium,
        presentPaywall,
        isMounted: () => mountedRef.current,
      });
    } finally {
      completeOnboarding();
      router.replace('/(tabs)');
    }
  };

  return (
    <View style={styles.root}>
      <OnboardingTopBar progress={onboardingProgress('plan')} topInset={insets.top} />

      <View style={styles.content}>
        <Text style={styles.eyebrow}>{plan.eyebrow}</Text>
        <Text style={styles.title}>
          {plan.handle ? `${plan.handle}, your plan is ready` : plan.headline}
        </Text>

        <View style={styles.gauges}>
          {plan.rings.map((ring, index) => (
            <PlanRingGauge key={ring.key} ring={ring} index={index} size={gaugeSize} />
          ))}
        </View>

        <View style={styles.chips}>
          {plan.chips.map((chip) => (
            <View key={chip.key} style={styles.chip}>
              <Ionicons name={chip.icon} size={14} color={colors.lime} />
              <Text style={styles.chipText}>{chip.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.footnote}>Adjustable any time in your profile.</Text>
        <GradientButton
          label={busy ? 'One moment…' : 'Start my plan'}
          accent="lime"
          onPress={continueToOffer}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  eyebrow: { ...type.label, color: colors.lime, textAlign: 'center' },
  title: {
    ...type.h1,
    color: colors.text,
    fontSize: 32,
    lineHeight: 36,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  gauges: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xxxl,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxl,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { ...type.micro, color: colors.text },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footnote: {
    ...type.bodySm,
    color: colors.textFaint,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});

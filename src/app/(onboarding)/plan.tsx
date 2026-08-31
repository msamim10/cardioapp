import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlanRingGauge, ringSequenceMs, useReduceMotion } from '@/components/PlanRingGauge';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import { useAuth } from '@/lib/AuthContext';
import { markPlanReviewed } from '@/lib/funnelStore';
import { onboardingProgress } from '@/lib/onboarding';
import { presentOnboardingOffer } from '@/lib/onboardingOffer';
import { buildOnboardingPlan } from '@/lib/onboardingPlan';
import { useOnboarding } from '@/lib/OnboardingContext';
import { useProgress } from '@/lib/ProgressContext';
import { useSubscription } from '@/lib/SubscriptionContext';
import { colors, spacing, type } from '@/theme';

/** Fade for the footer once the last gauge has landed. */
const FOOTER_FADE_MS = 240;

/**
 * Ceiling on how long the footer can stay hidden, whatever the gauges do. The
 * offer is mandatory, so an un-tappable CTA is a dead end rather than a
 * cosmetic bug: this fires independently of the sequence length.
 */
const FOOTER_SAFETY_MS = 4000;

/**
 * The plan hand-off, shown between account creation and the offer.
 *
 * Deliberately a readout rather than a written summary: the gauges are computed
 * from the user's own answers (see `buildOnboardingPlan`) and sweep in one at a
 * time on mount, so the screen reads as output the app is producing rather than
 * copy someone wrote. That is what has to carry credibility immediately before
 * a price, and it is why the footer waits for the last gauge.
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
  const reduceMotion = useReduceMotion();

  const plan = useMemo(() => buildOnboardingPlan(answers, username), [answers, username]);

  // Two gauges share each grid row, so the diameter has to come off the real
  // width rather than a fixed guess that overflows its cell on small phones.
  const { width } = useWindowDimensions();
  const gaugeSize = useMemo(() => {
    const cell = (width - spacing.lg * 2) / 2;
    return Math.max(84, Math.min(120, Math.floor(cell - spacing.md)));
  }, [width]);

  const reveal = useRef(new Animated.Value(0)).current;
  const revealAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const footerShownRef = useRef(false);
  const [footerShown, setFooterShown] = useState(false);

  useEffect(() => {
    if (reduceMotion) {
      footerShownRef.current = true;
      reveal.setValue(1);
      setFooterShown(true);
      return;
    }

    const show = () => {
      if (footerShownRef.current) return;
      footerShownRef.current = true;
      setFooterShown(true);
      revealAnimRef.current = Animated.timing(reveal, {
        toValue: 1,
        duration: FOOTER_FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      });
      revealAnimRef.current.start();
    };

    const timers = [
      setTimeout(show, ringSequenceMs(plan.rings.length)),
      setTimeout(show, FOOTER_SAFETY_MS),
    ];

    return () => {
      timers.forEach(clearTimeout);
      revealAnimRef.current?.stop();
    };
  }, [plan.rings.length, reduceMotion, reveal]);

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
        <Text style={styles.title}>
          {plan.handle ? `${plan.handle}, your plan is ready` : plan.headline}
        </Text>

        <View style={styles.gauges}>
          {plan.rings.map((ring, index) => (
            <View key={ring.key} style={styles.gaugeCell}>
              <PlanRingGauge ring={ring} index={index} size={gaugeSize} />
            </View>
          ))}
        </View>
      </View>

      <Animated.View
        pointerEvents={footerShown ? 'auto' : 'none'}
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + spacing.md,
            opacity: reveal,
            transform: [
              {
                translateY: reveal.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.footnote}>Adjustable any time in your profile.</Text>
        <GradientButton
          label={busy ? 'One moment…' : 'Start my plan'}
          accent="lime"
          onPress={continueToOffer}
        />
      </Animated.View>
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
  title: {
    ...type.h1,
    color: colors.text,
    fontSize: 32,
    lineHeight: 36,
    textAlign: 'center',
  },
  gauges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    rowGap: spacing.xl,
    marginTop: spacing.xxl,
  },
  gaugeCell: { width: '50%', paddingHorizontal: spacing.xs },
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

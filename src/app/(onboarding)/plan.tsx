import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import { useAuth } from '@/lib/AuthContext';
import { markPlanReviewed } from '@/lib/funnelStore';
import { onboardingProgress } from '@/lib/onboarding';
import { buildOnboardingPlan, type PlanRow } from '@/lib/onboardingPlan';
import { useOnboarding } from '@/lib/OnboardingContext';
import { presentOnboardingOffer } from '@/lib/onboardingOffer';
import { useProgress } from '@/lib/ProgressContext';
import { useSubscription } from '@/lib/SubscriptionContext';
import { colors, font, metric, radius, spacing, type } from '@/theme';

/**
 * The plan hand-off, shown between account creation and the offer.
 *
 * Everything on screen traces to an answer the user gave (see
 * `buildOnboardingPlan`), which is the point: recognising your own input right
 * before the price is what makes this beat work. The offer itself is still
 * presented by the shared `presentOnboardingOffer` helper, so ATT ordering and
 * the one-time paywall claim behave exactly as they do on the auth screen.
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

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>{plan.eyebrow}</Text>
        <Text style={styles.title}>
          {plan.handle ? `${plan.handle}, your plan is ready` : plan.headline}
        </Text>
        <Text style={styles.sub}>{plan.emphasis}</Text>

        <View style={styles.volumeCard}>
          <View style={styles.volumeMain}>
            <Text style={styles.volumeValue}>{plan.sessionsPerWeek}</Text>
            <Text style={styles.volumeUnit}>sessions{'\n'}per week</Text>
          </View>
          <View style={styles.volumeDivider} />
          <View style={styles.volumeMain}>
            <Text style={styles.volumeValue}>{plan.firstMonthSessions}</Text>
            <Text style={styles.volumeUnit}>sessions in{'\n'}your first month</Text>
          </View>
        </View>

        <View style={styles.rows}>
          {plan.rows.map((row) => (
            <PlanRowItem key={row.key} row={row} />
          ))}
        </View>

        <Text style={styles.footnote}>
          Built from your answers. Everything here is adjustable in your profile.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <GradientButton
          label={busy ? 'One moment…' : 'Start my plan'}
          accent="lime"
          onPress={continueToOffer}
        />
      </View>
    </View>
  );
}

function PlanRowItem({ row }: { row: PlanRow }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLead}>
        <Ionicons name={row.icon} size={19} color={colors.lime} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{row.label}</Text>
        <Text style={styles.rowDetail}>{row.detail}</Text>
      </View>
      {row.fromAnswer ? (
        <Ionicons name="checkmark-circle" size={18} color={colors.lime} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  eyebrow: { ...type.label, color: colors.lime },
  title: {
    ...type.h1,
    color: colors.text,
    fontSize: 32,
    lineHeight: 36,
    marginTop: spacing.sm,
  },
  sub: { ...type.body, color: colors.textDim, marginTop: spacing.sm, maxWidth: 400 },
  volumeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  volumeMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  volumeValue: {
    ...metric,
    color: colors.text,
    fontSize: 40,
    lineHeight: 42,
    fontWeight: font.heavy,
    letterSpacing: -1.6,
  },
  volumeUnit: {
    ...type.micro,
    color: colors.textDim,
    lineHeight: 13,
    letterSpacing: 0.8,
  },
  volumeDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginHorizontal: spacing.md,
    backgroundColor: colors.border,
  },
  rows: { marginTop: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowLead: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: 'rgba(215,255,62,0.1)',
  },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { ...type.h3, color: colors.text },
  rowDetail: { ...type.bodySm, color: colors.textDim },
  footnote: {
    ...type.bodySm,
    color: colors.textFaint,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

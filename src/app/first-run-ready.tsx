import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { logFirstRunLaunched } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { getMode } from '@/lib/gameData';
import { getModeCover } from '@/lib/modeCovers';
import { goalOptions } from '@/lib/onboarding';
import { useOnboarding } from '@/lib/OnboardingContext';
import { presentOnboardingOffer } from '@/lib/onboardingOffer';
import { recommendFirstRuns } from '@/lib/onboardingPlan';
import {
  DEFAULT_PLAY_SCREEN,
  describePlayScreen,
  INTENSITY_META,
  loadPlaySetup,
  type PlaySetup,
  resolveRunSettings,
} from '@/lib/playSetup';
import { useProgress } from '@/lib/ProgressContext';
import { useSubscription } from '@/lib/SubscriptionContext';
import { createTrackingRunId } from '@/lib/trackingSession';
import { colors, font, layout, metric, radius, spacing, type } from '@/theme';

/**
 * "Your first run is ready." The last screen of onboarding and the one that
 * presents the hosted paywall.
 *
 * Sequence on the primary tap:
 *   1. `presentOnboardingOffer` (same helper the auth screen used: ATT first,
 *      RevenueCat identity keyed to the Firebase UID, one-shot claim). Already
 *      entitled accounts skip straight through as `entitled`.
 *   2. `entitled`  → mark onboarding complete and launch the selected run
 *                    directly into the player, skipping Home.
 *      otherwise   → mark onboarding complete and land on Home, where every
 *                    map stays locked behind `canStartRun`.
 *
 * Lives outside the `(onboarding)` group so `completeOnboarding` can flip
 * without the root gate yanking the screen away before the replace fires.
 */
export default function FirstRunReadyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers, completeOnboarding, setCheckpoint } = useOnboarding();
  const { user } = useAuth();
  const { hydrated: subscriptionHydrated, isPremium, presentPaywall } = useSubscription();
  const { startRun } = useProgress();
  const [setup, setSetup] = useState<PlaySetup | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  const launchedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    setCheckpoint('first-run-ready');
    return () => {
      mountedRef.current = false;
    };
  }, [setCheckpoint]);

  useEffect(() => {
    let mounted = true;
    loadPlaySetup().then((loaded) => {
      if (mounted) setSetup(loaded);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const fallbackLevelId = useMemo(
    () => recommendFirstRuns(answers)[0]?.levelId ?? null,
    [answers],
  );
  const levelId = setup?.firstRunLevelId ?? fallbackLevelId;
  const mode = getMode(levelId ?? undefined);
  const level = mode?.levels[0];
  const cover = mode ? getModeCover(mode.id) : undefined;
  const screen = setup?.screen ?? DEFAULT_PLAY_SCREEN;
  const settings = resolveRunSettings(setup, answers);
  const intensity = INTENSITY_META[settings.intensity];
  const goal = goalOptions.find((o) => o.key === answers.goal);
  const trackingOff = setup?.firstRunTrackingOff === true;

  const launchRun = () => {
    if (!level || launchedRef.current) return;
    launchedRef.current = true;
    const runId = createTrackingRunId(level.id);
    startRun({
      runId,
      levelId: level.id,
      durationMin: settings.durationMin,
      intensity: settings.intensity,
    });
    logFirstRunLaunched();
    completeOnboarding();
    router.replace({
      pathname: '/workout',
      params: {
        level: level.id,
        name: level.name,
        speed: String(intensity.playbackRate),
        duration: String(settings.durationMin),
        intensity: settings.intensity,
        // No staged snapshot: the paywall sat between calibration and now, so
        // the in-run analyzer re-acquires the body from scratch.
        tracking: trackingOff ? 'off' : 'calibrated',
        trackingRunId: runId,
        fromOnboarding: '1',
      },
    });
  };

  const goHomeLocked = () => {
    completeOnboarding();
    router.replace('/(tabs)');
  };

  // The entitled fast path reads `isPremium`, so wait for RevenueCat's cached
  // customer info to hydrate before the button is live.
  const ready = subscriptionHydrated && Boolean(level);

  const onStart = async () => {
    if (busy || !ready) return;
    setBusy(true);
    try {
      const outcome = await presentOnboardingOffer({
        userId: user?.id ?? null,
        isPremium,
        presentPaywall,
        isMounted: () => mountedRef.current,
      });
      if (!mountedRef.current) return;
      if (outcome === 'entitled') {
        launchRun();
      } else {
        goHomeLocked();
      }
    } catch {
      if (mountedRef.current) goHomeLocked();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xl, paddingBottom: layout.scrollAboveFooter },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.eyebrowRow}>
          <Ionicons name="checkmark-circle" size={15} color={colors.lime} />
          <Text style={styles.eyebrow}>Calibration complete</Text>
        </View>
        <Text style={styles.title}>Your first run is ready</Text>
        <Text style={styles.sub}>
          Camera locked, map loaded, session set. Everything after this is you moving.
        </Text>

        <View style={styles.hero}>
          {cover ? (
            <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface2 }]} />
          )}
          <LinearGradient
            colors={['rgba(8,9,10,0.02)', 'rgba(8,9,10,0.35)', 'rgba(8,9,10,0.96)']}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.heroText}>
            <Text style={styles.heroName}>{mode?.name ?? 'Your first map'}</Text>
            {mode ? <Text style={styles.heroTagline}>{mode.tagline}</Text> : null}
            <View style={styles.heroChips}>
              <Chip icon={intensity.icon} label={intensity.label} />
              <Chip icon="timer-outline" label={`${settings.durationMin} min`} />
              <Chip icon={screen === 'tv' ? 'tv' : 'phone-portrait'} label={describePlayScreen(screen)} />
            </View>
          </View>
        </View>

        <View style={styles.goalCard}>
          <View style={styles.goalIcon}>
            <Ionicons name="trophy-outline" size={20} color={colors.lime} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.goalLabel}>Your objective</Text>
            <Text style={styles.goalValue}>{goal?.label ?? 'Move more, more often'}</Text>
            {answers.daysPerWeek ? (
              <Text style={styles.goalDetail}>
                {answers.daysPerWeek} sessions a week. This is session one.
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.checklist}>
          <CheckRow label="Body tracking calibrated" done={!trackingOff} />
          <CheckRow label={`${describePlayScreen(screen)}, phone as camera`} done />
          <CheckRow label="Full catalogue of maps unlocked with membership" done={isPremium} />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: layout.footerBottom(insets.bottom) }]}>
        <Pressable
          onPress={onStart}
          disabled={busy || !ready}
          accessibilityRole="button"
          accessibilityLabel="Start my first run"
          accessibilityState={{ disabled: busy || !ready, busy }}
          style={({ pressed }) => [
            styles.startBtn,
            (busy || !ready) && styles.startBtnDisabled,
            pressed && styles.pressed,
          ]}
        >
          {busy || !ready ? (
            <ActivityIndicator color={colors.black} />
          ) : (
            <Ionicons name="play" size={20} color={colors.black} />
          )}
          <Text style={styles.startBtnText}>{busy ? 'ONE MOMENT…' : 'START MY FIRST RUN'}</Text>
        </Pressable>
        <Text style={styles.footnote}>
          {isPremium
            ? 'Membership active. Straight into the run.'
            : 'Membership starts here. Cancel any time.'}
        </Text>
      </View>
    </View>
  );
}

function Chip({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={13} color={colors.lime} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

function CheckRow({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={styles.checkRow}>
      <View style={[styles.checkDot, done && styles.checkDotDone]}>
        <Ionicons name={done ? 'checkmark' : 'ellipse-outline'} size={13} color={done ? colors.black : colors.textDim} />
      </View>
      <Text style={styles.checkText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrow: { ...type.label, color: colors.lime },
  title: { ...type.h1, color: colors.text, marginTop: -spacing.sm },
  sub: { ...type.body, color: colors.textDim, marginTop: -spacing.sm },
  hero: {
    height: 300,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'flex-end',
  },
  heroText: { padding: spacing.lg, gap: 4 },
  heroName: { ...type.h1, color: colors.white, fontSize: 32, lineHeight: 35 },
  heroTagline: { ...type.body, color: 'rgba(247,248,248,0.8)' },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(8,9,10,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  chipText: { ...metric, color: colors.white, fontSize: 12, fontWeight: font.bold },
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  goalIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(215,255,62,0.1)',
  },
  goalLabel: { ...type.micro, color: colors.textFaint },
  goalValue: { ...type.h3, color: colors.text, marginTop: 3 },
  goalDetail: { ...type.bodySm, color: colors.textDim, marginTop: 2 },
  checklist: { gap: spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkDot: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  checkDotDone: { backgroundColor: colors.lime },
  checkText: { ...type.bodySm, color: colors.textDim, flex: 1 },
  // In flow below the scroll view, like every other onboarding footer, so the
  // scroll content needs no guess at the footer's height.
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  startBtn: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.button,
    backgroundColor: colors.lime,
  },
  startBtnDisabled: { opacity: 0.82 },
  startBtnText: { ...type.action, color: colors.black },
  footnote: { ...type.bodySm, color: colors.textFaint, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});

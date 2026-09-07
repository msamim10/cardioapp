import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GhostButton, GradientButton, Mascot } from '@/components/ui';
import {
  achievementsForRun,
  personalBestForRun,
  type Achievement,
  type PersonalBest,
} from '@/lib/achievements';
import { getMode } from '@/lib/gameData';
import { getModeCover } from '@/lib/modeCovers';
import {
  normalizeActionCounts,
  TRACKED_ACTIONS,
  type ActionCounts,
  type TrackedAction,
} from '@/lib/progressAggregation';
import { useProgress, type RunRecord } from '@/lib/ProgressContext';
import { isClassKey } from '@/lib/progression';
import { REVIEW_RUN_MILESTONE } from '@/lib/reviewEligibility';
import { requestMilestoneStoreReview } from '@/lib/storeReview';
import { accentColor, colors, font, metric, radius, spacing, type } from '@/theme';

const MOVE_LABEL: Record<TrackedAction, string> = {
  Jump: 'Jump',
  Duck: 'Duck',
  Left: 'Left',
  Right: 'Right',
};

const MOVE_ICON: Record<TrackedAction, keyof typeof Ionicons.glyphMap> = {
  Jump: 'arrow-up',
  Duck: 'arrow-down',
  Left: 'arrow-back',
  Right: 'arrow-forward',
};

/** Quiet segment tints, drawn from the fixed metric hues. */
const MOVE_TINT: Record<TrackedAction, string> = {
  Jump: 'rgba(61, 197, 240, 0.85)',
  Duck: 'rgba(255, 106, 43, 0.85)',
  Left: 'rgba(247, 248, 248, 0.45)',
  Right: 'rgba(155, 161, 166, 0.7)',
};

const COUNT_UP_MS = 900;

function formatRunClock(durationMin: number): string {
  const totalSec = Math.max(0, Math.round(durationMin * 60));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function parseParamActionCounts(raw: string | undefined): ActionCounts {
  if (!raw) return normalizeActionCounts(null);
  try {
    return normalizeActionCounts(JSON.parse(raw));
  } catch {
    return normalizeActionCounts(null);
  }
}

/**
 * Animated integer readout. Numbers that count up read as earned; numbers that
 * appear read as printed. Falls back to the final value immediately if the
 * target is zero, so an empty stat never "animates" to nothing.
 */
function useCountUp(target: number, delayMs = 0): number {
  const [value, setValue] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (target <= 0) {
      setValue(0);
      return;
    }
    anim.setValue(0);
    const id = anim.addListener(({ value: v }) => setValue(Math.round(v * target)));
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: COUNT_UP_MS,
      delay: delayMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start(() => setValue(target));
    return () => {
      anim.removeListener(id);
      animation.stop();
    };
  }, [anim, delayMs, target]);
  return value;
}

export default function SummaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    completed?: string;
    runId?: string;
    elapsedSeconds?: string;
    actionCounts?: string;
    poseScore?: string;
    fromOnboarding?: string;
  }>();
  const insets = useSafeAreaInsets();
  const {
    recordRun,
    runs,
    totalRuns,
    classData,
    streak,
    longestStreak,
    runsThisWeek,
    weeklyGoal,
    levelProgress,
    coins: totalCoins,
  } = useProgress();

  const fromOnboarding = params.fromOnboarding === '1';
  const recordedRef = useRef(false);
  const reviewScheduledRef = useRef(false);
  const [recordedRun, setRecordedRun] = useState<RunRecord | null>(null);

  useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    // Only the playToEnd → summary path sets completed=1. Anything else is an
    // incomplete visit and must not unlock campaign maps.
    if (params.completed !== '1' || !params.runId) return;
    const recorded = recordRun({
      runId: params.runId,
      elapsedSeconds: Number(params.elapsedSeconds),
      actionCounts: parseParamActionCounts(params.actionCounts),
      poseScore: Number(params.poseScore) || 0,
      finishedToEnd: true,
    });
    if (recorded) setRecordedRun(recorded);
  }, [
    params.actionCounts,
    params.completed,
    params.elapsedSeconds,
    params.poseScore,
    params.runId,
    recordRun,
  ]);

  // Prefer the just-recorded run; on remount (e.g. Strict Mode) fall back to the
  // persisted record matched by runId so the recap and unlock CTA stay correct.
  const run = useMemo(() => {
    if (recordedRun) return recordedRun;
    if (!params.runId) return null;
    return runs.find((entry) => entry.runId === params.runId) ?? null;
  }, [params.runId, recordedRun, runs]);

  // Ask for a review only at a genuine positive moment: a finished-to-end run
  // (completed=1) that just reached this recap and clears the milestone. The
  // request itself is guarded/throttled downstream, so this stays quiet.
  useEffect(() => {
    if (
      params.completed !== '1' ||
      !run ||
      totalRuns < REVIEW_RUN_MILESTONE ||
      reviewScheduledRef.current
    ) {
      return;
    }
    reviewScheduledRef.current = true;
    const timer = setTimeout(() => {
      void requestMilestoneStoreReview(totalRuns);
    }, 1500);
    return () => clearTimeout(timer);
  }, [params.completed, run, totalRuns]);

  const paramCounts = useMemo(
    () => parseParamActionCounts(params.actionCounts),
    [params.actionCounts],
  );
  const actionCounts = run?.actionCounts ?? paramCounts;
  const poseScore = run?.poseScore ?? (Number(params.poseScore) || 0);
  const durationMin =
    run?.durationMin ??
    (Number.isFinite(Number(params.elapsedSeconds))
      ? Math.max(0, Number(params.elapsedSeconds) / 60)
      : 0);
  const xp = run?.xp ?? 0;
  const coins = run?.coins ?? 0;
  const calories = run?.calories ?? 0;
  const totalMoves = TRACKED_ACTIONS.reduce((sum, move) => sum + actionCounts[move], 0);

  // Recognition is derived from history, never invented: the runs before this
  // one, this run, and the streak after it.
  const runsBefore = useMemo(
    () => (run ? runs.filter((r) => r.runId !== run.runId) : runs),
    [run, runs],
  );
  const achievements: Achievement[] = useMemo(
    () => (run ? achievementsForRun(runsBefore, run, streak) : []),
    [run, runsBefore, streak],
  );
  const personalBest: PersonalBest = useMemo(
    () => (run ? personalBestForRun(runsBefore, run) : null),
    [run, runsBefore],
  );

  const shownScore = useCountUp(Math.round(poseScore));
  const shownXp = useCountUp(xp, 200);
  const shownCoins = useCountUp(coins, 350);
  const shownCalories = useCountUp(Math.round(calories), 120);

  const campaignClass = isClassKey(run?.classKey) ? run.classKey : null;
  const isCampaignRun = campaignClass !== null;
  const playedMode = getMode(run?.levelId);
  const cover = playedMode ? getModeCover(playedMode.id) : undefined;
  const data = isCampaignRun ? classData(campaignClass) : null;
  const nextLevelId = isCampaignRun ? data?.nextLevelId ?? null : null;
  // Wait until the run is attached so next-map state reflects this completion.
  const recapReady = run !== null || params.completed !== '1';
  const showNext = !fromOnboarding && recapReady && Boolean(nextLevelId);

  const weeklyProgress = weeklyGoal > 0 ? Math.min(1, runsThisWeek / weeklyGoal) : 0;
  const weeklyHit = weeklyGoal > 0 && runsThisWeek >= weeklyGoal;

  const openNextMap = () => {
    if (!nextLevelId || !campaignClass) return;
    router.replace({
      pathname: '/level/[id]',
      params: { id: nextLevelId, classKey: campaignClass },
    });
  };
  const goHome = () => router.replace('/(tabs)');

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero: map cover as the backdrop, score as the identity metric. */}
        <View style={[styles.hero, { paddingTop: insets.top + spacing.lg }]}>
          {cover ? (
            <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          ) : null}
          <LinearGradient
            colors={['rgba(8,9,10,0.55)', 'rgba(8,9,10,0.82)', colors.bg]}
            locations={[0, 0.6, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.heroInner}>
            <View style={styles.titleRow}>
              <View style={styles.titleBlock}>
                <View style={styles.eyebrowRow}>
                  <Ionicons name="checkmark-circle" size={15} color={colors.lime} />
                  <Text style={styles.eyebrow}>
                    {fromOnboarding ? 'First run complete' : 'Workout complete'}
                  </Text>
                </View>
                <Text style={styles.runName} numberOfLines={2}>
                  {playedMode?.name ?? 'Cardio run'}
                </Text>
              </View>
              <Mascot size={64} />
            </View>

            <View style={styles.scoreBlock}>
              <Text style={styles.scoreValue}>{shownScore.toLocaleString()}</Text>
              <View style={styles.scoreLabelRow}>
                <Ionicons name="analytics-outline" size={14} color={colors.textDim} />
                <Text style={styles.scoreLabel}>Score</Text>
                {personalBest?.kind === 'score' ? (
                  <View style={styles.pbPill}>
                    <Ionicons name="trending-up" size={11} color={colors.black} />
                    <Text style={styles.pbPillText}>Personal best</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.metricStrip}>
              <View style={styles.metricCell}>
                <Ionicons name="timer-outline" size={15} color={colors.pace} />
                <Text style={styles.metricValue}>{formatRunClock(durationMin)}</Text>
                <Text style={styles.metricLabel}>Time</Text>
              </View>
              <View style={styles.metricRule} />
              <View style={styles.metricCell}>
                <Ionicons name="flame" size={15} color={colors.heat} />
                <Text style={styles.metricValue}>{shownCalories.toLocaleString()}</Text>
                <Text style={styles.metricLabel}>Cal</Text>
              </View>
              <View style={styles.metricRule} />
              <View style={styles.metricCell}>
                <Ionicons name="body-outline" size={15} color={colors.text} />
                <Text style={styles.metricValue}>{totalMoves}</Text>
                <Text style={styles.metricLabel}>Moves</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* Personal best callout (non-score kinds; score PB lives on the hero). */}
          {personalBest && personalBest.kind !== 'score' ? (
            <View style={styles.callout}>
              <View style={[styles.calloutIcon, { backgroundColor: 'rgba(61,197,240,0.14)' }]}>
                <Ionicons
                  name={personalBest.kind === 'first-map' ? 'map' : 'hourglass'}
                  size={18}
                  color={colors.pace}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.calloutTitle}>
                  {personalBest.kind === 'first-map' ? 'New map cleared' : 'Longest run yet'}
                </Text>
                <Text style={styles.calloutDetail}>
                  {personalBest.kind === 'first-map'
                    ? `First time through ${playedMode?.name ?? 'this map'}.`
                    : `Previous best ${formatRunClock(personalBest.previousMin)}.`}
                </Text>
              </View>
            </View>
          ) : null}
          {personalBest?.kind === 'score' ? (
            <View style={styles.callout}>
              <View style={[styles.calloutIcon, { backgroundColor: 'rgba(215,255,62,0.14)' }]}>
                <Ionicons name="trending-up" size={18} color={colors.lime} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.calloutTitle}>New personal best</Text>
                <Text style={styles.calloutDetail}>
                  Previous best on this map: {Math.round(personalBest.previous).toLocaleString()}.
                </Text>
              </View>
            </View>
          ) : null}

          {/* Earned: XP + coins counters, level progress. */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Earned</Text>
              <Text style={styles.cardMeta}>Level {levelProgress.level}</Text>
            </View>
            <View style={styles.earnRow}>
              <View style={styles.earnCell}>
                <View style={[styles.earnIcon, { backgroundColor: 'rgba(215,255,62,0.14)' }]}>
                  <Ionicons name="sparkles" size={18} color={colors.lime} />
                </View>
                <Text style={styles.earnValue}>+{shownXp.toLocaleString()}</Text>
                <Text style={styles.earnLabel}>XP</Text>
              </View>
              <View style={styles.earnCell}>
                <View style={[styles.earnIcon, { backgroundColor: 'rgba(255,106,43,0.14)' }]}>
                  <Ionicons name="diamond" size={18} color={colors.heat} />
                </View>
                <Text style={styles.earnValue}>+{shownCoins.toLocaleString()}</Text>
                <Text style={styles.earnLabel}>Coins · {totalCoins.toLocaleString()} total</Text>
              </View>
            </View>
            <View style={styles.levelRow}>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(levelProgress.progress * 100)}%` }]} />
              </View>
              <Text style={styles.levelMeta}>
                {levelProgress.toNext.toLocaleString()} XP to level {levelProgress.level + 1}
              </Text>
            </View>
          </View>

          {/* Streak + weekly goal. */}
          <View style={styles.card}>
            <View style={styles.streakRow}>
              <View style={styles.flame}>
                <Ionicons name="flame" size={26} color={streak > 0 ? colors.heat : colors.textFaint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.streakValue}>
                  {streak} day{streak === 1 ? '' : 's'}
                </Text>
                <Text style={styles.streakLabel}>
                  {streak >= longestStreak && streak > 1
                    ? 'Current streak · your longest yet'
                    : `Current streak · best ${longestStreak}`}
                </Text>
              </View>
            </View>
            <View style={styles.goalBlock}>
              <View style={styles.goalHead}>
                <Text style={styles.goalTitle}>This week</Text>
                <Text style={[styles.goalMeta, weeklyHit && { color: colors.lime }]}>
                  {runsThisWeek} / {weeklyGoal} sessions
                </Text>
              </View>
              <View style={styles.goalPips}>
                {Array.from({ length: Math.max(1, weeklyGoal) }, (_, i) => (
                  <View
                    key={i}
                    style={[styles.pip, i < runsThisWeek && styles.pipDone]}
                  />
                ))}
              </View>
              <Text style={styles.goalNote}>
                {weeklyHit
                  ? 'Weekly goal hit. Everything from here is extra.'
                  : `${Math.max(0, weeklyGoal - runsThisWeek)} more to hit your goal.`}
              </Text>
              <View style={styles.trackFaint}>
                <View style={[styles.fill, { width: `${Math.round(weeklyProgress * 100)}%` }]} />
              </View>
            </View>
          </View>

          {/* Achievements unlocked by this run. */}
          {achievements.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <Ionicons name="ribbon-outline" size={16} color={colors.textDim} />
                  <Text style={styles.sectionTitle}>Unlocked</Text>
                </View>
                <Text style={styles.sectionMeta}>
                  {achievements.length} {achievements.length === 1 ? 'badge' : 'badges'}
                </Text>
              </View>
              {achievements.map((a) => (
                <View key={a.key} style={styles.badge}>
                  <View
                    style={[
                      styles.badgeIcon,
                      { borderColor: accentColor[a.accent], backgroundColor: `${accentColor[a.accent]}22` },
                    ]}
                  >
                    <Ionicons name={a.icon} size={22} color={accentColor[a.accent]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.badgeTitle}>{a.title}</Text>
                    <Text style={styles.badgeDetail}>{a.detail}</Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={accentColor[a.accent]} />
                </View>
              ))}
            </View>
          ) : null}

          {/* Movement breakdown: proportion + split-style rows */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="body-outline" size={16} color={colors.textDim} />
                <Text style={styles.sectionTitle}>Movements</Text>
              </View>
              <Text style={styles.sectionMeta}>{totalMoves} total</Text>
            </View>

            {totalMoves > 0 ? (
              <View style={styles.proportionBar}>
                {TRACKED_ACTIONS.map((move) => {
                  const count = actionCounts[move];
                  if (count <= 0) return null;
                  return (
                    <View
                      key={move}
                      style={[
                        styles.proportionSegment,
                        { flex: count, backgroundColor: MOVE_TINT[move] },
                      ]}
                    />
                  );
                })}
              </View>
            ) : (
              <View style={styles.proportionBarEmpty} />
            )}

            <View style={styles.moveList}>
              {TRACKED_ACTIONS.map((move, index) => {
                const count = actionCounts[move];
                const share = totalMoves > 0 ? count / totalMoves : 0;
                return (
                  <View key={move}>
                    {index > 0 ? <View style={styles.rowRule} /> : null}
                    <View style={styles.moveRow}>
                      <View style={styles.moveLead}>
                        <View style={styles.moveIconWrap}>
                          <Ionicons name={MOVE_ICON[move]} size={14} color={MOVE_TINT[move]} />
                        </View>
                        <Text style={styles.moveLabel}>{MOVE_LABEL[move]}</Text>
                      </View>
                      <Text style={styles.moveShare}>
                        {totalMoves > 0 ? `${Math.round(share * 100)}%` : '—'}
                      </Text>
                      <Text style={styles.moveCount}>{count}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.ctaBar,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm },
        ]}
      >
        {fromOnboarding ? (
          <GradientButton label="Home" icon="home" accent="lime" onPress={goHome} />
        ) : showNext ? (
          <>
            <GradientButton
              label="Next level"
              icon="play-forward"
              accent="lime"
              onPress={openNextMap}
            />
            <GhostButton label="Done" icon="home-outline" onPress={goHome} />
          </>
        ) : (
          <GradientButton label="Done" icon="checkmark" accent="lime" onPress={goHome} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: {},
  hero: {
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  heroInner: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.xl,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleBlock: { flex: 1, minWidth: 0, gap: spacing.sm },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrow: { ...type.label, color: colors.lime },
  runName: { ...type.h1, color: colors.text, fontSize: 29, lineHeight: 33 },
  scoreBlock: { gap: spacing.xs },
  scoreValue: {
    ...metric,
    color: colors.text,
    fontSize: 76,
    fontWeight: font.heavy,
    letterSpacing: -3,
    lineHeight: 79,
  },
  scoreLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scoreLabel: { ...type.label, color: colors.textDim },
  pbPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  pbPillText: { ...type.micro, color: colors.black },
  metricStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  metricCell: { flex: 1, alignItems: 'flex-start', gap: 4, paddingVertical: spacing.xs },
  metricRule: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
    marginVertical: spacing.xs,
    marginHorizontal: spacing.md,
  },
  metricValue: { ...metric, color: colors.text, fontSize: 24, fontWeight: font.heavy, letterSpacing: -0.7 },
  metricLabel: { ...type.micro, color: colors.textFaint, fontWeight: font.bold },

  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.lg },

  callout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  calloutIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calloutTitle: { ...type.h3, color: colors.text },
  calloutDetail: { ...type.bodySm, color: colors.textDim, marginTop: 2 },

  card: {
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardTitle: { ...type.h3, color: colors.text },
  cardMeta: { ...metric, ...type.bodySm, color: colors.textFaint, fontWeight: font.bold },
  earnRow: { flexDirection: 'row', gap: spacing.md },
  earnCell: { flex: 1, gap: 6 },
  earnIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  earnValue: { ...metric, color: colors.text, fontSize: 28, fontWeight: font.heavy, letterSpacing: -0.9 },
  earnLabel: { ...type.micro, color: colors.textFaint },
  levelRow: { gap: spacing.sm },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surface3, overflow: 'hidden' },
  trackFaint: { height: 3, borderRadius: radius.pill, backgroundColor: colors.surface3, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.lime },
  levelMeta: { ...metric, ...type.bodySm, color: colors.textDim },

  streakRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flame: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,106,43,0.12)',
  },
  streakValue: { ...metric, color: colors.text, fontSize: 26, fontWeight: font.heavy, letterSpacing: -0.8 },
  streakLabel: { ...type.bodySm, color: colors.textDim },
  goalBlock: { gap: spacing.sm },
  goalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  goalTitle: { ...type.label, color: colors.textDim },
  goalMeta: { ...metric, color: colors.text, fontSize: 13, fontWeight: font.bold },
  goalPips: { flexDirection: 'row', gap: 6 },
  pip: { flex: 1, height: 10, borderRadius: radius.xs, backgroundColor: colors.surface3 },
  pipDone: { backgroundColor: colors.lime },
  goalNote: { ...type.bodySm, color: colors.textDim },

  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionTitle: { ...type.h3, color: colors.text },
  sectionMeta: { ...metric, color: colors.textFaint, fontSize: 13, fontWeight: font.medium },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTitle: { ...type.h3, color: colors.text },
  badgeDetail: { ...type.bodySm, color: colors.textDim, marginTop: 2 },

  proportionBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    gap: 2,
  },
  proportionBarEmpty: { height: 6, borderRadius: 3, backgroundColor: colors.surface2 },
  proportionSegment: { height: '100%', borderRadius: 2 },
  moveList: { marginTop: spacing.xs },
  rowRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  moveRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md + 2, gap: spacing.md },
  moveLead: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  moveIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  moveLabel: { color: colors.text, fontSize: 16, fontWeight: font.medium },
  moveShare: { ...metric, minWidth: 40, textAlign: 'right', color: colors.textFaint, fontSize: 14, fontWeight: font.medium },
  moveCount: { ...metric, minWidth: 36, textAlign: 'right', color: colors.text, fontSize: 17, fontWeight: font.bold },

  ctaBar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});

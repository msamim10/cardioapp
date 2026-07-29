import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GhostButton, GradientButton } from '@/components/ui';
import { getMode } from '@/lib/gameData';
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
import { colors, font, spacing } from '@/theme';

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

export default function SummaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    completed?: string;
    runId?: string;
    elapsedSeconds?: string;
    actionCounts?: string;
    poseScore?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { recordRun, runs, totalRuns, classData } = useProgress();

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
  const calories = run?.calories ?? 0;
  const totalMoves = TRACKED_ACTIONS.reduce((sum, move) => sum + actionCounts[move], 0);

  const campaignClass = isClassKey(run?.classKey) ? run.classKey : null;
  const isCampaignRun = campaignClass !== null;
  const playedMode = getMode(run?.levelId);
  const data = isCampaignRun ? classData(campaignClass) : null;
  const nextLevelId = isCampaignRun ? data?.nextLevelId ?? null : null;
  // Wait until the run is attached so next-map state reflects this completion.
  const recapReady = run !== null || params.completed !== '1';
  const showNext = recapReady && Boolean(nextLevelId);

  const openNextMap = () => {
    if (!nextLevelId || !campaignClass) return;
    router.replace({
      pathname: '/level/[id]',
      params: { id: nextLevelId, classKey: campaignClass },
    });
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleBlock}>
          <View style={styles.eyebrowRow}>
            <Ionicons name="checkmark-circle" size={15} color={colors.lime} />
            <Text style={styles.eyebrow}>Workout complete</Text>
          </View>
          <Text style={styles.runName} numberOfLines={2}>
            {playedMode?.name ?? 'Cardio run'}
          </Text>
        </View>

        {/* Hero: score as identity metric (Peloton output / game HUD) */}
        <View style={styles.hero}>
          <Text style={styles.heroValue}>{Math.round(poseScore).toLocaleString()}</Text>
          <View style={styles.heroLabelRow}>
            <Ionicons name="analytics-outline" size={14} color={colors.textDim} />
            <Text style={styles.heroLabel}>Score</Text>
          </View>
        </View>

        {/* Foundational strip: time / calories / XP (Strava 3-up) */}
        <View style={styles.metricStrip}>
          <View style={styles.metricCell}>
            <Ionicons name="timer-outline" size={15} color={colors.cyan} />
            <Text style={styles.metricValue}>{formatRunClock(durationMin)}</Text>
            <Text style={styles.metricLabel}>Time</Text>
          </View>
          <View style={styles.metricRule} />
          <View style={styles.metricCell}>
            <Ionicons name="flame" size={15} color={colors.orange} />
            <Text style={styles.metricValue}>{Math.round(calories).toLocaleString()}</Text>
            <Text style={styles.metricLabel}>Cal</Text>
          </View>
          <View style={styles.metricRule} />
          <View style={styles.metricCell}>
            <Ionicons name="sparkles" size={15} color={colors.lime} />
            <Text style={styles.metricValue}>{xp.toLocaleString()}</Text>
            <Text style={styles.metricLabel}>XP</Text>
          </View>
        </View>

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
                      {
                        flex: count,
                        backgroundColor: MOVE_TINT[move],
                      },
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
                        <Ionicons
                          name={MOVE_ICON[move]}
                          size={14}
                          color={MOVE_TINT[move]}
                        />
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
      </ScrollView>

      <View
        style={[
          styles.ctaBar,
          {
            paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm,
          },
        ]}
      >
        {showNext ? (
          <>
            <GradientButton
              label="Next"
              icon="play-forward"
              accent="lime"
              onPress={openNextMap}
            />
            <GhostButton
              label="Go home"
              icon="home-outline"
              onPress={() => router.replace('/(tabs)')}
            />
          </>
        ) : (
          <GradientButton
            label="Go home"
            icon="home"
            accent="cyan"
            onPress={() => router.replace('/(tabs)')}
          />
        )}
      </View>
    </View>
  );
}

/** Quiet segment tints — readable on dark, not neon lime/purple. */
const MOVE_TINT: Record<TrackedAction, string> = {
  Jump: 'rgba(69, 224, 255, 0.85)',
  Duck: 'rgba(255, 138, 61, 0.85)',
  Left: 'rgba(245, 245, 247, 0.45)',
  Right: 'rgba(160, 160, 176, 0.7)',
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xxl,
  },
  titleBlock: {
    gap: spacing.sm,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eyebrow: {
    color: colors.textFaint,
    fontSize: 13,
    fontWeight: font.semibold,
    letterSpacing: 0.2,
  },
  runName: {
    color: colors.text,
    fontSize: 28,
    fontWeight: font.bold,
    letterSpacing: -0.7,
    lineHeight: 34,
  },
  hero: {
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  heroValue: {
    color: colors.text,
    fontSize: 72,
    fontWeight: font.black,
    letterSpacing: -2.5,
    lineHeight: 76,
    fontVariant: ['tabular-nums'],
  },
  heroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroLabel: {
    color: colors.textDim,
    fontSize: 15,
    fontWeight: font.medium,
    letterSpacing: 0.1,
  },
  metricStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  metricCell: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 4,
    paddingVertical: spacing.xs,
  },
  metricRule: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
    marginVertical: spacing.xs,
    marginHorizontal: spacing.md,
  },
  metricValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: font.bold,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: font.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: font.semibold,
    letterSpacing: -0.2,
  },
  sectionMeta: {
    color: colors.textFaint,
    fontSize: 13,
    fontWeight: font.medium,
    fontVariant: ['tabular-nums'],
  },
  proportionBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    gap: 2,
  },
  proportionBarEmpty: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface2,
  },
  proportionSegment: {
    height: '100%',
    borderRadius: 2,
  },
  moveList: {
    marginTop: spacing.xs,
  },
  rowRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md + 2,
    gap: spacing.md,
  },
  moveLead: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  moveIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  moveLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: font.medium,
  },
  moveShare: {
    minWidth: 40,
    textAlign: 'right',
    color: colors.textFaint,
    fontSize: 14,
    fontWeight: font.medium,
    fontVariant: ['tabular-nums'],
  },
  moveCount: {
    minWidth: 36,
    textAlign: 'right',
    color: colors.text,
    fontSize: 17,
    fontWeight: font.semibold,
    fontVariant: ['tabular-nums'],
  },
  ctaBar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});

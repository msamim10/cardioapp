import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localDateKey } from '@shared/scoring/daily';
import { DailyChallengeBoard } from '@/components/DailyChallengeBoard';
import { MascotHero } from '@/components/MascotHero';
import { ModeCard } from '@/components/ModeCard';
import { Card, StatChip, WeekTracker } from '@/components/ui';
import { useAuth } from '@/lib/AuthContext';
import { useRunnerCounts } from '@/lib/communityActivity';
import {
  getDailyChallenge,
  isDailyChallengeCompleted,
  pickDailyRecommendations,
  RECOMMENDATION_RECENT_EXCLUSIONS,
} from '@/lib/dailyRecommendations';
import { modes } from '@/lib/gameData';
import { nextRewardLevel } from '@/lib/levels';
import { getModeCover } from '@/lib/modeCovers';
import { useOnboarding } from '@/lib/OnboardingContext';
import { calendarWeekStart, MAX_LEVEL } from '@/lib/progressAggregation';
import { useProgress } from '@/lib/ProgressContext';
import { DAILY_CHALLENGE_XP_BONUS } from '@/lib/progression';
import { colors, font, metric, radius, spacing, type } from '@/theme';

const HERO_HEIGHT = Math.round(Dimensions.get('window').height * 0.4);

function WeekMetric({
  icon,
  tint,
  value,
  unit,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <View style={styles.weekMetric}>
      <Ionicons name={icon} size={14} color={tint} />
      <Text style={styles.weekMetricValue}>
        {value}
        <Text style={styles.weekMetricUnit}> {unit}</Text>
      </Text>
      <Text style={styles.weekMetricLabel}>{label}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { answers } = useOnboarding();
  const {
    hydrated,
    streak,
    streakInfo,
    coins,
    runs,
    runsThisWeek,
    weeklyGoal,
    username,
    isLevelCompleted,
    levelProgress,
  } = useProgress();

  // Daily challenge is keyed to the local date; refresh the date on focus so a
  // session that straddles midnight picks up the new video.
  const [challengeDate, setChallengeDate] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setChallengeDate(new Date());
    }, [])
  );
  const challenge = useMemo(
    () => getDailyChallenge(modes, challengeDate),
    [challengeDate]
  );
  const challengeDone = useMemo(
    () => isDailyChallengeCompleted(runs, challenge),
    [challenge, runs]
  );
  const challengeDateKey = localDateKey(challengeDate);

  // "Recommended for you": five maps, rotating daily per person, biased toward
  // the onboarding answers and skipping the two most recent plays.
  const recentLevelIds = useMemo(() => {
    const ids: string[] = [];
    for (const run of [...runs].sort((a, b) => b.at - a.at)) {
      if (!ids.includes(run.levelId)) ids.push(run.levelId);
      if (ids.length >= RECOMMENDATION_RECENT_EXCLUSIONS) break;
    }
    return ids;
  }, [runs]);
  const recommended = useMemo(
    () =>
      pickDailyRecommendations({
        modes,
        seedKey: user?.id ?? 'local',
        dateKey: challengeDateKey,
        answers,
        recentLevelIds,
      }),
    [answers, challengeDateKey, recentLevelIds, user?.id]
  );
  const recommendedIds = useMemo(() => recommended.map((mode) => mode.id), [recommended]);
  // Real leaderboard player counts for the recommended cards (no fabrication).
  const runnerCounts = useRunnerCounts(recommendedIds, hydrated && user !== null);

  // Training load for the current calendar week, on the same Monday boundary
  // the weekly goal tracker uses.
  const week = useMemo(() => {
    const weekStart = calendarWeekStart(Date.now());
    let minutes = 0;
    let calories = 0;
    for (const run of runs) {
      if (run.at < weekStart) continue;
      minutes += run.durationMin;
      calories += run.calories;
    }
    return { minutes: Math.round(minutes), calories: Math.round(calories) };
  }, [runs]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Animated mascot hero: fox ties its shoes then double-jumps over the trail. */}
      <MascotHero height={HERO_HEIGHT}>
        {/*
          One row, always. The username chip is the only flexible item
          (flexShrink 1 + minWidth 0, so a 24-character handle ellipsizes);
          the stats cluster never shrinks (flexShrink 0) and stays on the
          right. The streak freeze is a small snowflake dot on the flame — no
          text in the header.
        */}
        <View style={[styles.heroOverlay, { paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.usernameChip}>
            <Ionicons name="person-circle" size={18} color={colors.lime} />
            <Text
              style={styles.usernameText}
              numberOfLines={1}
              ellipsizeMode="tail"
              maxFontSizeMultiplier={1.3}
            >
              @{username || 'runner'}
            </Text>
          </View>
          <View style={styles.heroChips}>
            <View
              style={styles.streakChip}
              accessible
              accessibilityLabel={`${streak} day streak. Streak freeze ${streakInfo.freezeAvailable ? 'available' : 'used'} this week.`}
            >
              <View style={styles.flameWrap}>
                <Ionicons name="flame" size={16} color={colors.heat} />
                {streakInfo.freezeAvailable ? (
                  <View style={styles.freezeDot}>
                    <Ionicons name="snow" size={7} color={colors.black} />
                  </View>
                ) : null}
              </View>
              <Text style={styles.streakChipText}>{streak}</Text>
            </View>
            <StatChip icon="diamond" label={`${coins}`} accent="lime" />
          </View>
        </View>
      </MascotHero>

      <View style={styles.body}>
        {/* Recommended for you: five maps, rotating daily. */}
        <View style={styles.challengesSection}>
          <Text style={styles.sectionTitle}>Recommended for you</Text>
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.challengeRow}
            style={styles.challengeScroller}
          >
            {recommended.map((mode) => (
              <ModeCard
                key={mode.id}
                mode={mode}
                completed={isLevelCompleted(mode.id)}
                participantCount={runnerCounts[mode.id]}
                showMeta={false}
                showAction={false}
                style={styles.challengeCard}
                onPress={() =>
                  router.push({
                    pathname: '/level/[id]',
                    params: { id: mode.id },
                  })
                }
              />
            ))}
          </ScrollView>
        </View>

        {/* This week's training load, then the weekly goal it feeds. */}
        <Card style={styles.weekCard}>
          <View style={styles.weekTop}>
            <Text style={styles.weekEyebrow}>This week</Text>
            <Text style={styles.weekCount}>
              {runsThisWeek}/{weeklyGoal} sessions
            </Text>
          </View>
          <View style={styles.weekMetrics}>
            <WeekMetric
              icon="time"
              tint={colors.pace}
              value={`${week.minutes}`}
              unit="min"
              label="Moving"
            />
            <View style={styles.weekMetricRule} />
            <WeekMetric
              icon="flame"
              tint={colors.heat}
              value={week.calories.toLocaleString()}
              unit="kcal"
              label="Burned"
            />
            <View style={styles.weekMetricRule} />
            <WeekMetric
              icon="flash"
              tint={colors.lime}
              value={`${streak}`}
              unit={streak === 1 ? 'day' : 'days'}
              label="Streak"
            />
          </View>
          <WeekTracker count={runsThisWeek} goal={weeklyGoal} accent="lime" />
          <Text style={styles.weekHint}>
            {runsThisWeek >= weeklyGoal
              ? 'Weekly target hit. Keep the streak going.'
              : `${Math.max(0, weeklyGoal - runsThisWeek)} more to hit your weekly target.`}
          </Text>
        </Card>

        {/* Today's challenge: one video per local date, same for everyone. */}
        {challenge ? (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/level/[id]', params: { id: challenge.mode.id } })
            }
            accessibilityRole="button"
            accessibilityLabel={`Today's challenge, ${challenge.mode.name}. ${
              challengeDone
                ? 'Completed, bonus earned.'
                : `Complete for ${Math.round(DAILY_CHALLENGE_XP_BONUS * 100)} percent bonus XP.`
            }`}
            style={({ pressed }) => [styles.challengeCardWrap, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.challengeCover}>
              {getModeCover(challenge.mode.id) ? (
                <Image
                  source={getModeCover(challenge.mode.id)}
                  contentFit="cover"
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <LinearGradient
                colors={['transparent', 'rgba(8,9,10,0.85)']}
                style={StyleSheet.absoluteFill}
              />
              {challengeDone ? (
                <View style={styles.challengeDoneBadge}>
                  <Ionicons name="checkmark" size={14} color={colors.black} />
                </View>
              ) : null}
            </View>
            <View style={styles.challengeBody}>
              <View style={styles.challengeEyebrowRow}>
                <Ionicons name="calendar" size={12} color={colors.lime} />
                <Text style={styles.challengeEyebrow}>Today&apos;s challenge</Text>
              </View>
              <Text style={styles.challengeName} numberOfLines={1}>
                {challenge.mode.name}
              </Text>
              <Text style={[styles.challengeMeta, challengeDone && { color: colors.lime }]}>
                {challengeDone
                  ? `Completed · +${Math.round(DAILY_CHALLENGE_XP_BONUS * 100)}% XP earned`
                  : `Complete for +${Math.round(DAILY_CHALLENGE_XP_BONUS * 100)}% XP`}
              </Text>
            </View>
            <Ionicons
              name={challengeDone ? 'checkmark-circle' : 'chevron-forward'}
              size={20}
              color={challengeDone ? colors.lime : colors.textFaint}
            />
          </Pressable>
        ) : null}

        {/* Live board for today's challenge — real scores, server-verified. */}
        {challenge && hydrated ? (
          <DailyChallengeBoard
            dateKey={challengeDateKey}
            uid={user?.id ?? null}
            onOpen={() =>
              router.push(`/leaderboard/${challenge.mode.id}?board=daily&date=${challengeDateKey}` as Href)
            }
          />
        ) : null}

        {/* Player level: XP toward the next level on the 1–50 curve. */}
        <Card
          style={styles.levelCard}
          accessible
          accessibilityLabel={
            levelProgress.isMax
              ? `Level ${MAX_LEVEL}, max level`
              : `Level ${levelProgress.level}. ${levelProgress.toNext} XP to level ${levelProgress.level + 1}`
          }
        >
          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeNumber}>{levelProgress.level}</Text>
            <Text style={styles.levelBadgeLabel}>LVL</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <View style={styles.levelHead}>
              <Text style={styles.levelTitle}>Level {levelProgress.level}</Text>
              <Text style={styles.levelMeta}>
                {levelProgress.isMax
                  ? 'Max level'
                  : `${levelProgress.toNext.toLocaleString()} XP to level ${levelProgress.level + 1}`}
              </Text>
            </View>
            <View style={styles.levelTrack}>
              <View
                style={[styles.levelFill, { width: `${Math.round(levelProgress.fraction * 100)}%` }]}
              />
            </View>
            <Text style={styles.levelHint}>
              {(() => {
                const next = nextRewardLevel(levelProgress.level);
                return next ? `Next reward at level ${next}` : 'Every reward unlocked';
              })()}
            </Text>
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: spacing.lg },
  body: { paddingHorizontal: spacing.lg, gap: spacing.lg, paddingTop: spacing.sm },
  heroOverlay: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  // MascotHero has no top scrim, so this fill is the only thing keeping the
  // label above AA over the hero art's bright sky.
  usernameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8,9,10,0.78)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  usernameText: { color: colors.text, fontSize: 14, fontWeight: font.bold, flexShrink: 1, minWidth: 0 },
  // Never shrinks or clips.
  heroChips: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 0 },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  streakChipText: { ...metric, color: colors.text, fontSize: 14, fontWeight: font.bold },
  flameWrap: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  // Freeze available this week: a small snowflake dot on the flame's corner.
  freezeDot: {
    position: 'absolute',
    right: -5,
    bottom: -3,
    width: 11,
    height: 11,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pace,
    borderWidth: 1,
    borderColor: colors.surface2,
  },

  levelCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  levelBadge: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
  },
  levelBadgeNumber: { ...metric, color: colors.black, fontSize: 22, lineHeight: 24, fontWeight: font.heavy, letterSpacing: -0.8 },
  levelBadgeLabel: { color: 'rgba(0,0,0,0.6)', fontSize: 7, fontWeight: font.black, letterSpacing: 1.2, marginTop: -1 },
  levelHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  levelTitle: { ...type.h3, color: colors.text },
  levelMeta: { ...metric, color: colors.textDim, fontSize: 12, fontWeight: font.bold, flexShrink: 1, textAlign: 'right' },
  levelTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surface3, overflow: 'hidden' },
  levelFill: { height: '100%', backgroundColor: colors.lime },
  levelHint: { ...type.bodySm, color: colors.textFaint, fontSize: 12 },

  challengeCardWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    paddingRight: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(215,255,62,0.28)',
  },
  challengeCover: {
    width: 96,
    height: 72,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  challengeDoneBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
  },
  challengeBody: { flex: 1, minWidth: 0, gap: 3 },
  challengeEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  challengeEyebrow: { ...type.micro, color: colors.lime },
  challengeName: { ...type.h3, color: colors.text, fontSize: 15 },
  challengeMeta: { ...type.bodySm, color: colors.textDim, fontSize: 12 },
  weekCard: { gap: spacing.md },
  weekTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  weekEyebrow: { ...type.label, color: colors.textDim },
  weekCount: { ...metric, color: colors.text, fontSize: 13, fontWeight: font.bold },
  weekMetrics: { flexDirection: 'row', alignItems: 'stretch' },
  weekMetric: { flex: 1, alignItems: 'flex-start', gap: 3 },
  weekMetricRule: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
    marginHorizontal: spacing.md,
  },
  weekMetricValue: {
    ...metric,
    color: colors.text,
    fontSize: 26,
    lineHeight: 30,
    fontWeight: font.heavy,
    letterSpacing: -1,
  },
  weekMetricUnit: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: font.bold,
    letterSpacing: 0,
  },
  weekMetricLabel: { ...type.micro, color: colors.textFaint },
  weekHint: { ...type.bodySm, color: colors.textDim },
  challengesSection: { gap: spacing.md },
  sectionTitle: { ...type.h2, color: colors.text, fontSize: 18, lineHeight: 22 },
  challengeScroller: { marginHorizontal: -spacing.lg },
  challengeRow: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: 9,
    paddingBottom: spacing.xs,
  },
  challengeCard: { width: 208 },
});

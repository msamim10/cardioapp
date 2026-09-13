import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  AppState,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MascotHero } from '@/components/MascotHero';
import { ModeCard } from '@/components/ModeCard';
import { Card, StatChip, WeekTracker } from '@/components/ui';
import { hasBeatmap } from '@/lib/beatmapRegistry';
import { getSimulatedRunnerCount } from '@/lib/communityActivity';
import { getDailyChallenge, isDailyChallengeCompleted } from '@/lib/dailyRecommendations';
import { getMode, modes } from '@/lib/gameData';
import { nextRewardLevel } from '@/lib/levels';
import { getModeCover } from '@/lib/modeCovers';
import { calendarWeekStart, MAX_LEVEL } from '@/lib/progressAggregation';
import { useProgress } from '@/lib/ProgressContext';
import {
  DAILY_CHALLENGE_XP_BONUS,
  nextLiveCompetitionDelay,
  type LeaderRow,
} from '@/lib/progression';
import { colors, font, metric, radius, spacing, type } from '@/theme';

const HERO_HEIGHT = Math.round(Dimensions.get('window').height * 0.4);
const POPULAR_CHALLENGE_IDS = [
  'neon-rails',
  'prison-escape-run',
  'dino-escape',
] as const;

// Missing/invalid selections are skipped; names and covers always come from
// the same canonical mode object used by the Levels screen.
const POPULAR_CHALLENGES = POPULAR_CHALLENGE_IDS.flatMap((id) => {
  const mode = getMode(id);
  return mode
    ? [
        {
          id,
          mode,
          cornerLabel: id === 'neon-rails' ? 'FEATURED' : undefined,
          participantCount: getSimulatedRunnerCount(id),
        },
      ]
    : [];
});

function CompetitionListCard({
  title,
  titleMeta,
  rows,
  highlightUser = false,
  emptyText,
}: {
  title: string;
  titleMeta?: string;
  rows: LeaderRow[];
  highlightUser?: boolean;
  emptyText: string;
}) {
  const accessibilityLabel = rows.length
    ? `${title}${titleMeta ? `, ${titleMeta}` : ''}. ${rows
        .map(
          (row) =>
            `Rank ${row.rank}, ${row.isUser ? 'you, ' : ''}${row.name}, ${row.calories} calories`
        )
        .join('. ')}`
    : `${title}. ${emptyText}`;

  return (
    <Card accessible accessibilityLabel={accessibilityLabel} style={styles.competitionListCard}>
      <View style={styles.listCardHeader}>
        <Text style={styles.listCardTitle}>{title}</Text>
        {titleMeta ? <Text style={styles.listCardMeta}>{titleMeta}</Text> : null}
      </View>
      {rows.length ? (
        <View style={styles.rankingList}>
          {rows.map((row, index) => {
            const isHighlightedUser = highlightUser && row.isUser;
            return (
              <View
                key={`${row.rank}-${row.name}`}
                style={[
                  styles.rankingRow,
                  index > 0 && styles.rankingRowSeparated,
                  isHighlightedUser && styles.rankingRowUser,
                ]}
              >
                <Text style={[styles.rowRank, isHighlightedUser && styles.rowTextUser]}>
                  #{row.rank}
                </Text>
                <Text
                  style={[styles.rowName, isHighlightedUser && styles.rowTextUser]}
                  numberOfLines={1}
                >
                  @{row.name}
                  {row.isUser ? ' (you)' : ''}
                </Text>
                <Text style={[styles.rowCalories, isHighlightedUser && styles.rowTextUser]}>
                  {row.calories.toLocaleString()} kcal
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.listEmpty}>{emptyText}</Text>
      )}
    </Card>
  );
}

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
  const {
    activeClassData,
    hydrated,
    streak,
    streakInfo,
    coins,
    runs,
    runsThisWeek,
    weeklyGoal,
    username,
    activeClass,
    advanceLiveCompetition,
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
    () => getDailyChallenge(modes, challengeDate, hasBeatmap),
    [challengeDate]
  );
  const challengeDone = useMemo(
    () => isDailyChallengeCompleted(runs, challenge),
    [challenge, runs]
  );

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

  useFocusEffect(
    useCallback(() => {
      if (!hydrated) return undefined;
      let focused = true;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const clearTimer = () => {
        if (timeout !== null) {
          clearTimeout(timeout);
          timeout = null;
        }
      };
      const scheduleNext = () => {
        clearTimer();
        if (!focused || AppState.currentState !== 'active') return;
        timeout = setTimeout(() => {
          timeout = null;
          if (!focused || AppState.currentState !== 'active') return;
          advanceLiveCompetition(activeClass);
          scheduleNext();
        }, nextLiveCompetitionDelay());
      };

      scheduleNext();
      const appStateSubscription = AppState.addEventListener('change', (nextState) => {
        clearTimer();
        if (nextState === 'active') scheduleNext();
      });

      return () => {
        focused = false;
        clearTimer();
        appStateSubscription.remove();
      };
    }, [activeClass, advanceLiveCompetition, hydrated])
  );

  const userLeaderboardIndex = activeClassData.leaderboard.findIndex((row) => row.isUser);
  const hasLeaderboard = hydrated && activeClassData.leaderboard.length > 0;
  const topRunners = hasLeaderboard ? activeClassData.leaderboard.slice(0, 3) : [];
  const aroundYouStart =
    userLeaderboardIndex >= 0
      ? Math.max(0, Math.min(userLeaderboardIndex - 1, activeClassData.leaderboard.length - 3))
      : 0;
  const aroundYou =
    hasLeaderboard && userLeaderboardIndex >= 0
      ? activeClassData.leaderboard.slice(aroundYouStart, aroundYouStart + 3)
      : [];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Animated mascot hero: fox ties its shoes then double-jumps over the trail. */}
      <MascotHero height={HERO_HEIGHT}>
        <View style={[styles.heroOverlay, { paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.usernameChip}>
            <Ionicons name="person-circle" size={18} color={colors.lime} />
            <Text style={styles.usernameText}>@{username || 'runner'}</Text>
          </View>
          <View style={styles.heroChips}>
            <View
              style={styles.streakChip}
              accessible
              accessibilityLabel={`${streak} day streak. Streak freeze ${streakInfo.freezeAvailable ? 'available' : 'used'} this week.`}
            >
              <Ionicons name="flame" size={16} color={colors.heat} />
              <Text style={styles.streakChipText}>{streak}</Text>
              <View
                style={[
                  styles.freezePill,
                  !streakInfo.freezeAvailable && styles.freezePillUsed,
                ]}
              >
                <Ionicons
                  name="snow"
                  size={10}
                  color={streakInfo.freezeAvailable ? colors.pace : colors.textFaint}
                />
                <Text
                  style={[
                    styles.freezePillText,
                    !streakInfo.freezeAvailable && styles.freezePillTextUsed,
                  ]}
                >
                  {streakInfo.freezeAvailable ? 'Freeze available' : 'Freeze used'}
                </Text>
              </View>
            </View>
            <StatChip icon="diamond" label={`${coins}`} accent="lime" />
          </View>
        </View>
      </MascotHero>

      <View style={styles.body}>
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
            }${challenge.practice ? ' Practice pick.' : ''}`}
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
                {challenge.practice ? (
                  <View style={styles.practicePill}>
                    <Text style={styles.practicePillText}>PRACTICE</Text>
                  </View>
                ) : null}
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

        <View style={styles.challengesSection}>
          <Text style={styles.sectionTitle}>Recommended for you</Text>
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.challengeRow}
            style={styles.challengeScroller}
          >
            {POPULAR_CHALLENGES.map((challenge) => (
              <ModeCard
                key={challenge.id}
                mode={challenge.mode}
                completed={isLevelCompleted(challenge.id)}
                cornerLabel={challenge.cornerLabel}
                participantCount={challenge.participantCount}
                showMeta={false}
                showAction={false}
                style={styles.challengeCard}
                onPress={() =>
                  router.push({
                    pathname: '/level/[id]',
                    params: { id: challenge.id },
                  })
                }
              />
            ))}
          </ScrollView>
        </View>

        {/* Active-class competition, kept separate from class selection and summaries. */}
        <View style={styles.competitionSection}>
          <View style={styles.competitionHeader}>
            <Text style={styles.competitionTitle}>Competition</Text>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          </View>
          <View style={styles.competitionCards}>
            <CompetitionListCard
              title="Top runners"
              rows={topRunners}
              emptyText="Rankings unavailable."
            />
            <CompetitionListCard
              title="Around you"
              titleMeta={
                hasLeaderboard
                  ? `#${activeClassData.rank} of ${activeClassData.rankTotal}`
                  : undefined
              }
              rows={aroundYou}
              highlightUser
              emptyText="Your ranking is unavailable."
            />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 0 },
  body: { paddingHorizontal: spacing.lg, gap: spacing.lg, paddingTop: spacing.sm },
  heroOverlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
  },
  // MascotHero has no top scrim, so this fill is the only thing keeping the
  // label above AA over the hero art's bright sky.
  usernameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8,9,10,0.78)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  usernameText: { color: colors.text, fontSize: 14, fontWeight: font.bold },
  heroChips: { flexDirection: 'row', gap: spacing.sm },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: spacing.md,
    paddingRight: 6,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  streakChipText: { ...metric, color: colors.text, fontSize: 14, fontWeight: font.bold },
  freezePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(61,197,240,0.14)',
  },
  freezePillUsed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  freezePillText: { color: colors.pace, fontSize: 9, fontWeight: font.black, letterSpacing: 0.3 },
  freezePillTextUsed: { color: colors.textFaint },

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
  practicePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  practicePillText: { color: colors.textDim, fontSize: 8, fontWeight: font.black, letterSpacing: 0.6 },
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
  competitionSection: { gap: spacing.md },
  competitionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  competitionTitle: { ...type.h2, color: colors.text, fontSize: 18, lineHeight: 22 },
  // Live state carries the fixed alert red, not the CTA lime.
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
    backgroundColor: 'rgba(255,71,87,0.14)',
  },
  liveDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.effort },
  liveText: { ...type.micro, color: colors.effort },
  competitionCards: { gap: spacing.md },
  competitionListCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  listCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listCardTitle: { ...type.label, color: colors.textDim },
  listCardMeta: { ...metric, color: colors.lime, fontSize: 12, fontWeight: font.bold },
  rankingList: { marginHorizontal: -spacing.xs },
  rankingRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rankingRowSeparated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  rankingRowUser: {
    borderLeftWidth: 2,
    borderLeftColor: colors.lime,
    borderRadius: radius.xs,
    backgroundColor: 'rgba(215,255,62,0.08)',
  },
  rowRank: {
    ...metric,
    width: 32,
    color: colors.textDim,
    fontSize: 13,
    fontWeight: font.heavy,
  },
  rowName: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: font.semibold,
  },
  rowCalories: {
    ...metric,
    color: colors.text,
    fontSize: 12,
    fontWeight: font.bold,
    textAlign: 'right',
  },
  rowTextUser: { color: colors.lime },
  listEmpty: { ...type.bodySm, color: colors.textDim, paddingVertical: spacing.md },
});

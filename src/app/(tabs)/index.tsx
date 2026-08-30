import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import {
  AppState,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GameplayHero } from '@/components/GameplayHero';
import { ModeCard } from '@/components/ModeCard';
import { Card, Mascot, StatChip, WeekTracker } from '@/components/ui';
import { getSimulatedRunnerCount } from '@/lib/communityActivity';
import { getMode } from '@/lib/gameData';
import { modeCovers } from '@/lib/modeCovers';
import { calendarWeekStart } from '@/lib/progressAggregation';
import { useProgress } from '@/lib/ProgressContext';
import { nextLiveCompetitionDelay, type LeaderRow } from '@/lib/progression';
import { colors, font, metric, radius, spacing, type } from '@/theme';

const HERO_HEIGHT = Math.round(Dimensions.get('window').height * 0.3);
// Deliberately not one of the three challenges listed below, so the banner
// reads as the world rather than as a duplicate of a card on the same screen.
const HERO_ART = modeCovers['red-light-rush-2'];
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
          cornerLabel: id === 'neon-rails' ? 'MOST POPULAR' : undefined,
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
    coins,
    runs,
    runsThisWeek,
    weeklyGoal,
    username,
    activeClass,
    advanceLiveCompetition,
    isLevelCompleted,
  } = useProgress();

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
      <GameplayHero
        accessibilityLabel="A runner crossing lit platforms high above a neon city"
        fadeTo={colors.bg}
        height={HERO_HEIGHT}
        source={HERO_ART}
      >
        <View style={[styles.heroOverlay, { paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.usernameChip}>
            <Mascot size={22} variant="avatar" />
            <Text style={styles.usernameText}>@{username || 'runner'}</Text>
          </View>
          <View style={styles.heroChips}>
            <StatChip icon="flame" label={`${streak}`} accent="orange" />
            <StatChip icon="diamond" label={`${coins}`} accent="lime" />
          </View>
        </View>
      </GameplayHero>

      <View style={styles.body}>
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
          <Text style={styles.sectionTitle}>Popular this week</Text>
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
  // Opaque enough that the label clears AA over any frame of the hero art, not
  // just the scrimmed top of it.
  usernameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingLeft: 7,
    paddingRight: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8,9,10,0.78)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  usernameText: { color: colors.text, fontSize: 14, fontWeight: font.bold },
  heroChips: { flexDirection: 'row', gap: spacing.sm },
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

import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import {
  AppState,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MascotHero } from '@/components/MascotHero';
import { ModeCard } from '@/components/ModeCard';
import { Card, StatChip, WeekTracker } from '@/components/ui';
import { getSimulatedRunnerCount } from '@/lib/communityActivity';
import { getMode } from '@/lib/gameData';
import { useProgress } from '@/lib/ProgressContext';
import { nextLiveCompetitionDelay, type LeaderRow } from '@/lib/progression';
import { colors, font, radius, spacing } from '@/theme';

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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    activeClassData,
    hydrated,
    streak,
    coins,
    runsThisWeek,
    weeklyGoal,
    username,
    activeClass,
    advanceLiveCompetition,
    isLevelCompleted,
  } = useProgress();

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
            <StatChip icon="flame" label={`${streak}`} accent="orange" />
            <StatChip icon="gift" label={`${coins}`} accent="lime" />
          </View>
        </View>
      </MascotHero>

      <View style={styles.body}>
        {/* Streak + weekly progress */}
        <Card style={styles.weekCard}>
          <View style={styles.weekTop}>
            <View style={styles.weekStreak}>
              <Ionicons name="flame" size={20} color={colors.orange} />
              <Text style={styles.weekStreakValue}>{streak}</Text>
              <Text style={styles.weekStreakLabel}>day streak</Text>
            </View>
            <Text style={styles.weekCount}>
              {runsThisWeek}/{weeklyGoal} this week
            </Text>
          </View>
          <WeekTracker count={runsThisWeek} goal={weeklyGoal} accent="lime" />
          <Text style={styles.weekHint}>
            {runsThisWeek >= weeklyGoal
              ? 'Weekly goal smashed. Keep the streak alive!'
              : `${Math.max(0, weeklyGoal - runsThisWeek)} more to hit your weekly goal.`}
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
  usernameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(10,10,15,0.55)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  usernameText: { color: colors.text, fontSize: 14, fontWeight: font.bold },
  heroChips: { flexDirection: 'row', gap: spacing.sm },
  weekCard: { gap: spacing.md },
  weekTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  weekStreak: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  weekStreakValue: { color: colors.text, fontSize: 20, fontWeight: font.black },
  weekStreakLabel: { color: colors.textDim, fontSize: 13, fontWeight: font.medium },
  weekCount: { color: colors.text, fontSize: 13, fontWeight: font.bold },
  weekHint: { color: colors.textDim, fontSize: 13, fontWeight: font.medium },
  challengesSection: { gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: font.bold, letterSpacing: -0.3 },
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
  competitionTitle: { color: colors.text, fontSize: 18, fontWeight: font.bold, letterSpacing: -0.3 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  liveDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.lime },
  liveText: { color: colors.lime, fontSize: 10, fontWeight: font.bold, textTransform: 'uppercase' },
  competitionCards: { gap: spacing.md },
  competitionListCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  listCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listCardTitle: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: font.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  listCardMeta: { color: colors.lime, fontSize: 12, fontWeight: font.bold },
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
    borderRadius: radius.sm,
    backgroundColor: 'rgba(198,255,61,0.08)',
  },
  rowRank: {
    width: 32,
    color: colors.textDim,
    fontSize: 13,
    fontWeight: font.black,
  },
  rowName: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: font.semibold,
  },
  rowCalories: {
    color: colors.text,
    fontSize: 12,
    fontWeight: font.bold,
    textAlign: 'right',
  },
  rowTextUser: { color: colors.lime },
  listEmpty: { color: colors.textDim, fontSize: 13, fontWeight: font.medium, paddingVertical: spacing.md },
});

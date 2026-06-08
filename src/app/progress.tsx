import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppHeader, IconBadge, NeonScreen, Panel, ProgressBar, SectionHeader, accentColor, neon } from '@/components/neon/NeonUi';
import { BottomTabBar } from '@/components/BottomTabBar';
import { useRunnerUiData } from '@/hooks/useRunnerUiData';
import type { Achievement, MetricCardData, RecentRun, UiAccent, WeeklyActivity } from '@/lib/run-ui-data';
import { percent } from '@/lib/run-ui-data';

const metricLabels: Record<string, [string, string]> = {
  'week-cal': ['CAL BURNED', 'THIS WEEK'],
  'week-min': ['MIN PLAYED', 'THIS WEEK'],
  dodged: ['OBSTACLES', 'DODGED'],
  combo: ['LONGEST', 'COMBO'],
  runs: ['TOTAL', 'RUNS'],
};

const trendSets = [
  [6, 8, 5, 9, 7, 11, 8],
  [5, 7, 6, 8, 10, 6, 9],
  [7, 5, 9, 6, 10, 8, 12],
  [4, 8, 6, 9, 5, 10, 7],
  [6, 4, 8, 7, 10, 9, 12],
];

export default function ProgressScreen() {
  const router = useRouter();
  const { data } = useRunnerUiData();
  const xpProgress = percent(data.user.xp, data.user.nextLevelXp);
  const weeklyCalories = data.weeklyActivity.reduce((sum, item) => sum + (item.calories ?? 0), 0);
  const weeklyGoalCurrent = Math.min(data.recentRuns.length, 5);
  const heroImage = data.modes.find((mode) => mode.id === 'neon-sprint')?.image ?? data.homeHeroImage;

  return (
    <View style={styles.root}>
      <NeonScreen contentStyle={styles.screenContent}>
        <AppHeader user={data.user} onActionPress={() => router.push('/settings')} />

        <View style={styles.hero}>
          <ExpoImage source={heroImage} style={styles.heroImage} contentFit="cover" contentPosition="top center" />
          <LinearGradient
            colors={['rgba(3,7,18,0.12)', 'rgba(3,7,18,0.62)', 'rgba(3,7,18,0.97)']}
            locations={[0, 0.45, 1]}
            style={styles.heroShade}
          />
          <MaterialCommunityIcons name="crown" size={34} color={neon.lime} style={styles.heroCrown} />
          <View style={styles.heroCopy}>
            <Text style={styles.title}>PROGRESS</Text>
            <Text style={styles.subtitle}>Track your cardio journey</Text>
          </View>
        </View>

        <View style={styles.summaryStrip}>
          <SummaryStat icon="fire" accent="orange" value={`${data.user.streakDays}`} label="DAY STREAK" />
          <View style={styles.summaryDivider} />
          <View style={styles.levelSummary}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>{data.user.level}</Text>
            </View>
            <View style={styles.levelDetails}>
              <Text style={styles.levelLabel}>LEVEL</Text>
              <ProgressBar current={data.user.xp} target={data.user.nextLevelXp} accent="purple" />
              <Text style={styles.xpText}>
                {data.user.xp.toLocaleString()} / {data.user.nextLevelXp.toLocaleString()} XP
              </Text>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <SummaryStat icon="coin" accent="orange" value={data.user.coins.toLocaleString()} label="TOTAL COINS" />
          <View style={[styles.summaryGlow, { width: `${Math.round(xpProgress * 100)}%` }]} />
        </View>

        <View style={styles.statsRow}>
          {data.progressStats.map((metric, index) => (
            <ProgressMetricCard key={metric.id} metric={metric} values={trendSets[index] ?? trendSets[0]} />
          ))}
        </View>

        <View style={styles.sectionLine}>
          <SectionHeader title="Weekly Activity" actionLabel="This Week" />
        </View>
        <WeeklyActivityPanel activity={data.weeklyActivity} totalCalories={weeklyCalories} />

        <View style={styles.achievementHeader}>
          <SectionHeader title="Achievements" actionLabel="View all" />
        </View>
        <View style={styles.achievementArea}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.achievementRail}>
            {data.achievements.map((item) => (
              <AchievementMiniCard key={item.id} item={item} />
            ))}
          </ScrollView>
          <WeeklyGoalCard current={weeklyGoalCurrent} target={5} />
        </View>

        <View style={styles.twoColumnSections}>
          <View style={styles.columnSection}>
            <SectionHeader title="Personal Bests" actionLabel="View all" />
            <View style={styles.bestRow}>
              {data.personalBests.map((metric) => (
                <PersonalBestCard key={metric.id} metric={metric} />
              ))}
            </View>
          </View>

          <View style={styles.columnSection}>
            <SectionHeader title="Recent Runs" actionLabel="View all" />
            <View style={styles.recentList}>
              {data.recentRuns.map((run) => (
                <RecentRunRow key={run.id} run={run} />
              ))}
            </View>
          </View>
        </View>
      </NeonScreen>
      <BottomTabBar />
    </View>
  );
}

function SummaryStat({
  icon,
  accent,
  value,
  label,
}: {
  icon: 'fire' | 'coin';
  accent: UiAccent;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.summaryStat}>
      <IconBadge kind={icon} accent={accent} size={42} />
      <View style={styles.summaryStatText}>
        <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        <Text style={styles.summaryLabel}>{label}</Text>
      </View>
    </View>
  );
}

function ProgressMetricCard({ metric, values }: { metric: MetricCardData; values: number[] }) {
  const color = accentColor(metric.accent);
  const [lineOne, lineTwo] = metricLabels[metric.id] ?? [metric.label.toUpperCase(), ''];

  return (
    <View style={[styles.metricCard, { borderColor: `${color}66` }]}>
      <IconBadge kind={metric.icon} accent={metric.accent} size={34} />
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
        {metric.value}
      </Text>
      <Text style={styles.metricLabel}>{lineOne}</Text>
      {lineTwo ? <Text style={styles.metricLabel}>{lineTwo}</Text> : null}
      <MiniSpark values={values} color={color} />
    </View>
  );
}

function MiniSpark({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  return (
    <View style={styles.spark}>
      {values.map((value, index) => (
        <View
          key={`${value}-${index}`}
          style={[styles.sparkBar, { height: 4 + (value / max) * 16, backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

function WeeklyActivityPanel({
  activity,
  totalCalories,
}: {
  activity: WeeklyActivity[];
  totalCalories: number;
}) {
  const max = Math.max(...activity.map((item) => item.calories ?? 0), 1);

  return (
    <Panel style={styles.weekPanel}>
      <View style={styles.chartArea}>
        <View style={styles.axisLabels}>
          <Text style={styles.axisLabel}>CAL</Text>
          <Text style={styles.axisLabel}>300</Text>
          <Text style={styles.axisLabel}>200</Text>
          <Text style={styles.axisLabel}>100</Text>
          <Text style={styles.axisLabel}>0</Text>
        </View>
        <View style={styles.chartGrid}>
          <View style={styles.gridLine} />
          <View style={styles.gridLine} />
          <View style={styles.gridLine} />
          <View style={styles.barRow}>
            {activity.map((item) => {
              const height = item.calories === null ? 18 : 32 + ((item.calories ?? 0) / max) * 88;
              return (
                <View key={item.day} style={styles.barColumn}>
                  <Text style={styles.chartValue}>{item.calories ?? '--'}</Text>
                  <LinearGradient
                    colors={item.calories === null ? ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.08)'] : ['#ff8b23', neon.pink, neon.purple]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={[styles.chartBar, { height }]}
                  />
                  <Text style={styles.chartDay}>{item.day}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>
      <View style={styles.weekTotalCard}>
        <Text style={styles.weekKicker}>WEEK TOTAL</Text>
        <IconBadge kind="fire" accent="pink" size={38} />
        <Text style={styles.weekValue}>{totalCalories.toLocaleString()}</Text>
        <Text style={styles.weekLabel}>CALORIES</Text>
        <Text style={styles.weekTrend}>▲ 18%</Text>
        <Text style={styles.weekTrendSub}>vs last week</Text>
      </View>
    </Panel>
  );
}

function AchievementMiniCard({ item }: { item: Achievement }) {
  const color = accentColor(item.accent);
  const showProgress = typeof item.progress === 'number' && typeof item.target === 'number';

  return (
    <View style={[styles.achievementCard, { borderColor: `${color}88` }]}>
      <IconBadge kind={item.icon} accent={item.accent} size={50} />
      <Text style={styles.achievementTitle} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.achievementSub} numberOfLines={1}>
        {item.subtitle}
      </Text>
      {showProgress ? (
        <ProgressBar current={item.progress ?? 0} target={item.target ?? 1} accent={item.accent} label={`${item.progress} / ${item.target}`} />
      ) : item.completed ? (
        <IconBadge kind="check" accent="lime" size={24} />
      ) : null}
    </View>
  );
}

function WeeklyGoalCard({ current, target }: { current: number; target: number }) {
  const progress = percent(current, target);

  return (
    <Panel style={styles.goalCard}>
      <View style={styles.goalTitleRow}>
        <IconBadge kind="timer" accent="pink" size={30} />
        <Text style={styles.goalTitle}>WEEKLY GOAL</Text>
      </View>
      <View style={styles.goalRing}>
        <View style={styles.goalRingTrack} />
        <View style={[styles.goalRingFill, { transform: [{ rotate: `${Math.round(progress * 300)}deg` }] }]} />
        <Text style={styles.goalValue}>
          {current}
          <Text style={styles.goalTarget}> / {target}</Text>
        </Text>
        <Text style={styles.goalSub}>RUNS COMPLETE</Text>
      </View>
      <Text style={styles.goalNote}>Great job! Keep pushing!</Text>
    </Panel>
  );
}

function PersonalBestCard({ metric }: { metric: MetricCardData }) {
  const color = accentColor(metric.accent);

  return (
    <View style={[styles.bestCard, { borderColor: `${color}66` }]}>
      <IconBadge kind={metric.icon} accent={metric.accent} size={38} />
      <Text style={styles.bestLabel} numberOfLines={2}>
        {metric.label}
      </Text>
      <Text style={styles.bestValue} numberOfLines={1} adjustsFontSizeToFit>
        {metric.value}
      </Text>
      {metric.detail ? <Text style={[styles.bestDetail, { color }]}>{metric.detail}</Text> : null}
    </View>
  );
}

function RecentRunRow({ run }: { run: RecentRun }) {
  return (
    <View style={styles.recentRow}>
      <ExpoImage source={run.image} style={styles.recentImage} contentFit="cover" contentPosition="center" />
      <View style={styles.recentText}>
        <Text style={styles.recentDate}>{run.dateLabel}</Text>
        <Text style={styles.recentDistance}>{run.distanceKm.toFixed(2)} km</Text>
      </View>
      <View style={styles.recentCalories}>
        <MaterialCommunityIcons name="fire" size={15} color={neon.orange} />
        <Text style={styles.recentCaloriesText}>{run.calories} cal</Text>
      </View>
      <View style={styles.recentArrow}>
        <MaterialCommunityIcons name="chevron-right" size={24} color={neon.text} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: neon.bg,
  },
  screenContent: {
    gap: 16,
    paddingTop: 10,
  },
  hero: {
    minHeight: 178,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,43,194,0.7)',
    backgroundColor: neon.panel,
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  heroShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  heroCrown: {
    position: 'absolute',
    left: 16,
    top: 17,
    transform: [{ rotate: '-14deg' }],
    textShadowColor: 'rgba(185,255,0,0.5)',
    textShadowRadius: 10,
  },
  heroCopy: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 18,
    paddingBottom: 20,
  },
  title: {
    color: neon.text,
    fontSize: 44,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 0,
    textShadowColor: 'rgba(255,43,194,0.8)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  subtitle: {
    color: neon.muted,
    fontSize: 17,
    fontWeight: '800',
  },
  summaryStrip: {
    minHeight: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(17,22,41,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,122,16,0.55)',
  },
  summaryGlow: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
    backgroundColor: neon.purple,
  },
  summaryStat: {
    flex: 0.92,
    alignItems: 'center',
    gap: 5,
  },
  summaryStatText: {
    alignItems: 'center',
  },
  summaryValue: {
    color: neon.text,
    fontSize: 24,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: {
    color: neon.muted,
    fontSize: 10,
    fontWeight: '900',
  },
  summaryDivider: {
    width: 1,
    height: 58,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  levelSummary: {
    flex: 1.35,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  levelBadge: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: neon.purple,
    backgroundColor: 'rgba(141,53,255,0.34)',
  },
  levelBadgeText: {
    color: neon.text,
    fontSize: 20,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  levelDetails: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  levelLabel: {
    color: neon.text,
    fontSize: 11,
    fontWeight: '900',
  },
  xpText: {
    color: neon.pink,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  statsRow: {
    flexDirection: 'row',
    gap: 7,
  },
  metricCard: {
    flex: 1,
    minHeight: 138,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 7,
    borderRadius: 15,
    borderWidth: 1.2,
    backgroundColor: 'rgba(17,22,41,0.84)',
  },
  metricValue: {
    color: neon.text,
    fontSize: 22,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  metricLabel: {
    color: neon.muted,
    fontSize: 8.5,
    lineHeight: 10.5,
    fontWeight: '900',
    textAlign: 'center',
  },
  spark: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginTop: 2,
  },
  sparkBar: {
    width: 4,
    borderRadius: 3,
  },
  sectionLine: {
    marginTop: 2,
  },
  weekPanel: {
    minHeight: 200,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  chartArea: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minWidth: 0,
  },
  axisLabels: {
    width: 24,
    justifyContent: 'space-between',
    paddingBottom: 23,
  },
  axisLabel: {
    color: neon.muted,
    fontSize: 9,
    fontWeight: '800',
  },
  chartGrid: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 0,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  barRow: {
    height: 162,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 4,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  chartBar: {
    width: 20,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  chartValue: {
    color: neon.text,
    fontSize: 9,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  chartDay: {
    color: neon.muted,
    fontSize: 9,
    fontWeight: '900',
  },
  weekTotalCard: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 9,
    borderRadius: 16,
    backgroundColor: 'rgba(17,22,41,0.88)',
    borderWidth: 1,
    borderColor: neon.border,
  },
  weekKicker: {
    color: neon.muted,
    fontSize: 9.5,
    fontWeight: '900',
    textAlign: 'center',
  },
  weekValue: {
    color: neon.text,
    fontSize: 23,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  weekLabel: {
    color: neon.muted,
    fontSize: 9,
    fontWeight: '900',
  },
  weekTrend: {
    color: neon.lime,
    fontSize: 12,
    fontWeight: '900',
  },
  weekTrendSub: {
    color: neon.muted,
    fontSize: 9,
    textAlign: 'center',
  },
  achievementHeader: {
    marginTop: 2,
  },
  achievementArea: {
    gap: 10,
  },
  achievementRail: {
    gap: 10,
    paddingRight: 18,
  },
  achievementCard: {
    width: 124,
    minHeight: 146,
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderRadius: 16,
    borderWidth: 1.2,
    backgroundColor: 'rgba(17,22,41,0.82)',
  },
  achievementTitle: {
    color: neon.text,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  achievementSub: {
    color: neon.muted,
    fontSize: 11,
    textAlign: 'center',
  },
  goalCard: {
    minHeight: 164,
    gap: 10,
    borderColor: 'rgba(141,53,255,0.78)',
  },
  goalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  goalTitle: {
    color: neon.text,
    fontSize: 16,
    fontWeight: '900',
  },
  goalRing: {
    alignSelf: 'center',
    width: 118,
    height: 118,
    borderRadius: 59,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  goalRingTrack: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 9,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  goalRingFill: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderTopWidth: 9,
    borderRightWidth: 9,
    borderColor: neon.lime,
  },
  goalValue: {
    color: neon.lime,
    fontSize: 28,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  goalTarget: {
    color: neon.text,
    fontSize: 16,
  },
  goalSub: {
    color: neon.muted,
    fontSize: 9,
    fontWeight: '900',
  },
  goalNote: {
    color: neon.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  twoColumnSections: {
    gap: 16,
  },
  columnSection: {
    gap: 10,
  },
  bestRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bestCard: {
    flex: 1,
    minHeight: 134,
    padding: 9,
    gap: 5,
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1.2,
    backgroundColor: 'rgba(17,22,41,0.82)',
  },
  bestLabel: {
    color: neon.text,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  bestValue: {
    color: neon.text,
    fontSize: 20,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  bestDetail: {
    fontSize: 10,
    fontWeight: '900',
  },
  recentList: {
    gap: 8,
  },
  recentRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 15,
    backgroundColor: 'rgba(17,22,41,0.82)',
    borderWidth: 1,
    borderColor: neon.border,
  },
  recentImage: {
    width: 78,
    height: 48,
    borderRadius: 10,
  },
  recentText: {
    flex: 1,
    minWidth: 0,
  },
  recentDate: {
    color: neon.muted,
    fontSize: 10,
  },
  recentDistance: {
    color: neon.text,
    fontSize: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  recentCalories: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  recentCaloriesText: {
    color: neon.text,
    fontSize: 12,
    fontWeight: '900',
  },
  recentArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: neon.border,
  },
});

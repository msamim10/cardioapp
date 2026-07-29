import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  aggregateWeeklyActivity,
  type WeeklyActivity,
} from '@/lib/progressAggregation';
import { useProgress } from '@/lib/ProgressContext';
import { colors, font, radius, spacing } from '@/theme';

const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const LONG_WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const LEVEL_SEGMENTS = 15;
const CHART_HEIGHT = 142;

const METRICS = {
  calories: { color: colors.orange, tint: 'rgba(255,138,61,0.13)' },
  minutes: { color: colors.cyan, tint: 'rgba(69,224,255,0.11)' },
  movement: { color: colors.violet, tint: 'rgba(139,92,255,0.14)' },
  runs: { color: colors.text, tint: 'rgba(255,255,255,0.07)' },
} as const;

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const {
    runs,
    totalCalories,
    totalMinutes,
    totalObstacles,
    totalRuns,
    levelProgress,
  } = useProgress();
  const weekly = useMemo(() => aggregateWeeklyActivity(runs), [runs]);
  const averageCalories = totalRuns > 0 ? totalCalories / totalRuns : 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: spacing.md },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>PERFORMANCE</Text>
          <Text style={styles.title}>Progress</Text>
        </View>
        <View style={styles.headerMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.headerMarkInner} />
        </View>
      </View>

      <LevelHero progress={levelProgress} />
      <WeeklyActivityCard activity={weekly} />

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>All-time output</Text>
          <Text style={styles.sectionCaption}>{totalRuns === 1 ? '1 completed run' : `${totalRuns} completed runs`}</Text>
        </View>

        <View style={styles.lifetimeStack}>
          <View
            style={styles.calorieCard}
            accessible
            accessibilityRole="summary"
            accessibilityLabel={`Total calories burned: ${Math.round(totalCalories)}`}
          >
            <View style={[styles.metricIcon, { backgroundColor: METRICS.calories.tint }]}>
              <Ionicons name="flame" size={22} color={METRICS.calories.color} />
            </View>
            <View style={styles.calorieCopy}>
              <Text style={styles.metricKicker}>TOTAL BURN</Text>
              <Text style={styles.calorieValue} numberOfLines={1} adjustsFontSizeToFit>
                {Math.round(totalCalories).toLocaleString()}
                <Text style={styles.calorieUnit}> kcal</Text>
              </Text>
            </View>
            <View style={styles.caloriePulse} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {[0.35, 0.56, 0.44, 0.78, 0.62, 1, 0.7].map((height, index) => (
                <View
                  key={index}
                  style={[
                    styles.pulseBar,
                    {
                      height: 10 + height * 29,
                      opacity: 0.24 + height * 0.6,
                    },
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={styles.metricPair}>
            <MetricPanel
              color={METRICS.minutes.color}
              tint={METRICS.minutes.tint}
              icon="time"
              value={Math.round(totalMinutes).toLocaleString()}
              unit="min"
              label="Active time"
            />
            <MetricPanel
              color={METRICS.movement.color}
              tint={METRICS.movement.tint}
              icon="body"
              value={totalObstacles.toLocaleString()}
              unit="moves"
              label="Obstacles dodged"
            />
          </View>

          <View
            style={styles.runsStrip}
            accessible
            accessibilityRole="summary"
            accessibilityLabel={`Total runs: ${totalRuns}. Average calories per run: ${Math.round(averageCalories)}.`}
          >
            <View style={[styles.metricIcon, { backgroundColor: METRICS.runs.tint }]}>
              <Ionicons name="footsteps" size={20} color={METRICS.runs.color} />
            </View>
            <View style={styles.runsPrimary}>
              <Text style={styles.runsValue}>{totalRuns.toLocaleString()}</Text>
              <Text style={styles.runsLabel}>Total runs</Text>
            </View>
            <View style={styles.runsDivider} />
            <View style={styles.runsInsight}>
              <Text style={styles.insightValue}>{Math.round(averageCalories).toLocaleString()} kcal</Text>
              <Text style={styles.insightLabel}>average per run</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function LevelHero({ progress }: { progress: ReturnType<typeof useProgress>['levelProgress'] }) {
  const tier = tierForLevel(progress.level);
  return (
    <LinearGradient
      colors={['#202039', '#13131E', '#0E0E15']}
      locations={[0, 0.58, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.levelHero}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${tier}, Level ${progress.level}. ${progress.intoLevel} of ${progress.span} experience points. ${progress.toNext} experience points to Level ${progress.level + 1}.`}
    >
      <LevelOrbit level={progress.level} value={progress.progress} />
      <View style={styles.heroCopy}>
        <View style={styles.tierRow}>
          <View style={styles.tierDot} />
          <Text style={styles.tierName}>{tier.toUpperCase()}</Text>
        </View>
        <Text style={styles.heroTitle}>Fitness level</Text>
        <Text style={styles.heroRemaining}>
          <Text style={styles.heroRemainingStrong}>{progress.toNext.toLocaleString()} XP</Text>
          {' '}until Level {progress.level + 1}
        </Text>
        <View style={styles.segmentRail} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: 10 }, (_, index) => (
            <View
              key={index}
              style={[
                styles.railSegment,
                index < Math.ceil(progress.progress * 10) && styles.railSegmentFilled,
              ]}
            />
          ))}
        </View>
        <Text style={styles.heroXp}>
          {progress.intoLevel.toLocaleString()} / {progress.span.toLocaleString()} XP
        </Text>
      </View>
    </LinearGradient>
  );
}

function LevelOrbit({ level, value }: { level: number; value: number }) {
  const completed = Math.round(value * LEVEL_SEGMENTS);
  return (
    <View style={styles.orbit} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.orbitInner}>
        <Text style={styles.levelNumeral} numberOfLines={1} adjustsFontSizeToFit>{level}</Text>
        <Text style={styles.levelLabel}>LEVEL</Text>
      </View>
      {Array.from({ length: LEVEL_SEGMENTS }, (_, index) => {
        const angle = -132 + index * (264 / (LEVEL_SEGMENTS - 1));
        return (
          <View
            key={index}
            style={[
              styles.orbitSegmentAnchor,
              { transform: [{ rotate: `${angle}deg` }] },
            ]}
          >
            <View
              style={[
                styles.orbitSegment,
                index < completed ? styles.orbitSegmentFilled : styles.orbitSegmentEmpty,
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function WeeklyActivityCard({ activity }: { activity: WeeklyActivity }) {
  const maxCalories = Math.max(...activity.dailyCalories, 0);
  const scaleMax = niceScale(maxCalories);
  const todayIndex = dayIndexInWeek(activity.weekStart, Date.now());
  const activeDays = activity.dailyCalories.filter((value) => value > 0).length;
  const hasActivity = activity.currentCalories > 0;
  const comparison =
    activity.comparisonCalories === 0
      ? hasActivity
        ? 'New'
        : '—'
      : `${activity.changePercent! > 0 ? '+' : ''}${activity.changePercent}%`;
  const comparisonColor =
    activity.changePercent === null || activity.changePercent === 0
      ? colors.textDim
      : activity.changePercent > 0
        ? colors.cyan
        : colors.pink;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>This week</Text>
        <Text style={styles.sectionCaption}>{activeDays} active {activeDays === 1 ? 'day' : 'days'}</Text>
      </View>
      <View style={styles.weekCard}>
        <View style={styles.weekSummary}>
          <View style={styles.weekTotal}>
            <Text style={styles.weekKicker}>CALORIES BURNED</Text>
            <Text style={styles.weekCalories} numberOfLines={1} adjustsFontSizeToFit>
              {Math.round(activity.currentCalories).toLocaleString()}
              <Text style={styles.weekCaloriesUnit}> kcal</Text>
            </Text>
          </View>
          <View style={styles.comparison}>
            <View style={[styles.comparisonBadge, { borderColor: `${comparisonColor}55` }]}>
              <Ionicons
                name={
                  activity.changePercent === null || activity.changePercent === 0
                    ? 'remove'
                    : activity.changePercent > 0
                      ? 'trending-up'
                      : 'trending-down'
                }
                size={14}
                color={comparisonColor}
              />
              <Text style={[styles.comparisonValue, { color: comparisonColor }]}>{comparison}</Text>
            </View>
            <Text style={styles.comparisonLabel}>{activity.comparisonLabel}</Text>
          </View>
        </View>

        <View
          style={styles.chartA11y}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Daily calories this week: ${activity.dailyCalories
            .map((value, index) => `${longWeekdayLabel(activity.weekStart, index)} ${Math.round(value)}`)
            .join(', ')}`}
        >
          <View style={styles.scale}>
            <Text style={styles.scaleText}>{scaleMax}</Text>
            <Text style={styles.scaleText}>{Math.round(scaleMax / 2)}</Text>
            <Text style={styles.scaleText}>0</Text>
          </View>
          <View style={styles.plot}>
            <View style={[styles.gridLine, { top: 0 }]} />
            <View style={[styles.gridLine, { top: CHART_HEIGHT / 2 }]} />
            <View style={[styles.gridLine, { top: CHART_HEIGHT }]} />
            <View style={styles.bars}>
              {activity.dailyCalories.map((calories, index) => {
                const isToday = index === todayIndex;
                const isFuture = index > todayIndex;
                const height = calories > 0 ? Math.max(7, (calories / scaleMax) * CHART_HEIGHT) : 3;
                return (
                  <View key={index} style={styles.barColumn}>
                    <View style={styles.barArea}>
                      {isToday && calories > 0 ? (
                        <Text style={styles.todayValue}>{Math.round(calories)}</Text>
                      ) : null}
                      <LinearGradient
                        colors={
                          calories > 0
                            ? ['#FFAA61', colors.orange]
                            : ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.06)']
                        }
                        style={[
                          styles.bar,
                          {
                            height,
                            opacity: isFuture ? 0.32 : isToday ? 1 : 0.76,
                          },
                        ]}
                      />
                    </View>
                    <View style={[styles.dayMarker, isToday && styles.dayMarkerToday]}>
                      <Text style={[styles.weekday, isToday && styles.weekdayToday]}>
                        {weekdayLabel(activity.weekStart, index)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {!hasActivity ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="pulse-outline" size={18} color={colors.orange} />
            </View>
            <View style={styles.emptyCopy}>
              <Text style={styles.emptyTitle}>Your week is ready</Text>
              <Text style={styles.emptyText}>Calories from your next completed run will appear here.</Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function MetricPanel({
  color,
  tint,
  icon,
  value,
  unit,
  label,
}: {
  color: string;
  tint: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  unit: string;
  label: string;
}) {
  return (
    <View style={styles.metricPanel} accessible accessibilityRole="summary" accessibilityLabel={`${label}: ${value} ${unit}`}>
      <View style={[styles.metricIconSmall, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={styles.metricPanelCopy}>
        <Text style={styles.panelValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        <Text style={[styles.panelUnit, { color }]}>{unit}</Text>
      </View>
      <Text style={styles.panelLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function tierForLevel(level: number) {
  if (level >= 15) return 'Apex Runner';
  if (level >= 10) return 'Trailblazer';
  if (level >= 6) return 'Pacesetter';
  if (level >= 3) return 'Strider';
  return 'Rookie';
}

function niceScale(value: number) {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function dayIndexInWeek(weekStart: number, timestamp: number) {
  for (let index = 0; index < 7; index += 1) {
    const start = new Date(weekStart);
    start.setDate(start.getDate() + index);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    if (timestamp >= start.getTime() && timestamp < end.getTime()) return index;
  }
  return 6;
}

function weekdayDate(weekStart: number, index: number) {
  const date = new Date(weekStart);
  date.setDate(date.getDate() + index);
  return date;
}

function weekdayLabel(weekStart: number, index: number) {
  return WEEKDAY_FORMAT.format(weekdayDate(weekStart, index));
}

function longWeekdayLabel(weekStart: number, index: number) {
  return LONG_WEEKDAY_FORMAT.format(weekdayDate(weekStart, index));
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.xl },
  pageHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: colors.textFaint, fontSize: 10, fontWeight: font.black, letterSpacing: 1.8 },
  title: { color: colors.text, fontSize: 31, lineHeight: 36, fontWeight: font.black, letterSpacing: -0.8, marginTop: 1 },
  headerMark: { width: 38, height: 38, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  headerMarkInner: { width: 9, height: 9, borderRadius: radius.pill, backgroundColor: colors.lime, shadowColor: colors.lime, shadowOpacity: 0.6, shadowRadius: 8 },
  levelHero: { minHeight: 230, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1, borderColor: 'rgba(139,92,255,0.28)' },
  orbit: { width: 154, height: 154, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  orbitInner: { width: 108, height: 108, borderRadius: 54, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,6,12,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  levelNumeral: { maxWidth: 86, color: colors.text, fontSize: 55, lineHeight: 59, fontWeight: font.black, letterSpacing: -2.5 },
  levelLabel: { color: colors.textFaint, fontSize: 9, fontWeight: font.black, letterSpacing: 2, marginTop: -2 },
  orbitSegmentAnchor: { position: 'absolute', width: 5, height: 154, alignItems: 'center' },
  orbitSegment: { width: 4, height: 15, borderRadius: 3 },
  orbitSegmentFilled: { backgroundColor: colors.lime },
  orbitSegmentEmpty: { backgroundColor: 'rgba(255,255,255,0.13)' },
  heroCopy: { flex: 1, minWidth: 0, marginLeft: spacing.md },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tierDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.lime },
  tierName: { color: colors.lime, fontSize: 10, fontWeight: font.black, letterSpacing: 1.3 },
  heroTitle: { color: colors.text, fontSize: 22, lineHeight: 27, fontWeight: font.black, letterSpacing: -0.4, marginTop: 6 },
  heroRemaining: { color: colors.textDim, fontSize: 12, lineHeight: 17, fontWeight: font.medium, marginTop: 5 },
  heroRemainingStrong: { color: colors.text, fontWeight: font.bold },
  segmentRail: { flexDirection: 'row', gap: 3, marginTop: spacing.lg },
  railSegment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.11)' },
  railSegmentFilled: { backgroundColor: colors.lime },
  heroXp: { color: colors.textFaint, fontSize: 10, fontWeight: font.semibold, marginTop: 7 },
  section: { gap: spacing.md },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: font.black, letterSpacing: -0.35 },
  sectionCaption: { color: colors.textFaint, fontSize: 11, fontWeight: font.semibold, textAlign: 'right' },
  weekCard: { padding: spacing.lg, overflow: 'hidden', borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  weekSummary: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  weekTotal: { flex: 1, minWidth: 0 },
  weekKicker: { color: colors.orange, fontSize: 9, fontWeight: font.black, letterSpacing: 1.25 },
  weekCalories: { color: colors.text, fontSize: 31, lineHeight: 38, fontWeight: font.black, letterSpacing: -0.8, marginTop: 2 },
  weekCaloriesUnit: { color: colors.textDim, fontSize: 13, fontWeight: font.bold, letterSpacing: 0 },
  comparison: { alignItems: 'flex-end', maxWidth: '46%' },
  comparisonBadge: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, borderRadius: radius.pill, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.025)' },
  comparisonValue: { fontSize: 13, fontWeight: font.black },
  comparisonLabel: { color: colors.textFaint, fontSize: 9, lineHeight: 12, fontWeight: font.semibold, textAlign: 'right', marginTop: 5 },
  chartA11y: { flexDirection: 'row', minHeight: CHART_HEIGHT + 35, marginTop: spacing.xl },
  scale: { width: 28, height: CHART_HEIGHT + 1, justifyContent: 'space-between', alignItems: 'flex-start' },
  scaleText: { color: colors.textFaint, fontSize: 8, fontWeight: font.semibold },
  plot: { flex: 1, height: CHART_HEIGHT + 35 },
  gridLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.085)' },
  bars: { position: 'absolute', top: 0, left: 0, right: 0, height: CHART_HEIGHT + 35, flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
  barColumn: { flex: 1, minWidth: 0, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  barArea: { width: '100%', height: CHART_HEIGHT, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '58%', minWidth: 9, maxWidth: 24, borderTopLeftRadius: 7, borderTopRightRadius: 7, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  todayValue: { color: colors.orange, fontSize: 8, fontWeight: font.black, marginBottom: 4 },
  dayMarker: { width: 27, height: 27, marginTop: 7, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dayMarkerToday: { borderWidth: 1, borderColor: colors.lime, backgroundColor: 'rgba(198,255,61,0.08)' },
  weekday: { color: colors.textFaint, fontSize: 10, fontWeight: font.bold },
  weekdayToday: { color: colors.text },
  emptyState: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  emptyIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: METRICS.calories.tint },
  emptyCopy: { flex: 1, minWidth: 0 },
  emptyTitle: { color: colors.text, fontSize: 13, fontWeight: font.bold },
  emptyText: { color: colors.textFaint, fontSize: 11, lineHeight: 15, fontWeight: font.medium, marginTop: 2 },
  lifetimeStack: { gap: spacing.sm },
  calorieCard: { minHeight: 122, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: 'rgba(255,138,61,0.18)' },
  metricIcon: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  calorieCopy: { flex: 1, minWidth: 0, marginLeft: spacing.md },
  metricKicker: { color: colors.textFaint, fontSize: 9, fontWeight: font.black, letterSpacing: 1.25 },
  calorieValue: { color: colors.text, fontSize: 29, lineHeight: 36, fontWeight: font.black, letterSpacing: -0.7, marginTop: 2 },
  calorieUnit: { color: colors.orange, fontSize: 12, fontWeight: font.bold, letterSpacing: 0 },
  caloriePulse: { width: 72, height: 47, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 4, marginLeft: spacing.sm },
  pulseBar: { width: 5, borderRadius: 3, backgroundColor: colors.orange },
  metricPair: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  metricPanel: { flex: 1, minWidth: 0, minHeight: 145, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  metricIconSmall: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  metricPanelCopy: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: spacing.lg },
  panelValue: { flexShrink: 1, color: colors.text, fontSize: 25, lineHeight: 30, fontWeight: font.black, letterSpacing: -0.5 },
  panelUnit: { fontSize: 10, fontWeight: font.bold },
  panelLabel: { color: colors.textDim, fontSize: 11, lineHeight: 15, fontWeight: font.semibold, marginTop: 4 },
  runsStrip: { minHeight: 82, flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  runsPrimary: { marginLeft: spacing.md },
  runsValue: { color: colors.text, fontSize: 22, lineHeight: 25, fontWeight: font.black },
  runsLabel: { color: colors.textDim, fontSize: 10, fontWeight: font.semibold, marginTop: 2 },
  runsDivider: { width: 1, height: 38, marginHorizontal: spacing.lg, backgroundColor: colors.borderStrong },
  runsInsight: { flex: 1, minWidth: 0 },
  insightValue: { color: colors.text, fontSize: 15, fontWeight: font.bold },
  insightLabel: { color: colors.textFaint, fontSize: 10, fontWeight: font.semibold, marginTop: 3 },
});

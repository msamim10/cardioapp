import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDuration, formatLongDuration } from '@/lib/calories';
import {
  computeStreak,
  loadProfile,
  loadSessions,
  summarizeSessions,
} from '@/lib/storage';
import { theme } from '@/lib/theme';
import type { FitnessLevel, GoalVibe, Session, UserProfile } from '@/lib/types';
import { BottomTabBar } from '@/components/BottomTabBar';

// ─────────────────────────── helpers ───────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'GM, LET\'S RIDE 🏃';
  if (h >= 20) return 'GN, ONE MORE RUN? 🌙';
  return 'LET\'S RIDE 🏃';
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString();
}

function getTodayMinutes(sessions: Session[]): number {
  const today = new Date().toDateString();
  return sessions
    .filter((s) => new Date(s.startedAt).toDateString() === today)
    .reduce((acc, s) => acc + s.durationSec / 60, 0);
}

function computeLevelFromRuns(count: number): FitnessLevel {
  if (count >= 35) return 'elite';
  if (count >= 15) return 'advanced';
  if (count >= 5) return 'intermediate';
  return 'beginner';
}

function levelDisplayName(level: FitnessLevel): string {
  const map: Record<FitnessLevel, string> = {
    beginner: 'BEGINNER',
    intermediate: 'INTERMEDIATE',
    advanced: 'ADVANCED',
    elite: 'ELITE',
  };
  return map[level];
}

function vibeDisplayName(vibe: GoalVibe): string {
  const map: Record<GoalVibe, string> = {
    sweat: '💦 JUST SWEAT',
    streak: '🔥 BEAT MY STREAK',
    zone: '🎧 ZONE OUT',
    compete: "🏆 LET'S COMPETE",
  };
  return map[vibe];
}

function runsToNextLevel(count: number): { needed: number; next: string } | null {
  if (count < 5) return { needed: 5 - count, next: 'INTERMEDIATE' };
  if (count < 15) return { needed: 15 - count, next: 'ADVANCED' };
  if (count < 35) return { needed: 35 - count, next: 'ELITE' };
  return null;
}

function sessionAccentColor(durationSec: number): string {
  const min = durationSec / 60;
  if (min >= 20) return theme.colors.success;
  if (min >= 10) return '#fde047';
  return '#f97316';
}

// ─────────────────────────── GoalRing ───────────────────────────

function GoalRing({ todayMin, goalMin }: { todayMin: number; goalMin: number }) {
  const size = 80;
  const stroke = 7;
  const pct = goalMin > 0 ? Math.min(1, todayMin / goalMin) : 0;
  const deg = pct * 360;

  const c = theme.colors.primary;
  const t = theme.colors.border;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderTopColor: deg > 0 ? c : t,
          borderRightColor: deg > 90 ? c : t,
          borderBottomColor: deg > 180 ? c : t,
          borderLeftColor: deg > 270 ? c : t,
          transform: [{ rotate: '-90deg' }],
        }}
      />
      <Text style={styles.ringText}>
        {Math.round(todayMin)}{'\n'}/ {goalMin}m
      </Text>
    </View>
  );
}

// ─────────────────────────── Main screen ───────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [profile, setProfile] = useState<UserProfile>({ weightKg: 70 });
  const [loaded, setLoaded] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([loadSessions(), loadProfile()]).then(([s, p]) => {
        if (!cancelled) {
          // Redirect to onboarding if gate was missed
          if (!p.hasSeenOnboarding) {
            router.replace('/onboarding');
            return;
          }
          setSessions(s);
          setProfile(p);
          setLoaded(true);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [router]),
  );

  const stats = summarizeSessions(sessions);
  const recent = sessions.slice(0, 5);
  const todayMin = Math.round(getTodayMinutes(sessions));
  const goalMin = profile.goalMinutes ?? 20;
  const streak = computeStreak(sessions);
  const autoLevel = computeLevelFromRuns(stats.count);
  const displayLevel = profile.level ?? autoLevel;
  const nextLevel = runsToNextLevel(stats.count);

  const chips = [
    { icon: '🏃', value: stats.count.toString(), label: 'Runs' },
    { icon: '⏱', value: formatLongDuration(stats.totalSec), label: 'Total' },
    { icon: '🔥', value: Math.round(stats.totalCalories).toString(), label: 'Cal' },
    { icon: '🪙', value: (profile.totalCoins ?? stats.totalCoins).toString(), label: 'Coins' },
    { icon: '🏆', value: formatDuration(stats.longestSec), label: 'Longest' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>CARDIO SURF</Text>
          <Pressable
            style={styles.settingsBtn}
            onPress={() => router.push('/settings')}
            hitSlop={12}
          >
            <Text style={styles.settingsBtnLabel}>⚙ SETTINGS</Text>
          </Pressable>
        </View>

        {/* ── Hero card ── */}
        <View style={styles.heroCard}>
          <View style={styles.heroBgOverlay} />
          <View style={styles.heroLeft}>
            <Text style={styles.heroGreeting}>{greeting()}</Text>
            {profile.level && (
              <View style={styles.heroBadgeRow}>
                <View style={styles.levelBadge}>
                  <Text style={styles.levelBadgeText}>⚡ {levelDisplayName(displayLevel)}</Text>
                </View>
                {profile.vibe && (
                  <View style={styles.vibeBadge}>
                    <Text style={styles.vibeBadgeText}>{vibeDisplayName(profile.vibe)}</Text>
                  </View>
                )}
              </View>
            )}
            {!profile.level && (
              <View style={styles.heroBadgeRow}>
                <View style={styles.levelBadge}>
                  <Text style={styles.levelBadgeText}>{levelDisplayName(autoLevel)}</Text>
                </View>
              </View>
            )}
          </View>
          <View style={styles.heroRight}>
            <GoalRing todayMin={todayMin} goalMin={goalMin} />
          </View>
        </View>

        {/* ── Start button ── */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <Pressable
            style={({ pressed }) => [styles.startBtn, pressed && styles.startBtnPressed]}
            onPress={() => router.push('/workout')}
          >
            <Text style={styles.startBtnLabel}>LET'S RIDE</Text>
            <Text style={styles.startBtnHint}>Place phone flat → run in place</Text>
          </Pressable>
        </Animated.View>

        {/* ── Stats strip ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsStrip}
          style={styles.statsScroll}
        >
          {chips.map((chip) => (
            <View key={chip.label} style={styles.chip}>
              <Text style={styles.chipIcon}>{chip.icon}</Text>
              <Text style={styles.chipValue}>{chip.value}</Text>
              <Text style={styles.chipLabel}>{chip.label}</Text>
            </View>
          ))}
        </ScrollView>

        {/* ── Level + streak ── */}
        <View style={styles.levelCard}>
          <View style={styles.levelSection}>
            {nextLevel ? (
              <>
                <Text style={styles.levelCardTitle}>
                  {levelDisplayName(displayLevel)} · {nextLevel.needed} runs to {nextLevel.next}
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(100, ((stats.count % (nextLevel.needed + (stats.count % (nextLevel.needed + 1)))) / (nextLevel.needed + (stats.count % (nextLevel.needed + 1)))) * 100)}%` as `${number}%`,
                      },
                    ]}
                  />
                </View>
              </>
            ) : (
              <Text style={styles.levelCardTitle}>⚡ ELITE · MAX LEVEL</Text>
            )}
          </View>
          <View style={styles.streakSection}>
            {streak > 0 ? (
              <Text style={styles.streakText}>🔥 {streak}-day streak</Text>
            ) : (
              <Text style={styles.streakText}>Start a streak today</Text>
            )}
          </View>
        </View>

        {/* ── Recent sessions ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RECENT RUNS</Text>
          {!loaded ? (
            <Text style={styles.emptyText}>Loading…</Text>
          ) : recent.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No runs yet. What are you waiting for? 👀</Text>
            </View>
          ) : (
            recent.map((s) => <SessionCard key={s.id} session={s} />)
          )}
        </View>

        {/* ── Community teaser ── */}
        <Pressable
          style={({ pressed }) => [styles.communityCard, pressed && styles.pressed]}
          onPress={() => router.push('/community')}
        >
          <Text style={styles.communityCardLabel}>🌍 SEE WHAT OTHERS ARE RUNNING →</Text>
          <Text style={styles.communityCardSub}>Leaderboard · Recent runs · Share</Text>
        </Pressable>
      </ScrollView>

      <BottomTabBar />
    </SafeAreaView>
  );
}

function SessionCard({ session }: { session: Session }) {
  const accent = sessionAccentColor(session.durationSec);
  return (
    <View style={styles.sessionCard}>
      <View style={[styles.sessionAccent, { backgroundColor: accent }]} />
      <View style={styles.sessionBody}>
        <Text style={styles.sessionDuration}>
          {formatLongDuration(session.durationSec)}
        </Text>
        <Text style={styles.sessionMeta}>
          🔥 {Math.round(session.estimatedCalories)} cal
          {session.coins ? `  🪙 ${session.coins}` : ''}
        </Text>
      </View>
      <View style={styles.sessionRight}>
        <Text style={styles.sessionTime}>{formatRelative(session.startedAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  eyebrow: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.5,
  },
  settingsBtn: {
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  settingsBtnLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Hero card
  heroCard: {
    height: 180,
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
  },
  heroBgOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: '40%',
    bottom: 0,
    backgroundColor: 'rgba(34,211,238,0.04)',
  },
  heroLeft: {
    flex: 1,
    gap: theme.spacing.sm,
  },
  heroGreeting: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  levelBadge: {
    backgroundColor: 'rgba(34,211,238,0.15)',
    borderRadius: theme.radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
  },
  levelBadgeText: {
    color: theme.colors.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  vibeBadge: {
    backgroundColor: 'rgba(253,224,71,0.12)',
    borderRadius: theme.radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(253,224,71,0.25)',
  },
  vibeBadgeText: {
    color: '#fde047',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heroRight: {
    marginLeft: theme.spacing.md,
  },
  ringText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 15,
  },

  // Start button
  startBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radii.lg,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 14,
    marginBottom: theme.spacing.md,
  },
  startBtnPressed: {
    backgroundColor: theme.colors.primaryDark,
    transform: [{ scale: 0.98 }],
  },
  startBtnLabel: {
    color: '#06222a',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 3,
  },
  startBtnHint: {
    color: 'rgba(6, 34, 42, 0.65)',
    fontSize: 12,
    marginTop: 3,
    fontWeight: '600',
  },

  // Stats strip
  statsScroll: {
    marginBottom: theme.spacing.md,
  },
  statsStrip: {
    gap: theme.spacing.sm,
    paddingVertical: 2,
  },
  chip: {
    width: 90,
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
  },
  chipIcon: {
    fontSize: 18,
    marginBottom: 4,
  },
  chipValue: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  chipLabel: {
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 2,
  },

  // Level + streak
  levelCard: {
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  levelSection: {
    gap: 6,
  },
  levelCardTitle: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  progressTrack: {
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: theme.colors.primary,
    borderRadius: 2,
  },
  streakSection: {},
  streakText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },

  // Sessions
  section: {
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.md,
  },
  emptyCard: {
    backgroundColor: theme.colors.bgCard,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
  },
  emptyTitle: {
    color: theme.colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.sm,
    overflow: 'hidden',
  },
  sessionAccent: {
    width: 4,
    alignSelf: 'stretch',
  },
  sessionBody: {
    flex: 1,
    padding: theme.spacing.md,
  },
  sessionDuration: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 3,
  },
  sessionMeta: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  sessionRight: {
    paddingRight: theme.spacing.md,
  },
  sessionTime: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: '600',
  },

  // Community teaser
  communityCard: {
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    gap: 4,
  },
  communityCardLabel: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  communityCardSub: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  pressed: {
    opacity: 0.8,
  },
});

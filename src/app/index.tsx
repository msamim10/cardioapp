import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  computeStreak,
  loadProfile,
  loadSessions,
  summarizeSessions,
} from '@/lib/storage';
import type { Session, UserProfile } from '@/lib/types';
import { BottomTabBar } from '@/components/BottomTabBar';

// ─────────────────────────── constants ───────────────────────────

const AVATAR_COLORS = ['#7c3aed', '#db2777', '#059669', '#d97706', '#2563eb'];

const DAILY_CHALLENGES = [
  { title: 'Duck 20 obstacles', target: 20 },
  { title: 'Collect 50 coins', target: 50 },
  { title: 'Run 10 minutes', target: 10 },
  { title: 'Jump 15 barriers', target: 15 },
  { title: 'Complete 3 roof runs', target: 3 },
];

const SPARKLINE_HEIGHTS = [3, 7, 4, 9, 3, 6, 8, 4];
const WAVE_HEIGHTS = [3, 6, 2, 8, 3, 7, 4, 5];

type CoinPos = { top: number; left?: number; right?: number };
const COIN_POSITIONS: CoinPos[] = [
  { top: 20, left: 60 },
  { top: 55, right: 45 },
  { top: 100, left: 130 },
  { top: 18, right: 100 },
  { top: 80, left: 30 },
];

// ─────────────────────────── Sparkline ───────────────────────────

function Sparkline({ color }: { color: string }) {
  return (
    <View style={styles.sparkline}>
      {SPARKLINE_HEIGHTS.map((h, i) => (
        <View
          key={i}
          style={{
            width: 3,
            height: h,
            borderRadius: 1,
            backgroundColor: color,
            opacity: 0.5,
          }}
        />
      ))}
    </View>
  );
}

// ─────────────────────────── Main screen ───────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [profile, setProfile] = useState<UserProfile>({ weightKg: 70 });
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([loadSessions(), loadProfile()]).then(([s, p]) => {
        if (!cancelled) {
          if (!p.hasSeenOnboarding) {
            router.replace('/onboarding');
            return;
          }
          setSessions(s);
          setProfile(p);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [router]),
  );

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.03,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [pulseAnim]);

  const stats = summarizeSessions(sessions);
  const streak = computeStreak(sessions);
  const coins = profile.totalCoins ?? 0;
  const displayName = profile.name ?? 'You';
  const avatarLetter = displayName.charAt(0).toUpperCase();
  const avatarBg = AVATAR_COLORS[(profile.name?.[0]?.charCodeAt(0) ?? 77) % 5];

  const todayChallenge = DAILY_CHALLENGES[new Date().getDate() % 5];
  const challengeProgress = Math.min(1, stats.count / todayChallenge.target);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
              <Text style={styles.avatarLetter}>{avatarLetter}</Text>
            </View>
            <View style={styles.headerNameCol}>
              <Text style={styles.headerName}>{displayName}</Text>
              <View style={styles.streakPill}>
                <Text style={styles.streakPillText}>🔥 {streak} DAY STREAK</Text>
              </View>
            </View>
          </View>

          <View style={styles.headerRight}>
            <View style={styles.coinRow}>
              <View style={styles.coinCircle} />
              <Text style={styles.coinCount}>{coins}</Text>
              <View style={styles.coinPlus}>
                <Text style={styles.coinPlusText}>+</Text>
              </View>
            </View>
            <Pressable
              style={styles.settingsBtn}
              onPress={() => router.push('/settings')}
              hitSlop={10}
            >
              <Text style={styles.settingsIcon}>⚙️</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Hero banner + START RUN button ── */}
        <Pressable
          onPress={() => router.push('/workout')}
          style={({ pressed }) => [styles.heroBanner, pressed && { opacity: 0.9 }]}
        >
          {/* Main banner image */}
          <Image
            source={require('../../assets/images/real1.png')}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          {/* Button image overlaid at the bottom */}
          <Animated.Image
            source={require('../../assets/images/real2.png')}
            style={[styles.heroBtn, { transform: [{ scale: pulseAnim }] }]}
            resizeMode="contain"
          />
        </Pressable>

        {/* ── Duration pills ── */}
        <View style={styles.pillRow}>
          {(
            [
              { label: '⚡ 3 min', color: '#22c55e', big: false },
              { label: '⏱ 5 min', color: '#a855f7', big: true },
              { label: '⚡ 10 min', color: '#22c55e', big: false },
            ] as const
          ).map((pill, i) => (
            <Pressable
              key={i}
              style={[
                styles.pill,
                {
                  borderColor: pill.color,
                  paddingVertical: pill.big ? 12 : 10,
                },
              ]}
              onPress={() => router.push('/workout')}
            >
              <Text style={[styles.pillText, { color: pill.color }]}>
                {pill.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── TODAY'S CHALLENGE ── */}
        <View style={styles.challengeCard}>
          <LinearGradient
            colors={['#2d1b69', '#1a0e3d']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
          />
          <View style={styles.challengeInner}>
            {/* Duck illustration */}
            <View style={styles.challengeIllustration}>
              <View style={styles.duckHead} />
              <View style={styles.duckBody} />
              <View style={styles.duckBeak} />
              <View style={styles.duckGlasses} />
            </View>

            {/* Text content */}
            <View style={styles.challengeContent}>
              <Text style={styles.challengeLabel}>👑 TODAY'S CHALLENGE</Text>
              <Text style={styles.challengeTitle}>{todayChallenge.title}</Text>
              <Text style={styles.challengeReward}>Reward: 🪙 +100 coins</Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.round(challengeProgress * 100)}%` as `${number}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>
                {stats.count} / {todayChallenge.target}
              </Text>
            </View>
          </View>

          {/* Crown */}
          <Text style={styles.challengeCrown}>👑</Text>

          {/* Arrow button */}
          <View style={styles.challengeArrowBtn}>
            <Text style={styles.challengeArrowText}>→</Text>
          </View>
        </View>

        {/* ── GAME MODES ── */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>👑 GAME MODES</Text>
          <Text style={styles.viewAll}>View all ›</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.modeScroll}
        >
          {/* Endless Run */}
          <Pressable
            style={[
              styles.modeCard,
              { backgroundColor: '#1a0533', borderColor: '#7c3aed' },
            ]}
            onPress={() => router.push('/workout')}
          >
            <View
              style={[
                styles.modeGlow,
                { backgroundColor: 'rgba(124,58,237,0.3)' },
              ]}
            />
            <Text style={styles.modeEmoji}>🚂</Text>
            <Text style={styles.modeLabel}>Endless Run</Text>
            <View
              style={[styles.modeArrowBadge, { backgroundColor: '#f97316' }]}
            >
              <Text style={styles.modeArrowText}>→</Text>
            </View>
          </Pressable>

          {/* Beginner */}
          <Pressable
            style={[
              styles.modeCard,
              { backgroundColor: '#052e16', borderColor: '#16a34a' },
            ]}
            onPress={() => router.push('/workout')}
          >
            <View
              style={[
                styles.modeGlow,
                { backgroundColor: 'rgba(22,163,74,0.3)' },
              ]}
            />
            <Text style={styles.modeEmoji}>👟</Text>
            <Text style={styles.modeLabel}>Beginner</Text>
            <View
              style={[styles.modeArrowBadge, { backgroundColor: '#16a34a' }]}
            >
              <Text style={styles.modeArrowText}>→</Text>
            </View>
          </Pressable>

          {/* Fat Burn */}
          <Pressable
            style={[
              styles.modeCard,
              { backgroundColor: '#431407', borderColor: '#ea580c' },
            ]}
            onPress={() => router.push('/workout')}
          >
            <View
              style={[
                styles.modeGlow,
                { backgroundColor: 'rgba(234,88,12,0.3)' },
              ]}
            />
            <Text style={styles.modeEmoji}>🔥</Text>
            <Text style={styles.modeLabel}>Fat Burn</Text>
            <View
              style={[styles.modeArrowBadge, { backgroundColor: '#f97316' }]}
            >
              <Text style={styles.modeArrowText}>→</Text>
            </View>
          </Pressable>

          {/* Friends Challenge */}
          <View
            style={[
              styles.modeCard,
              { backgroundColor: '#0f172a', borderColor: '#3b82f6' },
            ]}
          >
            <View
              style={[
                styles.modeGlow,
                { backgroundColor: 'rgba(59,130,246,0.3)' },
              ]}
            />
            <Text style={styles.modeEmoji}>👥</Text>
            <Text style={[styles.modeLabel, { textAlign: 'center' }]}>
              {'Friends\nChallenge'}
            </Text>
            <View style={styles.comingSoonPill}>
              <Text style={styles.comingSoonText}>COMING SOON</Text>
            </View>
          </View>
        </ScrollView>

        {/* ── YOUR STATS ── */}
        <View style={styles.statsHeader}>
          <View style={styles.waveDecor}>
            {WAVE_HEIGHTS.map((h, i) => (
              <View
                key={i}
                style={{
                  width: 4,
                  height: h,
                  backgroundColor: 'rgba(139,92,246,0.5)',
                  borderRadius: 2,
                }}
              />
            ))}
          </View>
          <Text style={styles.sectionLabel}>YOUR STATS</Text>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View
              style={[
                styles.statIconCircle,
                { backgroundColor: 'rgba(249,115,22,0.18)' },
              ]}
            >
              <Text style={styles.statIconEmoji}>🔥</Text>
            </View>
            <Text style={[styles.statNumber, { color: '#f97316' }]}>
              {Math.round(stats.totalCalories)}
            </Text>
            <Text style={styles.statLabel}>cal burned</Text>
            <Sparkline color="#f97316" />
          </View>

          <View style={styles.statCard}>
            <View
              style={[
                styles.statIconCircle,
                { backgroundColor: 'rgba(34,211,238,0.18)' },
              ]}
            >
              <Text style={styles.statIconEmoji}>⏱</Text>
            </View>
            <Text style={[styles.statNumber, { color: '#22d3ee' }]}>
              {Math.round(stats.totalSec / 60)}
            </Text>
            <Text style={styles.statLabel}>min this week</Text>
            <Sparkline color="#22d3ee" />
          </View>

          <View style={styles.statCard}>
            <View
              style={[
                styles.statIconCircle,
                { backgroundColor: 'rgba(34,197,94,0.18)' },
              ]}
            >
              <Text style={styles.statIconEmoji}>🎯</Text>
            </View>
            <Text style={[styles.statNumber, { color: '#22c55e' }]}>
              {stats.count * 4}
            </Text>
            <Text style={styles.statLabel}>dodges</Text>
            <Sparkline color="#22c55e" />
          </View>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      <BottomTabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#070a0e' },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerNameCol: { gap: 4 },
  headerName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  streakPill: {
    backgroundColor: 'rgba(251,146,60,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(251,146,60,0.4)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  streakPillText: {
    color: '#fb923c',
    fontSize: 11,
    fontWeight: '800',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  coinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  coinCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fde047',
  },
  coinCount: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  coinPlus: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinPlusText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1c2330',
    borderWidth: 1,
    borderColor: '#2a3441',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: { fontSize: 18 },

  // ── Hero Banner ──
  heroBanner: {
    aspectRatio: 1586 / 992,
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 14,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  heroBtn: {
    // real2 is 2172×724 — rendered at 88% width, pinned near the bottom
    width: '88%',
    aspectRatio: 2172 / 724,
    marginBottom: 14,
  },
  heroLeft: {
    paddingLeft: 20,
    paddingTop: 28,
    zIndex: 2,
  },
  heroKeep: {
    color: '#39d353',
    fontSize: 40,
    fontWeight: '900',
    transform: [{ rotate: '-4deg' }],
  },
  heroMoving: {
    color: '#fde047',
    fontSize: 40,
    fontWeight: '900',
    transform: [{ rotate: '-4deg' }],
    marginTop: -6,
  },
  heroRight: {
    position: 'absolute',
    right: 18,
    top: 24,
    zIndex: 2,
  },
  heroPinkText: {
    color: '#f472b6',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'right',
  },
  floatingCoin: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fde047',
    borderWidth: 2,
    borderColor: '#f59e0b',
    zIndex: 2,
  },
  heroCharacter: {
    position: 'absolute',
    bottom: 0,
    left: '38%',
    alignItems: 'center',
    zIndex: 3,
  },
  charHead: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fbbf24',
  },
  charBody: {
    width: 30,
    height: 45,
    borderRadius: 6,
    backgroundColor: '#f97316',
  },
  charLegs: {
    flexDirection: 'row',
    gap: 4,
  },
  charLeg: {
    width: 10,
    height: 28,
    borderRadius: 5,
    backgroundColor: '#1c1c2e',
  },
  groundLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(139,92,246,0.35)',
  },
  smileyBadge: {
    position: 'absolute',
    right: 14,
    bottom: 40,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: '#a855f7',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  smileyText: {
    color: '#a855f7',
    fontSize: 11,
    fontWeight: '900',
  },

  // ── START RUN ──
  startBtn: {
    borderRadius: 999,
    height: 68,
    marginBottom: 12,
    shadowColor: '#f97316',
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
    overflow: 'hidden',
  },
  startBtnGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    borderRadius: 999,
  },
  startBtnEmoji: { fontSize: 26 },
  startBtnLabel: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 3,
  },
  startBtnArrow: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },

  // ── Duration pills ──
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  pill: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1.5,
    backgroundColor: '#141a23',
    alignItems: 'center',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },

  // ── TODAY'S CHALLENGE ──
  challengeCard: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    padding: 14,
  },
  challengeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  challengeIllustration: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  duckBody: {
    width: 40,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#6d28d9',
    position: 'absolute',
    bottom: 6,
    alignSelf: 'center',
  },
  duckHead: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#7c3aed',
    position: 'absolute',
    top: 4,
    alignSelf: 'center',
  },
  duckBeak: {
    width: 10,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fde047',
    position: 'absolute',
    top: 22,
    left: 38,
  },
  duckGlasses: {
    width: 20,
    height: 4,
    backgroundColor: '#065f46',
    position: 'absolute',
    top: 18,
    alignSelf: 'center',
  },
  challengeContent: { flex: 1 },
  challengeLabel: {
    color: '#fde047',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  challengeTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 2,
  },
  challengeReward: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginBottom: 6,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  progressLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
  },
  challengeCrown: {
    position: 'absolute',
    top: 12,
    right: 12,
    fontSize: 22,
  },
  challengeArrowBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeArrowText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },

  // ── Section headers ──
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionLabel: {
    color: '#8a96a8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  viewAll: {
    color: '#22d3ee',
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Game mode cards ──
  modeScroll: {
    gap: 10,
    paddingRight: 16,
    marginBottom: 20,
  },
  modeCard: {
    width: 130,
    height: 145,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 12,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  modeGlow: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    top: 10,
    alignSelf: 'center',
  },
  modeEmoji: {
    fontSize: 36,
    zIndex: 1,
  },
  modeLabel: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
    zIndex: 1,
  },
  modeArrowBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  modeArrowText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  comingSoonPill: {
    backgroundColor: 'rgba(34,211,238,0.15)',
    borderWidth: 1,
    borderColor: '#22d3ee',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    zIndex: 1,
  },
  comingSoonText: {
    color: '#22d3ee',
    fontSize: 9,
    fontWeight: '800',
  },

  // ── YOUR STATS ──
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  waveDecor: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1c2330',
    borderRadius: 14,
    padding: 12,
    gap: 2,
    borderWidth: 1,
    borderColor: '#2a3441',
  },
  statIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  statIconEmoji: { fontSize: 14 },
  statNumber: {
    fontSize: 28,
    fontWeight: '900',
  },
  statLabel: {
    color: '#8a96a8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 8,
  },
  sparkline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 12,
  },
});

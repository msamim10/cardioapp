import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useState } from 'react';
import {
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

// ─────────────────────────── helpers ───────────────────────────

const AVATAR_COLORS = ['#7c3aed', '#db2777', '#059669', '#d97706', '#2563eb'];

function avatarColor(name: string): string {
  const char = (name || 'Y').toUpperCase().charCodeAt(0);
  return AVATAR_COLORS[char % AVATAR_COLORS.length];
}

const DAILY_CHALLENGES = [
  { emoji: '🚧', title: 'Duck 20 obstacles', target: 20 },
  { emoji: '🪙', title: 'Collect 50 coins', target: 50 },
  { emoji: '🏃', title: 'Run for 10 minutes', target: 10 },
  { emoji: '⬆️', title: 'Jump 15 barriers', target: 15 },
  { emoji: '🚂', title: 'Complete 3 roof runs', target: 3 },
];

const SPARKLINE_HEIGHTS = [3, 7, 4, 9, 3, 6, 8, 4];

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

  const stats = summarizeSessions(sessions);
  const streak = computeStreak(sessions);
  const coins = profile.totalCoins ?? 0;
  const displayName = profile.name || 'You';
  const avatarLetter = displayName.charAt(0).toUpperCase();
  const avatarBg = avatarColor(displayName);

  const challengeIdx = new Date().getDate() % 5;
  const challenge = DAILY_CHALLENGES[challengeIdx];
  const challengeProgress = Math.min(1, stats.count / challenge.target);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          {/* Avatar + name + streak */}
          <View style={styles.headerLeft}>
            <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
              <Text style={styles.avatarLetter}>{avatarLetter}</Text>
            </View>
            <View style={styles.headerNameCol}>
              <Text style={styles.headerName}>{displayName}</Text>
              <View style={styles.streakPill}>
                <Text style={styles.streakPillText}>
                  🔥 {streak} DAY STREAK
                </Text>
              </View>
            </View>
          </View>

          {/* Coins + settings */}
          <View style={styles.headerRight}>
            <View style={styles.coinRow}>
              <View style={styles.coinIcon}>
                <Text style={styles.coinIconText}>🪙</Text>
              </View>
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


        {/* ── Hero banner (real.png) — tap to start run ── */}
        <Pressable
          onPress={() => router.push('/workout')}
          style={({ pressed }) => [styles.heroBanner, pressed && { opacity: 0.88 }]}
        >
          <Image
            source={require('../../assets/images/real.png')}
            style={styles.heroBannerImage}
            resizeMode="cover"
          />
        </Pressable>

        {/* ── Quick duration pills ── */}
        <View style={styles.pillRow}>
          {[
            { label: '⚡ 3 min', color: '#22c55e', quickMin: 3 },
            { label: '⏱ 5 min', color: '#a855f7', quickMin: 5, big: true },
            { label: '⚡ 10 min', color: '#22c55e', quickMin: 10 },
          ].map((p) => (
            <Pressable
              key={p.quickMin}
              style={[
                styles.pill,
                { borderColor: p.color },
                p.big && styles.pillBig,
              ]}
              onPress={() => router.push('/workout')}
            >
              <Text style={[styles.pillText, { color: p.color }, p.big && styles.pillTextBig]}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── CHALLENGES — swipeable image cards ── */}
        <Text style={styles.challengesHeader}>👑 CHALLENGES</Text>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          contentContainerStyle={styles.challengeScroll}
        >
          {[
            require('../../assets/images/ch1.png'),
            require('../../assets/images/ch2.png'),
            require('../../assets/images/ch3.png'),
            require('../../assets/images/ch4.png'),
          ].map((src, i) => (
            <View key={i} style={styles.challengeImageCard}>
              <Image source={src} style={styles.challengeImage} resizeMode="cover" />
            </View>
          ))}
        </ScrollView>

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
          {[
            { src: require('../../assets/images/c.png'), label: 'Endless Run', tappable: true },
            { src: require('../../assets/images/m.png'), label: 'Beginner', tappable: true },
            { src: require('../../assets/images/n.png'), label: 'Fat Burn', tappable: true },
            { src: require('../../assets/images/x.png'), label: 'Friends', tappable: false },
          ].map((mode, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [styles.modeCard, pressed && { opacity: 0.85 }]}
              onPress={() => mode.tappable && router.push('/workout')}
            >
              <Image source={mode.src} style={styles.modeCardImage} resizeMode="cover" />
            </Pressable>
          ))}
        </ScrollView>

        {/* ── YOUR STATS ── */}
        <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>YOUR STATS</Text>
        <View style={styles.statsRow}>
          {/* Calories */}
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>🔥</Text>
            <Text style={[styles.statNumber, { color: '#f97316' }]}>
              {Math.round(stats.totalCalories)}
            </Text>
            <Text style={styles.statLabel}>cal burned</Text>
            <Sparkline color="#f97316" />
          </View>
          {/* Minutes */}
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>⏱</Text>
            <Text style={[styles.statNumber, { color: '#22d3ee' }]}>
              {Math.round(stats.totalSec / 60)}
            </Text>
            <Text style={styles.statLabel}>min this week</Text>
            <Sparkline color="#22d3ee" />
          </View>
          {/* Dodges */}
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>🎯</Text>
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
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  headerNameCol: {
    gap: 4,
  },
  headerName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  streakPill: {
    backgroundColor: 'rgba(30,20,5,0.85)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  streakPillText: {
    color: '#fde047',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
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
  coinIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1c1a10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinIconText: {
    fontSize: 14,
  },
  coinCount: {
    color: '#fde047',
    fontSize: 15,
    fontWeight: '800',
  },
  coinPlus: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinPlusText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    fontSize: 16,
  },

  // ── Hero banner ──
  heroBanner: {
    aspectRatio: 1672 / 941,
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 16,
  },
  heroBannerImage: {
    width: '100%',
    height: '100%',
  },
  heroLeft: {
    gap: 0,
  },
  heroKeep: {
    color: '#22c55e',
    fontSize: 38,
    fontWeight: '900',
    transform: [{ rotate: '-5deg' }],
  },
  heroMoving: {
    color: '#fde047',
    fontSize: 38,
    fontWeight: '900',
    transform: [{ rotate: '-5deg' }],
  },
  heroRight: {
    alignItems: 'flex-end',
  },
  heroNoLimits: {
    color: '#ec4899',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'right',
  },
  floatingCoin: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fde047',
    opacity: 0.9,
  },
  trackLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  // ── START RUN button ──
  startBtn: {
    borderRadius: 999,
    height: 68,
    marginBottom: 14,
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
  startBtnEmoji: {
    fontSize: 28,
  },
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

  // ── Quick pills ──
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  pill: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1.5,
    backgroundColor: '#111827',
    paddingVertical: 10,
    alignItems: 'center',
  },
  pillBig: {
    paddingVertical: 13,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pillTextBig: {
    fontSize: 14,
  },

  // ── Challenge card ──
  challengesHeader: {
    color: '#8a96a8',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  challengeScroll: {
    gap: 12,
    paddingBottom: 4,
  },
  challengeImageCard: {
    width: 300,
    aspectRatio: 1672 / 941,
    borderRadius: 16,
    overflow: 'hidden',
  },
  challengeImage: {
    width: '100%',
    height: '100%',
  },
  // kept so unused refs don't break tsc
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
    color: '#8a96a8',
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Game modes ──
  modeScroll: {
    gap: 10,
    paddingRight: 16,
    marginBottom: 20,
  },
  modeCard: {
    width: 130,
    aspectRatio: 1122 / 1402,
    borderRadius: 16,
    overflow: 'hidden',
  },
  modeCardImage: {
    width: '100%',
    height: '100%',
  },
  modeLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  modeArrowBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeArrowText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  comingSoonPill: {
    position: 'absolute',
    bottom: 12,
    right: 10,
    backgroundColor: '#22d3ee',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  comingSoonText: {
    color: '#0a0e14',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // ── YOUR STATS ──
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#0e1420',
    borderRadius: 14,
    padding: 12,
    gap: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  statIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    color: '#8a96a8',
    fontSize: 10,
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

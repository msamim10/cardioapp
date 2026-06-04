import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatLongDuration } from '@/lib/calories';
import { loadSessions } from '@/lib/storage';
import { theme } from '@/lib/theme';
import type { FitnessLevel, Session } from '@/lib/types';
import { BottomTabBar } from '@/components/BottomTabBar';

// ─────────────────────────── Mock data ───────────────────────────

type LeaderboardEntry = {
  name: string;
  city: string;
  durationSec: number;
  coins: number;
  level: FitnessLevel;
};

type FeedEntry = {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  timeAgo: string;
  durationSec: number;
  coins: number;
  caption: string;
  isYou?: boolean;
};

const LEADERBOARD: LeaderboardEntry[] = [
  { name: 'Alex', city: 'Toronto', durationSec: 3600, coins: 198, level: 'elite' },
  { name: 'Yuki', city: 'Tokyo', durationSec: 3240, coins: 175, level: 'elite' },
  { name: 'Priya', city: 'Mumbai', durationSec: 2880, coins: 154, level: 'advanced' },
  { name: 'Marcus', city: 'London', durationSec: 2700, coins: 141, level: 'advanced' },
  { name: 'Anya', city: 'Berlin', durationSec: 2400, coins: 128, level: 'advanced' },
  { name: 'Diego', city: 'São Paulo', durationSec: 2100, coins: 113, level: 'intermediate' },
  { name: 'Layla', city: 'Dubai', durationSec: 1800, coins: 97, level: 'intermediate' },
  { name: 'Chris', city: 'Sydney', durationSec: 1500, coins: 81, level: 'intermediate' },
  { name: 'Mei', city: 'Shanghai', durationSec: 1200, coins: 64, level: 'beginner' },
  { name: 'Sam', city: 'NYC', durationSec: 900, coins: 48, level: 'beginner' },
];

const MOCK_FEED: FeedEntry[] = [
  { id: 'f1', name: 'Alex', initials: 'AL', avatarColor: '#22d3ee', timeAgo: '2m ago', durationSec: 3600, coins: 198, caption: 'new PB!! 🔥' },
  { id: 'f2', name: 'Yuki', initials: 'YK', avatarColor: '#ec4899', timeAgo: '14m ago', durationSec: 2400, coins: 128, caption: 'just zoned out for 40 min 🎧' },
  { id: 'f3', name: 'Priya', initials: 'PR', avatarColor: '#a855f7', timeAgo: '31m ago', durationSec: 1800, coins: 97, caption: '30 min before breakfast 💪' },
  { id: 'f4', name: 'Marcus', initials: 'MR', avatarColor: '#f59e0b', timeAgo: '1h ago', durationSec: 2700, coins: 141, caption: 'beating my streak one run at a time 🔥' },
  { id: 'f5', name: 'Anya', initials: 'AN', avatarColor: '#10b981', timeAgo: '2h ago', durationSec: 2100, coins: 113, caption: 'let\'s compete 🏆' },
  { id: 'f6', name: 'Diego', initials: 'DG', avatarColor: '#ef4444', timeAgo: '3h ago', durationSec: 1200, coins: 64, caption: 'quick lunch break run 😤' },
  { id: 'f7', name: 'Layla', initials: 'LA', avatarColor: '#fde047', timeAgo: '4h ago', durationSec: 2880, coins: 154, caption: 'dubai heat got nothing on this app 🌡️' },
  { id: 'f8', name: 'Chris', initials: 'CR', avatarColor: '#06b6d4', timeAgo: '5h ago', durationSec: 1500, coins: 81, caption: 'cardio never skips 💯' },
  { id: 'f9', name: 'Mei', initials: 'ME', avatarColor: '#84cc16', timeAgo: '6h ago', durationSec: 900, coins: 48, caption: 'beginner grind 🏃' },
  { id: 'f10', name: 'Sam', initials: 'SA', avatarColor: '#fb923c', timeAgo: '7h ago', durationSec: 1800, coins: 97, caption: 'actually sweating rn 💦' },
  { id: 'f11', name: 'Alex', initials: 'AL', avatarColor: '#22d3ee', timeAgo: '8h ago', durationSec: 3240, coins: 175, caption: 'morning run ✅' },
  { id: 'f12', name: 'Priya', initials: 'PR', avatarColor: '#a855f7', timeAgo: '10h ago', durationSec: 1440, coins: 77, caption: 'hit my goal today 🎯' },
  { id: 'f13', name: 'Yuki', initials: 'YK', avatarColor: '#ec4899', timeAgo: '12h ago', durationSec: 2700, coins: 141, caption: 'late night zone out session 🌙' },
  { id: 'f14', name: 'Marcus', initials: 'MR', avatarColor: '#f59e0b', timeAgo: '14h ago', durationSec: 1800, coins: 97, caption: 'tried elite mode. survived 😅' },
  { id: 'f15', name: 'Anya', initials: 'AN', avatarColor: '#10b981', timeAgo: '16h ago', durationSec: 1200, coins: 64, caption: 'short but effective 💪' },
];

const LEVEL_LABELS: Record<FitnessLevel, string> = {
  beginner: 'BEGINNER',
  intermediate: 'INTER.',
  advanced: 'ADVANCED',
  elite: '⚡ ELITE',
};

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

// ─────────────────────────── Screen ───────────────────────────

export default function CommunityScreen() {
  const [tab, setTab] = useState<'leaderboard' | 'feed'>('leaderboard');
  const [userSessions, setUserSessions] = useState<Session[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadSessions().then((s) => {
        if (!cancelled) setUserSessions(s);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Merge user sessions into the feed
  const mergedFeed: FeedEntry[] = buildFeed(userSessions);

  const handleShare = async () => {
    const last = userSessions[0];
    const min = last ? Math.round(last.durationSec / 60) : 0;
    const coins = last?.coins ?? 0;
    try {
      await Share.share({
        message: `I just ran ${min} min on Cardio Surf 🏃‍♂️🪙 ${coins} coins collected. Join me!`,
      });
    } catch {
      // Share dismissed
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>COMMUNITY 🌍</Text>
        <Text style={styles.subtitle}>See what people are running worldwide</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['leaderboard', 'feed'] as const).map((t) => (
          <Pressable
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'leaderboard' ? '🏆 LEADERBOARD' : '📰 FEED'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {tab === 'leaderboard' ? (
          <LeaderboardTab />
        ) : (
          <FeedTab entries={mergedFeed} />
        )}
      </ScrollView>

      {/* Share FAB */}
      <Pressable style={styles.fab} onPress={handleShare}>
        <Text style={styles.fabIcon}>📤</Text>
      </Pressable>

      <BottomTabBar />
    </SafeAreaView>
  );
}

// ─────────────────────────── Leaderboard ───────────────────────────

function LeaderboardTab() {
  return (
    <View style={styles.section}>
      {LEADERBOARD.map((entry, i) => (
        <View key={entry.name + entry.city} style={[styles.leaderRow, i === 0 && styles.leaderRowTop]}>
          <View style={[styles.rankBadge, i === 0 && styles.rankBadgeGold]}>
            <Text style={[styles.rankText, i === 0 && styles.rankTextGold]}>
              {i < 3 ? RANK_MEDALS[i] : (i + 1).toString()}
            </Text>
          </View>
          <View style={styles.leaderInfo}>
            <Text style={[styles.leaderName, i === 0 && styles.leaderNameTop]}>
              {entry.name} · {entry.city}
            </Text>
            <View style={styles.leaderMeta}>
              <Text style={styles.leaderMetaText}>
                {formatLongDuration(entry.durationSec)} · 🪙 {entry.coins}
              </Text>
            </View>
          </View>
          <View style={styles.leaderBadge}>
            <Text style={styles.leaderBadgeText}>{LEVEL_LABELS[entry.level]}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─────────────────────────── Feed ───────────────────────────

function FeedTab({ entries }: { entries: FeedEntry[] }) {
  return (
    <View style={styles.section}>
      {entries.map((entry) => (
        <View key={entry.id} style={[styles.feedCard, entry.isYou && styles.feedCardYou]}>
          <View style={[styles.avatar, { backgroundColor: entry.avatarColor }]}>
            <Text style={styles.avatarText}>{entry.initials}</Text>
          </View>
          <View style={styles.feedBody}>
            <View style={styles.feedHeader}>
              <Text style={styles.feedName}>
                {entry.name}
                {entry.isYou ? ' (you)' : ''}
              </Text>
              <Text style={styles.feedTime}>{entry.timeAgo}</Text>
            </View>
            <Text style={styles.feedStats}>
              {formatLongDuration(entry.durationSec)} · 🪙 {entry.coins}
            </Text>
            <Text style={styles.feedCaption}>{entry.caption}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─────────────────────────── Feed builder ───────────────────────────

function buildFeed(userSessions: Session[]): FeedEntry[] {
  const base = [...MOCK_FEED];
  const yourEntries: FeedEntry[] = userSessions.slice(0, 3).map((s, i) => ({
    id: `you-${s.id}`,
    name: 'You',
    initials: 'ME',
    avatarColor: theme.colors.primary,
    timeAgo: formatRelativeShort(s.startedAt),
    durationSec: s.durationSec,
    coins: s.coins ?? 0,
    caption: ['just finished a run 🏃', 'grind never stops 💪', 'cardio surf session ✅'][i % 3],
    isYou: true,
  }));

  // Interleave your sessions into the feed
  const result = [...base];
  yourEntries.forEach((entry, i) => {
    result.splice(i * 3, 0, entry);
  });
  return result;
}

function formatRelativeShort(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ─────────────────────────── Styles ───────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 1,
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 14,
    marginTop: 2,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.bgCard,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderColor: theme.colors.primary,
  },
  tabLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  tabLabelActive: {
    color: theme.colors.primary,
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  section: {
    gap: theme.spacing.sm,
  },

  // Leaderboard
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  leaderRowTop: {
    borderColor: '#fde047',
    backgroundColor: 'rgba(253,224,71,0.05)',
    paddingVertical: 18,
  },
  rankBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rankBadgeGold: {
    borderColor: '#fde047',
    backgroundColor: 'rgba(253,224,71,0.1)',
  },
  rankText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  rankTextGold: {
    color: '#fde047',
  },
  leaderInfo: {
    flex: 1,
    gap: 3,
  },
  leaderName: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  leaderNameTop: {
    fontSize: 16,
    fontWeight: '900',
    color: '#fde047',
  },
  leaderMeta: {
    flexDirection: 'row',
  },
  leaderMetaText: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  leaderBadge: {
    backgroundColor: theme.colors.bgElevated,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  leaderBadgeText: {
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // Feed
  feedCard: {
    flexDirection: 'row',
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    alignItems: 'flex-start',
  },
  feedCardYou: {
    borderColor: 'rgba(34,211,238,0.3)',
    backgroundColor: 'rgba(34,211,238,0.04)',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#0a0e14',
    fontSize: 13,
    fontWeight: '900',
  },
  feedBody: {
    flex: 1,
    gap: 3,
  },
  feedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feedName: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  feedTime: {
    color: theme.colors.textDim,
    fontSize: 11,
  },
  feedStats: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  feedCaption: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 76,
    right: theme.spacing.lg,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fde047',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#fde047',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabIcon: {
    fontSize: 22,
  },
});

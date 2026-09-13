import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localDateKey } from '@shared/scoring/daily';
import { LeaderboardEmpty, LeaderboardRow } from '@/components/LeaderboardRow';
import { ShareScoreSheet, type ShareScoreInput } from '@/components/ShareScoreCard';
import { useAuth } from '@/lib/AuthContext';
import { hasBeatmap } from '@/lib/beatmapRegistry';
import { getDailyChallenge } from '@/lib/dailyRecommendations';
import { getMode, modes } from '@/lib/gameData';
import {
  fetchDailyMyEntry,
  fetchDailyRank,
  fetchDailyTop,
  fetchEntriesForUids,
  fetchMyEntry,
  fetchRank,
  fetchTopEntries,
  rankRows,
  type LeaderboardEntry,
} from '@/lib/leaderboards';
import { fetchFollowing } from '@/lib/profileSync';
import { useProgress } from '@/lib/ProgressContext';
import { colors, font, radius, spacing, type } from '@/theme';

type Tab = 'global' | 'friends' | 'daily';

type BoardState = {
  rows: LeaderboardEntry[];
  me: { entry: LeaderboardEntry; rank: number } | null;
};

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default function LeaderboardScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; board?: string | string[]; date?: string | string[] }>();
  const id = first(params.id) ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { username } = useProgress();
  const mode = getMode(id);
  const uid = user?.id ?? null;
  const scored = hasBeatmap(id);

  // The daily tab exists only when this level is today's challenge (or the
  // caller opened a specific date's board from Home).
  const todayKey = localDateKey(new Date());
  const today = useMemo(() => getDailyChallenge(modes, new Date(), hasBeatmap), []);
  const dateKey = first(params.date) ?? (today?.mode.id === id ? todayKey : null);
  const hasDaily = Boolean(dateKey);
  const [tab, setTab] = useState<Tab>(first(params.board) === 'daily' && hasDaily ? 'daily' : 'global');

  const [state, setState] = useState<Record<Tab, BoardState | null>>({ global: null, friends: null, daily: null });
  const [share, setShare] = useState<ShareScoreInput | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!scored || !id) return undefined;
      let cancelled = false;
      const load = async (): Promise<BoardState> => {
        if (tab === 'daily' && dateKey) {
          const [rows, mine] = await Promise.all([fetchDailyTop(dateKey), uid ? fetchDailyMyEntry(dateKey, uid) : null]);
          const rank = mine ? await fetchDailyRank(dateKey, mine.score) : null;
          return { rows, me: mine && rank ? { entry: mine, rank } : null };
        }
        if (tab === 'friends') {
          const following = uid ? await fetchFollowing(uid) : [];
          const rows = await fetchEntriesForUids(id, uid ? [...following, uid] : following);
          const mine = rows.find((row) => row.uid === uid) ?? null;
          const rank = mine ? rankRows(rows).find((row) => row.uid === uid)?.rank ?? null : null;
          return { rows, me: mine && rank ? { entry: mine, rank } : null };
        }
        const [rows, mine] = await Promise.all([fetchTopEntries(id), uid ? fetchMyEntry(id, uid) : null]);
        const rank = mine ? await fetchRank(id, mine.score) : null;
        return { rows, me: mine && rank ? { entry: mine, rank } : null };
      };
      load().then((next) => {
        if (!cancelled) setState((prev) => ({ ...prev, [tab]: next }));
      });
      return () => {
        cancelled = true;
      };
    }, [dateKey, id, scored, tab, uid])
  );

  const board = state[tab];
  const ranked = rankRows(board?.rows ?? []);
  const meInList = board?.me ? ranked.some((row) => row.uid === board.me?.entry.uid) : false;

  const openShare = () => {
    if (!board?.me || !mode) return;
    setShare({
      runId: board.me.entry.runId,
      levelId: id,
      levelName: mode.name,
      username: username ?? board.me.entry.username,
      rank: board.me.rank,
      score: board.me.entry.score,
      accuracy: board.me.entry.accuracy,
      maxCombo: board.me.entry.maxCombo,
    });
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'global', label: 'Global' },
    { key: 'friends', label: 'Friends' },
    ...(hasDaily ? [{ key: 'daily' as Tab, label: 'Today' }] : []),
  ];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Leaderboard</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {mode?.name ?? 'Level'}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/find-friends' as Href)}
          accessibilityRole="button"
          accessibilityLabel="Find friends"
          hitSlop={10}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="person-add-outline" size={20} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            style={[styles.tab, tab === t.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        {!mode ? (
          <LeaderboardEmpty icon="alert-circle-outline" title="Level not found" />
        ) : !scored ? (
          <LeaderboardEmpty
            icon="musical-notes-outline"
            title="Needs a beatmap"
            detail="This level has no cue map yet. Scores can only be ranked on levels with a published beatmap."
          />
        ) : board === null ? (
          <ActivityIndicator color={colors.lime} style={styles.loading} />
        ) : ranked.length === 0 ? (
          <LeaderboardEmpty
            title={tab === 'friends' ? 'No friends on this board yet' : 'No scores yet — be the first'}
            detail={
              tab === 'friends'
                ? 'Follow runners from their profile to see them here.'
                : tab === 'daily'
                  ? "Finish today's challenge to open the board."
                  : 'Finish this level to post the first score.'
            }
          />
        ) : (
          <View style={styles.list}>
            {ranked.map((row) => (
              <LeaderboardRow
                key={row.uid}
                entry={row}
                rank={row.rank}
                isMe={row.uid === uid}
                onPress={row.uid !== uid ? () => router.push(`/runner/${row.uid}` as Href) : undefined}
              />
            ))}
          </View>
        )}

        {board?.me && !meInList ? (
          <View style={styles.meBlock}>
            <Text style={styles.meLabel}>Your best</Text>
            <LeaderboardRow entry={board.me.entry} rank={board.me.rank} isMe />
          </View>
        ) : null}
      </ScrollView>

      {board?.me ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
          <Pressable
            onPress={openShare}
            accessibilityRole="button"
            accessibilityLabel="Share a beat-my-score card"
            style={({ pressed }) => [styles.shareBtn, pressed && styles.pressed]}
          >
            <Ionicons name="share-outline" size={18} color={colors.black} />
            <Text style={styles.shareBtnText}>BEAT MY SCORE</Text>
          </Pressable>
        </View>
      ) : null}

      <ShareScoreSheet visible={share !== null} input={share} onClose={() => setShare(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  back: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerText: { flex: 1, minWidth: 0 },
  headerEyebrow: { ...type.micro, color: colors.textFaint },
  headerTitle: { ...type.h2, color: colors.text, fontSize: 20 },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.lime, borderColor: colors.lime },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: font.bold },
  tabTextActive: { color: colors.black },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  loading: { paddingVertical: spacing.xxl },
  list: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.xs },
  meBlock: { gap: spacing.xs },
  meLabel: { ...type.label, color: colors.textDim, paddingHorizontal: spacing.xs },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  shareBtn: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.button,
    backgroundColor: colors.lime,
  },
  shareBtnText: { ...type.action, color: colors.black },
  pressed: { opacity: 0.72 },
});

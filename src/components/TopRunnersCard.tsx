import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GHOST_TARGET_TOTAL } from '@shared/scoring/ghosts';
import { LeaderboardRow } from '@/components/LeaderboardRow';
import { useBeatmapCacheVersion } from '@/lib/beatmapRegistry';
import { levelBoardKey, rememberBoard, useBoardCacheVersion, type CachedMe } from '@/lib/boardCache';
import { instantLevelBoard } from '@/lib/instantBoards';
import { fetchMyEntry, fetchRank, fetchTopEntries, rankRows, type LeaderboardEntry } from '@/lib/leaderboards';
import { colors, font, radius, spacing, type } from '@/theme';

export const TOP_RUNNERS_ROWS = 5;

type Board = { rows: LeaderboardEntry[]; me: CachedMe | null };

/**
 * Level brief: the top five of this level's Global board, plus the user's own
 * row (with rank) when they are on the board but outside the top five.
 * Renders instantly from the cached last result merged with the level's
 * deterministic ghost set (see instantBoards.ts) and swaps in the live rows;
 * never a spinner or an empty state. Tapping anywhere opens the full board.
 */
export function TopRunnersCard({
  levelId,
  uid,
  onOpen,
  onMyRank,
}: {
  levelId: string;
  uid: string | null;
  onOpen: () => void;
  /** The user's live Global rank (null when unranked), once known. */
  onMyRank?: (rank: number | null) => void;
}) {
  const [live, setLive] = useState<Board | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const cacheVersion = useBoardCacheVersion();
  const chartVersion = useBeatmapCacheVersion();
  const instant = useMemo(
    () => instantLevelBoard(levelId, TOP_RUNNERS_ROWS),
    // Recompute when hydration or a chart lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheVersion, chartVersion, levelId],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLive(null);
      setRefreshing(true);
      (async () => {
        const [rows, mine] = await Promise.all([
          fetchTopEntries(levelId),
          uid ? fetchMyEntry(levelId, uid) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const rank = mine ? await fetchRank(levelId, mine.score) : null;
        if (cancelled) return;
        onMyRank?.(rank);
        // Seeded boards are never empty: an empty reply is the offline fallback.
        if (rows.length === 0 && GHOST_TARGET_TOTAL > 0) return;
        const me: CachedMe | null = mine && rank ? { entry: mine, rank } : null;
        rememberBoard(levelBoardKey(levelId), rows, me);
        setLive({ rows: rows.slice(0, TOP_RUNNERS_ROWS), me });
      })().finally(() => {
        if (!cancelled) setRefreshing(false);
      });
      return () => {
        cancelled = true;
      };
      // onMyRank is a plain callback; the fetch is keyed by level + user.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [levelId, uid]),
  );

  const board = live ?? instant;
  const ranked = rankRows(board.rows).slice(0, TOP_RUNNERS_ROWS);
  const me = board.me;
  const meInTop = me ? ranked.some((row) => row.uid === me.entry.uid) : false;

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel="Top runners on this level. Opens the leaderboard."
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="podium-outline" size={14} color={colors.lime} />
          <Text style={styles.title}>Top runners</Text>
          {refreshing ? <ActivityIndicator size="small" color={colors.textFaint} style={styles.refresh} /> : null}
        </View>
        <View style={styles.headerRight}>
          {me && me.rank > 0 ? <Text style={styles.myRank}>#{me.rank.toLocaleString()}</Text> : null}
          <Text style={styles.more}>Full board</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </View>
      </View>

      {ranked.length === 0 ? (
        <Text style={styles.empty}>No scores yet. Finish this level to post the first one.</Text>
      ) : (
        <View style={styles.rows}>
          {ranked.map((row) => (
            <LeaderboardRow key={row.uid} entry={row} rank={row.rank} isMe={row.uid === uid} compact />
          ))}
          {me && !meInTop && me.rank > 0 ? (
            <>
              <View style={styles.ellipsis} accessible={false}>
                <Text style={styles.ellipsisText}>···</Text>
              </View>
              <LeaderboardRow entry={me.entry} rank={me.rank} isMe compact />
            </>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...type.label, color: colors.textDim },
  refresh: { transform: [{ scale: 0.7 }] },
  myRank: { color: colors.lime, fontSize: 13, fontWeight: font.heavy },
  more: { color: colors.textFaint, fontSize: 12, fontWeight: font.bold },
  rows: { marginHorizontal: -spacing.xs },
  ellipsis: { alignItems: 'center', paddingVertical: 2 },
  ellipsisText: { color: colors.textFaint, fontSize: 12, letterSpacing: 2 },
  empty: { ...type.bodySm, color: colors.textDim, paddingVertical: spacing.sm },
});

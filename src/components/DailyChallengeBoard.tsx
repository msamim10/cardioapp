import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GHOST_DAILY_TARGET } from '@shared/scoring/ghosts';
import { Card } from '@/components/ui';
import { LeaderboardEmpty, LeaderboardRow } from '@/components/LeaderboardRow';
import { LivePill } from '@/components/LivePill';
import { useBeatmapCacheVersion } from '@/lib/beatmapRegistry';
import { dailyBoardKey, rememberBoard, useBoardCacheVersion } from '@/lib/boardCache';
import { instantDailyBoard } from '@/lib/instantBoards';
import {
  fetchDailyMyEntry,
  fetchDailyRank,
  fetchDailyTop,
  rankRows,
  type LeaderboardEntry,
} from '@/lib/leaderboards';
import { colors, font, metric, spacing, type } from '@/theme';

const PREVIEW_ROWS = 3;

type Board = { rows: LeaderboardEntry[]; me: { entry: LeaderboardEntry; rank: number } | null };

/**
 * Compact live board for today's challenge on Home: top 3 plus your row.
 * Renders instantly from the cached last result merged with the day's
 * deterministic ghost set (see instantBoards.ts), then swaps in the live
 * rows. Refreshes on focus so a run that just finished shows up on return.
 */
export function DailyChallengeBoard({
  dateKey,
  uid,
  onOpen,
}: {
  dateKey: string;
  uid: string | null;
  onOpen: () => void;
}) {
  const [live, setLive] = useState<Board | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const cacheVersion = useBoardCacheVersion();
  const chartVersion = useBeatmapCacheVersion();
  const instant = useMemo(
    () => instantDailyBoard(dateKey, PREVIEW_ROWS),
    // Recompute when hydration or a chart lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheVersion, chartVersion, dateKey],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setRefreshing(true);
      (async () => {
        const [top, mine] = await Promise.all([
          fetchDailyTop(dateKey, PREVIEW_ROWS),
          uid ? fetchDailyMyEntry(dateKey, uid) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        // Seeded boards are never empty: an empty reply is the offline fallback.
        if (top.length === 0 && GHOST_DAILY_TARGET > 0) return;
        let me: Board['me'] = null;
        if (mine) {
          const rank = await fetchDailyRank(dateKey, mine.score);
          if (cancelled) return;
          me = { entry: mine, rank: rank ?? 0 };
        }
        rememberBoard(dailyBoardKey(dateKey), top, me, { partial: true });
        setLive({ rows: top, me });
      })().finally(() => {
        if (!cancelled) setRefreshing(false);
      });
      return () => {
        cancelled = true;
      };
    }, [dateKey, uid])
  );

  const board = live ?? instant;
  const ranked = rankRows(board.rows);
  const me = board.me;
  const meInTop = me ? ranked.some((row) => row.uid === me.entry.uid) : false;

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel="Open today's challenge leaderboard"
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.72 }]}
      >
        <View style={styles.headerLeft}>
          <Ionicons name="trophy" size={14} color={colors.lime} />
          <Text style={styles.title}>Today&apos;s board</Text>
          {refreshing ? <ActivityIndicator size="small" color={colors.textFaint} style={styles.refresh} /> : null}
        </View>
        <View style={styles.headerRight}>
          {me && me.rank > 0 ? <Text style={styles.myRank}>#{me.rank}</Text> : null}
          <LivePill />
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </View>
      </Pressable>

      {ranked.length === 0 ? (
        <LeaderboardEmpty title="No scores yet — be the first" detail="Finish today's challenge to open the board." />
      ) : (
        <View style={styles.rows}>
          {ranked.map((row) => (
            <LeaderboardRow key={row.uid} entry={row} rank={row.rank} isMe={row.uid === uid} compact />
          ))}
          {me && !meInTop ? (
            <>
              <View style={styles.ellipsis}>
                <Text style={styles.ellipsisText}>···</Text>
              </View>
              <LeaderboardRow entry={me.entry} rank={me.rank} isMe compact />
            </>
          ) : null}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...type.label, color: colors.textDim },
  refresh: { transform: [{ scale: 0.7 }] },
  myRank: { ...metric, color: colors.lime, fontSize: 13, fontWeight: font.heavy },
  rows: { marginHorizontal: -spacing.xs },
  ellipsis: { alignItems: 'center', paddingVertical: 2 },
  ellipsisText: { color: colors.textFaint, fontSize: 12, letterSpacing: 2 },
});

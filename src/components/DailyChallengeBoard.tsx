import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui';
import { LeaderboardEmpty, LeaderboardRow } from '@/components/LeaderboardRow';
import { LivePill } from '@/components/LivePill';
import {
  fetchDailyMyEntry,
  fetchDailyRank,
  fetchDailyTop,
  rankRows,
  type LeaderboardEntry,
} from '@/lib/leaderboards';
import { colors, font, metric, spacing, type } from '@/theme';

const PREVIEW_ROWS = 3;

/**
 * Compact live board for today's challenge on Home: top 3 plus your row.
 * Refreshes on focus so a run that just finished shows up when you return.
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
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [me, setMe] = useState<{ entry: LeaderboardEntry; rank: number } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [top, mine] = await Promise.all([
          fetchDailyTop(dateKey, PREVIEW_ROWS),
          uid ? fetchDailyMyEntry(dateKey, uid) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setRows(top);
        if (mine) {
          const rank = await fetchDailyRank(dateKey, mine.score);
          if (!cancelled) setMe({ entry: mine, rank: rank ?? 0 });
        } else {
          setMe(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [dateKey, uid])
  );

  const ranked = rankRows(rows ?? []);
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
          <LivePill />
        </View>
        <View style={styles.headerRight}>
          {me && me.rank > 0 ? <Text style={styles.myRank}>#{me.rank}</Text> : null}
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </View>
      </Pressable>

      {rows === null ? (
        <ActivityIndicator color={colors.lime} style={styles.loading} />
      ) : ranked.length === 0 ? (
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...type.label, color: colors.textDim },
  myRank: { ...metric, color: colors.lime, fontSize: 13, fontWeight: font.heavy },
  loading: { paddingVertical: spacing.lg },
  rows: { marginHorizontal: -spacing.xs },
  ellipsis: { alignItems: 'center', paddingVertical: 2 },
  ellipsisText: { color: colors.textFaint, fontSize: 12, letterSpacing: 2 },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui';
import { LeaderboardEmpty, LeaderboardRow } from '@/components/LeaderboardRow';
import {
  fetchDailyMyEntry,
  fetchDailyRank,
  fetchDailyTop,
  rankRows,
  type LeaderboardEntry,
} from '@/lib/leaderboards';
import { colors, font, metric, radius, spacing, type } from '@/theme';

const PREVIEW_ROWS = 3;

/**
 * Compact 24h board for today's challenge on Home: top 3 plus your row.
 * Refreshes on focus so a run that just finished shows up when you return.
 */
export function DailyChallengeBoard({
  dateKey,
  uid,
  hasBeatmap,
  onOpen,
}: {
  dateKey: string;
  uid: string | null;
  /** Levels without a beatmap cannot score, so there is nothing to rank. */
  hasBeatmap: boolean;
  onOpen: () => void;
}) {
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [me, setMe] = useState<{ entry: LeaderboardEntry; rank: number } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!hasBeatmap) return undefined;
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
    }, [dateKey, hasBeatmap, uid])
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
          <View style={styles.livePill}>
            <Text style={styles.liveText}>24H</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {me && me.rank > 0 ? <Text style={styles.myRank}>#{me.rank}</Text> : null}
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </View>
      </Pressable>

      {!hasBeatmap ? (
        <LeaderboardEmpty
          icon="musical-notes-outline"
          title="Needs a beatmap"
          detail="Today's pick has no cue map yet, so runs can't be scored on a board."
        />
      ) : rows === null ? (
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
  livePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
    backgroundColor: 'rgba(215,255,62,0.12)',
  },
  liveText: { color: colors.lime, fontSize: 9, fontWeight: font.black, letterSpacing: 0.6 },
  myRank: { ...metric, color: colors.lime, fontSize: 13, fontWeight: font.heavy },
  loading: { paddingVertical: spacing.lg },
  rows: { marginHorizontal: -spacing.xs },
  ellipsis: { alignItems: 'center', paddingVertical: 2 },
  ellipsisText: { color: colors.textFaint, fontSize: 12, letterSpacing: 2 },
});

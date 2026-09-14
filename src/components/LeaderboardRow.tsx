import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { displayHandle, type LeaderboardEntry } from '@/lib/leaderboards';
import { colors, font, metric, radius, spacing, type } from '@/theme';

export function formatBoardDate(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatAccuracy(accuracy: number): string {
  return `${Math.round(accuracy * 100)}%`;
}

/** One board row: rank · avatar · handle + meta · score. */
export function LeaderboardRow({
  entry,
  rank,
  isMe = false,
  onPress,
  compact = false,
}: {
  entry: LeaderboardEntry;
  rank: number;
  isMe?: boolean;
  onPress?: () => void;
  compact?: boolean;
}) {
  const handle = displayHandle(entry);
  const accuracy = formatAccuracy(entry.accuracy);
  const meta = compact
    ? [accuracy, `${entry.maxCombo}x`].join(' · ')
    : [`${accuracy} acc`, `${entry.maxCombo}x combo`, formatBoardDate(entry.at)].filter(Boolean).join(' · ');
  const label = `Rank ${rank}, ${isMe ? 'you, ' : ''}${handle}, ${entry.score.toLocaleString()} points, ${meta}${
    entry.recorded ? ', recorded' : ''
  }`;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, isMe && styles.rowMe, pressed && onPress && styles.pressed]}
    >
      <Text style={[styles.rank, isMe && styles.textMe, rank <= 3 && !isMe && styles.rankTop]}>#{rank}</Text>
      <View style={styles.avatar}>
        {entry.photoURL ? (
          <Image source={{ uri: entry.photoURL }} style={styles.avatarImage} contentFit="cover" />
        ) : (
          <Ionicons name="person" size={14} color={isMe ? colors.lime : colors.textFaint} />
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, isMe && styles.textMe]} numberOfLines={1}>
            {handle}
            {isMe ? ' (you)' : ''}
          </Text>
          {entry.recorded ? (
            <Ionicons name="videocam" size={12} color={colors.pace} accessibilityLabel="Recorded run" />
          ) : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Text style={[styles.score, isMe && styles.textMe]}>{entry.score.toLocaleString()}</Text>
    </Pressable>
  );
}

export function LeaderboardEmpty({
  icon = 'trophy-outline',
  title,
  detail,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  detail?: string;
}) {
  return (
    <View style={styles.empty} accessible accessibilityLabel={`${title}${detail ? `. ${detail}` : ''}`}>
      <Ionicons name={icon} size={22} color={colors.textFaint} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  rowMe: {
    borderLeftWidth: 2,
    borderLeftColor: colors.lime,
    backgroundColor: 'rgba(215,255,62,0.08)',
  },
  pressed: { opacity: 0.72 },
  rank: { ...metric, width: 36, color: colors.textDim, fontSize: 13, fontWeight: font.heavy },
  rankTop: { color: colors.text },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  body: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { color: colors.text, fontSize: 13, fontWeight: font.semibold, flexShrink: 1 },
  meta: { ...type.bodySm, color: colors.textFaint, fontSize: 11, lineHeight: 14 },
  score: { ...metric, color: colors.text, fontSize: 15, fontWeight: font.heavy, textAlign: 'right' },
  textMe: { color: colors.lime },
  empty: { alignItems: 'center', gap: 6, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  emptyTitle: { ...type.h3, color: colors.text, textAlign: 'center' },
  emptyDetail: { ...type.bodySm, color: colors.textDim, textAlign: 'center' },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, ProgressBar, SectionHeader } from '@/components/ui';
import { user } from '@/lib/gameData';
import { accentColor, colors, font, radius, spacing } from '@/theme';

const bigStats = [
  { label: 'Day streak', value: `${user.streak}`, icon: 'flame' as const, accent: 'orange' as const },
  { label: 'Runs / week', value: `${user.runsThisWeek}`, icon: 'walk' as const, accent: 'cyan' as const },
  { label: 'Calories', value: `${user.caloriesThisWeek}`, icon: 'heart' as const, accent: 'pink' as const },
];

const badges = [
  { emoji: '🏆', label: 'Jump Master', earned: true },
  { emoji: '⚡', label: 'No-Pause', earned: true },
  { emoji: '🔥', label: '7-Day', earned: false },
  { emoji: '👑', label: 'High Score', earned: false },
  { emoji: '🌍', label: 'Explorer', earned: false },
  { emoji: '💎', label: 'Premium', earned: false },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 120 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user.name[0]}</Text>
        </View>
        <Text style={styles.name}>{user.name}</Text>
        <Text style={styles.handle}>{user.handle}</Text>
      </View>

      {/* Level progress */}
      <Card style={{ gap: spacing.md }}>
        <View style={styles.levelRow}>
          <Text style={styles.levelText}>Level {user.level}</Text>
          <Text style={styles.levelXp}>{user.xp} / {user.xpToNext} XP</Text>
        </View>
        <ProgressBar value={user.xp / user.xpToNext} accent="violet" />
      </Card>

      {/* Big stats */}
      <View style={styles.statsRow}>
        {bigStats.map((s) => (
          <Card key={s.label} style={styles.statCell}>
            <Ionicons name={s.icon} size={22} color={accentColor[s.accent]} />
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </Card>
        ))}
      </View>

      {/* Badges */}
      <View style={styles.section}>
        <SectionHeader title="Badges" action={<Text style={styles.link}>2 / 6</Text>} />
        <View style={styles.badgeGrid}>
          {badges.map((b) => (
            <View key={b.label} style={[styles.badge, !b.earned && styles.badgeLocked]}>
              <Text style={[styles.badgeEmoji, !b.earned && styles.badgeEmojiLocked]}>{b.emoji}</Text>
              <Text style={styles.badgeLabel}>{b.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Settings list */}
      <View style={styles.section}>
        <SectionHeader title="Settings" />
        {['Notifications', 'TV & AirPlay', 'Privacy', 'Help & support'].map((item) => (
          <View key={item} style={styles.settingRow}>
            <Text style={styles.settingText}>{item}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  header: { alignItems: 'center', gap: 4, marginTop: spacing.sm },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { color: colors.white, fontSize: 36, fontWeight: font.black },
  name: { color: colors.text, fontSize: 24, fontWeight: font.black, letterSpacing: -0.4 },
  handle: { color: colors.textDim, fontSize: 14, fontWeight: font.medium },
  levelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  levelText: { color: colors.text, fontSize: 16, fontWeight: font.bold },
  levelXp: { color: colors.textDim, fontSize: 13, fontWeight: font.semibold },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCell: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.lg },
  statValue: { color: colors.text, fontSize: 22, fontWeight: font.black, marginTop: 2 },
  statLabel: { color: colors.textDim, fontSize: 12, fontWeight: font.medium, textAlign: 'center' },
  section: { gap: spacing.sm },
  link: { color: colors.lime, fontSize: 14, fontWeight: font.bold },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: {
    width: '31%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeLocked: { opacity: 0.45 },
  badgeEmoji: { fontSize: 30 },
  badgeEmojiLocked: {},
  badgeLabel: { color: colors.text, fontSize: 12, fontWeight: font.semibold },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingText: { color: colors.text, fontSize: 15, fontWeight: font.semibold },
});

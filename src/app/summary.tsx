import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, GhostButton, GradientButton } from '@/components/ui';
import { accentColor, colors, font, gradients, radius, spacing } from '@/theme';

const stats: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; accent: 'lime' | 'violet' | 'pink' | 'orange' }[] = [
  { icon: 'logo-bitcoin', label: 'Coins earned', value: '+140', accent: 'lime' },
  { icon: 'star', label: 'XP gained', value: '+320', accent: 'violet' },
  { icon: 'flame', label: 'Calories (est.)', value: '72', accent: 'orange' },
  { icon: 'checkmark-done', label: 'Streak', value: '5 days', accent: 'pink' },
];

export default function SummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.badge}>
        <Ionicons name="trophy" size={40} color={colors.black} />
      </View>
      <Text style={styles.eyebrow}>LEVEL COMPLETE</Text>

      {/* Score hero */}
      <LinearGradient colors={gradients.violet} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.scoreCard}>
        <Text style={styles.scoreLabel}>RUN SCORE</Text>
        <Text style={styles.score}>8,420</Text>
        <View style={styles.multiplier}>
          <Ionicons name="flash" size={14} color={colors.black} />
          <Text style={styles.multiplierText}>Hard · 1.5x · No-pause bonus</Text>
        </View>
      </LinearGradient>

      {/* Stat grid */}
      <View style={styles.grid}>
        {stats.map((s) => (
          <Card key={s.label} style={styles.statCell}>
            <Ionicons name={s.icon} size={22} color={accentColor[s.accent]} />
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </Card>
        ))}
      </View>

      {/* Challenge complete */}
      <Card style={styles.challengeDone}>
        <View style={styles.challengeIcon}>
          <Ionicons name="ribbon" size={20} color={colors.lime} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.challengeTitle}>Challenge complete</Text>
          <Text style={styles.challengeSub}>Jump Master · finished without pausing</Text>
        </View>
      </Card>

      {/* Next unlock */}
      <Card style={styles.unlock}>
        <Text style={styles.unlockLabel}>NEXT UNLOCK</Text>
        <View style={styles.unlockRow}>
          <Text style={styles.unlockEmoji}>🏜️</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.unlockName}>Desert Escape</Text>
            <Text style={styles.unlockSub}>2 more runs to unlock</Text>
          </View>
          <Ionicons name="lock-closed" size={18} color={colors.textFaint} />
        </View>
      </Card>

      {/* Actions */}
      <View style={styles.actions}>
        <GradientButton label="PLAY AGAIN" icon="refresh" accent="lime" onPress={() => router.back()} />
        <View style={styles.actionRow}>
          <GhostButton label="Next level" icon="arrow-forward" onPress={() => router.replace('/(tabs)/levels')} style={{ flex: 1 }} />
          <GhostButton label="Share" icon="share-social" onPress={() => {}} style={{ flex: 1 }} />
        </View>
        <GhostButton label="Back to home" icon="home" onPress={() => router.replace('/(tabs)')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg, alignItems: 'stretch' },
  badge: {
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    alignSelf: 'center',
    color: colors.lime,
    fontSize: 14,
    fontWeight: font.black,
    letterSpacing: 2,
  },
  scoreCard: { borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center' },
  scoreLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: font.black, letterSpacing: 2 },
  score: { color: colors.white, fontSize: 56, fontWeight: font.black, letterSpacing: -1, marginTop: 2 },
  multiplier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  multiplierText: { color: colors.black, fontSize: 12, fontWeight: font.bold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statCell: { width: '47.5%', flexGrow: 1, gap: 6 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: font.black, marginTop: 4 },
  statLabel: { color: colors.textDim, fontSize: 13, fontWeight: font.medium },
  challengeDone: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  challengeIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeTitle: { color: colors.text, fontSize: 15, fontWeight: font.bold },
  challengeSub: { color: colors.textDim, fontSize: 13, fontWeight: font.medium, marginTop: 1 },
  unlock: { gap: spacing.md },
  unlockLabel: { color: colors.textDim, fontSize: 12, fontWeight: font.black, letterSpacing: 1.5 },
  unlockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  unlockEmoji: { fontSize: 34 },
  unlockName: { color: colors.text, fontSize: 16, fontWeight: font.bold },
  unlockSub: { color: colors.textDim, fontSize: 13, fontWeight: font.medium, marginTop: 1 },
  actions: { gap: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
});

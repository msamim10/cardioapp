import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, GradientButton, ProgressBar, SectionHeader, StatChip } from '@/components/ui';
import { ModeCard } from '@/components/ModeCard';
import { dailyChallenges, featured, modes, user } from '@/lib/gameData';
import { accentGradient, colors, font, radius, spacing } from '@/theme';

export default function HomeScreen() {
  const router = useRouter();
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
        <View style={{ flex: 1 }}>
          <Text style={styles.hey}>Hey {user.name} 👋</Text>
          <Text style={styles.subhead}>Level {user.level} · let's move</Text>
        </View>
        <StatChip icon="flame" label={`${user.streak}`} accent="orange" />
        <StatChip icon="logo-bitcoin" label={`${user.coins}`} accent="lime" />
      </View>

      {/* XP progress */}
      <Card style={styles.xpCard}>
        <View style={styles.xpTop}>
          <Text style={styles.xpLabel}>XP · Level {user.level}</Text>
          <Text style={styles.xpValue}>
            {user.xp} / {user.xpToNext}
          </Text>
        </View>
        <ProgressBar value={user.xp / user.xpToNext} accent="violet" />
      </Card>

      {/* Featured level */}
      <Pressable
        onPress={() => router.push(`/level/${featured.modeId}`)}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <LinearGradient
          colors={accentGradient[featured.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.featured}
        >
          <Text style={styles.featuredEyebrow}>TODAY'S PICK</Text>
          <Text style={styles.featuredEmoji}>{featured.emoji}</Text>
          <Text style={styles.featuredTitle}>{featured.title}</Text>
          <Text style={styles.featuredSub}>{featured.subtitle}</Text>
          <View style={styles.playPill}>
            <Ionicons name="play" size={18} color={colors.black} />
            <Text style={styles.playText}>Play now</Text>
          </View>
        </LinearGradient>
      </Pressable>

      {/* Daily challenges */}
      <View style={styles.section}>
        <SectionHeader
          title="Daily Challenges"
          action={<Text style={styles.link}>3 today</Text>}
        />
        {dailyChallenges.map((c) => (
          <Card key={c.id} style={styles.challenge}>
            <View style={styles.challengeIcon}>
              <Ionicons
                name={c.done ? 'checkmark-circle' : 'trophy'}
                size={20}
                color={c.done ? colors.lime : colors.pink}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.challengeTitle}>{c.title}</Text>
              <View style={{ marginTop: 8 }}>
                <ProgressBar value={c.progress} accent="pink" />
              </View>
            </View>
            <Text style={styles.reward}>{c.reward}</Text>
          </Card>
        ))}
      </View>

      {/* Worlds */}
      <View style={styles.section}>
        <SectionHeader
          title="Worlds"
          action={
            <Pressable onPress={() => router.push('/levels')}>
              <Text style={styles.link}>See all</Text>
            </Pressable>
          }
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.lg }}
        >
          {modes.map((mode) => (
            <ModeCard key={mode.id} mode={mode} onPress={() => router.push(`/level/${mode.id}`)} />
          ))}
        </ScrollView>
      </View>

      <GradientButton
        label="QUICK RUN"
        icon="flash"
        accent="lime"
        onPress={() => router.push(`/level/${featured.modeId}`)}
        style={{ marginTop: spacing.sm }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.white, fontSize: 20, fontWeight: font.black },
  hey: { color: colors.text, fontSize: 20, fontWeight: font.black, letterSpacing: -0.4 },
  subhead: { color: colors.textDim, fontSize: 13, fontWeight: font.medium, marginTop: 1 },
  xpCard: { gap: spacing.md },
  xpTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  xpLabel: { color: colors.textDim, fontSize: 13, fontWeight: font.semibold },
  xpValue: { color: colors.text, fontSize: 13, fontWeight: font.bold },
  featured: { borderRadius: radius.xl, padding: spacing.xl, overflow: 'hidden' },
  featuredEyebrow: {
    color: 'rgba(0,0,0,0.6)',
    fontSize: 12,
    fontWeight: font.black,
    letterSpacing: 1.5,
  },
  featuredEmoji: { fontSize: 52, marginTop: spacing.sm },
  featuredTitle: { color: colors.black, fontSize: 26, fontWeight: font.black, letterSpacing: -0.5 },
  featuredSub: { color: 'rgba(0,0,0,0.65)', fontSize: 14, fontWeight: font.semibold, marginTop: 2 },
  playPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: spacing.lg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
  },
  playText: { color: colors.black, fontSize: 15, fontWeight: font.black },
  section: { gap: spacing.sm },
  link: { color: colors.lime, fontSize: 14, fontWeight: font.bold },
  challenge: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  challengeIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeTitle: { color: colors.text, fontSize: 14, fontWeight: font.semibold },
  reward: { color: colors.textDim, fontSize: 12, fontWeight: font.bold, maxWidth: 76, textAlign: 'right' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
});

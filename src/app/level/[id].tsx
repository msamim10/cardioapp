import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, SectionHeader } from '@/components/ui';
import { difficulties, getMode, type Difficulty } from '@/lib/gameData';
import { accentColor, accentGradient, colors, font, radius, spacing } from '@/theme';

export default function LevelDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mode = getMode(id);

  const [levelIdx, setLevelIdx] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');

  if (!mode) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.missing}>World not found</Text>
      </View>
    );
  }

  const accent = mode.accent;
  const level = mode.levels[levelIdx];

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm, paddingBottom: 160 }]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>

        {/* Hero */}
        <LinearGradient
          colors={accentGradient[accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Text style={styles.heroEmoji}>{mode.emoji}</Text>
          <Text style={styles.heroName}>{mode.name}</Text>
          <Text style={styles.heroTag}>{mode.tagline}</Text>
        </LinearGradient>

        {/* Levels */}
        <View style={styles.section}>
          <SectionHeader title="Level" />
          {mode.levels.map((lv, i) => {
            const selected = i === levelIdx;
            return (
              <Pressable
                key={lv.id}
                onPress={() => setLevelIdx(i)}
                style={[styles.row, selected && { borderColor: accentColor[accent] }]}
              >
                <Text style={styles.rowEmoji}>{lv.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{lv.name}</Text>
                  <Text style={styles.rowSub}>{lv.durationMin} min run</Text>
                </View>
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={selected ? accentColor[accent] : colors.textFaint}
                />
              </Pressable>
            );
          })}
        </View>

        {/* Difficulty */}
        <View style={styles.section}>
          <SectionHeader title="Difficulty" />
          <View style={styles.diffRow}>
            {difficulties.map((d) => {
              const selected = d.key === difficulty;
              return (
                <Pressable
                  key={d.key}
                  onPress={() => setDifficulty(d.key)}
                  style={[styles.diff, selected && { borderColor: accentColor[accent], backgroundColor: colors.surface2 }]}
                >
                  <Text style={[styles.diffLabel, selected && { color: colors.text }]}>{d.key}</Text>
                  <Text style={[styles.diffMult, selected && { color: accentColor[accent] }]}>{d.multiplier}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.diffNote}>{difficulties.find((d) => d.key === difficulty)?.note}</Text>
        </View>

        {/* Rewards preview */}
        <View style={styles.section}>
          <SectionHeader title="Rewards" />
          <View style={styles.rewardRow}>
            <RewardPill icon="logo-bitcoin" label="Coins" value="up to 140" accent="lime" />
            <RewardPill icon="star" label="XP" value="+320" accent="violet" />
            <RewardPill icon="flame" label="Streak" value="+1 day" accent="orange" />
          </View>
        </View>
      </ScrollView>

      {/* Sticky start */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <GradientButton
          label={`START · ${level.durationMin} MIN`}
          icon="play"
          accent={accent}
          onPress={() =>
            router.push({ pathname: '/workout', params: { level: level.id, name: level.name } })
          }
        />
      </View>
    </View>
  );
}

function RewardPill({
  icon,
  label,
  value,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent: 'lime' | 'violet' | 'orange';
}) {
  return (
    <View style={styles.rewardPill}>
      <Ionicons name={icon} size={20} color={accentColor[accent]} />
      <Text style={styles.rewardValue}>{value}</Text>
      <Text style={styles.rewardLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  missing: { color: colors.textDim, fontSize: 16 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  back: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { borderRadius: radius.xl, padding: spacing.xl, alignItems: 'flex-start' },
  heroEmoji: { fontSize: 60 },
  heroName: { color: colors.black, fontSize: 30, fontWeight: font.black, letterSpacing: -0.6, marginTop: spacing.sm },
  heroTag: { color: 'rgba(0,0,0,0.65)', fontSize: 15, fontWeight: font.semibold, marginTop: 2 },
  section: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  rowEmoji: { fontSize: 28 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: font.bold },
  rowSub: { color: colors.textDim, fontSize: 13, fontWeight: font.medium, marginTop: 1 },
  diffRow: { flexDirection: 'row', gap: spacing.sm },
  diff: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: 4,
  },
  diffLabel: { color: colors.textDim, fontSize: 14, fontWeight: font.bold },
  diffMult: { color: colors.textFaint, fontSize: 13, fontWeight: font.bold },
  diffNote: { color: colors.textDim, fontSize: 13, fontWeight: font.medium, marginTop: 4 },
  rewardRow: { flexDirection: 'row', gap: spacing.sm },
  rewardPill: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rewardValue: { color: colors.text, fontSize: 15, fontWeight: font.black },
  rewardLabel: { color: colors.textDim, fontSize: 12, fontWeight: font.semibold },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

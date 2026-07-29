import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModeClassCard } from '@/components/ModeClassCard';
import { SectionHeader } from '@/components/ui';
import {
  discoveryClassForMode,
  getDailyDiscovery,
} from '@/lib/dailyRecommendations';
import { modes, type Mode } from '@/lib/gameData';
import { getModeCover } from '@/lib/modeCovers';
import { caloriesForRun, CLASS_META, CLASS_ORDER, type ClassKey } from '@/lib/progression';
import { cardSurface, colors, font, radius, spacing } from '@/theme';

export default function LevelsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [discoveryDate, setDiscoveryDate] = useState(() => new Date());
  const dailyDiscovery = useMemo(
    () => getDailyDiscovery(modes, discoveryDate),
    [discoveryDate]
  );
  const featuredClass = discoveryClassForMode(dailyDiscovery.featured.id, modes);

  useFocusEffect(
    useCallback(() => {
      setDiscoveryDate(new Date());
    }, [])
  );

  /** Casual discovery — never thread a campaign classKey. */
  const openLevel = (mode: Mode) => {
    router.push({
      pathname: '/level/[id]',
      params: { id: mode.id },
    });
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <FeaturedMap
        mode={dailyDiscovery.featured}
        classKey={featuredClass}
        onPress={() => openLevel(dailyDiscovery.featured)}
      />

      <View style={styles.modesSection}>
        <SectionHeader title="Modes" />
        <View style={styles.modeRow}>
          {CLASS_ORDER.map((classKey) => (
            <ModeClassCard
              key={classKey}
              classKey={classKey}
              variant="compact"
              tone="surface"
              iconTone="lime"
              layout="centered"
              showMeta={false}
              accessibilityHint={`Opens the ${CLASS_META[classKey].label} campaign`}
              onPress={() =>
                router.push({
                  pathname: '/modes',
                  params: { classKey },
                })
              }
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Recommended for you" />
        <View style={styles.recommendations}>
          {dailyDiscovery.recommendations.map((mode) => {
            const classKey = discoveryClassForMode(mode.id, modes);
            return (
              <RecommendedMap
                key={mode.id}
                mode={mode}
                classKey={classKey}
                onPress={() => openLevel(mode)}
              />
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

function FeaturedMap({
  mode,
  classKey,
  onPress,
}: {
  mode: Mode;
  classKey: ClassKey;
  onPress: () => void;
}) {
  const cover = getModeCover(mode.id);
  const level = mode.levels[0];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Featured map, ${mode.name}, ${level.durationMin} minute run`}
      style={({ pressed }) => [styles.hero, pressed && styles.pressed]}
    >
      {cover ? <Image source={cover} contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
      <LinearGradient
        colors={['rgba(6,6,10,0.04)', 'rgba(6,6,10,0.35)', 'rgba(6,6,10,0.96)']}
        locations={[0.15, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.featuredBadge}>
        <Text style={styles.featuredBadgeText}>FEATURED</Text>
      </View>
      <View style={styles.heroText}>
        <Text style={styles.heroTitle}>{mode.name}</Text>
        <Text style={styles.heroDescriptor}>{mode.tagline}</Text>
        <View style={styles.heroMeta}>
          <Text style={styles.heroMetaText}>{level.durationMin} min</Text>
          <View style={styles.metaDot} />
          <Text style={styles.heroMetaText}>
            {caloriesForRun(level.durationMin, classKey)} kcal
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function RecommendedMap({
  mode,
  classKey,
  onPress,
}: {
  mode: Mode;
  classKey: ClassKey;
  onPress: () => void;
}) {
  const cover = getModeCover(mode.id);
  const level = mode.levels[0];
  const classLabel =
    classKey === 'beginner' ? 'Beginner' : classKey === 'intermediate' ? 'Intermediate' : 'Hard';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${mode.name}, ${level.durationMin} minutes, ${classLabel}`}
      style={({ pressed }) => [styles.recommendationCard, pressed && styles.pressed]}
    >
      <View style={styles.recommendationCover}>
        {cover ? <Image source={cover} contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
      </View>
      <View style={styles.recommendationBody}>
        <Text style={styles.recommendationTitle} numberOfLines={1}>
          {mode.name}
        </Text>
        <View style={styles.recommendationMeta}>
          <MetaItem icon="time-outline" label={`${level.durationMin} min`} />
          <MetaItem
            icon="flame-outline"
            label={`~${caloriesForRun(level.durationMin, classKey)} kcal`}
          />
        </View>
        <View style={styles.difficultyBadge}>
          <Text style={styles.difficultyText}>{classLabel}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={19} color={colors.textFaint} />
    </Pressable>
  );
}

function MetaItem({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={13} color={colors.textDim} />
      <Text style={styles.metaItemText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 0, gap: spacing.lg },
  hero: {
    height: 270,
    borderRadius: radius.xl,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  featuredBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(10,10,15,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  featuredBadgeText: {
    color: colors.lime,
    fontSize: 10,
    fontWeight: font.black,
    letterSpacing: 0.7,
  },
  heroText: { padding: spacing.lg },
  heroTitle: {
    color: colors.white,
    fontSize: 30,
    fontWeight: font.black,
    letterSpacing: -0.6,
  },
  heroDescriptor: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 15,
    fontWeight: font.medium,
    marginTop: 4,
  },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm },
  heroMetaText: { color: colors.white, fontSize: 12, fontWeight: font.bold },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.lime },
  modesSection: { marginTop: spacing.xs },
  modeRow: { flexDirection: 'row', gap: spacing.sm },
  section: { marginTop: spacing.xs },
  recommendations: { gap: spacing.sm },
  recommendationCard: {
    minHeight: 106,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    paddingRight: spacing.md,
    ...cardSurface,
  },
  recommendationCover: {
    width: 120,
    height: 88,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  recommendationBody: { flex: 1, alignItems: 'flex-start' },
  recommendationTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: font.bold,
    letterSpacing: -0.2,
    alignSelf: 'stretch',
  },
  recommendationMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 6,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaItemText: { color: colors.textDim, fontSize: 11, fontWeight: font.medium },
  difficultyBadge: {
    marginTop: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  difficultyText: { color: colors.lime, fontSize: 10, fontWeight: font.bold },
  pressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import { getMode } from '@/lib/gameData';
import { getModeCover } from '@/lib/modeCovers';
import { onboardingProgress } from '@/lib/onboarding';
import { useOnboarding } from '@/lib/OnboardingContext';
import { firstRunVariantCount, recommendFirstRuns } from '@/lib/onboardingPlan';
import { loadPlaySetup, saveFirstRunLevel } from '@/lib/playSetup';
import { colors, font, layout, radius, spacing, type } from '@/theme';

export default function PickFirstRunScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers } = useOnboarding();

  // The lead is fixed; `variant` rotates the two companions through the pool.
  const [variant, setVariant] = useState(0);
  const variantCount = useMemo(() => firstRunVariantCount(answers), [answers]);
  const picks = useMemo(() => recommendFirstRuns(answers, variant), [answers, variant]);
  const [selected, setSelected] = useState<string | null>(null);

  // Restore a persisted choice if it is in the opening trio; otherwise start on
  // the lead. Keyed off the answers rather than `picks` so a shuffle never
  // yanks the selection back.
  useEffect(() => {
    let mounted = true;
    const opening = recommendFirstRuns(answers, 0);
    loadPlaySetup().then((setup) => {
      if (!mounted) return;
      const persisted = setup.firstRunLevelId;
      if (persisted && opening.some((p) => p.levelId === persisted)) {
        setSelected(persisted);
      } else {
        setSelected(opening[0]?.levelId ?? null);
      }
    });
    return () => {
      mounted = false;
    };
  }, [answers]);

  const choose = (levelId: string) => {
    setSelected(levelId);
    void saveFirstRunLevel(levelId);
  };

  const shuffle = () => {
    const next = (variant + 1) % variantCount;
    setVariant(next);
    // If the selected companion just rotated away, fall back to the lead.
    const nextPicks = recommendFirstRuns(answers, next);
    if (selected && !nextPicks.some((p) => p.levelId === selected)) {
      const lead = nextPicks[0]?.levelId ?? null;
      setSelected(lead);
      if (lead) void saveFirstRunLevel(lead);
    }
  };

  const onContinue = () => {
    if (!selected) return;
    void saveFirstRunLevel(selected);
    router.push('/(onboarding)/username');
  };

  return (
    <View style={styles.root}>
      <OnboardingTopBar
        progress={onboardingProgress('pick-first-run')}
        topInset={insets.top}
        onBack={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: layout.scrollAboveFooter }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Recommended for you</Text>
        <Text style={styles.title}>Pick your first run</Text>
        <Text style={styles.sub}>
          Our featured map, plus two matched to your answers. The full catalogue opens after
          your first session.
        </Text>

        <View style={styles.stack}>
          {picks.map((pick, index) => {
            const mode = getMode(pick.levelId);
            if (!mode) return null;
            const cover = getModeCover(mode.id);
            const isSelected = selected === pick.levelId;
            return (
              <Pressable
                key={pick.levelId}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${mode.name}. ${pick.reason}`}
                onPress={() => choose(pick.levelId)}
                style={({ pressed }) => [
                  styles.card,
                  isSelected && styles.cardSelected,
                  pressed && styles.pressed,
                ]}
              >
                {cover ? (
                  <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface2 }]} />
                )}
                <LinearGradient
                  colors={['rgba(8,9,10,0.10)', 'rgba(8,9,10,0.45)', 'rgba(8,9,10,0.92)']}
                  locations={[0, 0.55, 1]}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />

                <View style={styles.cardTop}>
                  <View style={[styles.pill, pick.lead && styles.pillLead]}>
                    <Text style={[styles.pillText, pick.lead && styles.pillTextLead]}>
                      {pick.lead ? 'Top pick' : `Option ${index + 1}`}
                    </Text>
                  </View>
                  <View style={[styles.check, isSelected && styles.checkSelected]}>
                    {isSelected ? <Ionicons name="checkmark" size={15} color={colors.black} /> : null}
                  </View>
                </View>

                <View style={styles.cardBottom}>
                  <Text style={styles.cardName}>{mode.name}</Text>
                  <Text style={styles.cardTagline}>{mode.tagline}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {variantCount > 1 ? (
          <Pressable
            onPress={shuffle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Show two different maps"
            style={({ pressed }) => [styles.shuffleRow, pressed && styles.pressed]}
          >
            <Ionicons name="shuffle" size={16} color={colors.lime} />
            <Text style={styles.shuffleText}>Show me two others</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: layout.footerBottom(insets.bottom) }]}>
        <GradientButton
          label={selected ? 'LOCK IT IN' : 'CONTINUE'}
          accent="lime"
          icon="checkmark"
          onPress={selected ? onContinue : undefined}
          style={!selected ? styles.disabled : undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  eyebrow: { ...type.label, color: colors.lime, marginBottom: 8 },
  title: { ...type.h1, color: colors.text },
  sub: { ...type.body, color: colors.textDim, marginTop: spacing.sm },
  stack: { gap: spacing.md, marginTop: spacing.xl },
  card: {
    height: 164,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  cardSelected: { borderColor: colors.lime },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8,9,10,0.6)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  pillLead: { backgroundColor: colors.lime, borderColor: colors.lime },
  pillText: { ...type.micro, color: colors.text },
  pillTextLead: { color: colors.black },
  check: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(8,9,10,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: { backgroundColor: colors.lime, borderColor: colors.lime },
  cardBottom: { gap: 3 },
  cardName: { ...type.h2, color: colors.white },
  cardTagline: { ...type.bodySm, color: 'rgba(247,248,248,0.82)' },
  shuffleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  shuffleText: { color: colors.lime, fontSize: 14, fontWeight: font.bold },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});

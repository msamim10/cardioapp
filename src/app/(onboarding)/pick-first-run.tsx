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
import { recommendFirstRuns } from '@/lib/onboardingPlan';
import { loadPlaySetup, saveFirstRunLevel } from '@/lib/playSetup';
import { colors, font, metric, radius, spacing, type } from '@/theme';

export default function PickFirstRunScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers } = useOnboarding();

  const picks = useMemo(() => recommendFirstRuns(answers), [answers]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadPlaySetup().then((setup) => {
      if (!mounted) return;
      const persisted = setup.firstRunLevelId;
      if (persisted && picks.some((p) => p.levelId === persisted)) {
        setSelected(persisted);
      } else {
        setSelected(picks[0]?.levelId ?? null);
      }
    });
    return () => {
      mounted = false;
    };
  }, [picks]);

  const choose = (levelId: string) => {
    setSelected(levelId);
    void saveFirstRunLevel(levelId);
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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Recommended for you</Text>
        <Text style={styles.title}>Pick your first run</Text>
        <Text style={styles.sub}>
          Three maps matched to your answers. The full catalogue opens after your first
          session.
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
                  colors={['rgba(8,9,10,0.10)', 'rgba(8,9,10,0.55)', 'rgba(8,9,10,0.94)']}
                  locations={[0, 0.5, 1]}
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
                  <View style={styles.metaRow}>
                    <View style={styles.metaChip}>
                      <Ionicons name="sparkles" size={12} color={colors.lime} />
                      <Text style={styles.metaText}>{pick.reason}</Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
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
    height: 172,
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
  metaRow: { flexDirection: 'row', marginTop: spacing.xs },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(8,9,10,0.62)',
  },
  metaText: { ...metric, color: colors.text, fontSize: 12, fontWeight: font.bold },
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

import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, GradientButton, OnboardingTopBar } from '@/components/ui';
import { useOnboarding } from '@/lib/OnboardingContext';
import { weeklyGoalOptions } from '@/lib/onboarding';
import { accentColor, colors, font, radius, spacing } from '@/theme';

const RECOMMENDED = weeklyGoalOptions.find((o) => o.recommended)?.runs ?? 4;

export default function GoalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers, setAnswer } = useOnboarding();

  // Default to the recommended goal so Continue is always actionable.
  useEffect(() => {
    if (answers.daysPerWeek === null) setAnswer('daysPerWeek', RECOMMENDED);
  }, [answers.daysPerWeek, setAnswer]);

  const selected = answers.daysPerWeek ?? RECOMMENDED;

  return (
    <View style={styles.root}>
      <OnboardingTopBar progress={0.58} topInset={insets.top} onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Set your weekly run goal</Text>
        <Text style={styles.sub}>Pick a target you can actually hit. You can change this anytime.</Text>

        <View style={styles.list}>
          {weeklyGoalOptions.map((o) => {
            const active = selected === o.runs;
            return (
              <Pressable
                key={o.runs}
                onPress={() => setAnswer('daysPerWeek', o.runs)}
                style={({ pressed }) => [
                  styles.row,
                  active && styles.rowActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowLead}>
                  <Ionicons name={o.icon} size={22} color={accentColor[o.accent]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{o.label}</Text>
                  <Text style={styles.rowDesc}>{o.desc}</Text>
                </View>
                {o.recommended ? <Badge label="Recommended" accent="lime" /> : null}
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active ? <Ionicons name="checkmark" size={14} color={colors.black} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <GradientButton
          label="CONTINUE"
          accent="lime"
          onPress={() => router.push('/(onboarding)/notifications')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  title: { color: colors.text, fontSize: 30, fontWeight: font.black, letterSpacing: -0.6, lineHeight: 36 },
  sub: { color: colors.textDim, fontSize: 15, fontWeight: font.medium, marginTop: spacing.sm, lineHeight: 21 },
  list: { gap: spacing.md, marginTop: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  rowActive: { borderColor: colors.lime, backgroundColor: colors.surface2 },
  rowLead: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: font.bold },
  rowDesc: { color: colors.textDim, fontSize: 13, fontWeight: font.medium, marginTop: 2 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { backgroundColor: colors.lime, borderColor: colors.lime },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
});

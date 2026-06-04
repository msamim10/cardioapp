import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEFAULT_WEIGHT_KG } from '@/lib/constants';
import { clearSessions, loadProfile, saveProfile } from '@/lib/storage';
import { theme } from '@/lib/theme';
import type { FitnessLevel, GoalVibe, UserProfile } from '@/lib/types';

type Unit = 'kg' | 'lb';
const KG_TO_LB = 2.20462;
const MIN_KG = 30;
const MAX_KG = 200;

function toUnit(weightKg: number, unit: Unit): number {
  return unit === 'kg' ? weightKg : weightKg * KG_TO_LB;
}
function fromUnit(value: number, unit: Unit): number {
  return unit === 'kg' ? value : value / KG_TO_LB;
}

const LEVEL_OPTIONS: { level: FitnessLevel; emoji: string; label: string; goalMinutes: number }[] = [
  { level: 'beginner', emoji: '🟢', label: 'Beginner', goalMinutes: 10 },
  { level: 'intermediate', emoji: '🟡', label: 'Intermediate', goalMinutes: 20 },
  { level: 'advanced', emoji: '🔴', label: 'Advanced', goalMinutes: 30 },
  { level: 'elite', emoji: '⚡', label: 'Elite', goalMinutes: 45 },
];

const VIBE_OPTIONS: { vibe: GoalVibe; emoji: string; label: string }[] = [
  { vibe: 'sweat', emoji: '💦', label: 'JUST SWEAT' },
  { vibe: 'streak', emoji: '🔥', label: 'BEAT MY STREAK' },
  { vibe: 'zone', emoji: '🎧', label: 'ZONE OUT' },
  { vibe: 'compete', emoji: '🏆', label: "LET'S COMPETE" },
];

export default function SettingsScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile>({ weightKg: DEFAULT_WEIGHT_KG });
  const [unit, setUnit] = useState<Unit>('kg');
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadProfile().then((p) => {
        if (!cancelled) {
          setProfile(p);
          setLoaded(true);
        }
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useEffect(() => {
    if (!loaded) return;
    setSaved(false);
    const id = setTimeout(() => {
      saveProfile(profile).then(() => setSaved(true));
    }, 400);
    return () => clearTimeout(id);
  }, [loaded, profile]);

  const update = useCallback((updates: Partial<UserProfile>) => {
    setProfile((prev) => ({ ...prev, ...updates }));
  }, []);

  const displayWeight = Math.round(toUnit(profile.weightKg, unit));
  const step = 1;

  const adjustWeight = (delta: number) => {
    const nextDisplay = displayWeight + delta * step;
    const nextKg = Math.max(MIN_KG, Math.min(MAX_KG, fromUnit(nextDisplay, unit)));
    update({ weightKg: nextKg });
  };

  const adjustGoal = (delta: number) => {
    const current = profile.goalMinutes ?? 20;
    const next = Math.max(5, Math.min(90, current + delta));
    update({ goalMinutes: next });
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Clear all sessions?',
      'This permanently removes every saved workout from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: () => clearSessions(),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backLabel}>‹ BACK</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.backBtn}>
          {saved && <Text style={styles.savedLabel}>Saved</Text>}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Profile section ── */}
        <Text style={styles.groupLabel}>PROFILE</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Display Name</Text>
          <TextInput
            style={styles.nameInput}
            value={profile.name ?? ''}
            onChangeText={(name) => update({ name })}
            placeholder="Your name (optional)"
            placeholderTextColor={theme.colors.textDim}
            returnKeyType="done"
            maxLength={30}
          />
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Your weight</Text>
            <View style={styles.unitToggle}>
              {(['kg', 'lb'] as const).map((u) => (
                <Pressable
                  key={u}
                  onPress={() => setUnit(u)}
                  style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                >
                  <Text style={[styles.unitLabel, unit === u && styles.unitLabelActive]}>
                    {u.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => adjustWeight(-1)}
              style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
            >
              <Text style={styles.stepGlyph}>−</Text>
            </Pressable>
            <View style={styles.valueWrap}>
              <Text style={styles.valueText}>{displayWeight}</Text>
              <Text style={styles.valueUnit}>{unit}</Text>
            </View>
            <Pressable
              onPress={() => adjustWeight(1)}
              style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
            >
              <Text style={styles.stepGlyph}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.helperText}>Used for calorie estimates. Stored on device.</Text>
        </View>

        {/* ── Run preferences ── */}
        <Text style={styles.groupLabel}>RUN PREFERENCES</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Level</Text>
          <Text style={styles.cardSub}>Tap to change — also updates your session goal.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.levelRow}>
            {LEVEL_OPTIONS.map((opt) => (
              <Pressable
                key={opt.level}
                style={[
                  styles.levelPill,
                  profile.level === opt.level && styles.levelPillActive,
                ]}
                onPress={() => update({ level: opt.level, goalMinutes: opt.goalMinutes })}
              >
                <Text style={styles.levelEmoji}>{opt.emoji}</Text>
                <Text
                  style={[
                    styles.levelLabel,
                    profile.level === opt.level && styles.levelLabelActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Session Goal</Text>
          <Text style={styles.cardSub}>Target duration shown in your home ring.</Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => adjustGoal(-5)}
              style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
            >
              <Text style={styles.stepGlyph}>−</Text>
            </Pressable>
            <View style={styles.valueWrap}>
              <Text style={styles.valueText}>{profile.goalMinutes ?? 20}</Text>
              <Text style={styles.valueUnit}>min</Text>
            </View>
            <Pressable
              onPress={() => adjustGoal(5)}
              style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
            >
              <Text style={styles.stepGlyph}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Vibe</Text>
          <Text style={styles.cardSub}>What are you training for?</Text>
          <View style={styles.vibeGrid}>
            {VIBE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.vibe}
                style={[
                  styles.vibeChip,
                  profile.vibe === opt.vibe && styles.vibeChipActive,
                ]}
                onPress={() => update({ vibe: opt.vibe })}
              >
                <Text style={styles.vibeEmoji}>{opt.emoji}</Text>
                <Text
                  style={[
                    styles.vibeLabel,
                    profile.vibe === opt.vibe && styles.vibeLabelActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Data section ── */}
        <Text style={styles.groupLabel}>DATA</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Privacy</Text>
          <Text style={styles.body}>
            All data stored on device. No accounts, no network.
          </Text>
          <Pressable
            onPress={handleClearHistory}
            style={({ pressed }) => [styles.dangerBtn, pressed && styles.pressed]}
          >
            <Text style={styles.dangerLabel}>Clear all sessions</Text>
          </Pressable>
        </View>

        {/* ── About section ── */}
        <Text style={styles.groupLabel}>ABOUT</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cardio Surf · v1.0</Text>
          <Text style={styles.body}>
            A cardio game built for people who hate treadmills.
          </Text>
          <Pressable
            onPress={() => Linking.openURL('https://github.com/msamim10/cardioapp')}
            style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
          >
            <Text style={styles.linkLabel}>GitHub ↗</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            How calories are estimated: (7.0 × 3.5 × weight_kg) / 200 · cal/min
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  backBtn: { minWidth: 64 },
  backLabel: {
    color: theme.colors.primary,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  savedLabel: {
    color: theme.colors.success,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: 0,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.sm,
  },
  groupLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  card: {
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: theme.colors.text,
    fontWeight: '800',
    fontSize: 16,
  },
  cardSub: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: -theme.spacing.sm,
  },

  // Name input
  nameInput: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '600',
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
  },

  // Weight stepper
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radii.pill,
    padding: 4,
  },
  unitBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radii.pill,
  },
  unitBtnActive: { backgroundColor: theme.colors.primary },
  unitLabel: {
    color: theme.colors.textMuted,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 1.5,
  },
  unitLabelActive: { color: '#06222a' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
  },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  stepGlyph: { color: theme.colors.text, fontSize: 28, fontWeight: '700' },
  valueWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  valueText: {
    color: theme.colors.text,
    fontSize: 52,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  valueUnit: {
    color: theme.colors.textMuted,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
  },
  helperText: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19 },

  // Level pills
  levelRow: { flexGrow: 0 },
  levelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.bgElevated,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.sm,
  },
  levelPillActive: {
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(34,211,238,0.1)',
  },
  levelEmoji: { fontSize: 16 },
  levelLabel: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '700' },
  levelLabelActive: { color: theme.colors.primary },

  // Vibe chips
  vibeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  vibeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.bgElevated,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
  },
  vibeChipActive: {
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(34,211,238,0.1)',
  },
  vibeEmoji: { fontSize: 15 },
  vibeLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  vibeLabelActive: { color: theme.colors.primary },

  // Data section
  body: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  dangerBtn: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  dangerLabel: { color: theme.colors.danger, fontWeight: '800', letterSpacing: 1 },

  // About section
  linkBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34,211,238,0.08)',
    borderRadius: theme.radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.2)',
  },
  linkLabel: {
    color: theme.colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },

  // Footer
  footer: {
    paddingVertical: theme.spacing.lg,
  },
  footerText: {
    textAlign: 'center',
    color: theme.colors.textDim,
    fontSize: 11,
    lineHeight: 16,
  },

  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
});

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEFAULT_WEIGHT_KG } from '@/lib/constants';
import { clearSessions, loadProfile, saveProfile } from '@/lib/storage';
import { theme } from '@/lib/theme';

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

export default function SettingsScreen() {
  const router = useRouter();
  const [weightKg, setWeightKg] = useState<number>(DEFAULT_WEIGHT_KG);
  const [unit, setUnit] = useState<Unit>('kg');
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadProfile().then((p) => {
        if (!cancelled) {
          setWeightKg(p.weightKg);
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
      saveProfile({ weightKg }).then(() => setSaved(true));
    }, 300);
    return () => clearTimeout(id);
  }, [loaded, weightKg]);

  const displayValue = Math.round(toUnit(weightKg, unit));
  const step = unit === 'kg' ? 1 : 1;

  const adjust = (delta: number) => {
    const nextDisplay = displayValue + delta;
    const nextKg = Math.max(MIN_KG, Math.min(MAX_KG, fromUnit(nextDisplay, unit)));
    setWeightKg(nextKg);
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
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
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
                  <Text
                    style={[styles.unitLabel, unit === u && styles.unitLabelActive]}
                  >
                    {u.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.stepper}>
            <Pressable
              onPress={() => adjust(-step)}
              style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
            >
              <Text style={styles.stepGlyph}>−</Text>
            </Pressable>
            <View style={styles.valueWrap}>
              <Text style={styles.valueText}>{displayValue}</Text>
              <Text style={styles.valueUnit}>{unit}</Text>
            </View>
            <Pressable
              onPress={() => adjust(step)}
              style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
            >
              <Text style={styles.stepGlyph}>+</Text>
            </Pressable>
          </View>

          <Text style={styles.helperText}>
            Used to estimate calories burned during your workouts. Saved
            automatically on this device.{' '}
            <Text style={[styles.helperText, saved && styles.helperSaved]}>
              {saved ? 'Saved.' : ''}
            </Text>
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>How calories are estimated</Text>
          <Text style={styles.body}>
            We use the standard MET formula for moderate-intensity cardio:
          </Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText}>
              calories/min = (7.0 × 3.5 × weight_kg) / 200
            </Text>
          </View>
          <Text style={styles.body}>
            It is an estimate, not a measurement. The real number depends on
            your effort, fitness and metabolism.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Data</Text>
          <Text style={styles.body}>
            All workouts are stored only on this device. There are no accounts
            and nothing is sent over the network.
          </Text>
          <Pressable
            onPress={handleClearHistory}
            style={({ pressed }) => [styles.dangerBtn, pressed && styles.pressed]}
          >
            <Text style={styles.dangerLabel}>Clear all sessions</Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>Cardio Surf · v1.0</Text>
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
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  scroll: { padding: theme.spacing.lg, paddingTop: 0, gap: theme.spacing.md },
  card: {
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: {
    color: theme.colors.text,
    fontWeight: '800',
    fontSize: 16,
  },
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
  unitLabel: { color: theme.colors.textMuted, fontWeight: '800', fontSize: 12, letterSpacing: 1.5 },
  unitLabelActive: { color: '#06222a' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.md,
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
    fontSize: 56,
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
  helperSaved: { color: theme.colors.success, fontWeight: '700' },
  body: { color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  codeBlock: {
    backgroundColor: theme.colors.bgElevated,
    padding: theme.spacing.md,
    borderRadius: theme.radii.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  codeText: { color: theme.colors.text, fontFamily: 'Courier', fontSize: 13 },
  dangerBtn: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  dangerLabel: { color: theme.colors.danger, fontWeight: '800', letterSpacing: 1 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  footer: {
    textAlign: 'center',
    color: theme.colors.textDim,
    fontSize: 12,
    marginTop: theme.spacing.lg,
  },
});

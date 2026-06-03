import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDuration, formatLongDuration } from '@/lib/calories';
import { saveSession } from '@/lib/storage';
import { theme } from '@/lib/theme';

export default function SummaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    durationSec?: string;
    calories?: string;
  }>();

  const durationSec = useMemo(() => {
    const n = Number(params.durationSec);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }, [params.durationSec]);

  const calories = useMemo(() => {
    const n = Number(params.calories);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, [params.calories]);

  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'discarded'>(
    'idle',
  );

  const onSave = async () => {
    if (saving !== 'idle') return;
    setSaving('saving');
    try {
      await saveSession({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startedAt: Date.now() - durationSec * 1000,
        durationSec,
        estimatedCalories: calories,
      });
      setSaving('saved');
      router.replace('/');
    } catch {
      setSaving('idle');
    }
  };

  const onDiscard = () => {
    setSaving('discarded');
    router.replace('/');
  };

  const tooShort = durationSec < 5;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.headerBlock}>
          <Text style={styles.eyebrow}>WORKOUT COMPLETE</Text>
          <Text style={styles.title}>Nice run.</Text>
          <Text style={styles.subtitle}>
            {tooShort
              ? "That was a short one - want to save it anyway?"
              : 'Here is what you logged today.'}
          </Text>
        </View>

        <View style={styles.metricsCard}>
          <View style={styles.metricRow}>
            <View style={styles.metricBlock}>
              <Text style={styles.metricLabel}>Duration</Text>
              <Text style={styles.metricValue}>{formatDuration(durationSec)}</Text>
              <Text style={styles.metricMeta}>{formatLongDuration(durationSec)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.metricBlock}>
              <Text style={styles.metricLabel}>Calories</Text>
              <Text style={styles.metricValue}>{Math.round(calories)}</Text>
              <Text style={styles.metricMeta}>estimated</Text>
            </View>
          </View>
        </View>

        <View style={styles.note}>
          <Text style={styles.noteText}>
            Calories are an estimate based on your weight and the average
            intensity of stationary cardio. Set your weight in Settings for
            more accurate numbers.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onDiscard}
            style={({ pressed }) => [styles.discardBtn, pressed && styles.pressed]}
            disabled={saving !== 'idle'}
          >
            <Text style={styles.discardLabel}>DISCARD</Text>
          </Pressable>
          <Pressable
            onPress={onSave}
            style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}
            disabled={saving !== 'idle'}
          >
            <Text style={styles.saveLabel}>
              {saving === 'saving' ? 'SAVING…' : 'SAVE WORKOUT'}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { flex: 1, padding: theme.spacing.lg, justifyContent: 'space-between' },
  headerBlock: { marginTop: theme.spacing.lg },
  eyebrow: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.text,
    fontSize: 36,
    fontWeight: '900',
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  metricsCard: {
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metricBlock: { flex: 1, alignItems: 'center' },
  metricLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.sm,
  },
  metricValue: {
    color: theme.colors.text,
    fontSize: 44,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  metricMeta: {
    color: theme.colors.textDim,
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    width: 1,
    height: 64,
    backgroundColor: theme.colors.border,
  },
  note: {
    padding: theme.spacing.md,
    backgroundColor: 'rgba(34,211,238,0.06)',
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.15)',
  },
  noteText: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.md },
  discardBtn: {
    flex: 1,
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radii.pill,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  discardLabel: { color: theme.colors.textMuted, fontWeight: '800', letterSpacing: 2 },
  saveBtn: {
    flex: 1.5,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radii.pill,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  saveLabel: { color: '#06222a', fontWeight: '900', letterSpacing: 2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});

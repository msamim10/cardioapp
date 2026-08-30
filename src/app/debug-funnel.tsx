import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONVERSION_LADDER, describeConversionValue } from '@/lib/conversionValue';
import {
  CALIBRATION_FAILURE_REASONS,
  getFunnelSnapshot,
  resetFunnel,
  type FunnelSnapshot,
} from '@/lib/funnelStore';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Hidden dev-only funnel inspector (route registered only when __DEV__).
 * Surfaces the on-device acquisition funnel so drop-off is visible without
 * waiting on Singular / ad-network dashboards.
 */

const REASON_LABEL: Record<string, string> = {
  no_person: 'No person in frame',
  insufficient_lighting: 'Insufficient lighting',
  too_close: 'Person too close',
  too_far: 'Person too far',
  unknown: 'Unknown',
};

function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function duration(ms: number | null): string {
  if (ms === null) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}m ${totalSec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export default function DebugFunnelScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<FunnelSnapshot | null>(null);

  const load = useCallback(() => {
    let active = true;
    getFunnelSnapshot().then((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  const onReset = () => {
    Alert.alert('Reset funnel data?', 'Clears all on-device analytics counters.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await resetFunnel();
          load();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <View style={styles.headerRow}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.iconButton}>
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Analytics Funnel</Text>
        <Pressable hitSlop={10} onPress={load} style={styles.iconButton}>
          <Ionicons name="refresh" size={20} color={colors.text} />
        </Pressable>
      </View>
      <Text style={styles.subtitle}>On-device only · dev build</Text>

      {!snapshot ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : (
        <>
          <Section title="Acquisition">
            <Row
              label="Installed"
              value={
                snapshot.installedAt
                  ? new Date(snapshot.installedAt).toLocaleDateString()
                  : '—'
              }
            />
            <Row
              label="Days since install"
              value={snapshot.daysSinceInstall?.toString() ?? '—'}
            />
            <Row label="Onboarding starts" value={String(snapshot.onboarding.started)} />
            <Row
              label="Onboarding complete"
              value={snapshot.onboarding.completed ? 'Yes' : 'No'}
            />
            <Row
              label="Start → calibration success"
              value={pct(snapshot.onboarding.calibrationSuccessRate)}
            />
          </Section>

          <Section title="Calibration (biggest drop-off)">
            <Row label="Attempts" value={String(snapshot.calibration.attempts)} />
            <Row label="Successes" value={String(snapshot.calibration.successes)} />
            <Row label="Failures" value={String(snapshot.calibration.failures)} />
            <Row
              label="Attempts before 1st success"
              value={String(snapshot.calibration.attemptsBeforeFirstSuccess)}
            />
            <View style={styles.divider} />
            <Text style={styles.subhead}>Failure reasons</Text>
            {CALIBRATION_FAILURE_REASONS.map((reason) => (
              <Row
                key={reason}
                label={REASON_LABEL[reason] ?? reason}
                value={String(snapshot.calibration.failureByReason[reason] ?? 0)}
              />
            ))}
          </Section>

          <Section title="Engagement & retention">
            <Row label="Runs completed" value={String(snapshot.runComplete)} />
            <Row label="Time to first run" value={duration(snapshot.timeToFirstRunMs)} />
            <Row label="Day 1 return" value={snapshot.retention.day1 ? 'Yes' : 'No'} />
            <Row label="Day 3 return" value={snapshot.retention.day3 ? 'Yes' : 'No'} />
            <Row label="Day 7 return" value={snapshot.retention.day7 ? 'Yes' : 'No'} />
            <Row label="Active days" value={String(snapshot.retention.activeDays)} />
          </Section>

          <Section title="Monetization">
            <Row label="Paywall views" value={String(snapshot.monetization.paywallViews)} />
            <Row label="Trial starts" value={String(snapshot.monetization.trialStarts)} />
            <Row
              label="Paid conversions"
              value={String(snapshot.monetization.paidConversions)}
            />
            <View style={styles.divider} />
            <Row label="Views → trials" value={pct(snapshot.monetization.viewToTrialRate)} />
            <Row label="Trials → paid" value={pct(snapshot.monetization.trialToPaidRate)} />
          </Section>

          <Section title="SKAdNetwork conversion value">
            <Row
              label="Committed max (0–63)"
              value={`${snapshot.conversionValue.committedMax} · ${describeConversionValue(
                snapshot.conversionValue.committedMax,
              )}`}
            />
            <Row
              label="Last reported by Singular"
              value={snapshot.conversionValue.lastReported?.toString() ?? '—'}
            />
            <View style={styles.divider} />
            <Text style={styles.subhead}>Ladder (monotonic — never decreases)</Text>
            {CONVERSION_LADDER.map((rung) => (
              <Row
                key={rung.value}
                label={`${rung.value} · ${rung.label}`}
                value={rung.value <= snapshot.conversionValue.committedMax ? 'Yes' : '—'}
              />
            ))}
          </Section>

          <Pressable onPress={onReset} style={styles.resetButton}>
            <Ionicons name="trash-outline" size={16} color={colors.pink} />
            <Text style={styles.resetText}>Reset funnel data</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: font.black, letterSpacing: -0.3 },
  subtitle: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: font.medium,
    marginTop: -spacing.sm,
  },
  empty: { color: colors.textDim, fontSize: 14, marginTop: spacing.xl },
  section: { gap: spacing.sm },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: font.black,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  rowLabel: { color: colors.textDim, fontSize: 14, fontWeight: font.medium, flex: 1 },
  rowValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: font.bold,
    fontVariant: ['tabular-nums'],
    marginLeft: spacing.md,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  subhead: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: font.bold,
    marginTop: spacing.xs,
    marginBottom: 2,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,71,87,0.12)',
    borderWidth: 1,
    borderColor: colors.pink,
  },
  resetText: { color: colors.pink, fontSize: 14, fontWeight: font.bold },
});

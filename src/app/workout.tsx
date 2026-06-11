import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EndlessRoadScene } from '@/components/gameplay/EndlessRoadScene';
import { theme } from '@/lib/theme';

export default function WorkoutScreen() {
  useKeepAwake();

  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [distance, setDistance] = useState(0);

  const handleReset = useCallback(() => {
    setPaused(false);
    setDistance(0);
    setResetKey((value) => value + 1);
  }, []);

  return (
    <View style={styles.root}>
      <EndlessRoadScene
        paused={paused}
        resetKey={resetKey}
        onDistanceChange={setDistance}
      />

      <SafeAreaView style={styles.hud} pointerEvents="box-none" edges={['top', 'bottom']}>
        <View style={styles.topRow} pointerEvents="box-none">
          <Pressable
            onPress={() => setPaused((value) => !value)}
            style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={paused ? 'Resume run' : 'Pause run'}
          >
            <Text style={styles.roundButtonText}>{paused ? '>' : '||'}</Text>
          </Pressable>

          <View style={styles.metrics}>
            <View style={styles.metricBlock}>
              <Text style={styles.metricLabel}>SCORE</Text>
              <Text style={styles.metricValue}>{(distance * 10).toLocaleString()}</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricBlock}>
              <Text style={styles.metricLabel}>DIST</Text>
              <Text style={styles.metricValue}>{distance}m</Text>
            </View>
          </View>
        </View>

        {paused && (
          <View style={styles.pausePanel} pointerEvents="auto">
            <Text style={styles.pauseTitle}>RUN PAUSED</Text>
            <View style={styles.pauseActions}>
              <Pressable
                onPress={() => setPaused(false)}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Resume run"
              >
                <Text style={styles.primaryButtonText}>RESUME</Text>
              </Pressable>
              <Pressable
                onPress={handleReset}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Reset run"
              >
                <Text style={styles.secondaryButtonText}>RESET</Text>
              </Pressable>
              <Pressable
                onPress={() => router.replace('/')}
                style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="End run"
              >
                <Text style={styles.dangerButtonText}>END</Text>
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  hud: {
    ...StyleSheet.absoluteFillObject,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.xs,
  },
  roundButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,14,20,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  roundButtonText: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 20,
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10,14,20,0.68)',
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  metricBlock: {
    minWidth: 64,
    alignItems: 'flex-end',
  },
  metricLabel: {
    color: theme.colors.primary,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  metricValue: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  metricDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  pausePanel: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    backgroundColor: 'rgba(10,14,20,0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  pauseTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  pauseActions: {
    width: '100%',
    gap: theme.spacing.sm,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: theme.colors.bg,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.bgElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  dangerButton: {
    alignItems: 'center',
    borderRadius: theme.radii.pill,
    backgroundColor: 'rgba(239,68,68,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.38)',
    paddingVertical: 14,
  },
  dangerButtonText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
});

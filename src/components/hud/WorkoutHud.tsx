import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import type { ActionCue } from '@/lib/types';

type Props = {
  score: number;
  coins: number;
  actionCue: ActionCue;
  paused: boolean;
  onPauseToggle: () => void;
  onEnd: () => void;
};

export function WorkoutHud({
  score,
  coins,
  actionCue,
  paused,
  onPauseToggle,
  onEnd,
}: Props) {
  return (
    <SafeAreaView style={styles.root} pointerEvents="box-none" edges={['top', 'bottom']}>
      <View style={styles.topRow} pointerEvents="box-none">
        <View style={styles.leftControls}>
          <Pressable
            onPress={onPauseToggle}
            style={({ pressed }) => [styles.pauseBtn, pressed && styles.pressed]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={paused ? 'Resume workout' : 'Pause workout'}
          >
            <Text style={styles.pauseIcon}>{paused ? '>' : '||'}</Text>
          </Pressable>
        </View>

        <View style={styles.metrics}>
          <Text style={styles.scoreValue}>{score.toLocaleString()}</Text>
          <View style={styles.coinRow}>
            <View style={styles.coinIcon}>
              <View style={styles.coinInner} />
            </View>
            <Text style={styles.chipValue}>{coins}</Text>
          </View>
        </View>
      </View>

      {actionCue && !paused && (
        <View style={styles.cueWrap} pointerEvents="none">
          <View style={styles.cueBadge}>
            <Text style={styles.cueText}>{CUE_CONTENT[actionCue]}</Text>
          </View>
        </View>
      )}

      {paused && (
        <View style={styles.bottomEndWrap} pointerEvents="box-none">
          <Pressable
            onPress={onEnd}
            style={({ pressed }) => [styles.endBtn, pressed && styles.pressed]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="End workout"
          >
            <Text style={styles.endLabel}>END</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const CUE_CONTENT: Record<Exclude<ActionCue, null>, string> = {
  jump: 'JUMP',
  duck: 'DUCK',
  left: 'LEFT',
  right: 'RIGHT',
  // Two-line so the action (JUMP) and direction read as separate beats
  // at a glance instead of one long word.
  'jump-left': 'JUMP\nLEFT',
  'jump-right': 'JUMP\nRIGHT',
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.xs,
  },
  metrics: {
    backgroundColor: 'rgba(10,14,20,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    minWidth: 78,
    alignItems: 'flex-end',
  },
  leftControls: {
    gap: 8,
    alignItems: 'flex-start',
  },
  bottomEndWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: theme.spacing.lg,
    alignItems: 'center',
  },
  cueWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '23%',
    alignItems: 'center',
  },
  cueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(10,14,20,0.72)',
    borderColor: 'rgba(253,224,71,0.9)',
    borderWidth: 2,
    borderRadius: theme.radii.pill,
    paddingHorizontal: 18,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.26,
    shadowRadius: 8,
    elevation: 5,
  },
  cueText: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1.6,
    textAlign: 'center',
    lineHeight: 24,
  },
  chipLabel: {
    color: theme.colors.primary,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 1,
  },
  scoreValue: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    marginBottom: 5,
  },
  coinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  coinIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fde047',
    borderWidth: 2,
    borderColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinInner: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#facc15',
  },
  chipValue: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  timeLabel: {
    marginTop: 5,
    color: theme.colors.textMuted,
  },
  timeValue: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  pauseBtn: {
    width: 38,
    height: 38,
    backgroundColor: 'rgba(10,14,20,0.62)',
    borderRadius: theme.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 7,
    elevation: 4,
  },
  pauseIcon: {
    color: theme.colors.text,
    fontWeight: '900',
    fontSize: 17,
    lineHeight: 19,
  },
  endBtn: {
    backgroundColor: theme.colors.danger,
    borderRadius: theme.radii.pill,
    paddingHorizontal: 56,
    paddingVertical: 22,
    minWidth: 220,
    alignItems: 'center',
    shadowColor: theme.colors.danger,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.36,
    shadowRadius: 14,
    elevation: 8,
  },
  endLabel: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 22,
    letterSpacing: 3,
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
});

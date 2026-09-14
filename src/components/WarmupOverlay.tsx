import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { BeatmapMove } from '@/lib/beatmaps';
import { colors, font, spacing } from '@/theme';

/**
 * In-run warm-up (first two runs): oversized move prompts so the user learns
 * the four moves inside the run instead of in a separate test drive. The
 * prompt is the next move the run wants (≥ 96 pt + an arrow); a landed move
 * flashes "JUMP ✓" in the accent. Misses are not shown during the window —
 * the judge forgives them (see `CueJudge.forgiveMissesUntilSec`).
 */

export const WARMUP_MOVE_ORDER: readonly BeatmapMove[] = ['jump', 'duck', 'left', 'right'];

export const WARMUP_WORD: Record<BeatmapMove, string> = {
  jump: 'JUMP',
  duck: 'DUCK',
  left: 'LEFT',
  right: 'RIGHT',
};

const WARMUP_ARROW: Record<BeatmapMove, keyof typeof Ionicons.glyphMap> = {
  jump: 'arrow-up',
  duck: 'arrow-down',
  left: 'arrow-back',
  right: 'arrow-forward',
};

/** How long "JUMP ✓" stays up after a landed move. */
export const WARMUP_LANDED_MS = 750;

export type WarmupLanded = { move: BeatmapMove; id: number };

export function WarmupOverlay({
  prompt,
  landed,
  accent,
  intro,
}: {
  /** Move to show now, or null (nothing due yet). */
  prompt: BeatmapMove | null;
  /** Last landed move; a new `id` re-triggers the ✓ flash. */
  landed: WarmupLanded | null;
  accent: string;
  /** Shown while no prompt is due (first seconds of the run). */
  intro?: string;
}) {
  const flash = useRef(new Animated.Value(0)).current;
  const landedId = landed?.id ?? 0;
  useEffect(() => {
    if (!landedId) return;
    flash.setValue(1);
    const anim = Animated.timing(flash, {
      toValue: 0,
      duration: WARMUP_LANDED_MS,
      delay: 120,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [flash, landedId]);

  const showLanded = landed !== null;
  const scale = flash.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] });
  return (
    <View
      pointerEvents="none"
      style={styles.root}
      accessible
      accessibilityLiveRegion="assertive"
      accessibilityLabel={
        landed
          ? `${WARMUP_WORD[landed.move]} landed`
          : prompt
            ? `${WARMUP_WORD[prompt]} now`
            : intro ?? 'Warm-up'
      }
    >
      <View style={styles.eyebrowPill}>
        <Text style={styles.eyebrow}>WARM-UP</Text>
      </View>
      {prompt && !showLanded ? (
        <View style={styles.stack}>
          <Ionicons name={WARMUP_ARROW[prompt]} size={120} color={colors.white} style={styles.arrow} />
          <Text
            style={[styles.word, { color: colors.white }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            maxFontSizeMultiplier={1}
          >
            {WARMUP_WORD[prompt]}
          </Text>
        </View>
      ) : null}
      {showLanded && landed ? (
        <Animated.View style={[styles.stack, { opacity: flash, transform: [{ scale }] }]}>
          <Text
            style={[styles.word, { color: accent }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            maxFontSizeMultiplier={1}
          >
            {WARMUP_WORD[landed.move]} ✓
          </Text>
        </Animated.View>
      ) : null}
      {!prompt && !showLanded && intro ? <Text style={styles.intro}>{intro}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  eyebrowPill: {
    position: 'absolute',
    top: '18%',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  eyebrow: { color: colors.white, fontSize: 12, fontWeight: font.black, letterSpacing: 2 },
  stack: { alignItems: 'center', gap: spacing.sm },
  arrow: {
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 12,
  },
  word: {
    fontSize: 104,
    lineHeight: 110,
    fontWeight: font.heavy,
    letterSpacing: -3,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 14,
  },
  intro: {
    color: colors.white,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: font.heavy,
    letterSpacing: -0.8,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 12,
  },
});

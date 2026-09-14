import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { BodyOutline } from '@/components/BodyOutline';
import { withAlpha } from '@/lib/hudThemes';
import { FRAMING_MESSAGE, FRAMING_WORD, type FramingVerdict } from '@/lib/skeletonFraming';
import { colors, font, spacing } from '@/theme';

/**
 * Far-mode framing UI: the user is across the room, so everything here is
 * legible from three metres — ONE word at ≥ 72 pt, one oversized arrow, and
 * during the hold a ring that fills over three seconds. Shared by the
 * preflight screen and the in-run framing check / re-center overlay.
 *
 * Built from plain Views (no SVG dependency): the ring is a circle of tick
 * marks, the same construction as `PlanRingGauge`.
 */

const RING_TICKS = 40;
const RING_SIZE = 220;
const RING_TICK_LENGTH = 16;
const RING_TICK_WIDTH = 5;

const ARROW: Partial<Record<FramingVerdict, keyof typeof Ionicons.glyphMap>> = {
  back: 'arrow-down',
  closer: 'arrow-up',
  center: 'swap-horizontal',
  searching: 'body-outline',
};

export function FramingCoach({
  verdict,
  holding,
  progress,
  accent,
  outline = true,
  /** Optional line under the big word (e.g. "Legs don't need to be in frame"). */
  hint,
}: {
  verdict: FramingVerdict;
  /** Ring phase: framing is ok and the user is holding still. */
  holding: boolean;
  /** Ring fill 0..1 while holding. */
  progress: number;
  accent: string;
  outline?: boolean;
  hint?: string | null;
}) {
  const word = holding ? FRAMING_WORD.ok : FRAMING_WORD[verdict];
  const arrow = holding ? null : ARROW[verdict];
  const ok = holding || verdict === 'ok';
  const tint = ok ? accent : colors.white;
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityRole="summary"
      accessibilityLabel={
        holding
          ? `Perfect, hold still. ${Math.round(progress * 100)} percent.`
          : `${FRAMING_MESSAGE[verdict]}. Head, shoulders and hips in frame. Legs do not need to be visible.`
      }
    >
      {outline ? <BodyOutline verdict={holding ? 'ok' : verdict} upperBody /> : null}
      <View style={styles.stack}>
        {holding ? (
          <HoldRing progress={progress} accent={accent} />
        ) : arrow ? (
          <Ionicons name={arrow} size={112} color={tint} style={styles.arrow} />
        ) : null}
        <Text
          style={[styles.word, { color: tint }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          maxFontSizeMultiplier={1}
        >
          {word}
        </Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

/** Ring of tick marks that fills clockwise from 12 o'clock. */
export function HoldRing({
  progress,
  accent,
  size = RING_SIZE,
}: {
  progress: number;
  accent: string;
  size?: number;
}) {
  const lit = Math.round(Math.max(0, Math.min(1, progress)) * RING_TICKS);
  const radius = size / 2 - RING_TICK_LENGTH / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: RING_TICKS }, (_, index) => {
        const angle = (index / RING_TICKS) * 360;
        const on = index < lit;
        return (
          <View
            key={index}
            style={[
              styles.tick,
              {
                backgroundColor: on ? accent : withAlpha(colors.white, 0.28),
                transform: [{ rotate: `${angle}deg` }, { translateY: -radius }],
              },
            ]}
          />
        );
      })}
      <Text style={[styles.ringSeconds, { color: accent }]} maxFontSizeMultiplier={1}>
        {Math.max(1, Math.ceil(3 - progress * 3))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  arrow: {
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  word: {
    fontSize: 76,
    lineHeight: 82,
    fontWeight: font.heavy,
    letterSpacing: -2.4,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 12,
  },
  hint: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: font.bold,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  tick: {
    position: 'absolute',
    width: RING_TICK_WIDTH,
    height: RING_TICK_LENGTH,
    borderRadius: RING_TICK_WIDTH / 2,
  },
  ringSeconds: {
    fontSize: 88,
    lineHeight: 94,
    fontWeight: font.heavy,
    letterSpacing: -3,
    fontVariant: ['tabular-nums'],
  },
});

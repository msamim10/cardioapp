import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { MOVE_ORDER, MOVE_WORD } from '@/lib/preflightFlow';
import type { Move } from '@/lib/poseTracking';
import { withAlpha } from '@/lib/hudThemes';
import { colors, font, spacing } from '@/theme';

/**
 * Far-mode move check on the preflight screen: ONE move word at ≥ 96 pt with
 * an oversized arrow, legible from across the room, and a "JUMP ✓" flash in
 * the accent when it passes. Four dots at the bottom show which of the four
 * moves is up. There is no fail state to render — a move always passes.
 */

const MOVE_ARROW: Record<Move, keyof typeof Ionicons.glyphMap> = {
  Jump: 'arrow-up',
  Duck: 'arrow-down',
  Left: 'arrow-back',
  Right: 'arrow-forward',
};

export function MovePromptCoach({
  move,
  index,
  landed,
  accent,
}: {
  move: Move;
  /** Position in MOVE_ORDER, for the progress dots. */
  index: number;
  /** The move passed; show the ✓. */
  landed: boolean;
  accent: string;
}) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }).start();
  }, [landed, move, pop]);
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [landed ? 0.8 : 0.94, 1] });
  const tint = landed ? accent : colors.white;

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessible
      accessibilityLiveRegion="assertive"
      accessibilityRole="summary"
      accessibilityLabel={landed ? `${MOVE_WORD[move]} landed` : `${MOVE_WORD[move]} now. Move ${index + 1} of ${MOVE_ORDER.length}.`}
    >
      <Animated.View style={[styles.stack, { transform: [{ scale }] }]}>
        {landed ? (
          <Ionicons name="checkmark-circle" size={132} color={tint} style={styles.arrow} />
        ) : (
          <Ionicons name={MOVE_ARROW[move]} size={132} color={tint} style={styles.arrow} />
        )}
        <Text
          style={[styles.word, { color: tint }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          maxFontSizeMultiplier={1}
        >
          {landed ? `${MOVE_WORD[move]} ✓` : MOVE_WORD[move]}
        </Text>
      </Animated.View>
      <View style={styles.dots}>
        {MOVE_ORDER.map((entry, position) => (
          <View
            key={entry}
            style={[
              styles.dot,
              {
                backgroundColor:
                  position < index || (position === index && landed)
                    ? accent
                    : position === index
                      ? colors.white
                      : withAlpha(colors.white, 0.3),
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
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
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '22%',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
});

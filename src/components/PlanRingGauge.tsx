import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PlanRing } from '@/lib/onboardingPlan';
import { colors, font, metric, radius, spacing, type } from '@/theme';

/**
 * Radial gauge built from plain Views. `react-native-svg` is not a dependency of
 * this project (not even transitively), so the arc is a ring of tick marks laid
 * out with rotate + translate rather than a stroked path. At this tick count the
 * band reads as continuous, and it matches the segmented signal meter already
 * used on the calibration screen.
 */
const TICKS = 36;
const TICK_WIDTH = 3;
const TICK_LENGTH = 10;

/**
 * Gauges run strictly one after another, so the sweep is far shorter than a
 * lone gauge would want: four of these plus their gaps have to land inside the
 * couple of seconds a user will give a screen that stands between them and the
 * app. `ringSequenceMs` is the single source of truth for when the set ends.
 */
const SWEEP_MS = 420;
const GAP_MS = 110;
const ENTER_MS = 160;

/** Milliseconds from the first gauge starting to the last one finishing. */
export function ringSequenceMs(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return count * SWEEP_MS + (count - 1) * GAP_MS;
}

/** Shared so the gauges and whatever waits on them agree on the setting. */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}

export function PlanRingGauge({
  ring,
  index,
  size = 100,
}: {
  ring: PlanRing;
  index: number;
  size?: number;
}) {
  // Two drivers with identical timing: the native one animates tick opacity off
  // the UI thread, the JS one feeds the counter, which needs a listener. A
  // third fades the whole gauge in, so a cell is empty until its turn comes.
  const sweep = useRef(new Animated.Value(0)).current;
  const counter = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  const [display, setDisplay] = useState(ring.countTo === null ? null : 0);
  const lastDisplayRef = useRef(0);

  useEffect(() => {
    const target = ring.countTo;
    if (reduceMotion) {
      enter.setValue(1);
      sweep.setValue(ring.fraction);
      counter.setValue(1);
      if (target !== null) setDisplay(target);
      return;
    }

    let listener: string | undefined;
    if (target !== null) {
      // Only re-render when the rounded figure actually changes, so a gauge
      // counting to 16 costs seventeen renders rather than one per frame.
      listener = counter.addListener(({ value }) => {
        const next = Math.round(value * target);
        if (next !== lastDisplayRef.current) {
          lastDisplayRef.current = next;
          setDisplay(next);
        }
      });
    }

    const delay = index * (SWEEP_MS + GAP_MS);
    const config = {
      duration: SWEEP_MS,
      delay,
      easing: Easing.out(Easing.cubic),
    };
    const animation = Animated.parallel([
      Animated.timing(enter, {
        toValue: 1,
        duration: ENTER_MS,
        delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(sweep, { ...config, toValue: ring.fraction, useNativeDriver: true }),
      Animated.timing(counter, { ...config, toValue: 1, useNativeDriver: false }),
    ]);
    animation.start();

    return () => {
      animation.stop();
      if (listener) counter.removeListener(listener);
    };
  }, [counter, enter, index, reduceMotion, ring.countTo, ring.fraction, sweep]);

  const bandRadius = size / 2 - TICK_LENGTH / 2;
  const litCount = Math.ceil(ring.fraction * TICKS);
  // Keep the figure inside the tick band; long values like a multiplier then
  // shrink to fit rather than colliding with the ring.
  const innerWidth = size - TICK_LENGTH * 2 - spacing.sm;
  const valueFontSize = Math.round(size * 0.28);
  const centerText =
    ring.countTo === null || display === null ? ring.value : `${display}${ring.suffix}`;

  return (
    <Animated.View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${ring.label}: ${ring.value}, ${ring.denominator}.`}
      style={[styles.wrap, { opacity: enter }]}
    >
      <View style={[styles.gauge, { width: size, height: size }]}>
        {Array.from({ length: TICKS }, (_, tick) => (
          <View
            key={`track-${tick}`}
            style={[styles.tick, tickPosition(tick, size, bandRadius), styles.tickTrack]}
          />
        ))}
        {Array.from({ length: litCount }, (_, tick) => (
          <Animated.View
            key={`lit-${tick}`}
            style={[
              styles.tick,
              tickPosition(tick, size, bandRadius),
              styles.tickLit,
              { opacity: tickOpacity(sweep, tick) },
            ]}
          />
        ))}
        <View style={[styles.center, { width: innerWidth }]}>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            numberOfLines={1}
            style={[styles.value, { fontSize: valueFontSize, lineHeight: valueFontSize + 4 }]}
          >
            {centerText}
          </Text>
        </View>
      </View>
      <Text style={styles.label} numberOfLines={2}>{ring.label}</Text>
      <Text style={styles.denominator} numberOfLines={1}>{ring.denominator}</Text>
    </Animated.View>
  );
}

/**
 * Places a tick with its centre at `bandRadius` from the gauge centre, `tick`
 * steps clockwise from twelve o'clock. Rotating first means the translate runs
 * along the rotated axis, which is what puts the tick on the circle.
 */
function tickPosition(tick: number, size: number, bandRadius: number) {
  return {
    left: size / 2 - TICK_WIDTH / 2,
    top: size / 2 - TICK_LENGTH / 2,
    transform: [
      { rotate: `${(tick * 360) / TICKS}deg` },
      { translateY: -bandRadius },
    ],
  };
}

/** A tick reaches full opacity exactly as the sweep passes its position. */
function tickOpacity(sweep: Animated.Value, tick: number) {
  const start = tick / TICKS;
  return sweep.interpolate({
    inputRange: [start, start + 1 / TICKS],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  gauge: { alignItems: 'center', justifyContent: 'center' },
  tick: {
    position: 'absolute',
    width: TICK_WIDTH,
    height: TICK_LENGTH,
    borderRadius: radius.xs,
  },
  tickTrack: { backgroundColor: 'rgba(255,255,255,0.1)' },
  tickLit: { backgroundColor: colors.lime },
  center: { alignItems: 'center', justifyContent: 'center' },
  value: {
    ...metric,
    color: colors.text,
    fontWeight: font.heavy,
    letterSpacing: -1.2,
    textAlign: 'center',
  },
  label: {
    ...type.micro,
    color: colors.text,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  denominator: {
    ...type.micro,
    color: colors.textFaint,
    fontWeight: font.semibold,
    letterSpacing: 0.4,
    marginTop: 2,
    textAlign: 'center',
  },
});

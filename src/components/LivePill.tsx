import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '@/theme';

const PULSE_MS = 900;

/**
 * Small "LIVE" pill: a pulsing accent dot plus the label. Used wherever a
 * board is live for the current day. The pulse stops (dot stays solid) when
 * the system Reduce Motion setting is on.
 */
export function LivePill({ label = 'LIVE' }: { label?: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      opacity.setValue(1);
    };
  }, [opacity, reduceMotion]);

  return (
    <View style={styles.pill} accessible accessibilityLabel={`${label}, board is live`}>
      <Animated.View style={[styles.dot, { opacity }]} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 6,
    paddingRight: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(215,255,62,0.12)',
  },
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.lime },
  text: { color: colors.lime, fontSize: 9, fontWeight: font.black, letterSpacing: 0.6 },
});

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { DEFAULT_HUD_THEME, type HudTheme } from '@/lib/hudThemes';

/**
 * Radial particle burst for calibration feedback (move detected, phase
 * change, end card). ~20 dots fly outward from the center of the parent and
 * fade; colours come from the active HUD theme so it matches the skeleton.
 * Pure RN Animated on the native driver. Re-fires every time `trigger`
 * changes to a new non-zero value. Honors reduce-motion (renders nothing).
 */
export function ParticleBurst({
  trigger,
  count = 20,
  radius = 150,
  duration = 720,
  theme = DEFAULT_HUD_THEME,
  big = false,
}: {
  /** Monotonic counter; each new value fires one burst. */
  trigger: number;
  count?: number;
  radius?: number;
  duration?: number;
  theme?: HudTheme;
  /** End-card variant: larger dots, wider spread. */
  big?: boolean;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [visible, setVisible] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const lastTrigger = useRef(0);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const particles = useMemo(() => {
    const palette = [theme.accent, theme.accent, theme.joint, theme.perfect, theme.good];
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const distance = radius * (big ? 1.4 : 1) * (0.55 + Math.random() * 0.45);
      return {
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        size: (big ? 7 : 5) + Math.random() * (big ? 6 : 3),
        color: palette[index % palette.length],
        spin: (Math.random() - 0.5) * 240,
      };
    });
  }, [big, count, radius, theme]);

  useEffect(() => {
    if (!trigger || trigger === lastTrigger.current) return;
    lastTrigger.current = trigger;
    if (reduceMotion) return;
    setVisible(true);
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) setVisible(false);
    });
    return () => anim.stop();
  }, [duration, progress, reduceMotion, trigger]);

  if (!visible || reduceMotion) return null;

  const opacity = progress.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 0.9, 0] });
  const scale = progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.1, 0.6] });

  return (
    <View pointerEvents="none" style={styles.root}>
      {particles.map((particle, index) => {
        const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, particle.dx] });
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          // Slight gravity so the burst settles instead of exploding uniformly.
          outputRange: [0, particle.dy + 28],
        });
        const rotate = progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${particle.spin}deg`],
        });
        return (
          <Animated.View
            key={index}
            style={{
              position: 'absolute',
              width: particle.size,
              height: particle.size,
              borderRadius: index % 3 === 0 ? 1 : particle.size / 2,
              backgroundColor: particle.color,
              opacity,
              transform: [{ translateX }, { translateY }, { rotate }, { scale }],
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

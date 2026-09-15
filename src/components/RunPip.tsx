import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from '@/theme';

/**
 * The run's camera picture-in-picture: sizing and frame shared by the
 * workout screen (bottom-right, over the map) and the calibration teaser
 * (same corner, `scale` 1.5 so the person can see themselves while copying
 * the run). One place to change the PiP look.
 */

/** PiP box for a screen width: 96–120 pt wide, 4:3 portrait, times `scale`. */
export function runPipSize(screenWidth: number, scale = 1): { width: number; height: number } {
  const width = Math.min(120, Math.max(96, screenWidth * 0.28)) * scale;
  return { width, height: width * (4 / 3) };
}

const RING_WIDTH = 2;
const FLASH_MS = 520;

/**
 * Rounded, shadowed PiP frame. `ring` draws a thin border (the teaser's
 * amber/green tracking ring); each new non-zero `flash` value plays a short
 * green flash over the frame (a landed move). `expanded` fills the parent
 * instead (no radius, ring or shadow) with the SAME view tree, so a camera
 * child can go full-screen → PiP without being remounted.
 */
export function RunPipFrame({
  width,
  height,
  style,
  ring,
  flash = 0,
  flashColor = colors.lime,
  expanded = false,
  children,
}: {
  width: number;
  height: number;
  /** Placement (bottom/right offsets) on top of the shared absolute styles. */
  style?: StyleProp<ViewStyle>;
  ring?: string | null;
  flash?: number;
  flashColor?: string;
  expanded?: boolean;
  children: ReactNode;
}) {
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const lastFlash = useRef(0);
  useEffect(() => {
    if (!flash) {
      // Counter reset (a new calibration cycle): the next 1 flashes again.
      lastFlash.current = 0;
      return;
    }
    if (flash === lastFlash.current) return;
    lastFlash.current = flash;
    flashOpacity.setValue(0.85);
    const animation = Animated.timing(flashOpacity, {
      toValue: 0,
      duration: FLASH_MS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [flash, flashOpacity]);

  return (
    <View
      pointerEvents="box-none"
      style={expanded ? StyleSheet.absoluteFill : [pipStyles.placement, { width, height }, style]}
    >
      <View
        style={
          expanded
            ? pipStyles.expandedFrame
            : [pipStyles.frame, ring ? { borderWidth: RING_WIDTH, borderColor: ring } : null]
        }
        pointerEvents="none"
      >
        {children}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: flashColor, opacity: flashOpacity }]}
        />
      </View>
    </View>
  );
}

export const pipStyles = StyleSheet.create({
  placement: {
    position: 'absolute',
    borderRadius: radius.md,
    shadowColor: colors.black,
    shadowOpacity: 0.65,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  frame: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radius.md,
  },
  expandedFrame: { flex: 1 },
});

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { DEFAULT_HUD_THEME, withAlpha, type HudTheme } from '@/lib/hudThemes';
import { POSE_JOINTS, SKELETON_EDGES, type PoseJoint } from '@/lib/poseTracking';
import { colors } from '@/theme';

/**
 * Screen 1 hero: a soft person silhouette with the real tracking skeleton
 * (same joints and bones as `PoseOverlay`) lighting up joint by joint, then
 * looping. Pure RN Animated on the native driver; honors reduce-motion (the
 * skeleton renders fully lit and still). No video, no third-party art.
 */

/** Neutral standing pose in the figure's normalized box (x right, y down). */
const FIGURE_POSE: Record<PoseJoint, [number, number]> = {
  nose: [0.5, 0.09],
  neck: [0.5, 0.2],
  leftShoulder: [0.36, 0.23],
  rightShoulder: [0.64, 0.23],
  leftElbow: [0.29, 0.4],
  rightElbow: [0.71, 0.4],
  leftWrist: [0.25, 0.56],
  rightWrist: [0.75, 0.56],
  root: [0.5, 0.5],
  leftHip: [0.42, 0.51],
  rightHip: [0.58, 0.51],
  leftKnee: [0.41, 0.72],
  rightKnee: [0.59, 0.72],
  leftAnkle: [0.4, 0.94],
  rightAnkle: [0.6, 0.94],
};

/** Top-down lighting order so the scan reads as a sweep. */
const LIGHT_ORDER: PoseJoint[] = [
  'nose',
  'neck',
  'leftShoulder',
  'rightShoulder',
  'root',
  'leftElbow',
  'rightElbow',
  'leftHip',
  'rightHip',
  'leftWrist',
  'rightWrist',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
];

const STEP_MS = 95;
const HOLD_MS = 900;
const FADE_MS = 420;
const REST_MS = 350;

export function CalibrationIntroFigure({
  width = 180,
  height = 300,
  theme = DEFAULT_HUD_THEME,
}: {
  width?: number;
  height?: number;
  theme?: HudTheme;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const values = useRef(
    Object.fromEntries(POSE_JOINTS.map((joint) => [joint, new Animated.Value(0)])) as Record<
      PoseJoint,
      Animated.Value
    >,
  ).current;
  const scan = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    if (reduceMotion) {
      for (const joint of POSE_JOINTS) values[joint].setValue(1);
      scan.setValue(0);
      return;
    }
    const lightUp = Animated.stagger(
      STEP_MS,
      LIGHT_ORDER.map((joint) =>
        Animated.spring(values[joint], {
          toValue: 1,
          speed: 30,
          bounciness: 9,
          useNativeDriver: true,
        }),
      ),
    );
    const fadeOut = Animated.parallel(
      POSE_JOINTS.map((joint) =>
        Animated.timing(values[joint], {
          toValue: 0,
          duration: FADE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    );
    const sweep = Animated.sequence([
      Animated.timing(scan, {
        toValue: 1,
        duration: STEP_MS * LIGHT_ORDER.length,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(scan, { toValue: 0, duration: 1, useNativeDriver: true }),
    ]);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([lightUp, sweep]),
        Animated.delay(HOLD_MS),
        fadeOut,
        Animated.delay(REST_MS),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, scan, values]);

  const points = useMemo(
    () =>
      Object.fromEntries(
        POSE_JOINTS.map((joint) => {
          const [x, y] = FIGURE_POSE[joint];
          return [joint, { x: x * width, y: y * height }];
        }),
      ) as Record<PoseJoint, { x: number; y: number }>,
    [width, height],
  );

  // Derived Animated nodes are created once, not per render.
  const boneOpacity = useMemo(
    () => SKELETON_EDGES.map(([from, to]) => Animated.multiply(values[from], values[to])),
    [values],
  );
  const jointScale = useMemo(
    () =>
      Object.fromEntries(
        POSE_JOINTS.map((joint) => [
          joint,
          values[joint].interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
        ]),
      ) as Record<PoseJoint, Animated.AnimatedInterpolation<number>>,
    [values],
  );

  const scanY = scan.interpolate({ inputRange: [0, 1], outputRange: [0, height] });
  const scanOpacity = scan.interpolate({
    inputRange: [0, 0.05, 0.95, 1],
    outputRange: [0, 0.9, 0.9, 0],
  });
  const silhouette = withAlpha(colors.white, 0.08);

  return (
    <View
      accessible
      accessibilityLabel="Animated outline of a person with tracking points lighting up along the body"
      style={{ width, height }}
    >
      {/* Soft silhouette: head, torso, limbs as rounded blocks under the skeleton. */}
      <View
        style={[
          styles.silhouette,
          {
            width: width * 0.16,
            height: width * 0.16,
            borderRadius: width * 0.08,
            left: width * 0.42,
            top: height * 0.04,
            backgroundColor: silhouette,
          },
        ]}
      />
      <View
        style={[
          styles.silhouette,
          {
            width: width * 0.36,
            height: height * 0.33,
            borderRadius: width * 0.1,
            left: width * 0.32,
            top: height * 0.19,
            backgroundColor: silhouette,
          },
        ]}
      />
      {(['left', 'right'] as const).map((side) => {
        const sign = side === 'left' ? -1 : 1;
        return (
          <View key={side}>
            <View
              style={[
                styles.silhouette,
                {
                  width: width * 0.09,
                  height: height * 0.36,
                  borderRadius: width * 0.045,
                  left: width * (0.5 + sign * 0.27) - width * 0.045,
                  top: height * 0.2,
                  backgroundColor: silhouette,
                  transform: [{ rotate: `${sign * -9}deg` }],
                },
              ]}
            />
            <View
              style={[
                styles.silhouette,
                {
                  width: width * 0.12,
                  height: height * 0.45,
                  borderRadius: width * 0.06,
                  left: width * (0.5 + sign * 0.09) - width * 0.06,
                  top: height * 0.5,
                  backgroundColor: silhouette,
                },
              ]}
            />
          </View>
        );
      })}

      {/* Scan line sweeping down while joints light. */}
      {!reduceMotion ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.scan,
            {
              width,
              backgroundColor: withAlpha(theme.accent, 0.55),
              opacity: scanOpacity,
              transform: [{ translateY: scanY }],
            },
          ]}
        />
      ) : null}

      {/* Bones: lit when both endpoints are lit. */}
      {SKELETON_EDGES.map(([from, to], index) => {
        const a = points[from];
        const b = points[to];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const opacity = boneOpacity[index];
        return (
          <Animated.View
            key={`${from}-${to}`}
            style={[
              styles.bone,
              {
                width: length,
                left: (a.x + b.x - length) / 2,
                top: (a.y + b.y) / 2 - 1.5,
                backgroundColor: theme.accent,
                opacity,
                transform: [{ rotate: `${angle}rad` }],
              },
            ]}
          />
        );
      })}

      {/* Joints: pop in with a small scale overshoot. */}
      {POSE_JOINTS.map((joint) => {
        const point = points[joint];
        const value = values[joint];
        const scale = jointScale[joint];
        return (
          <Animated.View
            key={joint}
            style={[
              styles.joint,
              {
                left: point.x - 6,
                top: point.y - 6,
                backgroundColor: theme.joint,
                borderColor: theme.accent,
                opacity: value,
                transform: [{ scale }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  silhouette: { position: 'absolute' },
  scan: { position: 'absolute', left: 0, top: 0, height: 2, borderRadius: 1 },
  bone: {
    position: 'absolute',
    height: 3,
    borderRadius: 2,
    shadowColor: colors.black,
    shadowOpacity: 0.5,
    shadowRadius: 2,
  },
  joint: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
});

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius } from '@/theme';

const HERO_BG = require('../../assets/mascot/hero-bg.png');
const POSE_IDLE = require('../../assets/mascot/pose-idle.png');
const POSE_TIE = require('../../assets/mascot/pose-tie.png');
const POSE_JUMP = require('../../assets/mascot/pose-jump.png');
const RUN_BACK_FRAMES = [
  require('../../assets/mascot/run-back-1.png'),
  require('../../assets/mascot/run-back-2.png'),
  require('../../assets/mascot/run-back-3.png'),
  require('../../assets/mascot/run-back-4.png'),
] as const;

const POSE_RATIO = 923 / 1008; // width / height of the shared pose canvas
const RUN_RATIO = 360 / 630;
const HERO_SOURCE = { width: 1024, height: 683 };
const SCREEN = Dimensions.get('window');

const T_READY = 600;
const T_TIE = 1250;
const T_STAND = 300;
const T_ANTICIPATE = 120;
const T_LAUNCH = 80;
const T_JUMP_UP = 300;
const T_JUMP_DOWN = 300;
const T_LAND_DOWN = 110;
const T_LAND_UP = 130;
const T_BETWEEN_JUMPS = 180;
const T_TURN = 620;
const T_RUN = 7600;
const T_HIDDEN = 550;
const RUN_FRAME_MS = 130;
const SQUASH_ANTICIPATE = 0.86;
const SQUASH_LAND = 0.9;

const PATH_INPUT = [0, 0.16, 0.34, 0.51, 0.67, 0.83, 1];
// Source-image coordinates follow the center of the painted trail, from the
// lower-right foreground through its bends to the distant right-hand rise.
const TRAIL_SOURCE_POINTS = [
  { x: 720, y: 565 },
  { x: 770, y: 518 },
  { x: 700, y: 466 },
  { x: 770, y: 432 },
  { x: 808, y: 405 },
  { x: 786, y: 382 },
  { x: 826, y: 356 },
];
const TRAIL_SCALE = [1, 0.92, 0.78, 0.66, 0.54, 0.43, 0.32];
const TRAIL_ROTATION = ['-6deg', '-9deg', '-5deg', '3deg', '-3deg', '4deg', '-2deg'];

type Phase = 'ready' | 'tie' | 'jump' | 'turn' | 'run';
type Size = { width: number; height: number };

function mapCoverPoint(point: { x: number; y: number }, container: Size) {
  const imageScale = Math.max(
    container.width / HERO_SOURCE.width,
    container.height / HERO_SOURCE.height
  );
  const cropX = (HERO_SOURCE.width * imageScale - container.width) / 2;
  const cropY = (HERO_SOURCE.height * imageScale - container.height) / 2;
  return {
    x: point.x * imageScale - cropX,
    y: point.y * imageScale - cropY,
  };
}

export function MascotHero({
  height = Math.round(SCREEN.height * 0.4),
  style,
  children,
}: {
  height?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const [layout, setLayout] = useState<Size>({ width: SCREEN.width, height });
  const [phase, setPhase] = useState<Phase>('ready');
  const [runFrame, setRunFrame] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const travel = useRef(new Animated.Value(0)).current;
  const turn = useRef(new Animated.Value(0)).current;
  const jump = useRef(new Animated.Value(0)).current;
  const squash = useRef(new Animated.Value(1)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const foxHeight = Math.round(Math.min(layout.height * 0.31, layout.width * 0.29));
  const poseWidth = Math.round(foxHeight * POSE_RATIO);
  const runWidth = Math.round(foxHeight * RUN_RATIO);
  const shadowWidth = Math.round(runWidth * 0.62);
  const shadowHeight = Math.max(6, Math.round(foxHeight * 0.075));
  const trail = useMemo(
    () => TRAIL_SOURCE_POINTS.map((point) => mapCoverPoint(point, layout)),
    [layout]
  );
  const start = trail[0];

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
      timers.current.forEach(clearTimeout);
      timers.current = [];
      travel.stopAnimation();
      turn.stopAnimation();
      jump.stopAnimation();
      squash.stopAnimation();
      travel.setValue(0);
      turn.setValue(0);
      jump.setValue(0);
      squash.setValue(1);
      setPhase('ready');
      setRunFrame(0);
      return;
    }

    let cancelled = false;
    const after = (ms: number, fn: () => void) => {
      const id = setTimeout(() => {
        timers.current = timers.current.filter((timer) => timer !== id);
        if (!cancelled) fn();
      }, ms);
      timers.current.push(id);
    };

    const doJump = (onDone: () => void) => {
      if (cancelled) return;

      setPhase('ready');
      Animated.timing(squash, {
        toValue: SQUASH_ANTICIPATE,
        duration: T_ANTICIPATE,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished: anticipated }) => {
        if (cancelled || !anticipated) return;

        setPhase('jump');
        Animated.parallel([
          Animated.timing(squash, {
            toValue: 1,
            duration: T_LAUNCH,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(jump, {
              toValue: 1,
              duration: T_JUMP_UP,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(jump, {
              toValue: 0,
              duration: T_JUMP_DOWN,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ]).start(({ finished: landed }) => {
          if (cancelled || !landed) return;

          setPhase('ready');
          Animated.sequence([
            Animated.timing(squash, {
              toValue: SQUASH_LAND,
              duration: T_LAND_DOWN,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(squash, {
              toValue: 1,
              duration: T_LAND_UP,
              easing: Easing.out(Easing.back(1.6)),
              useNativeDriver: true,
            }),
          ]).start(({ finished: settled }) => {
            if (!cancelled && settled) onDone();
          });
        });
      });
    };

    const startTurnAndRun = () => {
      turn.setValue(0);
      setPhase('turn');
      Animated.timing(turn, {
        toValue: 1,
        duration: T_TURN,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (cancelled || !finished) return;

        // The turn ends on the same rear frame that begins the run.
        // Travel resets before that runner moves, and its final fade
        // keeps the next ready pose from revealing a teleport.
        travel.setValue(0);
        setPhase('run');
        Animated.timing(travel, {
          toValue: 1,
          duration: T_RUN,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished: travelFinished }) => {
          if (!cancelled && travelFinished) after(T_HIDDEN, cycle);
        });
      });
    };

    const cycle = () => {
      if (cancelled) return;
      setPhase('ready');
      jump.setValue(0);
      squash.setValue(1);
      after(T_READY, () => {
        setPhase('tie');
        after(T_TIE, () => {
          setPhase('ready');
          after(T_STAND, () => {
            doJump(() => {
              after(T_BETWEEN_JUMPS, () => {
                doJump(startTurnAndRun);
              });
            });
          });
        });
      });
    };

    cycle();

    return () => {
      cancelled = true;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      travel.stopAnimation();
      turn.stopAnimation();
      jump.stopAnimation();
      squash.stopAnimation();
    };
  }, [jump, reduceMotion, squash, travel, turn]);

  useEffect(() => {
    if (reduceMotion || phase !== 'run') {
      setRunFrame(0);
      return;
    }
    const id = setInterval(() => {
      setRunFrame((frame) => (frame + 1) % RUN_BACK_FRAMES.length);
    }, RUN_FRAME_MS);
    return () => clearInterval(id);
  }, [phase, reduceMotion]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height: measuredHeight } = event.nativeEvent.layout;
    if (width !== layout.width || measuredHeight !== layout.height) {
      setLayout({ width, height: measuredHeight });
    }
  };

  const translateX = travel.interpolate({
    inputRange: PATH_INPUT,
    outputRange: trail.map((point) => point.x - runWidth / 2),
  });
  // RN scales around the image center, so this compensation keeps the fox's
  // feet planted on each trail coordinate as the sprite shrinks into depth.
  const translateY = travel.interpolate({
    inputRange: PATH_INPUT,
    outputRange: trail.map(
      (point, index) => point.y - foxHeight / 2 - (foxHeight * TRAIL_SCALE[index]) / 2
    ),
  });
  const scale = travel.interpolate({
    inputRange: PATH_INPUT,
    outputRange: TRAIL_SCALE,
  });
  const rotate = travel.interpolate({
    inputRange: PATH_INPUT,
    outputRange: TRAIL_ROTATION,
  });
  const foxOpacity = travel.interpolate({
    inputRange: [0, 0.88, 0.97, 1],
    outputRange: [1, 1, 0.75, 0],
  });
  const shadowTranslateX = travel.interpolate({
    inputRange: PATH_INPUT,
    outputRange: trail.map((point) => point.x - shadowWidth / 2),
  });
  const shadowTranslateY = travel.interpolate({
    inputRange: PATH_INPUT,
    outputRange: trail.map((point) => point.y - shadowHeight / 2),
  });
  const shadowScale = travel.interpolate({
    inputRange: PATH_INPUT,
    outputRange: [1, 0.88, 0.68, 0.48, 0.3, 0.18, 0.1],
  });
  const shadowOpacity = travel.interpolate({
    inputRange: [0, 0.48, 0.72, 0.86, 1],
    outputRange: [0.34, 0.25, 0.1, 0.02, 0],
  });
  const turnScaleX = turn.interpolate({
    inputRange: [0, 0.46, 0.54, 1],
    outputRange: [1, 0.16, 0.08, 1],
  });
  const turnFrontOpacity = turn.interpolate({
    inputRange: [0, 0.42, 0.53],
    outputRange: [1, 0.35, 0],
    extrapolate: 'clamp',
  });
  const turnBackOpacity = turn.interpolate({
    inputRange: [0.43, 0.54, 0.72, 1],
    outputRange: [0, 0.18, 0.82, 1],
    extrapolate: 'clamp',
  });
  const hop = foxHeight * 0.34;
  const jumpLift = jump.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -hop],
  });
  // Scaling happens around the sprite center; this offset keeps its feet on
  // the trail during the anticipation and landing squashes.
  const squashCompensation = squash.interpolate({
    inputRange: [SQUASH_ANTICIPATE, 1],
    outputRange: [(foxHeight * (1 - SQUASH_ANTICIPATE)) / 2, 0],
  });
  const jumpTranslateY = Animated.add(jumpLift, squashCompensation);
  const jumpShadowScale = jump.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.55],
  });
  const jumpShadowOpacity = jump.interpolate({
    inputRange: [0, 1],
    outputRange: [0.34, 0.1],
  });

  const introScale = reduceMotion ? 0.9 : 1;
  const introHeight = foxHeight * introScale;
  const introWidth = poseWidth * introScale;
  const turnWidth = Math.max(poseWidth, runWidth);

  return (
    <View style={[styles.wrap, { height }, style]} onLayout={onLayout}>
      <Image source={HERO_BG} style={styles.bg} contentFit="cover" />

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {phase === 'run' && !reduceMotion ? (
          <>
            <Animated.View
              style={[
                styles.shadow,
                {
                  width: shadowWidth,
                  height: shadowHeight,
                  opacity: shadowOpacity,
                  transform: [
                    { translateX: shadowTranslateX },
                    { translateY: shadowTranslateY },
                    { scaleX: shadowScale },
                  ],
                },
              ]}
            />
            <Animated.View
              style={{
                position: 'absolute',
                width: runWidth,
                height: foxHeight,
                opacity: foxOpacity,
                transform: [{ translateX }, { translateY }, { scale }, { rotate }],
              }}
            >
              <Image
                source={RUN_BACK_FRAMES[runFrame]}
                style={{ width: runWidth, height: foxHeight }}
                contentFit="contain"
                accessibilityLabel="Fox mascot running up the hill"
              />
            </Animated.View>
          </>
        ) : (
          <>
            <Animated.View
              style={[
                styles.shadow,
                {
                  left: start.x - shadowWidth * introScale * 0.5,
                  top: start.y - shadowHeight / 2,
                  width: shadowWidth * introScale,
                  height: shadowHeight,
                  opacity: reduceMotion ? 0.28 : jumpShadowOpacity,
                  transform: [{ scaleX: reduceMotion ? 1 : jumpShadowScale }],
                },
              ]}
            />
            {phase === 'turn' ? (
              <Animated.View
                style={{
                  position: 'absolute',
                  left: start.x - turnWidth / 2,
                  top: start.y - foxHeight,
                  width: turnWidth,
                  height: foxHeight,
                  transform: [{ scaleX: turnScaleX }],
                }}
              >
                <Animated.View
                  style={[
                    StyleSheet.absoluteFill,
                    { opacity: turnFrontOpacity, alignItems: 'center', justifyContent: 'flex-end' },
                  ]}
                >
                  <Image
                    source={POSE_IDLE}
                    style={{ width: poseWidth, height: foxHeight }}
                    contentFit="contain"
                    accessibilityLabel="Fox mascot turning toward the trail"
                  />
                </Animated.View>
                <Animated.View
                  style={[
                    StyleSheet.absoluteFill,
                    { opacity: turnBackOpacity, alignItems: 'center', justifyContent: 'flex-end' },
                  ]}
                >
                  <Image
                    source={RUN_BACK_FRAMES[0]}
                    style={{ width: runWidth, height: foxHeight }}
                    contentFit="contain"
                    accessibilityLabel="Fox mascot turning away to run"
                  />
                </Animated.View>
              </Animated.View>
            ) : (
              <Animated.View
                style={{
                  position: 'absolute',
                  left: start.x - introWidth / 2,
                  top: start.y - introHeight,
                  width: introWidth,
                  height: introHeight,
                  transform: reduceMotion
                    ? []
                    : [{ translateY: jumpTranslateY }, { scaleY: squash }],
                }}
              >
                <Image
                  source={
                    reduceMotion
                      ? POSE_IDLE
                      : phase === 'tie'
                        ? POSE_TIE
                        : phase === 'jump'
                          ? POSE_JUMP
                          : POSE_IDLE
                  }
                  style={{ width: introWidth, height: introHeight }}
                  contentFit="contain"
                  accessibilityLabel={
                    reduceMotion
                      ? 'Fox mascot ready on the trail'
                      : phase === 'tie'
                        ? 'Fox mascot tying its shoes'
                        : phase === 'jump'
                          ? 'Fox mascot jumping'
                          : 'Fox mascot ready to run'
                  }
                />
              </Animated.View>
            )}
          </>
        )}
      </View>

      {/* Blend the scenic dark bottom edge into the app background. */}
      <LinearGradient
        colors={['transparent', 'transparent', colors.bg]}
        locations={[0, 0.7, 1]}
        style={styles.fade}
        pointerEvents="none"
      />

      {children ? (
        <View style={styles.overlay} pointerEvents="box-none">
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  bg: {
    ...StyleSheet.absoluteFillObject,
  },
  shadow: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: radius.pill,
    backgroundColor: colors.black,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '42%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
});

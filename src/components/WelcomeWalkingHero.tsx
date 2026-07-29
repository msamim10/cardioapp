import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '@/theme';

const WALK_FRAMES = [
  require('../../assets/mascot/walk-1.png'),
  require('../../assets/mascot/walk-2.png'),
  require('../../assets/mascot/walk-3.png'),
  require('../../assets/mascot/walk-4.png'),
] as const;

const FRAME_MS = 185;

// Pre-rendered soft lime radial gradient (transparent edges) -> perfectly smooth
// ambient glow with no visible rings and no native dependency.
const GLOW_SOURCE = require('../../assets/mascot/glow-lime.png');

export function WelcomeWalkingHero({
  height,
  verticalOffset,
}: {
  height: number;
  verticalOffset: number;
}) {
  const [frame, setFrame] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const step = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      step.stopAnimation();
      step.setValue(0.5);
      setFrame(1);
      return;
    }

    const movement = Animated.loop(
      Animated.sequence([
        Animated.timing(step, {
          toValue: 1,
          duration: FRAME_MS * 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(step, {
          toValue: 0,
          duration: FRAME_MS * 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    movement.start();
    const frameTimer = setInterval(() => setFrame((value) => (value + 1) % WALK_FRAMES.length), FRAME_MS);

    return () => {
      clearInterval(frameTimer);
      movement.stop();
    };
  }, [reduceMotion, step]);

  const foxTranslateY = step.interpolate({
    inputRange: [0, 1],
    outputRange: [verticalOffset + 3, verticalOffset - 4],
  });
  const foxRotate = step.interpolate({ inputRange: [0, 1], outputRange: ['-0.7deg', '0.7deg'] });
  const foxScale = step.interpolate({ inputRange: [0, 1], outputRange: [0.99, 1.01] });

  const glowSize = Math.round(height * 1.35);

  return (
    <View style={[styles.hero, { height }]}>
      <View pointerEvents="none" style={styles.glowWrap}>
        <Image
          source={GLOW_SOURCE}
          style={{ width: glowSize, height: glowSize }}
          contentFit="contain"
        />
      </View>
      <Animated.View
        accessible
        accessibilityRole="image"
        accessibilityLabel="Fox in sunglasses and sneakers walking in place"
        style={[
          styles.foxWrap,
          {
            transform: [
              { translateY: foxTranslateY },
              { rotate: foxRotate },
              { scale: foxScale },
            ],
          },
        ]}
      >
        <Image source={WALK_FRAMES[frame]} style={styles.fox} contentFit="contain" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
  },
  glowWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foxWrap: {
    width: '81%',
    maxWidth: 345,
    height: '85%',
  },
  fox: {
    width: '100%',
    height: '100%',
  },
});

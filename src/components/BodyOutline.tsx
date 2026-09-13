import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { withAlpha } from '@/lib/hudThemes';
import type { FramingVerdict } from '@/lib/skeletonFraming';
import { colors } from '@/theme';

/**
 * Phase 1 framing target: a soft standing silhouette centered in the camera
 * view, sized to the height band the framing helper accepts (~70% of the
 * frame). It sits behind the live skeleton and changes tint with the verdict:
 * neutral white while coaching, warm while the user is too close / too far,
 * lime once framing is ok. Built from rounded Views — no SVG dependency.
 */
export function BodyOutline({
  verdict,
  heightFraction = 0.7,
}: {
  verdict: FramingVerdict;
  heightFraction?: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (verdict !== 'ok') {
      pulse.setValue(0);
      return;
    }
    // One confident breath when framing locks; no perpetual pulsing.
    const anim = Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 380, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [pulse, verdict]);

  const tint =
    verdict === 'ok'
      ? colors.lime
      : verdict === 'searching'
        ? colors.white
        : colors.heat;
  const fill = withAlpha(tint, verdict === 'ok' ? 0.16 : 0.07);
  const stroke = withAlpha(tint, verdict === 'ok' ? 0.95 : 0.6);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  return (
    <View pointerEvents="none" style={styles.root}>
      <Animated.View
        style={[
          styles.figure,
          { height: `${Math.round(heightFraction * 100)}%`, transform: [{ scale }] },
        ]}
      >
        <View style={[styles.head, { backgroundColor: fill, borderColor: stroke }]} />
        <View style={[styles.neck, { backgroundColor: stroke }]} />
        <View style={styles.upper}>
          <View
            style={[styles.arm, styles.armLeft, { backgroundColor: fill, borderColor: stroke }]}
          />
          <View style={[styles.torso, { backgroundColor: fill, borderColor: stroke }]} />
          <View
            style={[styles.arm, styles.armRight, { backgroundColor: fill, borderColor: stroke }]}
          />
        </View>
        <View style={styles.legs}>
          <View style={[styles.leg, { backgroundColor: fill, borderColor: stroke }]} />
          <View style={[styles.leg, { backgroundColor: fill, borderColor: stroke }]} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  figure: { aspectRatio: 0.42, alignItems: 'center' },
  head: {
    width: '34%',
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  neck: { width: 2, height: '2.5%', opacity: 0.7 },
  upper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    height: '38%',
    width: '100%',
  },
  torso: {
    width: '58%',
    height: '100%',
    borderRadius: 26,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    borderWidth: 1.5,
  },
  arm: {
    width: '17%',
    height: '92%',
    borderRadius: 999,
    borderWidth: 1.5,
    marginTop: '4%',
  },
  armLeft: { marginRight: -2, transform: [{ rotate: '7deg' }] },
  armRight: { marginLeft: -2, transform: [{ rotate: '-7deg' }] },
  legs: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 3,
    height: '46%',
    width: '58%',
    marginTop: -2,
  },
  leg: {
    flex: 1,
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1.5,
  },
});

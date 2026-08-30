import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  type ImageSourcePropType,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { colors } from '@/theme';

/**
 * A gameplay still sized to carry a screen's hero slot.
 *
 * Two optional treatments, each tied to one job:
 * - `children` overlays content on the artwork, and brings a top scrim with it,
 *   because that scrim is the only thing guaranteeing AA contrast over a frame
 *   whose brightness is not known ahead of time.
 * - `fadeTo` dissolves the bottom edge into the screen colour, for full-bleed
 *   bands where the content below has to flow out of the artwork. Framed cards
 *   omit it and keep the whole frame inside their border.
 */
export function GameplayHero({
  source,
  height,
  fadeTo,
  style,
  accessibilityLabel,
  children,
}: {
  source: ImageSourcePropType;
  height: number;
  fadeTo?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  children?: ReactNode;
}) {
  return (
    <View style={[styles.wrap, { height }, style]}>
      <Image
        accessibilityLabel={accessibilityLabel}
        accessible={accessibilityLabel !== undefined}
        contentFit="cover"
        source={source}
        style={StyleSheet.absoluteFill}
        transition={180}
      />

      {children ? (
        <LinearGradient
          colors={['rgba(8,9,10,0.88)', 'rgba(8,9,10,0.32)', 'transparent']}
          locations={[0, 0.58, 1]}
          pointerEvents="none"
          style={styles.scrim}
        />
      ) : null}

      {fadeTo ? (
        <LinearGradient
          colors={['transparent', 'transparent', fadeTo]}
          locations={[0, 0.4, 1]}
          pointerEvents="none"
          style={styles.fade}
        />
      ) : null}

      {children ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '46%',
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '54%',
  },
});

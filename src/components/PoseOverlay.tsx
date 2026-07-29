import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Move,
  PoseFeedback,
  PoseFrame,
  PoseScore,
  PoseTrackingMode,
  SKELETON_EDGES,
  totalWorkoutScore,
} from '@/lib/poseTracking';
import { colors, font, radius, spacing } from '@/theme';

type Props = {
  frame: PoseFrame | null;
  feedback: PoseFeedback;
  mode: PoseTrackingMode;
  score: PoseScore;
  /** Playback elapsed seconds — drives the progress component of the HUD score. */
  playbackElapsed?: number;
  /** Playback duration seconds — required for progress scoring. */
  playbackDuration?: number;
  variant: 'companion' | 'pip' | 'setup';
};

const MOVE_ICON: Record<Move, string> = {
  Jump: '↑',
  Duck: '↓',
  Left: '←',
  Right: '→',
};

const MOVES: Move[] = ['Jump', 'Duck', 'Left', 'Right'];

export function PoseOverlay({
  frame,
  feedback,
  mode,
  score,
  playbackElapsed = 0,
  playbackDuration = 0,
  variant,
}: Props) {
  const compact = variant === 'pip';
  const setup = variant === 'setup';
  const displayScore = totalWorkoutScore(score.score, playbackElapsed, playbackDuration);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {frame ? <ResponsiveSkeleton feedback={feedback} frame={frame} compact={compact} /> : null}

      {mode === 'demo' ? (
        <View style={[styles.demoBanner, compact && styles.demoBannerCompact]}>
          <Text style={[styles.demoText, compact && styles.demoTextCompact]}>SIMULATED SCORING</Text>
        </View>
      ) : null}

      {!setup ? (
        <View style={[styles.hud, compact && styles.hudCompact]}>
          <HudValue label="SCORE" value={displayScore.toLocaleString()} compact={compact} />
          {/* Combo + move arrows stay on AirPlay companion; PiP keeps score only. */}
          {!compact ? (
            <>
              <View style={styles.divider} />
              <HudValue label="COMBO" value={score.combo ? `${score.combo}×` : '—'} compact={compact} />
              <View style={styles.divider} />
              <View style={styles.countsInline}>
                {MOVES.map((move) => (
                  <View key={move} style={styles.count}>
                    <Text style={styles.countIcon}>{MOVE_ICON[move]}</Text>
                    <Text style={styles.countNumber}>{score.counts[move]}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function HudValue({ label, value, compact }: { label: string; value: string; compact: boolean }) {
  return (
    <View style={styles.hudValue}>
      <Text style={[styles.hudLabel, compact && styles.hudLabelCompact]}>{label}</Text>
      <Text style={[styles.hudNumber, compact && styles.hudNumberCompact]}>{value}</Text>
    </View>
  );
}

function ResponsiveSkeleton({
  feedback,
  frame,
  compact,
}: {
  feedback: PoseFeedback;
  frame: PoseFrame;
  compact: boolean;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Native pose coordinates describe the full portrait camera buffer. The
  // preview uses aspect-fill, so map through the same cover crop.
  if (!size.width || !size.height) {
    return (
      <View
        style={StyleSheet.absoluteFill}
        onLayout={({ nativeEvent }) => setSize(nativeEvent.layout)}
      />
    );
  }

  const sourceWidth = Math.max(1, frame.sourceWidth);
  const sourceHeight = Math.max(1, frame.sourceHeight);
  const scale = Math.max(size.width / sourceWidth, size.height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (size.width - renderedWidth) / 2;
  const offsetY = (size.height - renderedHeight) / 2;
  const points = new Map(
    frame.keypoints
      .filter((point) => point.confidence >= 0.45)
      .map((point) => [
        point.name,
        {
          x: offsetX + point.x * renderedWidth,
          y: offsetY + point.y * renderedHeight,
          confidence: point.confidence,
        },
      ]),
  );
  const reference = feedback.reference;
  const referenceX = reference ? offsetX + reference.centerX * renderedWidth : null;
  const floorY =
    reference?.floorY === null || reference?.floorY === undefined
      ? null
      : offsetY + reference.floorY * renderedHeight;
  const laneWidth = reference
    ? Math.max(34, reference.bodyWidth * renderedWidth * 1.45)
    : 0;

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent }) => {
        const next = nativeEvent.layout;
        if (next.width !== size.width || next.height !== size.height) setSize(next);
      }}
    >
      {referenceX !== null ? (
        <>
          <View
            style={[
              styles.homeLane,
              compact && styles.homeLaneCompact,
              { left: referenceX - laneWidth / 2, width: laneWidth },
            ]}
          />
          <View
            style={[
              styles.homeCenter,
              compact && styles.homeCenterCompact,
              { left: referenceX - (compact ? 0.5 : 1) },
            ]}
          />
          {floorY !== null ? (
            <View
              style={[
                styles.homeFloor,
                compact && styles.homeFloorCompact,
                {
                  left: referenceX - laneWidth * 0.72,
                  top: floorY,
                  width: laneWidth * 1.44,
                },
              ]}
            />
          ) : null}
          {!compact ? (
            <View
              style={[
                styles.homeTarget,
                { left: referenceX - 13, top: (floorY ?? size.height * 0.75) - 13 },
              ]}
            >
              <View style={styles.homeTargetDot} />
            </View>
          ) : null}
        </>
      ) : null}
      {SKELETON_EDGES.map(([from, to]) => {
        const a = points.get(from);
        const b = points.get(to);
        if (!a || !b) return null;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        return (
          <View
            key={`${from}-${to}`}
            style={[
              styles.bone,
              compact && styles.boneCompact,
              {
                width: length,
                left: (a.x + b.x - length) / 2,
                top: (a.y + b.y) / 2,
                transform: [{ rotate: `${angle}rad` }],
              },
            ]}
          />
        );
      })}
      {[...points.entries()].map(([name, point]) => (
        <View
          key={name}
          style={[
            styles.joint,
            compact && styles.jointCompact,
            { left: point.x - (compact ? 2 : 3.5), top: point.y - (compact ? 2 : 3.5) },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bone: {
    position: 'absolute',
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
    shadowColor: colors.black,
    shadowOpacity: 0.65,
    shadowRadius: 2,
  },
  boneCompact: { height: 1.5 },
  joint: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.lime,
  },
  jointCompact: { width: 4, height: 4, borderWidth: 1 },
  homeLane: {
    position: 'absolute',
    top: '12%',
    bottom: '8%',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(182,255,59,0.24)',
    backgroundColor: 'rgba(182,255,59,0.035)',
  },
  homeLaneCompact: { top: '15%', bottom: '5%', borderColor: 'rgba(182,255,59,0.18)' },
  homeCenter: {
    position: 'absolute',
    top: '18%',
    bottom: '11%',
    width: 2,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  homeCenterCompact: { width: 1, top: '17%', bottom: '7%' },
  homeFloor: {
    position: 'absolute',
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(182,255,59,0.58)',
  },
  homeFloorCompact: { height: 1 },
  homeTarget: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: 'rgba(182,255,59,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeTargetDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.lime },
  demoBanner: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,149,0,0.9)',
  },
  demoBannerCompact: { top: 30, right: 6, height: 17, paddingHorizontal: 5 },
  demoText: { color: colors.black, fontSize: 9, fontWeight: font.black, letterSpacing: 0.6 },
  demoTextCompact: { fontSize: 6, letterSpacing: 0.2 },
  hud: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(5,8,12,0.75)',
  },
  hudCompact: {
    left: 6,
    right: undefined,
    bottom: 6,
    gap: 6,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  hudValue: { alignItems: 'flex-start', flexShrink: 0 },
  hudLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 8, fontWeight: font.black, letterSpacing: 1 },
  hudLabelCompact: { fontSize: 5, letterSpacing: 0.3 },
  hudNumber: { color: colors.white, fontSize: 18, fontWeight: font.black, lineHeight: 20 },
  hudNumberCompact: { fontSize: 11, lineHeight: 12 },
  divider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.16)', flexShrink: 0 },
  countsInline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    minWidth: 0,
  },
  count: {
    minWidth: 32,
    height: 24,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    flexShrink: 1,
  },
  countIcon: { color: colors.lime, fontSize: 11, fontWeight: font.black },
  countNumber: { color: colors.white, fontSize: 10, fontWeight: font.black },
});

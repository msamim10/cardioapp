import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { getModeCover } from '@/lib/modeCovers';
import type { ClassMapEntry, MapState } from '@/lib/progression';
import { campaignCoverBlurIntensity, shouldBlurCampaignTitle } from '@/lib/progression';
import { colors, font, radius, spacing } from '@/theme';

const NODE_SIZE = 92;
const ROW_GAP = 136;
const PATH_PAD_TOP = 28;
const PATH_PAD_BOTTOM = 56;
const CONNECTOR_THICKNESS = 5;

type PathPoint = { x: number; y: number };

function stateLabel(state: MapState, index: number, blurTitle: boolean): string {
  switch (state) {
    case 'completed':
      return 'Completed';
    case 'next':
      return 'Current, play now';
    case 'unlocked':
      return 'Unlocked';
    case 'locked':
      return blurTitle
        ? 'Locked upcoming map'
        : `Locked. Complete Level ${index}`;
  }
}

function nodeCenter(index: number, pathWidth: number): PathPoint {
  const side = index % 2 === 0 ? 'left' : 'right';
  const inset = pathWidth * 0.22;
  const x = side === 'left' ? inset : pathWidth - inset;
  const y = PATH_PAD_TOP + index * ROW_GAP + NODE_SIZE / 2;
  return { x, y };
}

function PathConnector({
  from,
  to,
  lit,
}: {
  from: PathPoint;
  to: PathPoint;
  lit: boolean;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.connector,
        {
          width: length,
          left: midX - length / 2,
          top: midY - CONNECTOR_THICKNESS / 2,
          backgroundColor: lit ? 'rgba(215,255,62,0.42)' : 'rgba(255,255,255,0.10)',
          transform: [{ rotate: `${angle}deg` }],
        },
      ]}
    />
  );
}

/**
 * Redaction for an unknowable upcoming map name. The real string is NEVER
 * rendered — we draw fixed-width frosted bars (a blurred pill) so neither the
 * name nor its length can leak. A `BlurView` gives the bars a glassy sheen on
 * iOS; the solid bar underneath guarantees the redaction even where blur is
 * unsupported.
 */
function RedactedTitle() {
  return (
    <View
      style={styles.redactedTitleWrap}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <View style={[styles.redactBar, styles.redactBarWide]}>
        <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
      </View>
      <View style={[styles.redactBar, styles.redactBarNarrow]}>
        <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
      </View>
    </View>
  );
}

function PathNode({
  entry,
  center,
  rosterLength,
  onPress,
}: {
  entry: ClassMapEntry;
  center: PathPoint;
  rosterLength: number;
  onPress?: () => void;
}) {
  const cover = getModeCover(entry.mode.id);
  const locked = entry.state === 'locked';
  const completed = entry.state === 'completed';
  const current = entry.state === 'next';
  const playable = !locked;
  const blurTitle = shouldBlurCampaignTitle(entry.index, entry.state, rosterLength);
  const coverBlur = campaignCoverBlurIntensity(entry.index, entry.state, rosterLength);
  const label = stateLabel(entry.state, entry.index, blurTitle);
  const a11yName = blurTitle ? 'upcoming map' : entry.mode.name;

  return (
    <View
      style={[
        styles.nodeWrap,
        {
          left: center.x - NODE_SIZE / 2,
          top: center.y - NODE_SIZE / 2,
          width: NODE_SIZE + 24,
          marginLeft: -12,
        },
      ]}
    >
      <Pressable
        disabled={locked}
        onPress={playable ? onPress : undefined}
        accessibilityRole="button"
        accessibilityLabel={`Level ${entry.index + 1}, ${a11yName}, ${label}, ${entry.level.durationMin} minute run`}
        accessibilityState={{ disabled: locked }}
        accessibilityHint={
          locked
            ? undefined
            : current
              ? 'Opens run details to play now'
              : completed
                ? 'Opens run details to replay'
                : 'Opens run details'
        }
        style={({ pressed }) => [
          styles.nodePress,
          pressed && playable && styles.nodePressed,
        ]}
      >
        {current ? (
          <View style={styles.currentHalo} pointerEvents="none">
            <LinearGradient
              colors={['rgba(215,255,62,0.38)', 'rgba(215,255,62,0.05)', 'transparent']}
              style={StyleSheet.absoluteFill}
            />
          </View>
        ) : null}
        <View
          style={[
            styles.nodeRing,
            current && styles.nodeRingCurrent,
            completed && styles.nodeRingCompleted,
            locked && styles.nodeRingLocked,
            blurTitle && styles.nodeRingBlurred,
          ]}
        >
          <View
            style={[
              styles.nodeFace,
              locked && styles.nodeFaceLocked,
              blurTitle && styles.nodeFaceBlurred,
            ]}
          >
            {cover ? (
              <Image source={cover} contentFit="cover" style={StyleSheet.absoluteFill} />
            ) : (
              <View style={styles.nodeFallback}>
                <Text style={styles.nodeFallbackText}>{entry.index + 1}</Text>
              </View>
            )}
            <LinearGradient
              colors={['transparent', 'rgba(6,6,10,0.55)']}
              style={styles.nodeShade}
            />
            {coverBlur > 0 ? (
              <BlurView
                intensity={coverBlur}
                tint="dark"
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
            ) : null}
            {locked ? (
              <View style={styles.lockOverlay}>
                <Ionicons name="lock-closed" size={22} color={colors.textDim} />
              </View>
            ) : null}
            {completed ? (
              <View style={styles.completedBadge}>
                <Ionicons name="checkmark" size={14} color={colors.black} />
              </View>
            ) : null}
            {current ? (
              <View style={styles.playBadge}>
                <Ionicons name="play" size={12} color={colors.black} />
              </View>
            ) : null}
          </View>
        </View>
        <Text
          style={[
            styles.levelIndex,
            current && styles.levelIndexCurrent,
            locked && styles.levelIndexLocked,
          ]}
        >
          LEVEL {entry.index + 1}
        </Text>
        {blurTitle ? (
          <RedactedTitle />
        ) : (
          <Text
            style={[styles.nodeTitle, locked && styles.nodeTitleLocked]}
            numberOfLines={2}
          >
            {entry.mode.name}
          </Text>
        )}
        {current ? (
          <View style={styles.playNowChip}>
            <Text style={styles.playNowText}>PLAY NOW</Text>
          </View>
        ) : blurTitle ? (
          <Text style={[styles.nodeMeta, styles.nodeMetaLocked]}>
            Complete Level {entry.index}
          </Text>
        ) : (
          <Text style={[styles.nodeMeta, locked && styles.nodeMetaLocked]}>
            {locked
              ? `Complete Level ${entry.index}`
              : completed
                ? `${entry.level.durationMin} min · Replay`
                : `${entry.level.durationMin} min`}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

export function ModeCampaignPath({
  maps,
  onSelect,
}: {
  maps: ClassMapEntry[];
  onSelect: (entry: ClassMapEntry) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const pathWidth = Math.min(windowWidth - spacing.lg * 2, 420);
  const height =
    PATH_PAD_TOP + Math.max(maps.length - 1, 0) * ROW_GAP + NODE_SIZE + PATH_PAD_BOTTOM;
  const centers = maps.map((_, index) => nodeCenter(index, pathWidth));

  return (
    <View style={[styles.pathRoot, { width: pathWidth, height }]}>
      {maps.slice(0, -1).map((entry, index) => {
        const next = maps[index + 1];
        // Light segments the player has already walked (from a completed node).
        const lit = entry.state === 'completed';
        return (
          <PathConnector
            key={`path-${entry.levelId}-${next.levelId}`}
            from={centers[index]}
            to={centers[index + 1]}
            lit={lit}
          />
        );
      })}

      {maps.map((entry, index) => (
        <PathNode
          key={entry.levelId}
          entry={entry}
          center={centers[index]}
          rosterLength={maps.length}
          onPress={
            entry.state === 'locked'
              ? undefined
              : () => onSelect(entry)
          }
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pathRoot: {
    alignSelf: 'center',
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  connector: {
    position: 'absolute',
    height: CONNECTOR_THICKNESS,
    borderRadius: radius.pill,
  },
  nodeWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  nodePress: {
    alignItems: 'center',
    width: NODE_SIZE + 24,
  },
  nodePressed: { opacity: 0.72 },
  currentHalo: {
    position: 'absolute',
    width: NODE_SIZE + 28,
    height: NODE_SIZE + 28,
    borderRadius: radius.pill,
    top: -14,
    overflow: 'hidden',
  },
  nodeRing: {
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: radius.pill,
    padding: 3,
    backgroundColor: colors.surface2,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  nodeRingCurrent: {
    borderColor: colors.lime,
    backgroundColor: 'rgba(215,255,62,0.16)',
  },
  nodeRingCompleted: {
    borderColor: 'rgba(215,255,62,0.35)',
  },
  nodeRingLocked: {
    borderColor: colors.border,
    opacity: 0.72,
  },
  nodeRingBlurred: {
    opacity: 0.55,
  },
  nodeFace: {
    flex: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  nodeFaceLocked: { opacity: 0.78 },
  nodeFaceBlurred: { opacity: 0.62 },
  nodeFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  nodeFallbackText: {
    color: colors.textDim,
    fontSize: 22,
    fontWeight: font.black,
  },
  nodeShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '45%',
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,6,10,0.62)',
  },
  completedBadge: {
    position: 'absolute',
    bottom: 4,
    alignSelf: 'center',
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
  },
  playBadge: {
    position: 'absolute',
    bottom: 4,
    alignSelf: 'center',
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
    paddingLeft: 2,
  },
  levelIndex: {
    marginTop: spacing.sm,
    color: colors.textDim,
    fontSize: 9,
    fontWeight: font.black,
    letterSpacing: 1.1,
  },
  levelIndexCurrent: { color: colors.lime },
  levelIndexLocked: { color: colors.textFaint },
  nodeTitle: {
    marginTop: 2,
    color: colors.text,
    fontSize: 13,
    fontWeight: font.bold,
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 2,
  },
  nodeTitleLocked: { color: colors.textDim },
  redactedTitleWrap: {
    marginTop: 6,
    alignItems: 'center',
    gap: 4,
  },
  redactBar: {
    height: 11,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(150,155,170,0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  redactBarWide: { width: 68 },
  redactBarNarrow: { width: 42 },
  nodeMeta: {
    marginTop: 3,
    color: colors.textDim,
    fontSize: 11,
    fontWeight: font.medium,
    textAlign: 'center',
  },
  nodeMetaLocked: { color: colors.textFaint },
  playNowChip: {
    marginTop: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  playNowText: {
    color: colors.black,
    fontSize: 9,
    fontWeight: font.black,
    letterSpacing: 0.6,
  },
});

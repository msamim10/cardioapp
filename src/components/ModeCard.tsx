import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { formatRunnerCount } from '@/lib/communityActivity';
import type { Mode } from '@/lib/gameData';
import { getModeCover } from '@/lib/modeCovers';
import { accentColor, accentGradient, colors, font, radius, spacing, type } from '@/theme';

export function ModeCard({
  mode,
  onPress,
  wide,
  locked = false,
  completed = false,
  cornerLabel,
  participantCount,
  showMeta = true,
  showAction = true,
  style,
}: {
  mode: Mode;
  onPress?: () => void;
  wide?: boolean;
  locked?: boolean;
  completed?: boolean;
  /** Optional artwork overlay supplied by the caller (for example, a featured label). */
  cornerLabel?: string;
  /** Optional simulated/live participant count shown on the artwork. */
  participantCount?: number;
  /** Show the duration row beneath the artwork. */
  showMeta?: boolean;
  /** Show the trailing play/lock/completion action icon. */
  showAction?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const cover = getModeCover(mode.id);
  const durationMin = mode.levels[0]?.durationMin;
  const participantLabel =
    participantCount === undefined ? undefined : `${formatRunnerCount(participantCount)} runners`;

  return (
    <Pressable
      onPress={locked ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={`${mode.name}${showMeta ? `, ${durationMin ?? 0} minute run` : ''}${participantLabel ? `, ${participantLabel}` : ''}${cornerLabel ? `, ${cornerLabel}` : ''}${locked ? ', locked' : ''}`}
      accessibilityState={{ disabled: locked }}
      style={({ pressed }) => [
        styles.card,
        wide && styles.cardWide,
        style,
        pressed && !locked && styles.pressed,
      ]}
    >
      <View style={styles.cardClip}>
        <LinearGradient
          colors={locked ? [colors.surface2, colors.surface] : accentGradient[mode.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.art}
        >
          {cover ? (
            <Image
              source={cover}
              contentFit="cover"
              transition={180}
              style={[StyleSheet.absoluteFill, locked && styles.coverLocked]}
            />
          ) : (
            <Ionicons
              name={mode.icon}
              size={40}
              color={locked ? colors.textFaint : colors.black}
              style={locked && styles.iconLocked}
            />
          )}
          <LinearGradient
            colors={['transparent', 'rgba(4,4,8,0.35)', 'rgba(4,4,8,0.96)']}
            locations={[0.28, 0.58, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.titleWrap, participantLabel && styles.titleWithParticipants]}>
            <Text style={styles.name} numberOfLines={2}>
              {mode.name}
            </Text>
          </View>
          {participantLabel ? (
            <View style={styles.participantPill}>
              <Ionicons name="people" size={11} color={colors.textDim} />
              <Text style={styles.participantText}>{participantLabel}</Text>
            </View>
          ) : null}
          {locked ? (
            <View style={[styles.badge, cornerLabel && styles.badgeWithCornerLabel]}>
              <Ionicons name="lock-closed" size={14} color={colors.text} />
            </View>
          ) : completed ? (
            <View
              style={[styles.badge, styles.badgeDone, cornerLabel && styles.badgeWithCornerLabel]}
            >
              <Ionicons name="checkmark" size={15} color={colors.black} />
            </View>
          ) : null}
        </LinearGradient>
        {showMeta || showAction ? (
          <View style={styles.body}>
            {showMeta ? (
              <>
                <View style={[styles.accentDot, { backgroundColor: accentColor[mode.accent] }]} />
                <Text style={styles.meta}>{durationMin ? `${durationMin} MIN RUN` : 'RUN'}</Text>
              </>
            ) : null}
            {showAction ? (
              <>
                <View style={styles.metaSpacer} />
                <Ionicons
                  name={locked ? 'lock-closed' : completed ? 'checkmark-circle' : 'play-circle'}
                  size={17}
                  color={locked ? colors.textFaint : accentColor[mode.accent]}
                />
              </>
            ) : null}
          </View>
        ) : null}
      </View>
      {cornerLabel ? (
        <View style={styles.cornerLabel}>
          <Text style={styles.cornerLabelText}>{cornerLabel}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 168,
    overflow: 'visible',
  },
  cardClip: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardWide: {
    width: '100%',
  },
  art: {
    height: 142,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverLocked: {
    opacity: 0.45,
  },
  iconLocked: {
    opacity: 0.4,
  },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  badgeDone: {
    backgroundColor: colors.lime,
  },
  badgeWithCornerLabel: {
    left: 10,
    right: undefined,
  },
  cornerLabel: {
    position: 'absolute',
    top: -9,
    right: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.xs,
    backgroundColor: colors.lime,
  },
  cornerLabelText: {
    ...type.micro,
    color: colors.black,
    fontSize: 9,
  },
  titleWrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  titleWithParticipants: {
    bottom: 38,
  },
  name: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 19,
    fontWeight: font.heavy,
    letterSpacing: -0.35,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  participantPill: {
    position: 'absolute',
    left: 10,
    bottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(4,4,8,0.66)',
  },
  participantText: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: font.bold,
    letterSpacing: 0.3,
  },
  body: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  accentDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
  },
  meta: {
    ...type.micro,
    color: colors.textDim,
    fontSize: 11,
  },
  metaSpacer: { flex: 1 },
  pressed: {
    opacity: 0.72,
  },
});

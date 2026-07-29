import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CLASS_META, type ClassKey } from '@/lib/progression';
import { cardSurface, colors, font, radius, spacing } from '@/theme';

const MODE_ICONS = {
  beginner: 'walk',
  intermediate: 'fitness',
  hard: 'flash',
} as const satisfies Record<ClassKey, keyof typeof Ionicons.glyphMap>;

type ModeCardVariant = 'compact' | 'full';
type ModeCardTone = 'default' | 'surface';
type ModeIconTone = 'default' | 'lime';
type ModeCardLayout = 'default' | 'centered';

export function ModeEmblem({
  classKey,
  size = 'medium',
  selected = false,
  iconTone = 'default',
}: {
  classKey: ClassKey;
  size?: 'small' | 'medium' | 'large';
  selected?: boolean;
  iconTone?: ModeIconTone;
}) {
  const dimensions = size === 'large' ? 66 : size === 'small' ? 48 : 56;
  const iconSize = size === 'large' ? 30 : size === 'small' ? 24 : 26;
  const limeIcon = iconTone === 'lime';

  return (
    <View
      style={[
        styles.emblemOuter,
        { width: dimensions, height: dimensions },
        limeIcon && styles.emblemOuterSurface,
        selected && styles.emblemOuterSelected,
      ]}
    >
      <LinearGradient
        colors={
          selected
            ? ['rgba(198,255,61,0.22)', 'rgba(198,255,61,0.07)']
            : limeIcon
              ? [colors.surface, colors.surface]
            : ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.025)']
        }
        style={styles.emblemInner}
      >
        <Ionicons
          name={MODE_ICONS[classKey]}
          size={iconSize}
          color={selected || limeIcon ? colors.lime : colors.text}
        />
      </LinearGradient>
    </View>
  );
}

export function ModeClassCard({
  classKey,
  variant = 'compact',
  tone = 'default',
  iconTone = 'default',
  layout = 'default',
  showMeta = true,
  selected = false,
  onPress,
  mapCount,
  accessibilityHint,
}: {
  classKey: ClassKey;
  variant?: ModeCardVariant;
  tone?: ModeCardTone;
  iconTone?: ModeIconTone;
  layout?: ModeCardLayout;
  showMeta?: boolean;
  selected?: boolean;
  onPress: () => void;
  mapCount?: number;
  accessibilityHint?: string;
}) {
  const meta = CLASS_META[classKey];
  const full = variant === 'full';
  const surface = tone === 'surface';
  const centered = layout === 'centered';
  const detail = `${meta.speedFactor.toFixed(1)}x · ${meta.target}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label} mode${showMeta ? `, ${detail}` : ''}${mapCount == null ? '' : `, ${mapCount} maps`}`}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.card,
        full ? styles.cardFull : styles.cardCompact,
        centered && styles.cardCentered,
        selected && styles.cardSelected,
        pressed && styles.pressed,
      ]}
    >
      {surface && !selected ? null : (
        <LinearGradient
          colors={
            selected
              ? ['rgba(198,255,61,0.08)', 'rgba(22,22,31,0.98)']
              : ['rgba(255,255,255,0.035)', 'rgba(22,22,31,0.98)']
          }
          style={StyleSheet.absoluteFill}
        />
      )}
      {selected ? (
        <View style={styles.check}>
          <Ionicons name="checkmark" size={12} color={colors.black} />
        </View>
      ) : null}
      <ModeEmblem
        classKey={classKey}
        size={centered ? 'large' : full ? 'medium' : 'small'}
        selected={selected}
        iconTone={iconTone}
      />
      <View style={[styles.copy, centered && styles.copyCentered]}>
        <Text
          style={[styles.label, full && styles.labelFull, centered && styles.textCentered]}
          numberOfLines={1}
        >
          {meta.label}
        </Text>
        {showMeta ? (
          <Text style={[styles.detail, centered && styles.textCentered]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  emblemOuter: {
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  emblemOuterSelected: {
    backgroundColor: 'rgba(198,255,61,0.06)',
    borderColor: 'rgba(198,255,61,0.36)',
  },
  emblemOuterSurface: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  emblemInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  card: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    overflow: 'hidden',
    ...cardSurface,
  },
  cardCompact: {
    height: 124,
    padding: spacing.sm,
  },
  cardFull: {
    height: 132,
    padding: spacing.md,
  },
  cardCentered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  cardSelected: {
    borderColor: colors.lime,
    shadowColor: colors.lime,
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  check: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  copy: { alignSelf: 'stretch' },
  copyCentered: { alignItems: 'center' },
  textCentered: { textAlign: 'center' },
  label: {
    color: colors.text,
    fontSize: 12,
    fontWeight: font.black,
    letterSpacing: -0.2,
  },
  labelFull: { fontSize: 13 },
  detail: {
    color: colors.textDim,
    fontSize: 9,
    fontWeight: font.semibold,
    marginTop: 3,
  },
  pressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
});

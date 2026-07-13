import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Mode } from '@/lib/gameData';
import { accentGradient, colors, font, radius, spacing } from '@/theme';

export function ModeCard({
  mode,
  onPress,
  wide,
}: {
  mode: Mode;
  onPress?: () => void;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={mode.locked ? undefined : onPress}
      style={({ pressed }) => [
        styles.card,
        wide && styles.cardWide,
        pressed && !mode.locked && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={mode.locked ? [colors.surface2, colors.surface] : accentGradient[mode.accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.art}
      >
        <Text style={styles.emoji}>{mode.emoji}</Text>
        {mode.locked ? (
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={14} color={colors.text} />
          </View>
        ) : null}
      </LinearGradient>
      <View style={styles.body}>
        <Text style={styles.name}>{mode.name}</Text>
        <Text style={styles.tagline} numberOfLines={1}>
          {mode.locked ? 'Locked · keep your streak' : mode.tagline}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 168,
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
    height: 104,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 44,
  },
  lockBadge: {
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
  body: {
    padding: spacing.md,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: font.bold,
  },
  tagline: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 2,
    fontWeight: font.medium,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
});

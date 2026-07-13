import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { AccentKey, accentColor, accentGradient, colors, font, radius, spacing } from '@/theme';

export function ScreenTitle({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.screenTitle}>{title}</Text>
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function StatChip({
  icon,
  label,
  accent = 'lime',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accent?: AccentKey;
}) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={16} color={accentColor[accent]} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

export function GradientButton({
  label,
  icon,
  accent = 'lime',
  onPress,
  style,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  accent?: AccentKey;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [style, pressed && styles.pressed]}>
      <LinearGradient
        colors={accentGradient[accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientBtn}
      >
        {icon ? <Ionicons name={icon} size={20} color={colors.black} /> : null}
        <Text style={styles.gradientBtnText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function GhostButton({
  label,
  icon,
  onPress,
  style,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ghostBtn, style, pressed && styles.pressed]}
    >
      {icon ? <Ionicons name={icon} size={18} color={colors.text} /> : null}
      <Text style={styles.ghostBtnText}>{label}</Text>
    </Pressable>
  );
}

export function ProgressBar({ value, accent = 'lime' }: { value: number; accent?: AccentKey }) {
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          { width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: accentColor[accent] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: font.semibold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  screenTitle: {
    color: colors.text,
    fontSize: 30,
    fontWeight: font.black,
    letterSpacing: -0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: font.bold,
    letterSpacing: -0.3,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: font.bold,
  },
  gradientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: radius.pill,
  },
  gradientBtnText: {
    color: colors.black,
    fontSize: 16,
    fontWeight: font.black,
    letterSpacing: 0.2,
  },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  ghostBtnText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: font.bold,
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});

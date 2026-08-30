import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import { useOnboarding } from '@/lib/OnboardingContext';
import { attributionOptions, onboardingProgress, type AttributionKey } from '@/lib/onboarding';
import { colors, font, radius, spacing } from '@/theme';

const CHANNEL_STYLE: Record<AttributionKey, { color: string; background: string }> = {
  instagram: { color: '#E4405F', background: 'rgba(228,64,95,0.13)' },
  tiktok: { color: '#FFFFFF', background: 'rgba(37,244,238,0.11)' },
  twitter: { color: '#FFFFFF', background: 'rgba(255,255,255,0.08)' },
  appstore: { color: '#0D96F6', background: 'rgba(13,150,246,0.13)' },
  friends: { color: colors.lime, background: 'rgba(215,255,62,0.10)' },
  other: { color: colors.textDim, background: 'rgba(155,161,166,0.09)' },
};

export default function AttributionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers, setAnswer } = useOnboarding();

  const selected = answers.attribution;

  return (
    <View style={styles.root}>
      <OnboardingTopBar progress={onboardingProgress('attribution')} topInset={insets.top} onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Where did you hear about us?</Text>

        <View style={styles.list}>
          {attributionOptions.map((o) => {
            const active = selected === o.key;
            const channelStyle = CHANNEL_STYLE[o.key];
            return (
              <Pressable
                key={o.key}
                onPress={() => setAnswer('attribution', o.key)}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={o.label}
                style={({ pressed }) => [
                  styles.row,
                  active && styles.rowActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.rowLead, { backgroundColor: channelStyle.background }]}>
                  <Ionicons name={o.icon} size={23} color={channelStyle.color} />
                </View>
                <Text style={styles.rowLabel}>{o.label}</Text>
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active ? <Ionicons name="checkmark" size={14} color={colors.black} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <GradientButton
          label="CONTINUE"
          accent="lime"
          onPress={selected ? () => router.push('/(onboarding)/questions') : undefined}
          style={!selected ? styles.disabled : undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  title: { color: colors.text, fontSize: 30, fontWeight: font.black, letterSpacing: -0.6, lineHeight: 36 },
  list: { gap: spacing.md, marginTop: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  rowActive: { borderColor: colors.lime, backgroundColor: colors.surface2 },
  rowLead: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, color: colors.text, fontSize: 16, fontWeight: font.bold },
  radio: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { backgroundColor: colors.lime, borderColor: colors.lime },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});

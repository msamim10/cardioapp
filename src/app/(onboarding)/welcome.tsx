import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/ui';
import { WelcomeWalkingHero } from '@/components/WelcomeWalkingHero';
import { logOnboardingStart } from '@/lib/analytics';
import { colors, font, spacing, type } from '@/theme';

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Top of the acquisition funnel: entering the welcome screen = onboarding start.
  useEffect(() => {
    logOnboardingStart();
  }, []);
  const { height } = useWindowDimensions();
  const usableHeight = height - insets.top - insets.bottom;
  const heroHeight = Math.min(320, Math.max(220, Math.round(usableHeight * 0.34)));
  const foxVerticalOffset = Math.min(32, Math.max(24, Math.round(usableHeight * 0.038)));
  const copyTopSpacing = Math.min(30, Math.max(18, Math.round(usableHeight * 0.032)));
  const groupTopInset = Math.min(34, Math.max(18, Math.round(usableHeight * 0.038)));

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom + spacing.md,
        },
      ]}
    >
      <View
        accessibilityLabel="CardioSurf"
        accessibilityRole="header"
        pointerEvents="none"
        style={styles.wordmark}
      >
        <Text style={styles.wordmarkText}>CardioSurf</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: groupTopInset }]}
        showsVerticalScrollIndicator={false}
      >
        <WelcomeWalkingHero height={heroHeight} verticalOffset={foxVerticalOffset} />

        <View style={styles.content}>
          <View style={[styles.copy, { paddingTop: copyTopSpacing }]}>
            <Text style={styles.eyebrow}>Full-body cardio</Text>
            <Text style={styles.title}>Run into another world</Text>
            <Text style={styles.subtitle}>
              Real cardio, built like a game. Your camera reads every jump, duck and dodge — no
              treadmill, no equipment.
            </Text>
          </View>

          <View style={styles.footer}>
            <GradientButton
              label="Start training"
              accent="lime"
              onPress={() => router.push('/(onboarding)/attribution')}
              style={styles.primaryButton}
            />
            <View style={styles.signInRow}>
              <Text style={styles.accountPrompt}>Already have an account?</Text>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Sign in to an existing account"
                hitSlop={8}
                onPress={() => router.push('/(onboarding)/signin')}
                style={({ pressed }) => [styles.signInLink, pressed && styles.pressed]}
              >
                <Text style={styles.signInText}>Sign in</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgElevated,
  },
  wordmark: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  wordmarkText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: font.heavy,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  copy: {
    flex: 1,
    width: '100%',
    maxWidth: 540,
    alignItems: 'center',
    paddingBottom: spacing.lg,
  },
  eyebrow: {
    ...type.label,
    color: colors.lime,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  title: {
    ...type.display,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    ...type.body,
    color: colors.textDim,
    marginTop: spacing.md,
    maxWidth: 400,
    textAlign: 'center',
  },
  footer: {
    width: '100%',
    maxWidth: 540,
    alignItems: 'center',
    gap: spacing.sm,
  },
  primaryButton: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
  },
  signInRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
  },
  accountPrompt: {
    color: colors.textDim,
    fontSize: 14,
    fontWeight: font.medium,
  },
  signInLink: {
    minHeight: 36,
    justifyContent: 'center',
  },
  signInText: {
    color: colors.lime,
    fontSize: 14,
    fontWeight: font.bold,
  },
  pressed: {
    opacity: 0.7,
  },
});

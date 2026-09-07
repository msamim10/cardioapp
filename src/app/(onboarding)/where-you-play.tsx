import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TvConnectionCard, TvSetupGuide } from '@/components/TvSetupGuide';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import { onboardingProgress } from '@/lib/onboarding';
import {
  DEFAULT_PLAY_SCREEN,
  loadPlaySetup,
  type PlayScreen,
  savePlayScreen,
} from '@/lib/playSetup';
import { colors, font, radius, spacing, type } from '@/theme';

type ScreenOption = {
  key: PlayScreen;
  title: string;
  tagline: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: string;
};

const OPTIONS: ScreenOption[] = [
  {
    key: 'tv',
    title: 'On your TV',
    tagline: 'Full-size map, phone as the camera.',
    detail:
      'Mirror your phone to the TV. Bigger picture, further back from the phone, better tracking.',
    icon: 'tv',
    badge: 'Recommended',
  },
  {
    key: 'phone',
    title: 'On your phone',
    tagline: 'Prop it up and go.',
    detail: 'Works anywhere with a stand or a shelf at chest height.',
    icon: 'phone-portrait',
  },
];

export default function WhereYouPlayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [choice, setChoice] = useState<PlayScreen>(DEFAULT_PLAY_SCREEN);
  const [guideOpen, setGuideOpen] = useState(false);
  // User-confirmed only. Screen mirroring is not observable from JS in a
  // managed build, so this never claims to have detected the TV itself.
  const [tvConfirmed, setTvConfirmed] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadPlaySetup().then((setup) => {
      if (mounted && setup.screen) setChoice(setup.screen);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const select = (next: PlayScreen) => {
    setChoice(next);
    void savePlayScreen(next);
  };

  const onContinue = () => {
    void savePlayScreen(choice);
    router.push('/(onboarding)/pick-first-run' as Href);
  };

  return (
    <View style={styles.root}>
      <OnboardingTopBar
        progress={onboardingProgress('where-you-play')}
        topInset={insets.top}
        onBack={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Setup</Text>
        <Text style={styles.title}>Where will you play?</Text>
        <Text style={styles.sub}>
          The phone camera reads your body either way. This only changes where the run is
          shown.
        </Text>

        <View style={styles.stack}>
          {OPTIONS.map((option) => {
            const selected = option.key === choice;
            const primary = option.key === 'tv';
            return (
              <Pressable
                key={option.key}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option.title}. ${option.tagline}`}
                onPress={() => select(option.key)}
                style={({ pressed }) => [
                  styles.option,
                  primary && styles.optionPrimary,
                  selected && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.optionIcon, selected && styles.optionIconSelected]}>
                  <Ionicons
                    name={option.icon}
                    size={primary ? 30 : 24}
                    color={selected ? colors.black : colors.text}
                  />
                </View>
                <View style={styles.optionText}>
                  <View style={styles.optionHead}>
                    <Text style={[styles.optionTitle, primary && styles.optionTitlePrimary]}>
                      {option.title}
                    </Text>
                    {option.badge ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{option.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.optionTagline}>{option.tagline}</Text>
                  <Text style={styles.optionDetail}>{option.detail}</Text>
                </View>
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected ? <Ionicons name="checkmark" size={14} color={colors.black} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {choice === 'tv' ? (
          <View style={styles.connectionWrap}>
            <TvConnectionCard
              state={tvConfirmed ? 'confirmed' : 'waiting'}
              onConfirm={() => setTvConfirmed(true)}
              onHelp={() => setGuideOpen(true)}
              onUsePhone={() => select('phone')}
            />
          </View>
        ) : (
          <Pressable
            onPress={() => setGuideOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.helpRow, pressed && styles.pressed]}
          >
            <Ionicons name="help-circle-outline" size={18} color={colors.lime} />
            <Text style={styles.helpText}>Having trouble connecting to a TV?</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.footnote}>
          {choice === 'tv' && !tvConfirmed
            ? 'Not set up yet? Continue anyway and connect before your run.'
            : 'You can switch any time from the run screen.'}
        </Text>
        <GradientButton label="CONTINUE" accent="lime" onPress={onContinue} />
      </View>

      <TvSetupGuide visible={guideOpen} onClose={() => setGuideOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  eyebrow: { ...type.label, color: colors.lime, marginBottom: 8 },
  title: { ...type.h1, color: colors.text },
  sub: { ...type.body, color: colors.textDim, marginTop: spacing.sm },
  stack: { gap: spacing.md, marginTop: spacing.xl },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionPrimary: {
    paddingVertical: spacing.xl,
    backgroundColor: colors.surface2,
  },
  optionSelected: { borderColor: colors.lime },
  optionIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
  },
  optionIconSelected: { backgroundColor: colors.lime },
  optionText: { flex: 1, gap: 3 },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  optionTitle: { ...type.h3, color: colors.text },
  optionTitlePrimary: { ...type.h2, color: colors.text },
  optionTagline: { ...type.body, color: colors.text, fontWeight: font.semibold },
  optionDetail: { ...type.bodySm, color: colors.textDim },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(215,255,62,0.14)',
  },
  badgeText: { ...type.micro, color: colors.lime },
  radio: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { backgroundColor: colors.lime, borderColor: colors.lime },
  connectionWrap: { marginTop: spacing.xl },
  helpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.xl,
    paddingVertical: spacing.sm,
  },
  helpText: { color: colors.lime, fontSize: 14, fontWeight: font.bold },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footnote: { ...type.bodySm, color: colors.textFaint, textAlign: 'center' },
  pressed: { opacity: 0.8 },
});

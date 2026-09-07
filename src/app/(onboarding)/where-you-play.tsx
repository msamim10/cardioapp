import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AirPlayConnectBox } from '@/components/AirPlayConnectBox';
import { TvSetupGuide } from '@/components/TvSetupGuide';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import { useExternalDisplay } from '@/lib/externalDisplay';
import { onboardingProgress } from '@/lib/onboarding';
import {
  DEFAULT_PLAY_SCREEN,
  loadPlaySetup,
  type PlayScreen,
  savePlayScreen,
} from '@/lib/playSetup';
import { colors, font, layout, radius, spacing, type } from '@/theme';

type ScreenOption = {
  key: PlayScreen;
  title: string;
  tagline: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: string;
};

const OPTIONS: ScreenOption[] = [
  {
    key: 'tv',
    title: 'On your TV',
    tagline: 'Full-size map. Phone stays the camera.',
    icon: 'tv',
    badge: 'Recommended',
  },
  {
    key: 'phone',
    title: 'On your phone',
    tagline: 'Prop it up at chest height and go.',
    icon: 'phone-portrait',
  },
];

/**
 * "Where will you play?"
 *
 * Two selectable cards and nothing else that looks like one. Choosing the TV
 * expands that card with the setup steps inline: the native AirPlay picker box
 * (whose text doubles as the connection status), the Control Center route and
 * the help link. Continue stays disabled until the TV is actually detected by
 * either path, AirPlay route or screen mirroring (or, where detection is
 * unsupported, until the user explicitly confirms), with a secondary link to
 * fall back to the phone so nobody is ever stuck here.
 */
export default function WhereYouPlayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [choice, setChoice] = useState<PlayScreen>(DEFAULT_PLAY_SCREEN);
  const [guideOpen, setGuideOpen] = useState(false);
  // Real detection on iOS native builds (UIScreen connect/disconnect plus
  // AVAudioSession AirPlay route changes, via the local external-display
  // module). Where unsupported (Expo Go, Android, web)
  // we fall back to the user's own confirmation and never claim to have
  // detected the TV ourselves. One hook instance feeds both this screen and
  // the guide sheet, so a connection made while the sheet is open is reflected
  // here the moment it closes.
  const display = useExternalDisplay();
  const [tvConfirmed, setTvConfirmed] = useState(false);
  const tvReady = display.supported ? display.connected : tvConfirmed;
  const canContinue = choice === 'phone' || tvReady;

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
    if (!canContinue) return;
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
        contentContainerStyle={[styles.content, { paddingBottom: layout.scrollAboveFooter }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Setup</Text>
        <Text style={styles.title}>Where will you play?</Text>
        <Text style={styles.sub}>
          The phone camera reads your body either way. This only changes where the run is
          shown.
        </Text>

        <View style={styles.stack} accessibilityRole="radiogroup">
          {OPTIONS.map((option) => {
            const selected = option.key === choice;
            const primary = option.key === 'tv';
            const expanded = primary && selected;
            return (
              <View
                key={option.key}
                style={[
                  styles.option,
                  primary && styles.optionPrimary,
                  selected && styles.optionSelected,
                ]}
              >
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${option.title}. ${option.tagline}`}
                  onPress={() => select(option.key)}
                  style={({ pressed }) => [styles.optionRow, pressed && styles.pressed]}
                >
                  <View style={[styles.optionIcon, selected && styles.optionIconSelected]}>
                    <Ionicons
                      name={option.icon}
                      size={primary ? 28 : 24}
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
                  </View>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? (
                      <Ionicons name="checkmark" size={14} color={colors.black} />
                    ) : null}
                  </View>
                </Pressable>

                {expanded ? (
                  <View style={styles.setup}>
                    <View style={styles.divider} />

                    <Text style={styles.setupLabel}>Connect your TV</Text>
                    <AirPlayConnectBox
                      connected={tvReady}
                      deviceName={display.airPlayDeviceName}
                    />
                    <Text style={styles.setupHint}>
                      Or open Control Center → Screen Mirroring → choose your TV.
                    </Text>

                    {!display.supported && !tvReady ? (
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: tvConfirmed }}
                        accessibilityLabel="My TV is showing this screen"
                        onPress={() => setTvConfirmed((v) => !v)}
                        hitSlop={6}
                        style={({ pressed }) => [styles.confirmRow, pressed && styles.pressed]}
                      >
                        <View style={[styles.checkbox, tvConfirmed && styles.checkboxOn]}>
                          {tvConfirmed ? (
                            <Ionicons name="checkmark" size={14} color={colors.black} />
                          ) : null}
                        </View>
                        <Text style={styles.confirmText}>My TV is showing this screen</Text>
                      </Pressable>
                    ) : null}

                    <Pressable
                      onPress={() => setGuideOpen(true)}
                      hitSlop={8}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.helpRow, pressed && styles.pressed]}
                    >
                      <Ionicons name="help-circle-outline" size={16} color={colors.lime} />
                      <Text style={styles.helpText}>Having trouble?</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: layout.footerBottom(insets.bottom) }]}>
        <Text style={styles.footnote}>
          {choice === 'tv' && !tvReady
            ? 'Continue unlocks once your TV is connected.'
            : 'You can switch any time from the run screen.'}
        </Text>
        <GradientButton
          label="CONTINUE"
          accent="lime"
          onPress={canContinue ? onContinue : undefined}
          style={!canContinue ? styles.disabled : undefined}
        />
        {choice === 'tv' && !tvReady ? (
          <Pressable
            onPress={() => select('phone')}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.altRow, pressed && styles.pressed]}
          >
            <Text style={styles.altText}>Continue with phone instead</Text>
          </Pressable>
        ) : null}
      </View>

      <TvSetupGuide
        visible={guideOpen}
        onClose={() => setGuideOpen(false)}
        detection={display}
      />
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
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  optionPrimary: { backgroundColor: colors.surface2 },
  optionSelected: { borderColor: colors.lime },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
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
  optionTagline: { ...type.bodySm, color: colors.textDim },
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

  // Inline TV setup, inside the selected card. Deliberately no inner boxes:
  // one divider, then rows, so nothing reads as a third option.
  setup: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  setupLabel: { ...type.label, color: colors.textDim, marginBottom: spacing.xs },
  setupHint: { ...type.bodySm, color: colors.textDim },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.lime, borderColor: colors.lime },
  confirmText: { ...type.body, color: colors.text, fontWeight: font.semibold },
  helpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
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
  altRow: { alignSelf: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.lg },
  altText: { color: colors.textDim, fontSize: 14, fontWeight: font.bold },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});

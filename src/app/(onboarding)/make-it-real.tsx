import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import { getMode } from '@/lib/gameData';
import { getModeCover } from '@/lib/modeCovers';
import { goalOptions, onboardingProgress } from '@/lib/onboarding';
import { useOnboarding } from '@/lib/OnboardingContext';
import { recommendFirstRuns } from '@/lib/onboardingPlan';
import {
  DEFAULT_PLAY_SCREEN,
  describePlayScreen,
  INTENSITY_META,
  loadPlaySetup,
  type PlaySetup,
  resolveRunSettings,
  saveFirstRunLevel,
  saveRunSettings,
  type RunSettings,
} from '@/lib/playSetup';
import { colors, font, metric, radius, spacing, type } from '@/theme';

/**
 * "Let's make it real": the recap between the plan readout and calibration. It
 * restates the concrete choices the user just made (map, screen, intensity,
 * duration, goal) so the calibration that follows feels like setting up THEIR
 * run rather than a generic permission step.
 */
export default function MakeItRealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers, setCheckpoint } = useOnboarding();
  const [setup, setSetup] = useState<PlaySetup | null>(null);

  useEffect(() => {
    setCheckpoint('make-it-real');
  }, [setCheckpoint]);

  const fallbackLevelId = useMemo(
    () => recommendFirstRuns(answers)[0]?.levelId ?? null,
    [answers],
  );

  useEffect(() => {
    let mounted = true;
    loadPlaySetup().then((loaded) => {
      if (!mounted) return;
      // A resumed install may have skipped the picker; lock in the lead
      // recommendation so the rest of the ceremony has a map to talk about.
      if (!loaded.firstRunLevelId && fallbackLevelId) {
        void saveFirstRunLevel(fallbackLevelId);
        loaded = { ...loaded, firstRunLevelId: fallbackLevelId };
      }
      if (!loaded.runSettings) {
        const defaults = resolveRunSettings(loaded, answers);
        void saveRunSettings(defaults);
        loaded = { ...loaded, runSettings: defaults };
      }
      setSetup(loaded);
    });
    return () => {
      mounted = false;
    };
  }, [answers, fallbackLevelId]);

  const levelId = setup?.firstRunLevelId ?? fallbackLevelId;
  const mode = getMode(levelId ?? undefined);
  const level = mode?.levels[0];
  const cover = mode ? getModeCover(mode.id) : undefined;
  const screen = setup?.screen ?? DEFAULT_PLAY_SCREEN;
  const settings: RunSettings = setup?.runSettings ?? resolveRunSettings(setup, answers);
  const intensity = INTENSITY_META[settings.intensity];
  const goal = goalOptions.find((o) => o.key === answers.goal);

  const onCalibrate = () => {
    if (!level) return;
    router.push({
      pathname: '/preflight',
      params: {
        level: level.id,
        name: level.name,
        speed: String(intensity.playbackRate),
        duration: String(settings.durationMin),
        intensity: settings.intensity,
        firstRun: '1',
      },
    });
  };

  return (
    <View style={styles.root}>
      <OnboardingTopBar progress={onboardingProgress('make-it-real')} topInset={insets.top} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Almost there</Text>
        <Text style={styles.title}>Let&apos;s make it real</Text>
        <Text style={styles.sub}>
          Your first session, exactly as you set it. One quick camera calibration and
          it&apos;s ready to start.
        </Text>

        <View style={styles.mapCard}>
          {cover ? (
            <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface2 }]} />
          )}
          <LinearGradient
            colors={['rgba(8,9,10,0.05)', 'rgba(8,9,10,0.55)', 'rgba(8,9,10,0.95)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.mapPill}>
            <Ionicons name="flag" size={12} color={colors.black} />
            <Text style={styles.mapPillText}>First run</Text>
          </View>
          <View style={styles.mapText}>
            <Text style={styles.mapName}>{mode?.name ?? 'Your first map'}</Text>
            {mode ? <Text style={styles.mapTagline}>{mode.tagline}</Text> : null}
          </View>
        </View>

        <View style={styles.grid}>
          <RecapCell
            icon={screen === 'tv' ? 'tv' : 'phone-portrait'}
            label="Screen"
            value={describePlayScreen(screen)}
          />
          <RecapCell icon={intensity.icon} label="Intensity" value={intensity.label} />
          <RecapCell icon="timer-outline" label="Duration" value={`${settings.durationMin} min`} />
          <RecapCell
            icon="trophy-outline"
            label="Goal"
            value={goal?.label ?? 'Move more'}
          />
        </View>

        {answers.daysPerWeek ? (
          <View style={styles.cadence}>
            <Ionicons name="calendar-outline" size={16} color={colors.lime} />
            <Text style={styles.cadenceText}>
              <Text style={styles.cadenceStrong}>{answers.daysPerWeek} sessions a week.</Text>{' '}
              This one counts as the first.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.headsUp}>
          <Ionicons name="camera-outline" size={14} color={colors.lime} />
          <Text style={styles.headsUpText}>
            Next: a 20-second camera calibration. Processed on-device, never recorded.
          </Text>
        </View>
        <GradientButton
          label="Calibrate my camera"
          icon="scan-outline"
          accent="lime"
          onPress={level ? onCalibrate : undefined}
          style={!level ? styles.disabled : undefined}
        />
      </View>
    </View>
  );
}

function RecapCell({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.cell} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={styles.cellIcon}>
        <Ionicons name={icon} size={17} color={colors.lime} />
      </View>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.lg },
  eyebrow: { ...type.label, color: colors.lime },
  title: { ...type.h1, color: colors.text, marginTop: -spacing.sm },
  sub: { ...type.body, color: colors.textDim, marginTop: -spacing.sm },
  mapCard: {
    height: 200,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  mapPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  mapPillText: { ...type.micro, color: colors.black },
  mapText: { gap: 3 },
  mapName: { ...type.h2, color: colors.white, fontSize: 26, lineHeight: 30 },
  mapTagline: { ...type.bodySm, color: 'rgba(247,248,248,0.82)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: {
    width: '48%',
    flexGrow: 1,
    padding: spacing.md,
    gap: 6,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cellIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(215,255,62,0.1)',
    marginBottom: 2,
  },
  cellLabel: { ...type.micro, color: colors.textFaint },
  cellValue: { ...metric, color: colors.text, fontSize: 17, fontWeight: font.bold, letterSpacing: -0.2 },
  cadence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cadenceText: { ...type.bodySm, color: colors.textDim, flex: 1 },
  cadenceStrong: { color: colors.text, fontWeight: font.bold },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  headsUp: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  headsUpText: { ...type.bodySm, color: colors.textDim, textAlign: 'center', flexShrink: 1 },
  disabled: { opacity: 0.4 },
});

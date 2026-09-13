import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { VideoAirPlayButton } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RunSettingsSheet } from '@/components/RunSettingsSheet';
import { OptionCard, SectionHeader } from '@/components/ui';
import { hasBeatmap } from '@/lib/beatmapRegistry';
import { discoveryClassForMode } from '@/lib/dailyRecommendations';
import { displayHandle, fetchChallenge, type ChallengeCard } from '@/lib/leaderboards';
import { getMode, modes } from '@/lib/gameData';
import { getModeCover } from '@/lib/modeCovers';
import { useOnboarding } from '@/lib/OnboardingContext';
import {
  INTENSITY_META,
  loadPlaySetup,
  resolveRunSettings,
  savePlayScreen,
  saveRunSettings,
  type RunSettings,
} from '@/lib/playSetup';
import { useProgress } from '@/lib/ProgressContext';
import {
  caloriesForRun,
  CLASS_META,
  lockReasonCopy,
  parseOptionalClassKeyParam,
} from '@/lib/progression';
import { useSubscription } from '@/lib/SubscriptionContext';
import { canStartRun, requestSubscriptionAccess } from '@/lib/subscriptionAccess';
import { colors, font, metric, radius, spacing, type } from '@/theme';

const PREP_ITEMS: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
}[] = [
  { icon: 'resize-outline', title: 'Clear space', detail: 'Room to move on all sides.' },
  { icon: 'volume-high-outline', title: 'Sound on', detail: 'Audio cues call the moves.' },
  { icon: 'phone-portrait-outline', title: 'Screen placed', detail: 'Phone or TV in clear view.' },
  { icon: 'body-outline', title: 'In frame', detail: 'Full body visible to the camera.' },
];

type PlaybackDestination = 'phone' | 'tv';

export default function LevelDetailScreen() {
  const { id: idParam, classKey: classKeyParam, challenge: challengeParam } = useLocalSearchParams<{
    id: string | string[];
    classKey?: string | string[];
    challenge?: string | string[];
  }>();
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const challengeId = Array.isArray(challengeParam) ? challengeParam[0] : challengeParam;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mode = getMode(id);
  const { classData } = useProgress();
  const { answers } = useOnboarding();
  const { hydrated: subscriptionHydrated, isPremium, presentPaywall } = useSubscription();
  const [playbackDestination, setPlaybackDestination] = useState<PlaybackDestination>('phone');
  const [starting, setStarting] = useState(false);
  // Per-run settings: last-used from AsyncStorage, otherwise derived from the
  // onboarding baseline answer. Edited through the sheet, persisted on save.
  const [runSettings, setRunSettings] = useState<RunSettings>(() =>
    resolveRunSettings(null, answers),
  );
  const [editOpen, setEditOpen] = useState(false);
  // Beat-my-score deep link: `?challenge={runId}` → public `challenges/{runId}`.
  const [challenge, setChallenge] = useState<ChallengeCard | null>(null);

  useEffect(() => {
    if (!challengeId) {
      setChallenge(null);
      return undefined;
    }
    let mounted = true;
    fetchChallenge(challengeId).then((card) => {
      if (mounted) setChallenge(card && card.levelId === id ? card : null);
    });
    return () => {
      mounted = false;
    };
  }, [challengeId, id]);

  useEffect(() => {
    let mounted = true;
    loadPlaySetup().then((setup) => {
      if (!mounted) return;
      setRunSettings(resolveRunSettings(setup, answers));
      if (setup.screen) setPlaybackDestination(setup.screen);
    });
    return () => {
      mounted = false;
    };
    // Only the initial resolve should read answers; later edits are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const intensityMeta = INTENSITY_META[runSettings.intensity];
  const sessionLabel = useMemo(
    () => `${intensityMeta.label} · ${runSettings.durationMin} min`,
    [intensityMeta.label, runSettings.durationMin],
  );
  const campaignClass = parseOptionalClassKeyParam(classKeyParam);
  const displayClass =
    campaignClass ?? (id ? discoveryClassForMode(id, modes) : 'beginner');
  const inCampaignRoster = Boolean(
    campaignClass && id && classData(campaignClass).roster.includes(id)
  );
  // Campaign entry only: a node reached while gated (deep link, stale summary
  // CTA) explains the lock and cannot start. Casual entry never gates.
  const campaignEntry =
    campaignClass && id ? classData(campaignClass).maps.find((m) => m.levelId === id) ?? null : null;
  const campaignLock = campaignEntry?.state === 'locked' ? campaignEntry.lockReason : null;
  const lockCopy = campaignLock
    ? lockReasonCopy(campaignLock, (levelId) => getMode(levelId)?.name ?? 'the previous map')
    : null;

  if (!mode) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.missing}>Map not found</Text>
        <Pressable
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace('/(tabs)/levels')
          }
          style={styles.missingBack}
        >
          <Text style={styles.missingBackText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const level = mode.levels[0];
  const cover = getModeCover(mode.id);
  const classMeta = CLASS_META[displayClass];
  const calories = caloriesForRun(runSettings.durationMin, displayClass, intensityMeta.effort);

  // Intensity is the playback rate: the user's explicit choice replaces the
  // class speed factor, so a Light run is genuinely slower on any class.
  const preflightParams: Record<string, string> = {
    level: level.id,
    name: level.name,
    speed: String(intensityMeta.playbackRate),
    duration: String(runSettings.durationMin),
    intensity: runSettings.intensity,
    ...(campaignClass ? { classKey: campaignClass } : {}),
  };

  const saveEdits = (next: RunSettings) => {
    setRunSettings(next);
    setEditOpen(false);
    void saveRunSettings(next);
  };

  const goPreflight = () => {
    router.push({
      pathname: '/preflight',
      params: preflightParams,
    });
  };

  const onStart = async () => {
    if (!subscriptionHydrated || starting || campaignLock) return;

    if (canStartRun(isPremium)) {
      goPreflight();
      return;
    }

    setStarting(true);
    try {
      const outcome = await requestSubscriptionAccess(presentPaywall, router, {
        ifNeeded: false,
        preflightParams,
      });
      if (outcome === 'granted') {
        goPreflight();
      }
    } finally {
      setStarting(false);
    }
  };

  const onBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (campaignClass && inCampaignRoster) {
      router.replace({
        pathname: '/modes',
        params: { classKey: campaignClass },
      });
      return;
    }
    router.replace('/(tabs)/levels');
  };

  const continueLabel = 'CONTINUE';

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: insets.bottom + 108,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Level brief</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.hero}>
          {cover ? <Image source={cover} contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
          <LinearGradient
            colors={[
              'rgba(6,6,10,0.04)',
              'rgba(6,6,10,0.22)',
              'rgba(6,6,10,0.78)',
              'rgba(6,6,10,0.98)',
            ]}
            locations={[0.08, 0.42, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroText}>
            <Text style={styles.heroTitle}>{mode.name}</Text>
            <Text style={styles.heroSubtitle}>{mode.tagline}</Text>
            <View
              style={styles.heroSummaryRow}
              accessible
              accessibilityLabel={`${classMeta.label}, ${runSettings.durationMin} minutes, approximately ${calories} calories, ${intensityMeta.playbackRate.toFixed(2)} times speed`}
            >
              <HeroSummaryItem icon={classMeta.icon} value={classMeta.label} />
              <HeroSummaryItem icon="time-outline" value={`${runSettings.durationMin} min`} />
              <HeroSummaryItem icon="flame-outline" value={`~${calories} kcal`} />
              <HeroSummaryItem
                icon="speedometer-outline"
                value={`${intensityMeta.playbackRate.toFixed(2)}x`}
              />
            </View>
          </View>
        </View>

        {challenge ? (
          <Pressable
            onPress={() => router.push(`/leaderboard/${mode.id}` as Href)}
            accessibilityRole="button"
            accessibilityLabel={`Challenge from ${displayHandle(challenge)}: ${challenge.score.toLocaleString()} points at ${Math.round(challenge.accuracy * 100)} percent accuracy. Beat it. Opens the leaderboard.`}
            style={({ pressed }) => [styles.challengeBanner, pressed && styles.pressed]}
          >
            <Ionicons name="trophy" size={18} color={colors.black} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.challengeTitle} numberOfLines={1}>
                {displayHandle(challenge)} scored {challenge.score.toLocaleString()} · {Math.round(challenge.accuracy * 100)}%
              </Text>
              <Text style={styles.challengeDetail}>Beat it — finish this level to post your score.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.black} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => router.push(`/leaderboard/${mode.id}` as Href)}
          accessibilityRole="button"
          accessibilityLabel={hasBeatmap(mode.id) ? 'Open leaderboard' : 'Leaderboard. This level needs a beatmap before scores can be ranked.'}
          style={({ pressed }) => [styles.boardLink, pressed && styles.pressed]}
        >
          <Ionicons name="podium-outline" size={18} color={colors.lime} />
          <Text style={styles.boardLinkText}>Leaderboard</Text>
          <Text style={styles.boardLinkMeta}>{hasBeatmap(mode.id) ? 'Global · Friends' : 'Needs a beatmap'}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </Pressable>

        {lockCopy ? (
          <View
            style={styles.lockBanner}
            accessible
            accessibilityRole="summary"
            accessibilityLabel={`Locked on the ${classMeta.label} path. ${lockCopy}`}
          >
            <Ionicons name="lock-closed" size={18} color={colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={styles.lockTitle}>Locked on the {classMeta.label} path</Text>
              <Text style={styles.lockDetail}>{lockCopy}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader
            title="Your session"
            action={
              <Pressable
                onPress={() => setEditOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Edit intensity and duration. Currently ${sessionLabel}`}
                hitSlop={8}
                style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
              >
                <Ionicons name="options-outline" size={15} color={colors.lime} />
                <Text style={styles.editBtnText}>Edit</Text>
              </Pressable>
            }
          />
          <View style={styles.sessionCard}>
            <View style={styles.sessionCell}>
              <View style={styles.sessionIcon}>
                <Ionicons name={intensityMeta.icon} size={18} color={colors.lime} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sessionLabel}>Intensity</Text>
                <Text style={styles.sessionValue}>{intensityMeta.label}</Text>
                <Text style={styles.sessionDetail}>{intensityMeta.blurb}</Text>
              </View>
            </View>
            <View style={styles.sessionRule} />
            <View style={styles.sessionCell}>
              <View style={styles.sessionIcon}>
                <Ionicons name="timer-outline" size={18} color={colors.lime} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sessionLabel}>Duration</Text>
                <Text style={styles.sessionValue}>{runSettings.durationMin} min</Text>
                <Text style={styles.sessionDetail}>
                  {runSettings.durationMin > level.durationMin
                    ? 'The map loops until time is up.'
                    : 'Ends into your results on the clock.'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Get ready" />
          <View
            style={styles.prepRow}
            accessibilityRole="list"
            accessibilityLabel="Get ready reminders"
          >
            {PREP_ITEMS.map((item) => (
              <View
                key={item.title}
                style={styles.prepCard}
                accessible
                accessibilityRole="summary"
                accessibilityLabel={`${item.title}. ${item.detail}`}
              >
                <Ionicons name={item.icon} size={21} color={colors.lime} />
                <Text
                  style={styles.prepTitle}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  maxFontSizeMultiplier={1.2}
                >
                  {item.title}
                </Text>
                <Text
                  style={styles.prepDetail}
                  numberOfLines={3}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  maxFontSizeMultiplier={1.1}
                >
                  {item.detail}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {Platform.OS === 'ios' ? (
          <View style={styles.playDestinationGroup}>
            <SectionHeader title="Choose your screen" />
            <View style={styles.playDestinationOptions}>
              <OptionCard
                title="Phone"
                desc="Play on this device"
                icon="phone-portrait-outline"
                selected={playbackDestination === 'phone'}
                onPress={() => {
                  setPlaybackDestination('phone');
                  void savePlayScreen('phone');
                }}
              />
              <View
                style={styles.tvAirplayCardWrap}
                pointerEvents="box-none"
                accessibilityRole="radio"
                accessibilityLabel="TV or AirPlay"
                accessibilityHint="Opens the AirPlay picker to choose your display"
                accessibilityState={{ selected: playbackDestination === 'tv' }}
              >
                {/* Visual-only card — touches pass through to the native picker overlay. */}
                <View pointerEvents="none">
                  <OptionCard
                    title="TV / AirPlay"
                    desc="Stream to Apple TV or AirPlay display"
                    icon="tv-outline"
                    selected={playbackDestination === 'tv'}
                  />
                </View>
                {/* Invisible native route picker — transparent tint keeps icon hidden while opacity stays 1 for hit-testing. */}
                <VideoAirPlayButton
                  style={styles.tvAirplayOverlay}
                  tint="#00000000"
                  activeTint="#00000000"
                  prioritizeVideoDevices
                  onBeginPresentingRoutes={() => {
                    setPlaybackDestination('tv');
                    void savePlayScreen('tv');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Choose an AirPlay display"
                  accessibilityHint="Opens the system AirPlay route picker"
                />
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm },
        ]}
      >
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel="Next: quick camera setup and calibration"
          style={styles.setupHeadsUp}
        >
          <Ionicons name="camera-outline" size={15} color={colors.lime} />
          <Text style={styles.setupHeadsUpText}>Next: quick camera setup and calibration</Text>
        </View>
        <Pressable
          onPress={onStart}
          disabled={!subscriptionHydrated || starting || Boolean(campaignLock)}
          accessibilityRole="button"
          accessibilityLabel={
            campaignLock ? `Locked. ${lockCopy}` : `Continue to camera setup for ${mode.name}`
          }
          accessibilityState={{
            disabled: !subscriptionHydrated || starting || Boolean(campaignLock),
            busy: starting,
          }}
          style={({ pressed }) => [
            styles.beginButton,
            (!subscriptionHydrated || starting) && styles.beginDisabled,
            campaignLock && styles.beginLocked,
            pressed && styles.beginPressed,
          ]}
        >
          {!subscriptionHydrated || starting ? (
            <ActivityIndicator color={colors.black} />
          ) : (
            <Ionicons name={campaignLock ? 'lock-closed' : 'play'} size={20} color={colors.black} />
          )}
          <Text style={styles.beginButtonText}>{campaignLock ? 'LOCKED' : continueLabel}</Text>
        </Pressable>
      </View>

      <RunSettingsSheet
        visible={editOpen}
        value={runSettings}
        onClose={() => setEditOpen(false)}
        onSave={saveEdits}
      />
    </View>
  );
}

function HeroSummaryItem({
  icon,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
}) {
  return (
    <View style={styles.heroSummaryItem}>
      <Ionicons name={icon} size={15} color={colors.lime} />
      <Text style={styles.heroSummaryValue} maxFontSizeMultiplier={1.2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  missing: { color: colors.text, fontSize: 18, fontWeight: font.bold },
  missingBack: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  missingBackText: { color: colors.lime, fontSize: 14, fontWeight: font.bold },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  back: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: {
    ...type.label,
    flex: 1,
    color: colors.textDim,
    textAlign: 'center',
  },
  headerSpacer: { width: 42 },
  hero: {
    minHeight: 292,
    borderRadius: radius.xl,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroText: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + spacing.xl,
    paddingBottom: spacing.md,
  },
  heroTitle: {
    ...type.h1,
    color: colors.white,
    fontSize: 32,
    lineHeight: 35,
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    fontWeight: font.medium,
    marginTop: 4,
  },
  heroSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  heroSummaryItem: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(6,6,10,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroSummaryValue: {
    ...metric,
    color: colors.white,
    fontSize: 12,
    fontWeight: font.bold,
    letterSpacing: 0.3,
  },
  section: { gap: spacing.sm },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(215,255,62,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(215,255,62,0.3)',
  },
  editBtnText: { color: colors.lime, fontSize: 12, fontWeight: font.heavy, letterSpacing: 0.6 },
  sessionCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  sessionCell: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sessionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(215,255,62,0.1)',
  },
  sessionLabel: { ...type.micro, color: colors.textFaint },
  sessionValue: { ...type.h3, color: colors.text, marginTop: 2 },
  sessionDetail: { ...type.bodySm, color: colors.textDim },
  sessionRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  prepRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    gap: 6,
  },
  prepCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 124,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 5,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  prepTitle: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: font.bold,
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  prepDetail: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: font.medium,
    textAlign: 'center',
  },
  playDestinationGroup: { gap: spacing.sm },
  playDestinationOptions: { gap: spacing.sm },
  tvAirplayCardWrap: {
    position: 'relative',
  },
  tvAirplayOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  setupHeadsUp: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: spacing.sm,
  },
  setupHeadsUpText: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: font.semibold,
  },
  beginButton: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.button,
    backgroundColor: colors.lime,
  },
  beginButtonText: {
    ...type.action,
    color: colors.black,
  },
  beginDisabled: { opacity: 0.82 },
  beginLocked: { backgroundColor: colors.textFaint, opacity: 0.9 },
  beginPressed: { opacity: 0.72 },
  pressed: { opacity: 0.72 },
  lockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  lockTitle: { ...type.h3, color: colors.text },
  lockDetail: { ...type.bodySm, color: colors.textDim, marginTop: 2 },
  challengeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.lime,
  },
  challengeTitle: { ...type.h3, color: colors.black },
  challengeDetail: { ...type.bodySm, color: 'rgba(0,0,0,0.7)', marginTop: 2 },
  boardLink: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  boardLinkText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: font.bold },
  boardLinkMeta: { ...type.bodySm, color: colors.textFaint, fontSize: 12 },
});

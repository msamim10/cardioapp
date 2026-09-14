import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { recordBlockedReasonFor, RunSettingsSheet } from '@/components/RunSettingsSheet';
import { TopRunnersCard } from '@/components/TopRunnersCard';
import { logRunRecordingEnabled } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { refreshBeatmap } from '@/lib/beatmapRegistry';
import {
  checkCompositeAvailable,
  hasCachedCompositeAsset,
  prefetchCompositeAsset,
  type CompositeAvailability,
} from '@/lib/compositeAssetCache';
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
  saveRecordRun,
  saveRunSettings,
  type PlayScreen,
  type RunSettings,
} from '@/lib/playSetup';
import { useProgress } from '@/lib/ProgressContext';
import { isRunRecordingAvailable } from '@/lib/runRecording';
import {
  caloriesForRun,
  CLASS_META,
  lockReasonCopy,
  parseOptionalClassKeyParam,
} from '@/lib/progression';
import { useSubscription } from '@/lib/SubscriptionContext';
import { canStartRun, requestSubscriptionAccess } from '@/lib/subscriptionAccess';
import { colors, font, metric, radius, spacing, type } from '@/theme';

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
  const { classData, runs } = useProgress();
  const { answers } = useOnboarding();
  const { user } = useAuth();
  const { hydrated: subscriptionHydrated, isPremium, presentPaywall } = useSubscription();
  const [playbackDestination, setPlaybackDestination] = useState<PlayScreen>('phone');
  const [starting, setStarting] = useState(false);
  // Per-run settings: last-used from AsyncStorage, otherwise derived from the
  // onboarding baseline answer. Edited through the sheet, persisted on save.
  const [runSettings, setRunSettings] = useState<RunSettings>(() =>
    resolveRunSettings(null, answers),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Beat-my-score deep link: `?challenge={runId}` → public `challenges/{runId}`.
  const [challenge, setChallenge] = useState<ChallengeCard | null>(null);
  // Global rank for the user's best on this level (reported by the Top
  // runners card, which fetches the board); null while loading or unranked.
  const [myRank, setMyRank] = useState<number | null>(null);
  // "Record my runs": persisted opt-in (Settings / run settings sheet) and
  // whether this map's composite game asset (needed to build the clip) is
  // hosted and cached. See docs/RUN_RECORDING.md.
  const [cameraPermission] = useCameraPermissions();
  const [recordRun, setRecordRun] = useState(false);
  const [compositeState, setCompositeState] = useState<CompositeAvailability | 'checking'>('checking');
  const [compositeCached, setCompositeCached] = useState(false);

  // Opening a level refreshes its scoring data from the server (TTL-gated) so
  // the run that follows scores against the latest version without an update.
  useEffect(() => {
    if (id) void refreshBeatmap(id);
  }, [id]);

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

  const readPlaySetup = () => {
    void loadPlaySetup().then((setup) => {
      if (setup.screen) setPlaybackDestination(setup.screen);
      setRecordRun(setup.recordRun);
    });
  };

  useEffect(() => {
    let mounted = true;
    loadPlaySetup().then((setup) => {
      if (!mounted) return;
      setRunSettings(resolveRunSettings(setup, answers));
      if (setup.screen) setPlaybackDestination(setup.screen);
      setRecordRun(setup.recordRun);
    });
    return () => {
      mounted = false;
    };
    // Only the initial resolve should read answers; later edits are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Personal best on this level from local history; rank from the board.
  const personalBest = useMemo(() => {
    if (!id) return null;
    let best: number | null = null;
    for (const run of runs) {
      if (run.levelId !== id || run.poseScore <= 0) continue;
      best = best === null ? run.poseScore : Math.max(best, run.poseScore);
    }
    return best;
  }, [id, runs]);

  const uid = user?.id ?? null;

  // Recording needs the writer + composer (iOS native build, physical device),
  // the phone as the screen (v1 does not record AirPlay runs), camera access
  // and a hosted composite asset for this map.
  const recordingDeviceCapable = Platform.OS === 'ios' && Device.isDevice && isRunRecordingAvailable;
  const recordBlockers = {
    deviceCapable: recordingDeviceCapable,
    cameraDenied: cameraPermission?.granted === false,
    compositeState,
  };
  const recordBlockedReason = recordBlockedReasonFor(playbackDestination, recordBlockers);
  const recordEffective = recordRun && recordBlockedReason === null;

  useEffect(() => {
    if (!id || !recordingDeviceCapable) return undefined;
    let mounted = true;
    setCompositeCached(hasCachedCompositeAsset(id));
    setCompositeState('checking');
    checkCompositeAvailable(id).then((state) => {
      if (mounted) setCompositeState(state);
    });
    return () => {
      mounted = false;
    };
  }, [id, recordingDeviceCapable]);

  // Background prefetch as soon as recording is on and the asset is hosted;
  // the summary falls back to a foreground download if this never lands.
  useEffect(() => {
    if (!id || !recordEffective || compositeState !== 'available' || compositeCached) return undefined;
    let mounted = true;
    prefetchCompositeAsset(id).then((path) => {
      if (!mounted) return;
      if (path) setCompositeCached(true);
      else setCompositeState('unknown');
    });
    return () => {
      mounted = false;
    };
  }, [compositeCached, compositeState, id, recordEffective]);

  const onDestinationChange = (next: PlayScreen) => {
    setPlaybackDestination(next);
    void savePlayScreen(next);
  };

  const onRecordRunChange = (next: boolean) => {
    setRecordRun(next);
    void saveRecordRun(next);
    if (next) logRunRecordingEnabled();
  };

  const intensityMeta = INTENSITY_META[runSettings.intensity];
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
  const destinationLabel = playbackDestination === 'tv' ? 'TV' : 'Phone';
  const sessionLine = `${runSettings.durationMin} min · ${intensityMeta.label} · ${destinationLabel}`;
  const calories = caloriesForRun(runSettings.durationMin, displayClass, intensityMeta.effort);
  const bestLine =
    personalBest === null
      ? 'No runs yet · your first score sets the bar'
      : myRank !== null
        ? `Best ${Math.round(personalBest).toLocaleString()} · #${myRank.toLocaleString()} global`
        : `Best ${Math.round(personalBest).toLocaleString()}`;

  // Intensity is the playback rate: the user's explicit choice replaces the
  // class speed factor, so a Light run is genuinely slower on any class.
  const preflightParams: Record<string, string> = {
    level: level.id,
    name: level.name,
    speed: String(intensityMeta.playbackRate),
    duration: String(runSettings.durationMin),
    intensity: runSettings.intensity,
    ...(campaignClass ? { classKey: campaignClass } : {}),
    ...(recordEffective ? { record: '1' } : {}),
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    // Destination + recording were persisted as they changed; re-read so the
    // brief reflects exactly what the next run will use.
    readPlaySetup();
  };

  const saveSettings = (next: RunSettings) => {
    setRunSettings(next);
    void saveRunSettings(next);
    closeSettings();
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

  return (
    <View style={styles.root}>
      {/*
        The brief fills the screen: the cover grows to take whatever height is
        left after the fixed rows, so there is never a blank band between the
        content and Start. If banners push the content past the viewport
        (small phone + challenge + lock) the body scrolls; Start stays pinned.
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => setSettingsOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Run settings"
            accessibilityHint={`Currently ${sessionLine}`}
            hitSlop={10}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          >
            <Ionicons name="options-outline" size={22} color={colors.text} />
          </Pressable>
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
          {recordEffective ? (
            <View style={styles.recBadge} accessible accessibilityLabel="Recording on">
              <View style={styles.recDot} />
              <Text style={styles.recText}>REC</Text>
            </View>
          ) : null}
          <View style={styles.heroText}>
            <Text style={styles.heroTitle}>{mode.name}</Text>
            <Text style={styles.heroSubtitle} numberOfLines={1}>
              {mode.tagline}
            </Text>
            <View
              style={styles.heroSummaryRow}
              accessible
              accessibilityLabel={`${classMeta.label}, ${runSettings.durationMin} minutes, ${intensityMeta.label} intensity, approximately ${calories} calories, on your ${destinationLabel}`}
            >
              <HeroSummaryItem icon={classMeta.icon} value={classMeta.label} />
              <HeroSummaryItem icon="time-outline" value={`${runSettings.durationMin} min`} />
              <HeroSummaryItem icon={`${intensityMeta.icon}-outline`} value={intensityMeta.label} />
              <HeroSummaryItem icon="flame-outline" value={`~${calories} kcal`} />
              {playbackDestination === 'tv' ? <HeroSummaryItem icon="tv-outline" value="TV" /> : null}
            </View>
          </View>
        </View>

        <View style={styles.bestRow}>
          <Ionicons
            name={personalBest === null ? 'flag-outline' : 'trending-up'}
            size={14}
            color={personalBest === null ? colors.textFaint : colors.lime}
          />
          <Text style={styles.bestLine} numberOfLines={1}>
            {bestLine}
          </Text>
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
                {displayHandle(challenge)} · {challenge.score.toLocaleString()} · {Math.round(challenge.accuracy * 100)}%
              </Text>
              <Text style={styles.challengeDetail}>Beat it — finish this level to post your score.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.black} />
          </Pressable>
        ) : null}

        {/* Top 5 of the Global board (instant via the seeded ghost set) + your row. */}
        <TopRunnersCard
          levelId={mode.id}
          uid={uid}
          onOpen={() => router.push(`/leaderboard/${mode.id}` as Href)}
          onMyRank={setMyRank}
        />

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
      </ScrollView>

      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm },
        ]}
      >
        <Pressable
          onPress={onStart}
          disabled={!subscriptionHydrated || starting || Boolean(campaignLock)}
          accessibilityRole="button"
          accessibilityLabel={campaignLock ? `Locked. ${lockCopy}` : `Start ${mode.name}`}
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
          <Text style={styles.beginButtonText}>{campaignLock ? 'LOCKED' : 'START'}</Text>
        </Pressable>
      </View>

      <RunSettingsSheet
        visible={settingsOpen}
        value={runSettings}
        destination={playbackDestination}
        recordRun={recordRun}
        recordBlockers={recordBlockers}
        onDestinationChange={onDestinationChange}
        onRecordRunChange={onRecordRunChange}
        onClose={closeSettings}
        onSave={saveSettings}
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
  scroll: { flex: 1 },
  // flexGrow lets the cover absorb the remaining height on tall phones.
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hero: {
    // The cover absorbs whatever height the fixed rows (best line, Top
    // runners, banners) leave over, so there is no blank band above Start on
    // a 6.1" or a 6.9" phone. Never less than this, so the title block always
    // has art behind it; with a challenge banner on a small phone the body
    // scrolls a little instead.
    flexGrow: 1,
    minHeight: 240,
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
    paddingBottom: spacing.lg,
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
  recBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(6,6,10,0.7)',
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  recText: { color: colors.white, fontSize: 11, fontWeight: font.black, letterSpacing: 1.2 },
  bestRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.xs },
  bestLine: { ...metric, ...type.bodySm, color: colors.textDim, flexShrink: 1 },
  // A flex sibling of the scroll view (not absolute): the body can never
  // hide behind it, and there is no phantom padding to leave a gap above it.
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
});

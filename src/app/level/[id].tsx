import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { VideoAirPlayButton } from 'expo-video';
import { useState } from 'react';
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
import { OptionCard, SectionHeader } from '@/components/ui';
import { discoveryClassForMode } from '@/lib/dailyRecommendations';
import { getMode, modes } from '@/lib/gameData';
import { getModeCover } from '@/lib/modeCovers';
import { useProgress } from '@/lib/ProgressContext';
import {
  caloriesForRun,
  CLASS_META,
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
  const { id: idParam, classKey: classKeyParam } = useLocalSearchParams<{
    id: string | string[];
    classKey?: string | string[];
  }>();
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mode = getMode(id);
  const { classData } = useProgress();
  const { hydrated: subscriptionHydrated, isPremium, presentPaywall } = useSubscription();
  const [playbackDestination, setPlaybackDestination] = useState<PlaybackDestination>('phone');
  const [starting, setStarting] = useState(false);
  const campaignClass = parseOptionalClassKeyParam(classKeyParam);
  const displayClass =
    campaignClass ?? (id ? discoveryClassForMode(id, modes) : 'beginner');
  const inCampaignRoster = Boolean(
    campaignClass && id && classData(campaignClass).roster.includes(id)
  );

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
  const calories = caloriesForRun(level.durationMin, displayClass);

  const preflightParams: Record<string, string> = {
    level: level.id,
    name: level.name,
    speed: String(classMeta.speedFactor),
    duration: String(level.durationMin),
    ...(campaignClass ? { classKey: campaignClass } : {}),
  };

  const goPreflight = () => {
    router.push({
      pathname: '/preflight',
      params: preflightParams,
    });
  };

  const onStart = async () => {
    if (!subscriptionHydrated || starting) return;

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
              accessibilityLabel={`${classMeta.label}, ${level.durationMin} minutes, approximately ${calories} calories, ${classMeta.speedFactor.toFixed(1)} times intensity`}
            >
              <HeroSummaryItem icon={classMeta.icon} value={classMeta.label} />
              <HeroSummaryItem icon="time-outline" value={`${level.durationMin} min`} />
              <HeroSummaryItem icon="flame-outline" value={`~${calories} kcal`} />
              <HeroSummaryItem
                icon="speedometer-outline"
                value={`${classMeta.speedFactor.toFixed(1)}x`}
              />
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
                onPress={() => setPlaybackDestination('phone')}
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
                  onBeginPresentingRoutes={() => setPlaybackDestination('tv')}
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
          disabled={!subscriptionHydrated || starting}
          accessibilityRole="button"
          accessibilityLabel={`Continue to camera setup for ${mode.name}`}
          accessibilityState={{ disabled: !subscriptionHydrated || starting, busy: starting }}
          style={({ pressed }) => [
            styles.beginButton,
            (!subscriptionHydrated || starting) && styles.beginDisabled,
            pressed && styles.beginPressed,
          ]}
        >
          {!subscriptionHydrated || starting ? (
            <ActivityIndicator color={colors.black} />
          ) : (
            <Ionicons name="play" size={20} color={colors.black} />
          )}
          <Text style={styles.beginButtonText}>{continueLabel}</Text>
        </Pressable>
      </View>

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
  beginPressed: { opacity: 0.72 },
  pressed: { opacity: 0.72 },
});

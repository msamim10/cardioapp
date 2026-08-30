import { Asset } from 'expo-asset';
import { Image } from 'expo-image';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  FlatList,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import { onboardingProgress } from '@/lib/onboarding';
import {
  getCarouselItemOffset,
  getShowcaseCarouselLayout,
  isPreviewLoadCurrent,
  resolveActiveIndex,
  sameIndices,
  selectMountedIndices,
  selectPlayingIndices,
  shouldPreviewPlay,
  type ShowcasePreviewStatus,
} from '@/lib/showcaseMedia';
import { colors, font, metric, radius, spacing, type as typeScale } from '@/theme';

type ShowcaseClip = {
  id: string;
  video: number;
  poster: number;
  accessibilityLabel: string;
};

// Twelve distinct clips, twelve distinct people. The count is the only number
// this screen claims, and it is literally what is on screen.
const CLIPS: ShowcaseClip[] = [
  {
    id: 'living-room-duo',
    video: require('../../../assets/onboarding/living-room-duo.mp4'),
    poster: require('../../../assets/onboarding/living-room-duo-poster.jpg'),
    accessibilityLabel: 'Two players doing a full-body running workout in front of a living room TV.',
  },
  {
    id: 'dodge',
    video: require('../../../assets/onboarding/dodge-and-run.mp4'),
    poster: require('../../../assets/onboarding/dodge-and-run-poster.jpg'),
    accessibilityLabel: 'A player moving side to side while controlling a running game.',
  },
  {
    id: 'overalls-subway-run',
    video: require('../../../assets/onboarding/overalls-subway-run.mp4'),
    poster: require('../../../assets/onboarding/overalls-subway-run-poster.jpg'),
    accessibilityLabel: 'A player running in place to control a subway running game.',
  },
  {
    id: 'jump',
    video: require('../../../assets/onboarding/jump-and-reach.mp4'),
    poster: require('../../../assets/onboarding/jump-and-reach-poster.jpg'),
    accessibilityLabel: 'A player jumping and reaching while following the game on a TV.',
  },
  {
    id: 'friends-cardio-duo',
    video: require('../../../assets/onboarding/friends-cardio-duo.mp4'),
    poster: require('../../../assets/onboarding/friends-cardio-duo-poster.jpg'),
    accessibilityLabel: 'Two friends doing a cardio running game together in front of the TV.',
  },
  {
    id: 'steer',
    video: require('../../../assets/onboarding/move-and-steer.mp4'),
    poster: require('../../../assets/onboarding/move-and-steer-poster.jpg'),
    accessibilityLabel: 'A child moving their body to steer through a running game.',
  },
  {
    id: 'ditch-the-treadmill',
    video: require('../../../assets/onboarding/ditch-the-treadmill.mp4'),
    poster: require('../../../assets/onboarding/ditch-the-treadmill-poster.jpg'),
    accessibilityLabel: 'A player pointing at the TV while playing a running game instead of using a treadmill.',
  },
  {
    id: 'duck',
    video: require('../../../assets/onboarding/duck-and-weave.mp4'),
    poster: require('../../../assets/onboarding/duck-and-weave-poster.jpg'),
    accessibilityLabel: 'A player crouching and ducking with their whole body to control a subway running game.',
  },
  {
    id: 'dodge-and-sidestep',
    video: require('../../../assets/onboarding/dodge-and-sidestep.mp4'),
    poster: require('../../../assets/onboarding/dodge-and-sidestep-poster.jpg'),
    accessibilityLabel: 'A player dodging and side-stepping to steer a subway running game.',
  },
  {
    id: 'high-jump-run',
    video: require('../../../assets/onboarding/high-jump-run.mp4'),
    poster: require('../../../assets/onboarding/high-jump-run-poster.jpg'),
    accessibilityLabel: 'A player jumping high in their living room to control a running game.',
  },
  {
    id: 'brother-subway-run',
    video: require('../../../assets/onboarding/brother-subway-run.mp4'),
    poster: require('../../../assets/onboarding/brother-subway-run-poster.jpg'),
    accessibilityLabel: 'A player sprinting in place to play a subway running game.',
  },
  {
    id: 'level-one-run',
    video: require('../../../assets/onboarding/level-one-run.mp4'),
    poster: require('../../../assets/onboarding/level-one-run-poster.jpg'),
    accessibilityLabel: 'A player following the run, jump, duck and dodge prompts of a level.',
  },
];

// A card only holds a native player while it is the settled card or one of its
// immediate neighbours, so at most three decoders are ever allocated. The tile
// wall this replaced held six, permanently.
const PRELOAD_RADIUS = 1;
// Two cards clear the visibility threshold in the middle of a swipe. That is
// wanted, because the incoming card is already moving as it slides in, but a
// fling must never push past it.
const MAX_PLAYING = 2;

// A card counts as on screen at 60%. At rest the snapped card is fully visible
// and its neighbours sit near 17%, so the threshold isolates one card cleanly
// and only ever overlaps during the middle third of a gesture.
const VIEWABILITY_THRESHOLD = 60;

// Fallback for the one case a snap produces no momentum phase: a slow release
// already sitting on a snap point, where `onMomentumScrollEnd` never fires.
const SETTLE_FALLBACK_MS = 200;

const EMPHASIS_MS = 190;
const VIDEO_FADE_MS = 220;
// Dim enough to put the snapped card clearly first, bright enough that the
// peeking neighbour still reads as another person mid-session.
const INACTIVE_OPACITY = 0.38;
const INACTIVE_SCALE = 0.955;

function safe(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    // The expo-video native object may already be released during teardown.
    return false;
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * One card's player. Mounted only while the card sits inside the preload window,
 * and its source never changes for its lifetime, so there is no source-swap
 * churn — the generation guard exists purely for unmount safety.
 */
function CardVideo({
  video,
  playing,
  reduceMotion,
}: {
  video: number;
  playing: boolean;
  reduceMotion: boolean;
}) {
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const statusRef = useRef<ShowcasePreviewStatus>('loading');
  const opacity = useRef(new Animated.Value(0)).current;
  const [status, setStatus] = useState<ShowcasePreviewStatus>('loading');
  const visible = status === 'ready';

  const player = useVideoPlayer(null, (instance) => {
    instance.loop = true;
    instance.muted = true;
  });

  const updateStatus = useCallback((next: ShowcasePreviewStatus) => {
    if (!mountedRef.current) return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Invalidate async work before useVideoPlayer releases its native object.
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status: playerStatus }) => {
      if (!mountedRef.current) return;
      if (playerStatus === 'readyToPlay') updateStatus('ready');
      else if (playerStatus === 'error') {
        updateStatus('error');
        safe(() => player.pause());
      }
    });
    return () => subscription.remove();
  }, [player, updateStatus]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    updateStatus('loading');

    void (async () => {
      const asset = Asset.fromModule(video);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (!uri || !isPreviewLoadCurrent(mountedRef.current, generation, generationRef.current)) return;
      await player.replaceAsync({ uri });
      if (!isPreviewLoadCurrent(mountedRef.current, generation, generationRef.current)) return;
      const configured = safe(() => {
        player.loop = true;
        player.muted = true;
      });
      if (!configured) throw new Error('Video player was released');
    })().catch(() => {
      if (!isPreviewLoadCurrent(mountedRef.current, generation, generationRef.current)) return;
      updateStatus('error');
    });

    return () => {
      generationRef.current += 1;
    };
  }, [video, player, updateStatus]);

  useEffect(() => {
    safe(() => {
      if (shouldPreviewPlay(statusRef.current, playing)) player.play();
      else player.pause();
    });
  }, [player, status, playing]);

  // The poster underneath stays visible until there are real frames to show, so
  // a card is never blank and never flickers while it buffers.
  useEffect(() => {
    opacity.stopAnimation();
    if (!visible) {
      opacity.setValue(0);
      return;
    }
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, {
      toValue: 1,
      duration: VIDEO_FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    return () => opacity.stopAnimation();
  }, [opacity, visible, reduceMotion]);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <VideoView
        accessible={false}
        contentFit="cover"
        nativeControls={false}
        player={player}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

function ShowcaseCard({
  clip,
  width,
  height,
  live,
  playing,
  emphasised,
  reduceMotion,
}: {
  clip: ShowcaseClip;
  width: number;
  height: number;
  live: boolean;
  playing: boolean;
  emphasised: boolean;
  reduceMotion: boolean;
}) {
  const emphasis = useRef(new Animated.Value(emphasised ? 1 : 0)).current;

  useEffect(() => {
    const toValue = emphasised ? 1 : 0;
    if (reduceMotion) {
      emphasis.setValue(toValue);
      return;
    }
    Animated.timing(emphasis, {
      toValue,
      duration: EMPHASIS_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    return () => emphasis.stopAnimation();
  }, [emphasis, emphasised, reduceMotion]);

  return (
    <Animated.View
      accessibilityLabel={clip.accessibilityLabel}
      accessibilityRole="image"
      style={[
        styles.card,
        {
          width,
          height,
          opacity: emphasis.interpolate({ inputRange: [0, 1], outputRange: [INACTIVE_OPACITY, 1] }),
          transform: [
            { scale: emphasis.interpolate({ inputRange: [0, 1], outputRange: [INACTIVE_SCALE, 1] }) },
          ],
        },
      ]}
    >
      <Image contentFit="cover" source={clip.poster} style={StyleSheet.absoluteFill} transition={120} />
      {live ? <CardVideo playing={playing} reduceMotion={reduceMotion} video={clip.video} /> : null}
    </Animated.View>
  );
}

export default function GameplayShowcaseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [screenFocused, setScreenFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [railSize, setRailSize] = useState({ width: 0, height: 0 });

  // `active` drives the counter and the emphasis; `playing` is the playback gate
  // and is allowed to briefly hold two cards while one slides out.
  const [focus, setFocus] = useState<{ active: number; playing: number[] }>({
    active: 0,
    playing: [0],
  });
  // The settled card. Deliberately lags `focus.active` until the scroll comes to
  // rest, so players are created and released between gestures, never during one.
  const [settledIndex, setSettledIndex] = useState(0);
  const activeRef = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeRef.current = focus.active;
  }, [focus.active]);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const layout = useMemo(
    () => getShowcaseCarouselLayout(railSize.width, railSize.height, spacing.md),
    [railSize.width, railSize.height],
  );
  const layoutReady = layout.cardWidth > 0 && layout.cardHeight > 0;

  const lifecycleAllowsPlayback = screenFocused && appActive;
  const mounted = useMemo(
    () => new Set(selectMountedIndices(settledIndex, CLIPS.length, PRELOAD_RADIUS)),
    [settledIndex],
  );
  const playing = useMemo(() => new Set(focus.playing), [focus.playing]);

  // FlatList refuses a viewability handler that changes identity, so the config
  // and the callback are built once. Everything they touch is a stable setter.
  const viewability = useRef({
    viewabilityConfig: { itemVisiblePercentThreshold: VIEWABILITY_THRESHOLD },
    onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const visible = viewableItems
        .map((token) => token.index)
        .filter((index): index is number => index != null);
      if (visible.length === 0) return;
      setFocus((prev) => {
        const active = resolveActiveIndex(visible, prev.active);
        const next = selectPlayingIndices(visible, active, MAX_PLAYING);
        if (prev.active === active && sameIndices(prev.playing, next)) return prev;
        return { active, playing: next };
      });
    },
  }).current;

  const handleRailLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setRailSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: layout.itemWidth,
      offset: getCarouselItemOffset(index, layout.itemWidth),
      index,
    }),
    [layout.itemWidth],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ShowcaseClip>) => (
      <View style={[styles.cell, { width: layout.itemWidth }]}>
        <ShowcaseCard
          clip={item}
          emphasised={index === focus.active}
          height={layout.cardHeight}
          live={mounted.has(index)}
          playing={lifecycleAllowsPlayback && playing.has(index)}
          reduceMotion={reduceMotion}
          width={layout.cardWidth}
        />
      </View>
    ),
    [
      focus.active,
      layout.cardHeight,
      layout.cardWidth,
      layout.itemWidth,
      lifecycleAllowsPlayback,
      mounted,
      playing,
      reduceMotion,
    ],
  );

  // Player create/release is deferred to true rest. Momentum-begin cancels the
  // drag-end fallback, so the preload window moves exactly once per gesture.
  const clearSettleTimer = useCallback(() => {
    if (settleTimer.current == null) return;
    clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }, []);

  const settleNow = useCallback(() => {
    clearSettleTimer();
    setSettledIndex(activeRef.current);
  }, [clearSettleTimer]);

  const settleSoon = useCallback(() => {
    clearSettleTimer();
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      setSettledIndex(activeRef.current);
    }, SETTLE_FALLBACK_MS);
  }, [clearSettleTimer]);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  return (
    <View style={styles.root}>
      <OnboardingTopBar progress={onboardingProgress('gameplay-showcase')} topInset={insets.top} onBack={() => router.back()} />

      <View style={styles.header}>
        <Text style={styles.title}>This is what a session looks like</Text>
        <Text style={styles.subtitle}>
          Real full-body cardio, no equipment, no treadmill required. Swipe through all {CLIPS.length}.
        </Text>
      </View>

      <View onLayout={handleRailLayout} style={styles.rail}>
        {layoutReady ? (
          <FlatList
            accessibilityLabel={`${CLIPS.length} clips of players moving through the game. Swipe left or right.`}
            contentContainerStyle={[styles.railContent, { paddingHorizontal: layout.sidePadding }]}
            data={CLIPS}
            decelerationRate="fast"
            disableIntervalMomentum
            getItemLayout={getItemLayout}
            horizontal
            initialNumToRender={3}
            keyExtractor={(clip) => clip.id}
            maxToRenderPerBatch={3}
            onMomentumScrollBegin={clearSettleTimer}
            onMomentumScrollEnd={settleNow}
            onScrollBeginDrag={clearSettleTimer}
            onScrollEndDrag={settleSoon}
            onViewableItemsChanged={viewability.onViewableItemsChanged}
            removeClippedSubviews={false}
            renderItem={renderItem}
            scrollEventThrottle={16}
            showsHorizontalScrollIndicator={false}
            snapToAlignment="start"
            snapToInterval={layout.itemWidth}
            viewabilityConfig={viewability.viewabilityConfig}
            windowSize={5}
          />
        ) : null}
      </View>

      {/* The volume cue the tile wall used to carry: one segment per clip plus
          the total, so the set still reads as twelve rather than one. */}
      <View
        accessibilityLabel={`Clip ${focus.active + 1} of ${CLIPS.length}`}
        accessibilityRole="progressbar"
        style={styles.meta}
      >
        <Text style={styles.counter}>
          {pad2(focus.active + 1)} / {pad2(CLIPS.length)}
        </Text>
        <View pointerEvents="none" style={styles.track}>
          {CLIPS.map((clip, index) => (
            <View
              key={clip.id}
              style={[styles.segment, index === focus.active && styles.segmentActive]}
            />
          ))}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <GradientButton
          accent="lime"
          label="CONTINUE"
          onPress={() => router.push('/(onboarding)/create-account' as Href)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 29,
    fontWeight: font.black,
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 14,
    fontWeight: font.medium,
    lineHeight: 20,
    marginTop: spacing.sm,
    maxWidth: 340,
    textAlign: 'center',
  },
  rail: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 220,
    overflow: 'hidden',
  },
  railContent: {
    alignItems: 'center',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    paddingBottom: spacing.md,
    paddingTop: spacing.lg,
  },
  counter: {
    ...typeScale.label,
    ...metric,
    color: colors.textDim,
  },
  track: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  segment: {
    backgroundColor: colors.borderStrong,
    borderRadius: radius.pill,
    height: 3,
    width: 6,
  },
  segmentActive: {
    backgroundColor: colors.lime,
    width: 18,
  },
  footer: {
    backgroundColor: colors.bg,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});

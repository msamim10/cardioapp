import Ionicons from '@expo/vector-icons/Ionicons';
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
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import {
  getRectAppearanceTransform,
  getShowcaseGridLayout,
  getTilePosition,
  isPreviewLoadCurrent,
  type Rect,
  selectPlayingTileIndices,
  SHOWCASE_MEDIA_ASPECT_RATIO,
  shouldPreviewPlay,
  type ShowcasePreviewStatus,
} from '@/lib/showcaseMedia';
import { colors, font, radius, spacing } from '@/theme';

type ShowcaseClip = {
  id: string;
  video: number;
  poster: number;
  accessibilityLabel: string;
};

// The hero (index 0) is the clip that plays big on arrival, then shrinks into
// slot 0 of the grid. The remaining clips fill the wall.
const CLIPS: ShowcaseClip[] = [
  {
    id: 'living-room-duo',
    video: require('../../../assets/onboarding/living-room-duo.mp4'),
    poster: require('../../../assets/onboarding/living-room-duo-poster.jpg'),
    accessibilityLabel: 'Two kids playing a full-body running game on the living room TV.',
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

// Concurrency cap: many simultaneous expo-video decoders crash on device, so
// only this many grid tiles ever mount a real player (spread across the wall);
// the rest stay on their poster image. Peak concurrently-playing decoders is
// therefore capped at this number (grid) or 1 (an expanded tile, grid paused).
const MAX_CONCURRENT_TILE_PLAYERS = 6;

// Diameter of the circular close ("X") pill overlaid on the expanded hero card.
const CLOSE_BUTTON_SIZE = 42;

const INTRO_HOLD_MS = 650;
// The single shared grow/shrink curve reused by BOTH the opening hero intro and
// tap-to-expand, so a tapped tile blooms to hero size (and shrinks back) with
// the exact same duration, easing, scale and position treatment as the intro.
const HERO_TRANSITION_MS = 1500;
const HERO_CROSSFADE_MS = 260;
const INTRO_FALLBACK_MS = 2200;

// intro:    hero big on load, auto-shrinks into slot 0 of the grid.
// grid:     no overlay, the tile wall plays.
// expanded: a tapped tile has bloomed to hero size (grid paused).
// settling: hero is shrinking back into its tile and crossfading to the grid.
type Phase = 'intro' | 'grid' | 'expanded' | 'settling';

function safe(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    // The expo-video native object may already be released during teardown.
    return false;
  }
}

/** Shared frame for every tile: poster underlay + tap-to-bloom selection. */
function TileFrame({
  clip,
  width,
  height,
  onSelect,
  children,
}: {
  clip: ShowcaseClip;
  width: number;
  height: number;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityLabel={`Expand preview. ${clip.accessibilityLabel}`}
      accessibilityRole="button"
      onPress={onSelect}
      style={[styles.tile, { width, height }]}
    >
      <Image contentFit="cover" source={clip.poster} style={StyleSheet.absoluteFill} transition={120} />
      {children}
    </Pressable>
  );
}

/** A tile that owns a stable, always-mounted player (load-once, never swapped). */
function LiveTile({
  clip,
  active,
  reduceMotion,
  width,
  height,
  onSelect,
}: {
  clip: ShowcaseClip;
  active: boolean;
  reduceMotion: boolean;
  width: number;
  height: number;
  onSelect: () => void;
}) {
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const statusRef = useRef<ShowcasePreviewStatus>('loading');
  const opacity = useRef(new Animated.Value(0)).current;
  const [status, setStatus] = useState<ShowcasePreviewStatus>('loading');
  const videoVisible = status === 'ready';

  const player = useVideoPlayer(null, (instance) => {
    instance.loop = true;
    instance.muted = true;
  });

  const updateStatus = useCallback((next: ShowcasePreviewStatus) => {
    if (!mountedRef.current) return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  const syncPlayback = useCallback(() => {
    safe(() => {
      if (shouldPreviewPlay(statusRef.current, active)) player.play();
      else player.pause();
    });
  }, [player, active]);

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
      const asset = Asset.fromModule(clip.video);
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
  }, [clip.video, player, updateStatus]);

  useEffect(() => {
    syncPlayback();
  }, [status, syncPlayback]);

  useEffect(() => {
    opacity.stopAnimation();
    if (!videoVisible) {
      opacity.setValue(0);
      return;
    }
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, { duration: 220, toValue: 1, useNativeDriver: true }).start();
    return () => opacity.stopAnimation();
  }, [opacity, videoVisible, reduceMotion]);

  return (
    <TileFrame clip={clip} height={height} onSelect={onSelect} width={width}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
        <VideoView
          accessible={false}
          contentFit="cover"
          nativeControls={false}
          player={player}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </TileFrame>
  );
}

/**
 * A single reused player for the big hero intro and the tap-to-expand view.
 * Its source is swapped with replaceAsync under a generation guard so an
 * in-flight swap never touches a released native object.
 */
function useFocusPlayer(target: ShowcaseClip | null, shouldPlay: boolean) {
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const statusRef = useRef<ShowcasePreviewStatus>('loading');
  const [status, setStatus] = useState<ShowcasePreviewStatus>('loading');
  const targetVideo = target?.video ?? null;

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
    if (targetVideo == null) {
      safe(() => player.pause());
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    updateStatus('loading');

    void (async () => {
      const asset = Asset.fromModule(targetVideo);
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
  }, [targetVideo, player, updateStatus]);

  useEffect(() => {
    safe(() => {
      if (targetVideo != null && shouldPreviewPlay(statusRef.current, shouldPlay)) player.play();
      else player.pause();
    });
  }, [player, status, shouldPlay, targetVideo]);

  return { player, status };
}

export default function GameplayShowcaseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [screenFocused, setScreenFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [phase, setPhase] = useState<Phase>('intro');
  // Which clip currently occupies the big hero presentation. Index 0 during the
  // opening intro; the tapped tile's index while expanded.
  const [heroIndex, setHeroIndex] = useState(0);

  // A single shared driver for the hero: 0 = big (hero size), 1 = docked in its
  // grid tile. The intro animates 0->1 (shrink); a tap animates 1->0 (bloom).
  const heroProgress = useRef(new Animated.Value(0)).current;
  const heroFade = useRef(new Animated.Value(1)).current;
  const introStartedRef = useRef(false);

  const liveIndices = useMemo(
    () => new Set(selectPlayingTileIndices(CLIPS.length, MAX_CONCURRENT_TILE_PLAYERS)),
    [],
  );

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

  const shouldPlay = screenFocused && appActive;
  const layout = getShowcaseGridLayout(previewSize.width, previewSize.height, CLIPS.length);
  const layoutReady = layout.tileWidth > 0 && layout.tileHeight > 0;

  // Grid content is centered inside the preview area; tile/hero rects below are
  // in preview-local coordinates so the shrink animation lands cleanly.
  const gridOffsetX = Math.max(0, (previewSize.width - layout.contentWidth) / 2);
  const gridOffsetY = Math.max(0, (previewSize.height - layout.contentHeight) / 2);

  const heroRect = useMemo<Rect>(() => {
    if (!layoutReady) return { x: 0, y: 0, width: 0, height: 0 };
    let heroWidth = previewSize.width * 0.82;
    let heroHeight = heroWidth / SHOWCASE_MEDIA_ASPECT_RATIO;
    const maxHeight = previewSize.height * 0.94;
    if (heroHeight > maxHeight) {
      heroHeight = maxHeight;
      heroWidth = heroHeight * SHOWCASE_MEDIA_ASPECT_RATIO;
    }
    return {
      x: (previewSize.width - heroWidth) / 2,
      y: (previewSize.height - heroHeight) / 2,
      width: heroWidth,
      height: heroHeight,
    };
  }, [layoutReady, previewSize.width, previewSize.height]);

  // A tile's rect in preview-local coordinates, derived straight from the grid
  // layout (no measureInWindow needed) so the hero can shrink into / bloom out
  // of ANY tile with the same math the intro uses for slot 0.
  const tileRectFor = useCallback(
    (index: number): Rect => {
      const pos = getTilePosition(index, layout);
      return {
        x: gridOffsetX + pos.x,
        y: gridOffsetY + pos.y,
        width: layout.tileWidth,
        height: layout.tileHeight,
      };
    },
    [layout, gridOffsetX, gridOffsetY],
  );

  const heroOverlayVisible =
    (phase === 'intro' && !reduceMotion) || phase === 'expanded' || phase === 'settling';
  const focusClip = heroOverlayVisible ? CLIPS[heroIndex] : null;
  const focusShouldPlay = shouldPlay && heroOverlayVisible;
  const gridActive = shouldPlay && (phase === 'grid' || phase === 'settling');

  const focus = useFocusPlayer(focusClip, focusShouldPlay);

  // Transform that docks the big hero card into its target tile. Shared by both
  // the intro (target = slot 0) and tap-to-expand (target = tapped tile).
  const heroTransform = useMemo(() => {
    if (!layoutReady) return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
    return getRectAppearanceTransform(heroRect, tileRectFor(heroIndex));
  }, [layoutReady, heroRect, tileRectFor, heroIndex]);

  // Shared tail: shrink the hero into its tile is already done; crossfade it out
  // and hand off to the live grid underneath. Used by both intro end and dismiss.
  const settleIntoGrid = useCallback(() => {
    setPhase('settling');
    Animated.timing(heroFade, {
      toValue: 0,
      duration: HERO_CROSSFADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setPhase('grid');
    });
  }, [heroFade]);

  // Reduce Motion: skip the opening blow-up entirely; go straight to the grid.
  useEffect(() => {
    if (!reduceMotion) return;
    setPhase((prev) => (prev === 'intro' ? 'grid' : prev));
  }, [reduceMotion]);

  // Hero intro: hold big, then shrink into slot 0 using the shared curve, then
  // crossfade to the live grid. Starts once the hero is ready (or a fallback).
  useEffect(() => {
    if (reduceMotion || phase !== 'intro' || !layoutReady || introStartedRef.current) return;

    const begin = () => {
      if (introStartedRef.current) return;
      introStartedRef.current = true;
      heroProgress.setValue(0);
      heroFade.setValue(1);
      Animated.sequence([
        Animated.delay(INTRO_HOLD_MS),
        Animated.timing(heroProgress, {
          toValue: 1,
          duration: HERO_TRANSITION_MS,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) settleIntoGrid();
      });
    };

    if (focus.status === 'ready') {
      begin();
      return;
    }
    const timer = setTimeout(begin, INTRO_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [reduceMotion, phase, layoutReady, focus.status, heroProgress, heroFade, settleIntoGrid]);

  const handlePreviewLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    setPreviewSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
  }, []);

  // Tap-to-expand: the tapped tile blooms to hero size with the SAME treatment
  // as the intro (start docked at the tile, grow 1->0 along the shared curve).
  const openHero = useCallback(
    (index: number) => {
      if (phase !== 'grid') return;
      setHeroIndex(index);
      setPhase('expanded');
      heroFade.setValue(1);
      if (reduceMotion) {
        heroProgress.setValue(0);
        return;
      }
      heroProgress.setValue(1);
      Animated.timing(heroProgress, {
        toValue: 0,
        duration: HERO_TRANSITION_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
    [phase, reduceMotion, heroProgress, heroFade],
  );

  // Dismiss: shrink the hero back into its tile with the same shrink-into-grid
  // transition used after the intro, then hand off to the grid.
  const dismissHero = useCallback(() => {
    if (phase !== 'expanded') return;
    if (reduceMotion) {
      heroFade.setValue(0);
      setPhase('grid');
      return;
    }
    Animated.timing(heroProgress, {
      toValue: 1,
      duration: HERO_TRANSITION_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) settleIntoGrid();
    });
  }, [phase, reduceMotion, heroProgress, heroFade, settleIntoGrid]);

  return (
    <View style={styles.root}>
      <OnboardingTopBar progress={0.8} topInset={insets.top} onBack={() => router.back()} />

      <View style={styles.header}>
        <Text style={styles.title}>The run everyone&apos;s on</Text>
        <Text style={styles.subtitle}>
          Thousands are turning cardio into a game they actually finish. Tap any clip to watch.
        </Text>
      </View>

      <View accessibilityLabel="A wall of players moving through the game." onLayout={handlePreviewLayout} style={styles.previewSection}>
        {layoutReady ? (
          <View
            style={[
              styles.gridWrap,
              { width: layout.contentWidth, height: layout.contentHeight, columnGap: layout.gap, rowGap: layout.gap },
            ]}
          >
            {CLIPS.map((clip, index) =>
              liveIndices.has(index) ? (
                <LiveTile
                  key={clip.id}
                  active={gridActive}
                  clip={clip}
                  height={layout.tileHeight}
                  onSelect={() => openHero(index)}
                  reduceMotion={reduceMotion}
                  width={layout.tileWidth}
                />
              ) : (
                <TileFrame
                  key={clip.id}
                  clip={clip}
                  height={layout.tileHeight}
                  onSelect={() => openHero(index)}
                  width={layout.tileWidth}
                />
              ),
            )}
          </View>
        ) : null}

        {heroOverlayVisible && layoutReady ? (
          <Animated.View
            pointerEvents={phase === 'expanded' ? 'auto' : 'none'}
            style={[
              styles.heroOverlay,
              {
                left: heroRect.x,
                top: heroRect.y,
                width: heroRect.width,
                height: heroRect.height,
                opacity: heroFade,
                transform: [
                  {
                    translateX: heroProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, heroTransform.translateX],
                    }),
                  },
                  {
                    translateY: heroProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, heroTransform.translateY],
                    }),
                  },
                  {
                    scaleX: heroProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, heroTransform.scaleX],
                    }),
                  },
                  {
                    scaleY: heroProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, heroTransform.scaleY],
                    }),
                  },
                ],
              },
            ]}
          >
            <Pressable
              accessibilityLabel={
                phase === 'expanded'
                  ? `Close preview. ${CLIPS[heroIndex].accessibilityLabel}`
                  : CLIPS[heroIndex].accessibilityLabel
              }
              accessibilityRole={phase === 'expanded' ? 'button' : 'image'}
              disabled={phase !== 'expanded'}
              onPress={dismissHero}
              style={StyleSheet.absoluteFill}
            >
              <Image contentFit="cover" source={CLIPS[heroIndex].poster} style={StyleSheet.absoluteFill} />
              <VideoView
                accessible={false}
                contentFit="cover"
                nativeControls={false}
                player={focus.player}
                style={StyleSheet.absoluteFill}
              />
            </Pressable>
          </Animated.View>
        ) : null}

        {phase === 'expanded' && layoutReady ? (
          <Pressable
            accessibilityLabel="Close preview"
            accessibilityRole="button"
            hitSlop={12}
            onPress={dismissHero}
            style={[
              styles.closeButton,
              {
                left: heroRect.x + heroRect.width - CLOSE_BUTTON_SIZE - spacing.sm,
                top: heroRect.y + spacing.sm,
              },
            ]}
          >
            <Ionicons color={colors.text} name="close" size={22} />
          </Pressable>
        ) : null}
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
  previewSection: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 205,
    overflow: 'hidden',
  },
  gridWrap: {
    alignContent: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
  heroOverlay: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: colors.violet,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
  },
  footer: {
    backgroundColor: colors.bg,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,10,15,0.72)',
    borderRadius: radius.pill,
    height: CLOSE_BUTTON_SIZE,
    justifyContent: 'center',
    position: 'absolute',
    width: CLOSE_BUTTON_SIZE,
  },
});

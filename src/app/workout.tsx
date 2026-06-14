import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { SubwayScene } from '@/components/scene/SubwayScene';
import { WorkoutHud } from '@/components/hud/WorkoutHud';
import { preloadGlbModel } from '@/components/scene/models/GLBModel';
import { estimateCalories } from '@/lib/calories';
import { getCityPreloadAssets } from '@/lib/cityBuilderRegistry';
import { theme } from '@/lib/theme';
import type { ActionCue, WorkoutSceneVariant } from '@/lib/types';
import { useUserWeight } from '@/hooks/useUserWeight';
import { useWorkoutTimer } from '@/hooks/useWorkoutTimer';

const COIN_SOUND = require('../../assets/sounds/coin.mp3');

export default function WorkoutScreen() {
  useKeepAwake();
  const router = useRouter();
  const params = useLocalSearchParams<{ scene?: string }>();
  const sceneVariant: WorkoutSceneVariant =
    params.scene === 'current' ? 'current' : 'city-builder';
  const { weightKg } = useUserWeight();
  const [paused, setPaused] = useState(false);
  const [collectedCoinIds, setCollectedCoinIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const collectedCoinIdsRef = useRef<Set<string>>(new Set());
  const coinSoundIndexRef = useRef(0);
  const coinSoundA = useAudioPlayer(COIN_SOUND, { downloadFirst: true });
  const coinSoundB = useAudioPlayer(COIN_SOUND, { downloadFirst: true });
  const coinSoundC = useAudioPlayer(COIN_SOUND, { downloadFirst: true });
  const [score, setScore] = useState(0);
  const [actionCue, setActionCue] = useState<ActionCue>(null);
  // The workout is "loading" while the selected scene warms up. For the
  // City option we preload the City Builder Bits GLB models; the current runner
  // option only needs a short Canvas warm-up. While loading we keep everything paused
  // (scene animation, score ticker, workout timer) so the player doesn't
  // lose game time to the first-frame hitch, and we mask the initial render
  // behind a Getting Ready overlay.
  const [isReady, setIsReady] = useState(false);
  const isLoading = !isReady;
  const scenePaused = paused || isLoading;

  useEffect(() => {
    let cancelled = false;
    const preload =
      sceneVariant === 'city-builder'
        ? Promise.all(getCityPreloadAssets().map((asset) => preloadGlbModel(asset)))
        : Promise.resolve();
    preload
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, 250)))
      .then(() => {
        if (!cancelled) setIsReady(true);
      })
      .catch(() => {
        if (!cancelled) setIsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sceneVariant]);
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    }).catch(() => undefined);
  }, []);

  const { elapsedSec } = useWorkoutTimer({ paused: scenePaused, active: true });
  const calories = useMemo(
    () => estimateCalories(weightKg, elapsedSec),
    [weightKg, elapsedSec],
  );
  useEffect(() => {
    if (scenePaused) return;
    const id: ReturnType<typeof setInterval> = setInterval(() => {
      setScore((value) => value + 1);
    }, 35);
    return () => clearInterval(id);
  }, [scenePaused]);
  const playCoinSound = useCallback(() => {
    const players = [coinSoundA, coinSoundB, coinSoundC];
    const player = players[coinSoundIndexRef.current % players.length];
    coinSoundIndexRef.current += 1;
    player.volume = 0.10;
    player.seekTo(0).catch(() => undefined);
    player.play();
  }, [coinSoundA, coinSoundB, coinSoundC]);
  const handleCoinCollect = useCallback((coinId: string) => {
    if (collectedCoinIdsRef.current.has(coinId)) return;
    collectedCoinIdsRef.current.add(coinId);
    playCoinSound();
    setCollectedCoinIds(new Set(collectedCoinIdsRef.current));
  }, [playCoinSound]);

  const handleEnd = () => {
    const finalSec = Math.round(elapsedSec);
    const finalCal = estimateCalories(weightKg, finalSec);
    router.replace({
      pathname: '/summary',
      params: {
        durationSec: finalSec.toString(),
        calories: finalCal.toFixed(2),
        coins: collectedCoinIdsRef.current.size.toString(),
      },
    });
  };

  return (
    <View style={styles.root}>
      <SubwayScene
        variant={sceneVariant}
        paused={scenePaused}
        collectedCoinIds={collectedCoinIds}
        onCoinCollect={handleCoinCollect}
        onCueChange={setActionCue}
      />
      <WorkoutHud
        score={score}
        coins={collectedCoinIds.size}
        actionCue={actionCue}
        paused={paused}
        onPauseToggle={() => setPaused((value) => !value)}
        onEnd={handleEnd}
      />
      {isLoading && (
        <View style={styles.loadingOverlay} pointerEvents="auto">
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingTitle}>GETTING READY</Text>
          <Text style={styles.loadingSubtitle}>Warming up the run…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg,
    gap: 14,
  },
  loadingTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: 6,
  },
  loadingSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.2,
  },
});

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { SubwayScene } from '@/components/scene/SubwayScene';
import { WorkoutHud } from '@/components/hud/WorkoutHud';
import { preloadModel } from '@/components/scene/models/GLBModel';
import { estimateCalories } from '@/lib/calories';
import { getAllModelAssets } from '@/lib/modelRegistry';
import { theme } from '@/lib/theme';
import type { ActionCue } from '@/lib/types';
import { useUserWeight } from '@/hooks/useUserWeight';
import { useWorkoutTimer } from '@/hooks/useWorkoutTimer';

const COIN_SOUND = require('../../assets/sounds/coin.mp3');

export default function WorkoutScreen() {
  useKeepAwake();
  const router = useRouter();
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
  // The workout is "loading" until every GLB has been pulled into the
  // cache and the Canvas has had a beat to warm up. While loading we keep
  // everything paused (scene animation, score ticker, workout timer) so
  // the player doesn't lose game time to the first-frame hitch, and we
  // mask the heavy initial render behind a Getting Ready overlay.
  const [isReady, setIsReady] = useState(false);
  const isLoading = !isReady;
  const scenePaused = paused || isLoading;

  // Warm the GLB cache as soon as the workout screen opens.
  useEffect(() => {
    let cancelled = false;
    const assets = getAllModelAssets();
    Promise.all(assets.map((asset) => preloadModel(asset)))
      // Small extra delay so the Canvas can render its first frame after
      // the preload promises resolve (preload finishing doesn't mean the
      // GPU has built every material yet).
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, 400)))
      .then(() => {
        if (!cancelled) setIsReady(true);
      })
      .catch(() => {
        // If preloads fail we still want to enter the game eventually -
        // GLBModel falls back to its `fallback` prop and missing assets
        // just don't render, which is better than being stuck on the
        // loading screen.
        if (!cancelled) setIsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
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

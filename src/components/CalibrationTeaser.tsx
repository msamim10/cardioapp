import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ParticleBurst } from '@/components/ParticleBurst';
import { JudgementPop } from '@/components/PoseOverlay';
import { CALIBRATION_TEASER_DURATION_MS } from '@/data/calibrationTeaser';
import type { HudTheme } from '@/lib/hudThemes';
import {
  currentTeaserClip,
  TEASER_CLIPS,
  teaserLandedCount,
  teaserOnLastClip,
  type PreflightFlowEvent,
  type PreflightFlowState,
  type TeaserHit,
} from '@/lib/preflightFlow';
import { colors, font, metric, spacing, type } from '@/theme';

/**
 * Calibration teaser (docs/CALIBRATION_FLOW.md): the run, already started.
 * Four clips of real gameplay from the bundled MP4 play full-screen, one per
 * move, and the user copies each dodge. No words over the footage — the
 * footage is the cue. A landed move gets the run's own ✓ PERFECT / ✓ GOOD pop
 * plus a coin burst; between clips a one-second "Next up" sits over the
 * frozen frame; after the last one a score card ("3/4 · You're in.").
 *
 * All timing lives in the pure reducer (`preflightFlow.ts`); this file only
 * mirrors the reducer's step into the player (seek/play/pause) and reports
 * the player's clock back (`VIDEO_TIME`), plus the visuals.
 */

/** Bundled asset: onboarding never waits on the network for this. */
export const TEASER_SOURCE = require('../../assets/video/calibration-neon-rails.mp4') as number;

/** `timeUpdate` cadence, seconds. Clip ends are detected from these ticks. */
const TIME_UPDATE_S = 0.1;
/**
 * Where the frozen frame sits once a clip has ended: just inside the clip so
 * the pause never lands on the first frames of the next one.
 */
const FREEZE_BACK_MS = 50;

const safe = (run: () => void) => {
  try {
    run();
  } catch {
    // The player may already be released (unmount race); nothing to do.
  }
};

/**
 * One muted, non-looping player for the teaser, created with the screen so
 * the asset is loaded before the hold finishes.
 */
export function useTeaserPlayer(): VideoPlayer {
  return useVideoPlayer(TEASER_SOURCE, (player) => {
    player.loop = false;
    player.muted = true;
    player.timeUpdateEventInterval = TIME_UPDATE_S;
  });
}

/**
 * Mirror the reducer's teaser step into the player and feed its clock back.
 *   playing        seek to the clip's startMs, play
 *   tail / interstitial / done   pause (frozen frame)
 * Every `timeUpdate` → VIDEO_TIME; a player error → VIDEO_FAILED. The
 * reducer's wall-clock guard finishes every step even if none of this works.
 */
export function useTeaserPlayback(
  player: VideoPlayer,
  state: PreflightFlowState,
  dispatch: (event: PreflightFlowEvent) => void,
): void {
  const inTeaser = state.phase === 'teaser';
  const clipIndex = state.teaserClip;
  const step = state.teaserStep;

  useEffect(() => {
    if (!inTeaser) return;
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      dispatch({ type: 'VIDEO_TIME', now: Date.now(), positionMs: Math.max(0, currentTime) * 1000 });
    });
    const end = player.addListener('playToEnd', () => {
      dispatch({ type: 'VIDEO_TIME', now: Date.now(), positionMs: CALIBRATION_TEASER_DURATION_MS });
    });
    const status = player.addListener('statusChange', ({ status: next }) => {
      if (next === 'error') dispatch({ type: 'VIDEO_FAILED', now: Date.now() });
    });
    safe(() => {
      if (player.status === 'error') dispatch({ type: 'VIDEO_FAILED', now: Date.now() });
    });
    return () => {
      time.remove();
      end.remove();
      status.remove();
    };
  }, [dispatch, inTeaser, player]);

  useEffect(() => {
    if (!inTeaser) {
      safe(() => player.pause());
      return;
    }
    const clip = TEASER_CLIPS[clipIndex];
    if (step === 'playing' && clip) {
      safe(() => {
        player.currentTime = clip.startMs / 1000;
        player.play();
      });
      return;
    }
    safe(() => player.pause());
    if ((step === 'tail' || step === 'interstitial') && clip) {
      // Hold the clip's own last frame while the interstitial is up.
      safe(() => {
        const at = (clip.endMs - FREEZE_BACK_MS) / 1000;
        if (Math.abs(player.currentTime - at) > FREEZE_BACK_MS / 1000) player.currentTime = at;
      });
    }
  }, [clipIndex, inTeaser, player, step]);
}

/** The most recent landed clip's grade, for the pop (null before any). */
export function lastTeaserHit(state: PreflightFlowState): TeaserHit | null {
  for (let index = state.teaserHits.length - 1; index >= 0; index -= 1) {
    const hit = state.teaserHits[index];
    if (hit) return hit;
  }
  return null;
}

const HIT_LABEL: Record<TeaserHit, string> = { perfect: '✓ PERFECT', good: '✓ GOOD' };

/** Coin-coloured burst palette (the theme decides nothing about coins). */
const COIN_BURST = {
  accent: '#FFD23F',
  joint: '#FFF1A8',
  perfect: '#FFB020',
  good: '#FFE680',
} as const;

export function CalibrationTeaser({
  player,
  state,
  theme,
}: {
  player: VideoPlayer;
  state: PreflightFlowState;
  theme: HudTheme;
}) {
  const step = state.teaserStep;
  const landed = teaserLandedCount(state);
  const hit = lastTeaserHit(state);
  const clip = currentTeaserClip(state);
  const coinTheme = useMemo<HudTheme>(() => ({ ...theme, ...COIN_BURST }), [theme]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
        // The footage is the cue; nothing of the player's chrome shows.
        accessibilityLabel={clip ? `Watch the run ${clip.move.toLowerCase()}, then do the same.` : 'Run footage'}
      />

      {step === 'tail' || step === 'interstitial' || step === 'done' ? (
        <View style={styles.freezeScrim} />
      ) : null}

      {/* The run's judgement pop + a coin burst on every landed clip. */}
      <ParticleBurst trigger={landed} theme={coinTheme} count={22} radius={170} duration={800} />
      <JudgementPop grade={hit} nonce={landed} theme={theme} hero label={hit ? HIT_LABEL[hit] : undefined} />

      {step === 'interstitial' ? (
        <View style={styles.interstitial} accessible accessibilityLiveRegion="polite">
          <Text style={styles.interstitialEyebrow} maxFontSizeMultiplier={1.2}>
            {teaserOnLastClip(state) ? "THAT'S IT" : 'NEXT UP'}
          </Text>
          <ClipDots state={state} accent={theme.accent} />
        </View>
      ) : null}

      {step === 'done' ? (
        <View style={styles.card} accessible accessibilityLiveRegion="assertive">
          {/* Mounts with the card: a fresh burst fires once on its first non-zero trigger. */}
          <ParticleBurst trigger={1} theme={coinTheme} big count={26} duration={1_100} />
          <Text style={[styles.cardScore, { color: theme.accent }]} maxFontSizeMultiplier={1}>
            {landed}/{TEASER_CLIPS.length}
          </Text>
          <Text style={styles.cardTitle} maxFontSizeMultiplier={1.2}>You&apos;re in.</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Four dots: landed clips in the accent, the rest dim. */
function ClipDots({ state, accent }: { state: PreflightFlowState; accent: string }) {
  return (
    <View style={styles.dots}>
      {TEASER_CLIPS.map((clip, index) => {
        const hit = state.teaserHits[index];
        const current = index === state.teaserClip;
        return (
          <View
            key={clip.move}
            style={[
              styles.dot,
              {
                backgroundColor: hit ? accent : current ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.28)',
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  freezeScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  interstitial: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  interstitialEyebrow: {
    ...type.micro,
    color: colors.white,
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: font.heavy,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  card: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: 'rgba(8,9,10,0.9)',
  },
  cardScore: {
    ...type.hero,
    ...metric,
    fontSize: 88,
    lineHeight: 92,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 16,
  },
  cardTitle: {
    ...type.display,
    color: colors.white,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});

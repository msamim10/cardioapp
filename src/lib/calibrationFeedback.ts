/**
 * Haptic + sound feedback for the calibration micro-game.
 *
 * Both channels are optional: the haptics and audio native modules are probed
 * with `requireOptionalNativeModule` before their JS packages are imported
 * (same pattern as `storeReview.ts`), so a development build that predates
 * either module — or the simulator, or Android — degrades to silence instead
 * of a red screen. Every call is fire-and-forget and swallows errors.
 *
 * Sounds are tiny synthesized WAVs bundled under `assets/sfx/` (generated with
 * ffmpeg's sine source; no third-party audio). The audio session is set to the
 * ambient category (`playsInSilentMode: false`, mix with others), so the
 * effects respect the ring/silent switch and never interrupt someone's music.
 * expo-video re-asserts the playback category when the run starts.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type FeedbackCue = 'tick' | 'move' | 'phase' | 'celebrate';

type HapticsModule = typeof import('expo-haptics');
type AudioModule = typeof import('expo-audio');
type AudioPlayer = ReturnType<AudioModule['createAudioPlayer']>;

const SOUND_SOURCES = {
  tick: require('../../assets/sfx/tick.wav') as number,
  move: require('../../assets/sfx/move.wav') as number,
  celebrate: require('../../assets/sfx/celebrate.wav') as number,
} as const;

type SoundName = keyof typeof SOUND_SOURCES;

const SOUND_FOR_CUE: Record<FeedbackCue, SoundName> = {
  tick: 'tick',
  move: 'move',
  phase: 'tick',
  celebrate: 'celebrate',
};

const hapticsSupported = Platform.OS !== 'web';

let hapticsPromise: Promise<HapticsModule | null> | null = null;

function loadHaptics(): Promise<HapticsModule | null> {
  if (!hapticsPromise) {
    hapticsPromise = (async () => {
      try {
        if (!hapticsSupported) return null;
        if (requireOptionalNativeModule('ExpoHaptics') === null) return null;
        return await import('expo-haptics');
      } catch {
        return null;
      }
    })();
  }
  return hapticsPromise;
}

/** Fire one haptic for a cue. Resolves silently when haptics are unavailable. */
export function playHaptic(cue: FeedbackCue): void {
  void loadHaptics()
    .then(async (haptics) => {
      if (!haptics) return;
      switch (cue) {
        case 'tick':
          await haptics.selectionAsync();
          return;
        case 'move':
          await haptics.impactAsync(haptics.ImpactFeedbackStyle.Medium);
          return;
        case 'phase':
          await haptics.notificationAsync(haptics.NotificationFeedbackType.Success);
          return;
        case 'celebrate':
          await haptics.notificationAsync(haptics.NotificationFeedbackType.Success);
          await haptics.impactAsync(haptics.ImpactFeedbackStyle.Heavy);
          return;
      }
    })
    .catch(() => {});
}

export type CalibrationSounds = {
  /** Start loading the players so the first cue is not late. */
  preload(): void;
  play(cue: FeedbackCue): void;
  dispose(): void;
};

/**
 * One sound bank per screen: players are created lazily on `preload()` (or the
 * first `play`) and released on `dispose()`. Every method is a no-op when the
 * audio module is missing.
 */
export function createCalibrationSounds(): CalibrationSounds {
  let disposed = false;
  let bank: Promise<Partial<Record<SoundName, AudioPlayer>> | null> | null = null;

  const load = () => {
    if (!bank) {
      bank = (async () => {
        try {
          if (requireOptionalNativeModule('ExpoAudio') === null) return null;
          const audio = await import('expo-audio');
          await audio.setAudioModeAsync({
            playsInSilentMode: false,
            interruptionMode: 'mixWithOthers',
            shouldPlayInBackground: false,
          });
          const players: Partial<Record<SoundName, AudioPlayer>> = {};
          for (const name of Object.keys(SOUND_SOURCES) as SoundName[]) {
            players[name] = audio.createAudioPlayer(SOUND_SOURCES[name]);
          }
          return players;
        } catch {
          return null;
        }
      })();
    }
    return bank;
  };

  return {
    preload() {
      if (!disposed) void load().catch(() => {});
    },
    play(cue) {
      if (disposed) return;
      void load()
        .then(async (players) => {
          if (disposed || !players) return;
          const player = players[SOUND_FOR_CUE[cue]];
          if (!player) return;
          await player.seekTo(0);
          player.play();
        })
        .catch(() => {});
    },
    dispose() {
      disposed = true;
      if (!bank) return;
      void bank
        .then((players) => {
          if (!players) return;
          for (const player of Object.values(players)) {
            try {
              player?.remove();
            } catch {
              // Already released.
            }
          }
        })
        .catch(() => {});
    },
  };
}

/**
 * Play setup: where the user plays (TV or phone), the map they picked for their
 * first run, and the per-run settings (intensity + duration) they last used.
 *
 * Persisted to AsyncStorage so onboarding choices survive an app kill and the
 * level screen opens with the settings the user last ran with. Mutations are
 * serialized through one write chain, matching the other small stores.
 *
 * Deliberately not part of OnboardingContext: those answers are the
 * personalisation questionnaire, whereas these are live preferences that keep
 * changing after onboarding (every Edit on the level screen writes here).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MoverKey, OnboardingAnswers } from '@/lib/onboarding';

const STORAGE_KEY = 'cardiosurf.playSetup.v1';

export type PlayScreen = 'tv' | 'phone';

export type IntensityKey = 'light' | 'active' | 'intense';

export const INTENSITY_ORDER: IntensityKey[] = ['light', 'active', 'intense'];

/**
 * Intensity maps straight onto the map's video playback rate. expo-video keeps
 * `preservesPitch` on by default, so the soundtrack stays in key at every rate.
 * The multiplier scales the MET estimate so calories track the faster cadence.
 */
export const INTENSITY_META: Record<
  IntensityKey,
  { key: IntensityKey; label: string; blurb: string; playbackRate: number; effort: number; icon: 'leaf' | 'flash' | 'flame' }
> = {
  light: {
    key: 'light',
    label: 'Light',
    blurb: 'Easy cadence. Learn the moves.',
    playbackRate: 0.85,
    effort: 0.85,
    icon: 'leaf',
  },
  active: {
    key: 'active',
    label: 'Active',
    blurb: 'Standard pace. A real session.',
    playbackRate: 1.0,
    effort: 1.0,
    icon: 'flash',
  },
  intense: {
    key: 'intense',
    label: 'Intense',
    blurb: 'Fast cues. Maximum burn.',
    playbackRate: 1.2,
    effort: 1.2,
    icon: 'flame',
  },
};

export const DURATION_OPTIONS = [5, 10, 15] as const;
export type RunDurationMin = (typeof DURATION_OPTIONS)[number];

export type RunSettings = {
  intensity: IntensityKey;
  durationMin: RunDurationMin;
};

export type PlaySetup = {
  screen: PlayScreen | null;
  /** Level id chosen on the "Pick your first run" onboarding screen. */
  firstRunLevelId: string | null;
  /** Last-used per-run settings; null until the user first runs or edits. */
  runSettings: RunSettings | null;
  /** Set when the user chose to run without body tracking during onboarding. */
  firstRunTrackingOff: boolean;
};

export const DEFAULT_PLAY_SCREEN: PlayScreen = 'tv';

function emptySetup(): PlaySetup {
  return {
    screen: null,
    firstRunLevelId: null,
    runSettings: null,
    firstRunTrackingOff: false,
  };
}

export function isIntensityKey(value: unknown): value is IntensityKey {
  return typeof value === 'string' && INTENSITY_ORDER.includes(value as IntensityKey);
}

export function isRunDuration(value: unknown): value is RunDurationMin {
  return typeof value === 'number' && (DURATION_OPTIONS as readonly number[]).includes(value);
}

function parseRunSettings(value: unknown): RunSettings | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RunSettings>;
  if (!isIntensityKey(candidate.intensity) || !isRunDuration(candidate.durationMin)) return null;
  return { intensity: candidate.intensity, durationMin: candidate.durationMin };
}

function parse(raw: string | null): PlaySetup {
  if (!raw) return emptySetup();
  try {
    const parsed = JSON.parse(raw) as Partial<PlaySetup>;
    return {
      screen: parsed.screen === 'tv' || parsed.screen === 'phone' ? parsed.screen : null,
      firstRunLevelId:
        typeof parsed.firstRunLevelId === 'string' && parsed.firstRunLevelId
          ? parsed.firstRunLevelId
          : null,
      runSettings: parseRunSettings(parsed.runSettings),
      firstRunTrackingOff: parsed.firstRunTrackingOff === true,
    };
  } catch {
    return emptySetup();
  }
}

let cache: PlaySetup | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function read(): Promise<PlaySetup> {
  if (cache) return cache;
  try {
    cache = parse(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    cache = emptySetup();
  }
  return cache;
}

function mutate(update: (setup: PlaySetup) => void): Promise<PlaySetup> {
  const next = chain.then(async () => {
    const setup = await read();
    update(setup);
    cache = setup;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
    } catch {
      // A failed write only costs the user a repeat of a choice.
    }
    return { ...setup };
  });
  chain = next.catch(() => {});
  return next;
}

export function loadPlaySetup(): Promise<PlaySetup> {
  return read().then((setup) => ({ ...setup }));
}

/** Synchronous view for callers that already awaited a load. */
export function peekPlaySetup(): PlaySetup | null {
  return cache ? { ...cache } : null;
}

export function savePlayScreen(screen: PlayScreen): Promise<PlaySetup> {
  return mutate((setup) => {
    setup.screen = screen;
  });
}

export function saveFirstRunLevel(levelId: string | null): Promise<PlaySetup> {
  return mutate((setup) => {
    setup.firstRunLevelId = levelId;
  });
}

export function saveRunSettings(settings: RunSettings): Promise<PlaySetup> {
  return mutate((setup) => {
    setup.runSettings = { ...settings };
  });
}

export function saveFirstRunTrackingOff(off: boolean): Promise<PlaySetup> {
  return mutate((setup) => {
    setup.firstRunTrackingOff = off;
  });
}

export function resetPlaySetup(): Promise<PlaySetup> {
  return mutate((setup) => {
    Object.assign(setup, emptySetup());
  });
}

/**
 * Sensible opening settings from the baseline answer. Someone starting from
 * zero gets the short, easy session; someone already training gets a real one.
 * Fifteen minutes is never a default — that is an upgrade the user chooses.
 */
export function defaultRunSettings(mover: MoverKey | null): RunSettings {
  switch (mover) {
    case 'daily':
      return { intensity: 'intense', durationMin: 10 };
    case 'weekend':
      return { intensity: 'active', durationMin: 10 };
    case 'couch':
    case 'comeback':
    default:
      return { intensity: 'light', durationMin: 5 };
  }
}

/** Settings to run with: last-used if present, otherwise the answer-derived default. */
export function resolveRunSettings(
  setup: PlaySetup | null,
  answers: Pick<OnboardingAnswers, 'mover'>,
): RunSettings {
  return setup?.runSettings ?? defaultRunSettings(answers.mover);
}

/** Wall-clock seconds a run lasts, independent of playback rate. */
export function targetSecondsForRun(durationMin: number): number {
  return Math.max(60, Math.round(durationMin * 60));
}

/**
 * Wall-clock seconds elapsed given how much video has actually played (across
 * loops) at a playback rate. A 1.2x run covers 72 video-seconds every real
 * minute, so the video position has to be divided back out.
 */
export function wallClockElapsed(videoSecondsPlayed: number, playbackRate: number): number {
  const rate = playbackRate > 0 && Number.isFinite(playbackRate) ? playbackRate : 1;
  return Math.max(0, videoSecondsPlayed / rate);
}

export function describeRunSettings(settings: RunSettings): string {
  return `${INTENSITY_META[settings.intensity].label} · ${settings.durationMin} min`;
}

export function describePlayScreen(screen: PlayScreen | null): string {
  return screen === 'phone' ? 'On your phone' : 'On your TV';
}

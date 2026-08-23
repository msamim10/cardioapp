/**
 * Local (on-device) analytics funnel store.
 *
 * Persists lightweight counters + timestamps to AsyncStorage so the acquisition
 * funnel is inspectable on-device (see the hidden `debug-funnel` screen) without
 * waiting on ad-network / Singular dashboards. This is intentionally decoupled
 * from Singular: `analytics.ts` writes here AND forwards to Singular, but this
 * module has no native dependency and works in Expo Go / web.
 *
 * All mutations are serialized through a single write chain so the fire-and-
 * forget calls sprinkled across the app can't clobber each other.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cardiosurf.analytics.funnel.v1';
const MS_PER_DAY = 86_400_000;

/** Detectable calibration failure reasons (Phase 4). */
export type CalibrationFailureReason =
  | 'no_person'
  | 'insufficient_lighting'
  | 'too_close'
  | 'too_far'
  | 'unknown';

export const CALIBRATION_FAILURE_REASONS: CalibrationFailureReason[] = [
  'no_person',
  'insufficient_lighting',
  'too_close',
  'too_far',
  'unknown',
];

type Counters = {
  onboardingStart: number;
  calibrationAttempt: number;
  calibrationSuccess: number;
  calibrationFailure: number;
  runComplete: number;
  paywallViewed: number;
  trialStarted: number;
  paidConversion: number;
};

type FunnelState = {
  /** Epoch ms of the very first analytics init on this device. */
  installedAt: number | null;
  onboardingStartedAt: number | null;
  onboardingCompletedAt: number | null;
  firstCalibrationSuccessAt: number | null;
  firstRunCompletedAt: number | null;
  /** Calibration attempts recorded before the FIRST success (drop-off signal). */
  calibrationAttemptsBeforeFirstSuccess: number;
  counters: Counters;
  failureByReason: Record<CalibrationFailureReason, number>;
  /** Unique day-numbers (floor(epochMs / dayMs)) the app was opened, for retention. */
  openDays: number[];
  /** Highest SKAdNetwork conversion value we've committed (monotonic). */
  conversionValueMax: number;
  /** Most recent conversion value Singular reported via its updated-handler. */
  lastReportedConversionValue: number | null;
  /** True once the ATT prompt has been requested (shown at most once, ever). */
  attRequested: boolean;
};

function emptyState(): FunnelState {
  return {
    installedAt: null,
    onboardingStartedAt: null,
    onboardingCompletedAt: null,
    firstCalibrationSuccessAt: null,
    firstRunCompletedAt: null,
    calibrationAttemptsBeforeFirstSuccess: 0,
    counters: {
      onboardingStart: 0,
      calibrationAttempt: 0,
      calibrationSuccess: 0,
      calibrationFailure: 0,
      runComplete: 0,
      paywallViewed: 0,
      trialStarted: 0,
      paidConversion: 0,
    },
    failureByReason: {
      no_person: 0,
      insufficient_lighting: 0,
      too_close: 0,
      too_far: 0,
      unknown: 0,
    },
    openDays: [],
    conversionValueMax: 0,
    lastReportedConversionValue: null,
    attRequested: false,
  };
}

let cache: FunnelState | null = null;
let loadPromise: Promise<FunnelState> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function ensureLoaded(): Promise<FunnelState> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<FunnelState>;
          // Merge over defaults so newly-added fields are always present.
          cache = {
            ...emptyState(),
            ...parsed,
            counters: { ...emptyState().counters, ...(parsed.counters ?? {}) },
            failureByReason: {
              ...emptyState().failureByReason,
              ...(parsed.failureByReason ?? {}),
            },
            openDays: Array.isArray(parsed.openDays) ? parsed.openDays : [],
          };
        } else {
          cache = emptyState();
        }
      } catch {
        cache = emptyState();
      }
      return cache;
    })();
  }
  return loadPromise;
}

/** Serialize a read-modify-write so concurrent fire-and-forget calls are safe. */
function mutate(fn: (state: FunnelState) => void): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      const state = await ensureLoaded();
      fn(state);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    })
    .catch(() => {
      // Never let analytics persistence throw into a caller.
    });
  return writeChain;
}

const dayNumber = (epochMs: number) => Math.floor(epochMs / MS_PER_DAY);

/** Record install (first ever) + today's session day for retention. Idempotent. */
export function markAppOpen(now = Date.now()): Promise<void> {
  return mutate((state) => {
    if (state.installedAt === null) state.installedAt = now;
    const today = dayNumber(now);
    if (!state.openDays.includes(today)) state.openDays.push(today);
  });
}

export function markOnboardingStart(now = Date.now()): Promise<void> {
  return mutate((state) => {
    state.counters.onboardingStart += 1;
    if (state.onboardingStartedAt === null) state.onboardingStartedAt = now;
  });
}

export function markOnboardingComplete(now = Date.now()): Promise<void> {
  return mutate((state) => {
    if (state.onboardingCompletedAt === null) state.onboardingCompletedAt = now;
  });
}

export function markCalibrationAttempt(): Promise<void> {
  return mutate((state) => {
    state.counters.calibrationAttempt += 1;
    // Count attempts leading up to the first success only.
    if (state.firstCalibrationSuccessAt === null) {
      state.calibrationAttemptsBeforeFirstSuccess += 1;
    }
  });
}

/** Records a calibration success; resolves true when it was the FIRST ever. */
export async function markCalibrationSuccess(now = Date.now()): Promise<boolean> {
  let wasFirst = false;
  await mutate((state) => {
    state.counters.calibrationSuccess += 1;
    if (state.firstCalibrationSuccessAt === null) {
      state.firstCalibrationSuccessAt = now;
      wasFirst = true;
    }
  });
  return wasFirst;
}

export function markCalibrationFailure(reason: CalibrationFailureReason): Promise<void> {
  return mutate((state) => {
    state.counters.calibrationFailure += 1;
    state.failureByReason[reason] = (state.failureByReason[reason] ?? 0) + 1;
  });
}

/** Records a completed run; resolves with the new total completed-run count. */
export async function markRunComplete(now = Date.now()): Promise<number> {
  let count = 0;
  await mutate((state) => {
    state.counters.runComplete += 1;
    if (state.firstRunCompletedAt === null) state.firstRunCompletedAt = now;
    count = state.counters.runComplete;
  });
  return count;
}

export function markPaywallViewed(): Promise<void> {
  return mutate((state) => {
    state.counters.paywallViewed += 1;
  });
}

export function markTrialStarted(): Promise<void> {
  return mutate((state) => {
    state.counters.trialStarted += 1;
  });
}

export function markPaidConversion(): Promise<void> {
  return mutate((state) => {
    state.counters.paidConversion += 1;
  });
}

/**
 * Monotonically raise the committed conversion value. Returns the new value when
 * it actually increased (so the caller updates SKAN), or null when unchanged —
 * Apple discards non-increasing conversion values, so we never lower it.
 */
export async function raiseConversionValue(next: number): Promise<number | null> {
  let applied: number | null = null;
  await mutate((state) => {
    if (next > state.conversionValueMax) {
      state.conversionValueMax = next;
      applied = next;
    }
  });
  return applied;
}

export function recordReportedConversionValue(value: number): Promise<void> {
  return mutate((state) => {
    state.lastReportedConversionValue = value;
    if (value > state.conversionValueMax) state.conversionValueMax = value;
  });
}

/**
 * Atomically claim the one-time ATT prompt. Resolves true only for the caller
 * that first flips the flag, so the prompt is requested at most once ever.
 */
export async function claimAttRequest(): Promise<boolean> {
  let claimed = false;
  await mutate((state) => {
    if (!state.attRequested) {
      state.attRequested = true;
      claimed = true;
    }
  });
  return claimed;
}

export async function resetFunnel(): Promise<void> {
  await writeChain.catch(() => {});
  cache = emptyState();
  loadPromise = Promise.resolve(cache);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

export type FunnelSnapshot = {
  installedAt: number | null;
  daysSinceInstall: number | null;
  onboarding: {
    started: number;
    completed: boolean;
    /** onboardingStart -> firstCalibrationSuccess rate (0..1), null if no starts. */
    calibrationSuccessRate: number | null;
  };
  calibration: {
    attempts: number;
    successes: number;
    failures: number;
    attemptsBeforeFirstSuccess: number;
    failureByReason: Record<CalibrationFailureReason, number>;
  };
  timeToFirstRunMs: number | null;
  retention: { day1: boolean; day3: boolean; day7: boolean; activeDays: number };
  monetization: {
    paywallViews: number;
    trialStarts: number;
    paidConversions: number;
    /** paywallViews -> trialStarts rate. */
    viewToTrialRate: number | null;
    /** trialStarts -> paidConversions rate. */
    trialToPaidRate: number | null;
  };
  conversionValue: { committedMax: number; lastReported: number | null };
  runComplete: number;
};

const rate = (num: number, denom: number): number | null =>
  denom > 0 ? num / denom : null;

/** Compute a read-only funnel snapshot for the debug screen. */
export async function getFunnelSnapshot(now = Date.now()): Promise<FunnelSnapshot> {
  const state = await ensureLoaded();
  const installDay = state.installedAt !== null ? dayNumber(state.installedAt) : null;
  const returnedOnOffset = (offset: number): boolean =>
    installDay !== null && state.openDays.includes(installDay + offset);

  return {
    installedAt: state.installedAt,
    daysSinceInstall:
      state.installedAt !== null
        ? Math.floor((now - state.installedAt) / MS_PER_DAY)
        : null,
    onboarding: {
      started: state.counters.onboardingStart,
      completed: state.onboardingCompletedAt !== null,
      calibrationSuccessRate: rate(
        state.counters.calibrationSuccess,
        state.counters.onboardingStart,
      ),
    },
    calibration: {
      attempts: state.counters.calibrationAttempt,
      successes: state.counters.calibrationSuccess,
      failures: state.counters.calibrationFailure,
      attemptsBeforeFirstSuccess: state.calibrationAttemptsBeforeFirstSuccess,
      failureByReason: { ...state.failureByReason },
    },
    timeToFirstRunMs:
      state.installedAt !== null && state.firstRunCompletedAt !== null
        ? state.firstRunCompletedAt - state.installedAt
        : null,
    retention: {
      day1: returnedOnOffset(1),
      day3: returnedOnOffset(3),
      day7: returnedOnOffset(7),
      activeDays: state.openDays.length,
    },
    monetization: {
      paywallViews: state.counters.paywallViewed,
      trialStarts: state.counters.trialStarted,
      paidConversions: state.counters.paidConversion,
      viewToTrialRate: rate(state.counters.trialStarted, state.counters.paywallViewed),
      trialToPaidRate: rate(state.counters.paidConversion, state.counters.trialStarted),
    },
    conversionValue: {
      committedMax: state.conversionValueMax,
      lastReported: state.lastReportedConversionValue,
    },
    runComplete: state.counters.runComplete,
  };
}

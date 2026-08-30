/**
 * Durable calibration SETUP profile.
 *
 * Deliberately does NOT store `PoseCalibrationSnapshot`. That snapshot is a
 * camera-space reference pose (centerX / hipY / bodyHeight in normalized frame
 * coordinates), it self-adapts while a run is in progress, and
 * `isValidCalibrationSnapshot` rejects anything older than POSE_LOSS_GRACE_MS.
 * It describes where the body sat in one particular frame of one particular
 * camera placement, so reusing it across sessions would mis-scale every move
 * threshold. The measurement genuinely has to happen per session.
 *
 * What IS stable is the setup KNOWLEDGE: whether this device has ever completed
 * calibration, and the user's scale-invariant body proportions. That lets a
 * returning user skip the teaching UI and drop straight into a fast sensor lock,
 * which is the friction the per-run ceremony was actually creating.
 *
 * Mutations are serialized through a single write chain, matching funnelStore.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cardiosurf.calibration.profile.v1';

/**
 * Ratios of torso length and shoulder width to overall body height. Unlike the
 * raw baseline these are independent of how far the user stood from the camera,
 * so they stay comparable between sessions.
 */
export type BodyProportions = {
  torsoRatio: number;
  shoulderRatio: number;
};

export type CalibrationProfile = {
  firstCompletedAt: number | null;
  lastCompletedAt: number | null;
  completedCount: number;
  proportions: BodyProportions | null;
  /** Set by an explicit "Recalibrate" action; consumed by the next preflight. */
  guidanceRequested: boolean;
};

/**
 * Fractional difference at which fresh proportions are treated as a different
 * body rather than measurement noise, so a shared device re-teaches setup.
 */
const PROPORTION_MISMATCH = 0.25;

function emptyProfile(): CalibrationProfile {
  return {
    firstCompletedAt: null,
    lastCompletedAt: null,
    completedCount: 0,
    proportions: null,
    guidanceRequested: false,
  };
}

const finitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

function parseProportions(value: unknown): BodyProportions | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BodyProportions>;
  if (!finitePositive(candidate.torsoRatio) || !finitePositive(candidate.shoulderRatio)) {
    return null;
  }
  return {
    torsoRatio: candidate.torsoRatio,
    shoulderRatio: candidate.shoulderRatio,
  };
}

function parse(raw: string | null): CalibrationProfile {
  if (!raw) return emptyProfile();
  try {
    const parsed = JSON.parse(raw) as Partial<CalibrationProfile>;
    const base = emptyProfile();
    return {
      firstCompletedAt:
        typeof parsed.firstCompletedAt === 'number' && Number.isFinite(parsed.firstCompletedAt)
          ? parsed.firstCompletedAt
          : base.firstCompletedAt,
      lastCompletedAt:
        typeof parsed.lastCompletedAt === 'number' && Number.isFinite(parsed.lastCompletedAt)
          ? parsed.lastCompletedAt
          : base.lastCompletedAt,
      completedCount:
        typeof parsed.completedCount === 'number' && Number.isFinite(parsed.completedCount)
          ? Math.max(0, Math.floor(parsed.completedCount))
          : base.completedCount,
      proportions: parseProportions(parsed.proportions),
      guidanceRequested: parsed.guidanceRequested === true,
    };
  } catch {
    return emptyProfile();
  }
}

let cache: CalibrationProfile | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function read(): Promise<CalibrationProfile> {
  if (cache) return cache;
  try {
    cache = parse(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    cache = emptyProfile();
  }
  return cache;
}

function mutate(
  update: (profile: CalibrationProfile) => void,
): Promise<CalibrationProfile> {
  const next = chain.then(async () => {
    const profile = await read();
    update(profile);
    cache = profile;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch {
      // A failed write only costs the user a repeat of the teaching UI.
    }
    return { ...profile };
  });
  chain = next.catch(() => {});
  return next;
}

export function loadCalibrationProfile(): Promise<CalibrationProfile> {
  return read().then((profile) => ({ ...profile }));
}

/**
 * Synchronous view of the profile for callers that already awaited a load and
 * only need it to pick an initial render mode.
 */
export function peekCalibrationProfile(): CalibrationProfile | null {
  return cache ? { ...cache } : null;
}

export function recordCalibrationComplete(
  proportions: BodyProportions | null,
  now = Date.now(),
): Promise<CalibrationProfile> {
  return mutate((profile) => {
    if (profile.firstCompletedAt === null) profile.firstCompletedAt = now;
    profile.lastCompletedAt = now;
    profile.completedCount += 1;
    if (proportions) profile.proportions = proportions;
    profile.guidanceRequested = false;
  });
}

/** Queues full setup guidance for the next preflight, without erasing history. */
export function requestCalibrationGuidance(): Promise<CalibrationProfile> {
  return mutate((profile) => {
    profile.guidanceRequested = true;
  });
}

export function resetCalibrationProfile(): Promise<CalibrationProfile> {
  return mutate((profile) => {
    Object.assign(profile, emptyProfile());
  });
}

/**
 * Whether preflight should show the full teaching UI. Errs toward guidance:
 * being over-instructed is cheaper than a user who never learns the framing.
 */
export function shouldGuideCalibration(profile: CalibrationProfile | null): boolean {
  if (!profile) return true;
  return profile.guidanceRequested || profile.completedCount === 0;
}

/**
 * True when a fresh measurement looks like a different body than the stored one,
 * which is the one case worth re-teaching setup without being asked.
 */
export function proportionsMismatch(
  stored: BodyProportions | null,
  fresh: BodyProportions | null,
): boolean {
  if (!stored || !fresh) return false;
  const drift = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b);
  return (
    drift(stored.torsoRatio, fresh.torsoRatio) > PROPORTION_MISMATCH ||
    drift(stored.shoulderRatio, fresh.shoulderRatio) > PROPORTION_MISMATCH
  );
}

/** Derives session-independent proportions from a preflight snapshot baseline. */
export function proportionsFromBaseline(baseline: {
  torso: number;
  bodyHeight: number;
  shoulderWidth: number;
}): BodyProportions | null {
  if (!finitePositive(baseline.bodyHeight)) return null;
  const torsoRatio = baseline.torso / baseline.bodyHeight;
  const shoulderRatio = baseline.shoulderWidth / baseline.bodyHeight;
  if (!finitePositive(torsoRatio) || !finitePositive(shoulderRatio)) return null;
  return { torsoRatio, shoulderRatio };
}

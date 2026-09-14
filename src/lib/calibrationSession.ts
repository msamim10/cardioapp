/**
 * Once-per-session calibration + in-run warm-up: the pure decisions.
 *
 * Kept free of native imports so `scripts/replay-preflight-flow.ts` can pin
 * them; `playSetup.ts` persists the values and re-exports these helpers.
 */

/**
 * The once-per-session calibration marker. The camera-space baseline itself
 * is re-measured live by the run (see calibrationProfile.ts for why a stale
 * baseline must never be reused); what is kept is WHEN and HOW the user last
 * framed up, so the next run within `CALIBRATION_SESSION_MS` can skip the
 * preflight screen and just confirm framing during its own countdown.
 */
export type CalibrationBaseline = {
  capturedAt: number;
  cameraFacing: 'front' | 'back';
  orientation: 'portrait' | 'landscape';
  /** Scale-invariant body proportions at capture, for shared-device checks. */
  torsoRatio: number | null;
  shoulderRatio: number | null;
};

/** A stored baseline older than this re-runs the full preflight. */
export const CALIBRATION_SESSION_MS = 12 * 60 * 60 * 1000;

/** The in-run warm-up (oversized move prompts, misses forgiven) shows for this many runs. */
export const WARMUP_RUN_COUNT = 2;

/** Length of the in-run warm-up window (wall clock). */
export const WARMUP_SECONDS = 15;

/**
 * Whether a run may skip the preflight screen: a framing hold completed on
 * this device within the session window.
 */
export function hasFreshCalibration(
  baseline: CalibrationBaseline | null | undefined,
  now = Date.now(),
): boolean {
  if (!baseline) return false;
  const age = now - baseline.capturedAt;
  return age >= 0 && age <= CALIBRATION_SESSION_MS;
}

/** Whether the next run should open with the warm-up window. */
export function shouldShowWarmup(setup: { warmupRunsCompleted: number } | null): boolean {
  return (setup?.warmupRunsCompleted ?? 0) < WARMUP_RUN_COUNT;
}

export function parseCalibrationBaseline(value: unknown): CalibrationBaseline | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CalibrationBaseline>;
  if (typeof candidate.capturedAt !== 'number' || !Number.isFinite(candidate.capturedAt)) return null;
  const ratio = (ratioValue: unknown) =>
    typeof ratioValue === 'number' && Number.isFinite(ratioValue) && ratioValue > 0 ? ratioValue : null;
  return {
    capturedAt: candidate.capturedAt,
    cameraFacing: candidate.cameraFacing === 'back' ? 'back' : 'front',
    orientation: candidate.orientation === 'landscape' ? 'landscape' : 'portrait',
    torsoRatio: ratio(candidate.torsoRatio),
    shoulderRatio: ratio(candidate.shoulderRatio),
  };
}

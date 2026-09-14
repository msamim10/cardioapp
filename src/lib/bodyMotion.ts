/**
 * "Is the body clearly moving?" — the move check's second pass criterion.
 *
 * The preflight move prompts (`preflightFlow.ts`, phase `moves`) pass on the
 * classified move, on significant motion, or on their own when the window
 * ends. The `PoseAnalyzer` classifiers need a clean, cooled-down, re-armed
 * movement to fire; a half-hearted duck or a shuffle to the side does not
 * classify, yet it is unmistakably a person trying. This helper answers that
 * from the raw frames: the body centre (shoulder/hip centre in normalized
 * frame space) has travelled at least `MOTION_MIN_TORSO_FRACTION` of the torso
 * length within the last `MOTION_WINDOW_MS`.
 *
 * Pure and read-only beside the analyzer, like `skeletonFraming.ts`.
 */

import type { PoseFrame, PoseJoint, PoseKeypoint } from '@/lib/poseTracking';

export type BodyCentreSample = {
  at: number;
  /** Centre of the visible shoulders + hips, normalized 0..1. */
  x: number;
  y: number;
  /** Shoulder line → hip line distance, fraction of the frame. */
  torso: number;
};

/** Displacement must happen within this span to count (a slow sway does not). */
export const MOTION_WINDOW_MS = 500;
/**
 * Body-centre travel, as a fraction of the torso length, that counts as
 * significant. A jump lifts the body ≈ 0.3 torso, a duck drops the shoulders
 * ≈ 0.5, a side step moves the hips ≈ 0.6; detector jitter is ≈ 0.03.
 */
export const MOTION_MIN_TORSO_FRACTION = 0.25;
/** Same confidence the framing helper and the overlay use to trust a joint. */
const VISIBLE_CONFIDENCE = 0.45;
const CORE_JOINTS: PoseJoint[] = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Body centre of one frame, or null when shoulders + hips are not seen. */
export function bodyCentre(frame: PoseFrame | null): BodyCentreSample | null {
  if (!frame) return null;
  const visible = new Map<PoseJoint, PoseKeypoint>();
  for (const point of frame.keypoints) {
    if (point.confidence >= VISIBLE_CONFIDENCE && CORE_JOINTS.includes(point.name)) visible.set(point.name, point);
  }
  if (visible.size < 3) return null;
  const shoulders = [visible.get('leftShoulder'), visible.get('rightShoulder')].filter(
    (point): point is PoseKeypoint => !!point,
  );
  const hips = [visible.get('leftHip'), visible.get('rightHip')].filter((point): point is PoseKeypoint => !!point);
  const shoulderY = average(shoulders.map((point) => point.y));
  const hipY = average(hips.map((point) => point.y));
  const torso = Math.max(0, hipY - shoulderY);
  if (torso <= 0) return null;
  const points = [...shoulders, ...hips];
  return { at: frame.timestamp, x: average(points.map((point) => point.x)), y: (shoulderY + hipY) / 2, torso };
}

/**
 * Append a sample and drop everything older than the window. Returns the new
 * history (input untouched). A null sample (body not seen) keeps the history.
 */
export function pushMotionSample(
  history: readonly BodyCentreSample[],
  sample: BodyCentreSample | null,
  windowMs = MOTION_WINDOW_MS,
): BodyCentreSample[] {
  if (!sample) return [...history];
  const cutoff = sample.at - windowMs;
  return [...history.filter((entry) => entry.at >= cutoff && entry.at <= sample.at), sample];
}

/**
 * True when the newest sample sits at least `minFraction × torso` away from
 * some sample inside the window — the body moved, whatever the classifiers
 * made of it.
 */
export function significantMotion(
  history: readonly BodyCentreSample[],
  minFraction = MOTION_MIN_TORSO_FRACTION,
): boolean {
  if (history.length < 2) return false;
  const latest = history[history.length - 1];
  const threshold = minFraction * latest.torso;
  if (!(threshold > 0)) return false;
  for (let index = 0; index < history.length - 1; index += 1) {
    const past = history[index];
    const dx = latest.x - past.x;
    const dy = latest.y - past.y;
    if (Math.hypot(dx, dy) >= threshold) return true;
  }
  return false;
}

/**
 * Read-only framing guidance derived from a single `PoseFrame`.
 *
 * Sits beside `PoseAnalyzer` (never inside it): the analyzer decides when the
 * body is calibrated; this only tells the user how to stand so that lock
 * happens quickly. Coordinates are the detector's normalized 0..1 frame space.
 *
 * UPPER BODY ONLY. The analyzer's baseline and every move classifier run on
 * shoulders + hips (jump/duck = shoulder/hip vertical motion, left/right =
 * lateral shift of the hip centre; ankles only corroborate a jump when seen),
 * so framing passes on head + shoulders + hips. Legs are never required: a
 * phone on a desk that crops the user at the thigh frames fine, and nobody
 * has to back off until the coaching text is unreadable.
 *
 * Size is judged on the torso (shoulder line → hip line) as a fraction of the
 * frame height, which is stable whether or not the legs are visible.
 */

import type { PoseFrame, PoseJoint, PoseKeypoint } from '@/lib/poseTracking';

export type FramingVerdict = 'searching' | 'closer' | 'back' | 'center' | 'ok';

export type SkeletonFraming = {
  /** Shoulder line → hip line distance as a fraction of the frame (0 when unseen). */
  torsoFraction: number;
  /** Key joints missing or pressed against a frame edge (head cut off, etc). */
  clippedJoints: PoseJoint[];
  /** True when the torso fills the target band, is centred and nothing is clipped. */
  ok: boolean;
  verdict: FramingVerdict;
};

/**
 * Below this the torso is too small for reliable move detection: step closer.
 * 0.16 of the frame ≈ a full standing body spanning ~45 % of the frame.
 */
export const FRAMING_MIN_TORSO = 0.16;
/**
 * Above this the head is about to leave the frame on a jump: step back.
 * 0.34 ≈ a standing body that would run off both edges.
 */
export const FRAMING_MAX_TORSO = 0.34;
/** A key joint within this distance of a side or the bottom edge counts as clipped. */
export const FRAMING_EDGE_MARGIN = 0.03;
/**
 * Headroom above the head so a jump stays inside the frame. A jump lifts the
 * body by ~10 % of standing height ≈ 0.3 torso; this is the floor for it.
 */
export const FRAMING_HEAD_MARGIN = 0.07;
/** The hip centre must sit inside this band, else "center up". */
export const FRAMING_CENTER_MIN_X = 0.22;
export const FRAMING_CENTER_MAX_X = 0.78;
/** Same confidence the skeleton overlay uses to draw a joint. */
const VISIBLE_CONFIDENCE = 0.45;

/** Joints the framing outline expects to see on a standing (or seated) body. */
const CORE_JOINTS: PoseJoint[] = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];

const nearEdge = (point: PoseKeypoint) =>
  point.x <= FRAMING_EDGE_MARGIN ||
  point.x >= 1 - FRAMING_EDGE_MARGIN ||
  point.y <= FRAMING_EDGE_MARGIN ||
  point.y >= 1 - FRAMING_EDGE_MARGIN;

export const NO_SKELETON_FRAMING: SkeletonFraming = {
  torsoFraction: 0,
  clippedJoints: [],
  ok: false,
  verdict: 'searching',
};

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function skeletonFraming(frame: PoseFrame | null): SkeletonFraming {
  if (!frame) return NO_SKELETON_FRAMING;
  const visible = new Map<PoseJoint, PoseKeypoint>();
  for (const point of frame.keypoints) {
    if (point.confidence >= VISIBLE_CONFIDENCE) visible.set(point.name, point);
  }
  // Without shoulders and hips there is no body to frame — the analyzer would
  // report `searching` for the same frame.
  const coreVisible = CORE_JOINTS.filter((name) => visible.has(name));
  if (coreVisible.length < 3) return NO_SKELETON_FRAMING;

  const shoulders = [visible.get('leftShoulder'), visible.get('rightShoulder')].filter(
    (point): point is PoseKeypoint => !!point,
  );
  const hips = [visible.get('leftHip'), visible.get('rightHip')].filter(
    (point): point is PoseKeypoint => !!point,
  );
  const shoulderY = average(shoulders.map((point) => point.y));
  const hipY = average(hips.map((point) => point.y));
  const hipX = average(hips.map((point) => point.x));
  const torsoFraction = Math.max(0, Math.min(1, hipY - shoulderY));

  const clippedJoints: PoseJoint[] = [];
  // Core joints: missing OR at the edge both mean part of the torso is out.
  for (const name of CORE_JOINTS) {
    const point = visible.get(name);
    if (!point || nearEdge(point)) clippedJoints.push(name);
  }
  // Head: the nose (or the neck when the face is turned) must be seen and
  // have headroom for a jump. Missing head → the crown is already out.
  const headPoint = visible.get('nose') ?? visible.get('neck');
  if (!headPoint || headPoint.y < FRAMING_HEAD_MARGIN || nearEdge(headPoint)) {
    clippedJoints.push('nose');
  }

  let verdict: FramingVerdict;
  if (clippedJoints.length > 0 || torsoFraction > FRAMING_MAX_TORSO) {
    verdict = 'back';
  } else if (torsoFraction < FRAMING_MIN_TORSO) {
    verdict = 'closer';
  } else if (hipX < FRAMING_CENTER_MIN_X || hipX > FRAMING_CENTER_MAX_X) {
    verdict = 'center';
  } else {
    verdict = 'ok';
  }
  return { torsoFraction, clippedJoints, ok: verdict === 'ok', verdict };
}

/**
 * Silent in-run check (runs that skipped the preflight screen): the analyzer
 * can work from this frame — shoulders + hips seen, nothing clipped. Size and
 * centring are not enforced here; the run's own coaching handles those.
 */
export function bodyVisible(frame: PoseFrame | null): boolean {
  const framing = skeletonFraming(frame);
  return framing.verdict !== 'searching' && framing.clippedJoints.length === 0;
}

/**
 * The ONE big word shown far from the phone (≥ 72 pt). Short enough to read
 * from across a room, no punctuation to squint at.
 */
export const FRAMING_WORD: Record<FramingVerdict, string> = {
  searching: 'Step in',
  closer: 'Closer',
  back: 'Step back',
  center: 'Center up',
  ok: 'Hold still',
};

/** Longer coaching line for screen readers / the compact layouts. */
export const FRAMING_MESSAGE: Record<FramingVerdict, string> = {
  searching: 'Step into the frame',
  closer: 'Move closer',
  back: 'Step back',
  center: 'Step toward the middle',
  ok: 'Perfect, hold still.',
};

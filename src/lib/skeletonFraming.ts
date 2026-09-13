/**
 * Read-only framing guidance derived from a single `PoseFrame`.
 *
 * Sits beside `PoseAnalyzer` (never inside it): the analyzer decides when the
 * body is calibrated; this only tells the user how to stand so that lock
 * happens quickly. Coordinates are the detector's normalized 0..1 frame space,
 * so a `heightFraction` of 0.7 means the skeleton spans 70% of the camera
 * frame's height.
 */

import type { PoseFrame, PoseJoint, PoseKeypoint } from '@/lib/poseTracking';

export type FramingVerdict = 'searching' | 'closer' | 'back' | 'ok';

export type SkeletonFraming = {
  /** Skeleton bounding-box height as a fraction of the frame (0 when unseen). */
  heightFraction: number;
  /** Key joints missing or pressed against a frame edge (feet cut off, etc). */
  clippedJoints: PoseJoint[];
  /** True when the body fills the target band and nothing is clipped. */
  ok: boolean;
  verdict: FramingVerdict;
};

/** Below this the body is too small for reliable move detection: step closer. */
export const FRAMING_MIN_HEIGHT = 0.6;
/** Above this the body is about to leave the frame on a jump: step back. */
export const FRAMING_MAX_HEIGHT = 0.8;
/** A key joint within this distance of an edge counts as clipped. */
export const FRAMING_EDGE_MARGIN = 0.03;
/** Same confidence the skeleton overlay uses to draw a joint. */
const VISIBLE_CONFIDENCE = 0.45;

/** Joints the framing outline expects to see on a standing body. */
const CORE_JOINTS: PoseJoint[] = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];
const ANKLE_JOINTS: PoseJoint[] = ['leftAnkle', 'rightAnkle'];

const nearEdge = (point: PoseKeypoint) =>
  point.x <= FRAMING_EDGE_MARGIN ||
  point.x >= 1 - FRAMING_EDGE_MARGIN ||
  point.y <= FRAMING_EDGE_MARGIN ||
  point.y >= 1 - FRAMING_EDGE_MARGIN;

export const NO_SKELETON_FRAMING: SkeletonFraming = {
  heightFraction: 0,
  clippedJoints: [],
  ok: false,
  verdict: 'searching',
};

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

  const ys = [...visible.values()].map((point) => point.y);
  const heightFraction = Math.max(0, Math.min(1, Math.max(...ys) - Math.min(...ys)));
  const lowestY = Math.max(...ys);

  const clippedJoints: PoseJoint[] = [];
  // Core joints: missing OR at the edge both mean part of the torso is out.
  for (const name of CORE_JOINTS) {
    const point = visible.get(name);
    if (!point || nearEdge(point)) clippedJoints.push(name);
  }
  // Head: a nose against the top edge means the crown is already out. When the
  // nose is unseen (face turned) the neck stands in for it.
  const nose = visible.get('nose');
  const neck = visible.get('neck');
  const headPoint = nose ?? neck;
  if (!headPoint || nearEdge(headPoint)) clippedJoints.push('nose');
  // Ankles are expected once the body runs to the bottom edge: if the lowest
  // visible joint sits against the floor of the frame and no ankle is seen,
  // the feet are cut off. A small body with ankles simply out of the
  // detector's confidence is a "move closer" case, not clipping.
  const ankles = ANKLE_JOINTS.map((name) => visible.get(name)).filter(
    (point): point is PoseKeypoint => !!point,
  );
  if (ankles.length === 0) {
    if (lowestY >= 1 - FRAMING_EDGE_MARGIN) clippedJoints.push('leftAnkle', 'rightAnkle');
  } else {
    for (const point of ankles) {
      if (nearEdge(point)) clippedJoints.push(point.name);
    }
  }

  let verdict: FramingVerdict;
  if (clippedJoints.length > 0 || heightFraction > FRAMING_MAX_HEIGHT) {
    verdict = 'back';
  } else if (heightFraction < FRAMING_MIN_HEIGHT) {
    verdict = 'closer';
  } else {
    verdict = 'ok';
  }
  return { heightFraction, clippedJoints, ok: verdict === 'ok', verdict };
}

/** User-facing coaching line for a framing verdict (no jargon). */
export const FRAMING_MESSAGE: Record<FramingVerdict, string> = {
  searching: 'Step into the outline',
  closer: 'Move closer',
  back: 'Move back',
  ok: 'Perfect, hold still.',
};

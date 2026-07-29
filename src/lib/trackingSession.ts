import {
  isValidCalibrationSnapshot,
  POSE_LOSS_GRACE_MS,
  type PoseCalibrationSnapshot,
} from '@/lib/poseTracking';

type Handoff = {
  runId: string;
  levelId: string;
  createdAt: number;
  snapshot: PoseCalibrationSnapshot;
};

let pendingHandoff: Handoff | null = null;

export function createTrackingRunId(levelId: string, now = Date.now()) {
  return `${levelId}:${now}:${Math.random().toString(36).slice(2, 9)}`;
}

export function stageTrackingHandoff(
  runId: string,
  levelId: string,
  snapshot: PoseCalibrationSnapshot,
  now = Date.now(),
): boolean {
  if (!runId || !levelId || !isValidCalibrationSnapshot(snapshot, now)) {
    pendingHandoff = null;
    return false;
  }
  pendingHandoff = { runId, levelId, snapshot, createdAt: now };
  return true;
}

export function consumeTrackingHandoff(
  runId: string | undefined,
  levelId: string,
  now = Date.now(),
): PoseCalibrationSnapshot | null {
  const handoff = pendingHandoff;
  pendingHandoff = null;
  if (
    !handoff ||
    !runId ||
    handoff.runId !== runId ||
    handoff.levelId !== levelId ||
    now - handoff.createdAt > POSE_LOSS_GRACE_MS ||
    !isValidCalibrationSnapshot(handoff.snapshot, now)
  ) {
    return null;
  }
  return handoff.snapshot;
}

export function clearTrackingHandoff() {
  pendingHandoff = null;
}

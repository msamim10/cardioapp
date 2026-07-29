export const POSE_JOINTS = [
  'nose',
  'neck',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'root',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
] as const;

export type PoseJoint = (typeof POSE_JOINTS)[number];
export type Move = 'Jump' | 'Duck' | 'Left' | 'Right';

export type PoseKeypoint = {
  name: PoseJoint;
  x: number;
  y: number;
  confidence: number;
};

export type PoseFrame = {
  keypoints: PoseKeypoint[];
  origin: 'native' | 'demo';
  timestamp: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type PoseTrackingMode = 'real' | 'demo' | 'unavailable';
export type TrackingStatus =
  | 'calibrating'
  | 'tracking'
  | 'searching'
  | 'reconnecting'
  | 'demo'
  | 'unavailable';
export type PoseReadiness = 'ready' | 'return-to-center';

export type PoseReference = {
  centerX: number;
  floorY: number | null;
  bodyHeight: number;
  bodyWidth: number;
};

export type PoseFeedback = {
  calibrationProgress: number;
  instruction: string;
  framingHint: string;
  readiness: PoseReadiness;
  reference: PoseReference | null;
};

export const INITIAL_POSE_FEEDBACK: PoseFeedback = {
  calibrationProgress: 0,
  instruction: 'Stand centered — calibrating',
  framingHint: 'Keep shoulders and hips visible; knees help, full body is best for jumps',
  readiness: 'ready',
  reference: null,
};

export type PoseScore = {
  /** Action bonuses only. Compose with playback via `totalWorkoutScore`. */
  score: number;
  combo: number;
  latestMove: Move | null;
  latestMoveAt: number;
  counts: Record<Move, number>;
};

export const INITIAL_POSE_SCORE: PoseScore = {
  score: 0,
  combo: 0,
  latestMove: null,
  latestMoveAt: 0,
  counts: { Jump: 0, Duck: 0, Left: 0, Right: 0 },
};

export const SKELETON_EDGES: readonly [PoseJoint, PoseJoint][] = [
  ['nose', 'neck'],
  ['neck', 'leftShoulder'],
  ['neck', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['neck', 'root'],
  ['root', 'leftHip'],
  ['root', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
];

type Geometry = {
  centerX: number;
  hipY: number;
  shoulderY: number;
  headY: number;
  ankleY: number | null;
  torso: number;
  bodyHeight: number;
  shoulderWidth: number;
  kneeBend: number;
  confidence: number;
};

type Baseline = Omit<Geometry, 'confidence' | 'kneeBend' | 'ankleY'> & {
  ankleY: number | null;
};

export type PoseCalibrationSnapshot = {
  version: 1;
  capturedAt: number;
  sourceWidth: number;
  sourceHeight: number;
  baseline: Baseline;
};

const CORE_JOINTS: PoseJoint[] = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
];

const CORE_CONFIDENCE = 0.42;
const OPTIONAL_CONFIDENCE = 0.32;
const CALIBRATION_FRAMES = 20;
const COOLDOWN_MS = 280;
const REARM_MS = 220;
/** Preserve calibration and combo through ordinary occlusions up to six seconds. */
export const POSE_LOSS_GRACE_MS = 6_000;
export const POSE_REACQUIRE_FRAMES = 3;
const FRAME_GAP_MS = 250;
const RECONNECTED_MS = 900;
const DUCK_EVIDENCE_FRAMES = 2;
const ALL_MOVES: Move[] = ['Jump', 'Duck', 'Left', 'Right'];

const average = (...values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function distance(a: PoseKeypoint, b: PoseKeypoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angle(a: PoseKeypoint, b: PoseKeypoint, c: PoseKeypoint) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!denominator) return Math.PI;
  const cosine = Math.max(-1, Math.min(1, (ab.x * cb.x + ab.y * cb.y) / denominator));
  return Math.acos(cosine);
}

function geometry(points: PoseKeypoint[]): Geometry | null {
  const map = new Map(points.map((point) => [point.name, point]));
  const core = CORE_JOINTS.map((name) => map.get(name));
  if (core.some((point) => !point || point.confidence < CORE_CONFIDENCE)) return null;

  const visible = core as PoseKeypoint[];
  const [ls, rs, lh, rh] = visible;
  const lk = map.get('leftKnee');
  const rk = map.get('rightKnee');
  const la = map.get('leftAnkle');
  const ra = map.get('rightAnkle');
  const nose = map.get('nose');
  const neck = map.get('neck');
  const shoulderY = average(ls.y, rs.y);
  const hipY = average(lh.y, rh.y);
  const torso = Math.max(0.04, Math.abs(hipY - shoulderY));
  const reliableAnkles = [la, ra].filter(
    (point): point is PoseKeypoint => !!point && point.confidence >= OPTIONAL_CONFIDENCE,
  );
  const ankleY = reliableAnkles.length
    ? average(...reliableAnkles.map((point) => point.y))
    : null;
  const headY =
    nose && nose.confidence >= OPTIONAL_CONFIDENCE
      ? nose.y
      : neck && neck.confidence >= OPTIONAL_CONFIDENCE
        ? neck.y - torso * 0.45
        : shoulderY - torso * 0.45;
  const bodyHeight = Math.max(
    torso * 2.5,
    ankleY === null ? torso * 3.2 : ankleY - headY,
  );
  const bends: number[] = [];
  if (lk && la && lk.confidence >= OPTIONAL_CONFIDENCE && la.confidence >= OPTIONAL_CONFIDENCE) {
    bends.push(Math.PI - angle(lh, lk, la));
  }
  if (rk && ra && rk.confidence >= OPTIONAL_CONFIDENCE && ra.confidence >= OPTIONAL_CONFIDENCE) {
    bends.push(Math.PI - angle(rh, rk, ra));
  }
  return {
    centerX: average(lh.x, rh.x),
    hipY,
    shoulderY,
    headY,
    ankleY,
    torso,
    bodyHeight,
    shoulderWidth: Math.max(0.04, distance(ls, rs)),
    kneeBend: bends.length ? average(...bends) : 0,
    confidence: average(...visible.map((point) => point.confidence)),
  };
}

export class PoseAnalyzer {
  private smoothed = new Map<PoseJoint, PoseKeypoint>();
  private calibration: Geometry[] = [];
  private baseline: Baseline | null = null;
  private armedMoves = new Set<Move>(ALL_MOVES);
  private neutralSince = 0;
  private lastMoveAt = -Infinity;
  private lastValidAt = 0;
  private previousGeometry: { value: Geometry; timestamp: number } | null = null;
  private lossStartedAt = 0;
  private reacquisition: Geometry[] = [];
  private reacquireNeedsNeutral = false;
  private duckEvidenceFrames = 0;
  private duckDescentSeen = false;
  private duckSuppressedUntilNeutral = false;
  private reconnectedUntil = 0;
  private sourceSize: { width: number; height: number } | null = null;

  reset() {
    this.smoothed.clear();
    this.calibration = [];
    this.baseline = null;
    this.armedMoves = new Set(ALL_MOVES);
    this.neutralSince = 0;
    this.lastMoveAt = -Infinity;
    this.lastValidAt = 0;
    this.previousGeometry = null;
    this.lossStartedAt = 0;
    this.reacquisition = [];
    this.reacquireNeedsNeutral = false;
    this.duckEvidenceFrames = 0;
    this.duckDescentSeen = false;
    this.duckSuppressedUntilNeutral = false;
    this.reconnectedUntil = 0;
    this.sourceSize = null;
  }

  /**
   * Export only the spatial reference needed for a camera handoff. Scoring,
   * armed actions, smoothing, and movement evidence intentionally stay out.
   */
  calibrationSnapshot(capturedAt = Date.now()): PoseCalibrationSnapshot | null {
    if (!this.baseline || !this.sourceSize || !Number.isFinite(capturedAt)) return null;
    return {
      version: 1,
      capturedAt,
      sourceWidth: this.sourceSize.width,
      sourceHeight: this.sourceSize.height,
      baseline: { ...this.baseline },
    };
  }

  /**
   * Restore a recent preflight reference in loss/reacquisition mode. The first
   * workout frames therefore cannot score and must confirm a neutral body.
   */
  hydrateCalibration(snapshot: PoseCalibrationSnapshot, now = Date.now()): boolean {
    if (!isValidCalibrationSnapshot(snapshot, now)) return false;
    this.reset();
    this.baseline = { ...snapshot.baseline };
    this.sourceSize = {
      width: snapshot.sourceWidth,
      height: snapshot.sourceHeight,
    };
    this.lastValidAt = snapshot.capturedAt;
    this.lossStartedAt = snapshot.capturedAt;
    this.reacquireNeedsNeutral = true;
    this.armedMoves.clear();
    return true;
  }

  markTrackingLost(timestamp = Date.now()) {
    if (!this.baseline) {
      this.calibration = [];
      return;
    }
    if (!this.lossStartedAt) this.lossStartedAt = timestamp;
    this.smoothed.clear();
    this.previousGeometry = null;
    this.neutralSince = 0;
    this.duckEvidenceFrames = 0;
    this.duckDescentSeen = false;
  }

  process(frame: PoseFrame): {
    keypoints: PoseKeypoint[];
    status: Exclude<TrackingStatus, 'demo'>;
    move: Move | null;
    feedback: PoseFeedback;
  } {
    const sourceChanged =
      this.sourceSize &&
      (Math.abs(frame.sourceWidth / this.sourceSize.width - 1) > 0.15 ||
        Math.abs(frame.sourceHeight / this.sourceSize.height - 1) > 0.15);
    if (sourceChanged && this.baseline) this.reset();
    this.sourceSize = { width: frame.sourceWidth, height: frame.sourceHeight };

    const seen = new Set<PoseJoint>();
    for (const point of frame.keypoints) {
      seen.add(point.name);
      const previous = this.smoothed.get(point.name);
      // At the native detector's 10 FPS cadence, this removes single-frame
      // jitter while keeping visual latency close to one frame.
      const alpha = previous ? 0.58 : 1;
      this.smoothed.set(point.name, {
        ...point,
        x: previous ? previous.x + (point.x - previous.x) * alpha : point.x,
        y: previous ? previous.y + (point.y - previous.y) * alpha : point.y,
        confidence: previous
          ? previous.confidence + (point.confidence - previous.confidence) * 0.6
          : point.confidence,
      });
    }
    for (const [name, point] of this.smoothed) {
      if (seen.has(name)) continue;
      const confidence = point.confidence * 0.4;
      if (confidence < 0.2) this.smoothed.delete(name);
      else this.smoothed.set(name, { ...point, confidence });
    }

    const keypoints = [...this.smoothed.values()];
    const current = geometry(keypoints);
    if (!current) {
      this.markTrackingLost(frame.timestamp);
      return {
        keypoints,
        status: 'searching',
        move: null,
        feedback: this.feedback(
          'Tracking lost — step back into view',
          'Tracking lost — step back into view',
        ),
      };
    }

    const validGap = this.lastValidAt ? frame.timestamp - this.lastValidAt : 0;
    const lostFor = this.lossStartedAt
      ? frame.timestamp - this.lossStartedAt
      : validGap;
    if (this.baseline && (this.lossStartedAt || validGap > FRAME_GAP_MS)) {
      if (lostFor > POSE_LOSS_GRACE_MS) {
        this.reset();
        return this.process(frame);
      }
      this.lossStartedAt ||= this.lastValidAt;
      this.lastValidAt = frame.timestamp;
      return this.confirmReacquisition(current, keypoints, frame);
    }
    this.lastValidAt = frame.timestamp;

    if (!this.baseline) {
      const previous = this.calibration.at(-1);
      const stable =
        !previous ||
        (Math.abs(current.centerX - previous.centerX) / previous.shoulderWidth < 0.08 &&
          Math.abs(current.hipY - previous.hipY) / previous.bodyHeight < 0.025 &&
          Math.abs(current.shoulderWidth - previous.shoulderWidth) / previous.shoulderWidth < 0.08);
      if (!stable) this.calibration = [];
      this.calibration.push(current);
      if (this.calibration.length >= CALIBRATION_FRAMES) {
        const samples = this.calibration.slice(-CALIBRATION_FRAMES);
        this.baseline = {
          centerX: average(...samples.map((sample) => sample.centerX)),
          hipY: average(...samples.map((sample) => sample.hipY)),
          shoulderY: average(...samples.map((sample) => sample.shoulderY)),
          headY: average(...samples.map((sample) => sample.headY)),
          ankleY: medianNullable(samples.map((sample) => sample.ankleY)),
          torso: average(...samples.map((sample) => sample.torso)),
          bodyHeight: average(...samples.map((sample) => sample.bodyHeight)),
          shoulderWidth: average(...samples.map((sample) => sample.shoulderWidth)),
        };
      }
      this.previousGeometry = { value: current, timestamp: frame.timestamp };
      return {
        keypoints,
        status: this.baseline ? 'tracking' : 'calibrating',
        move: null,
        feedback: this.feedback(
          this.baseline ? 'Ready — move!' : 'Stand centered — calibrating',
          'Keep shoulders and hips visible; knees help, full body is best for jumps',
        ),
      };
    }

    const baseline = this.baseline;
    const hipVertical = (current.hipY - baseline.hipY) / baseline.bodyHeight;
    const shoulderVertical = (current.shoulderY - baseline.shoulderY) / baseline.bodyHeight;
    const headVertical = (current.headY - baseline.headY) / baseline.bodyHeight;
    const horizontal = (current.centerX - baseline.centerX) / Math.max(
      baseline.shoulderWidth,
      baseline.bodyHeight * 0.22,
    );
    const previous = this.previousGeometry;
    const elapsedSeconds = previous
      ? Math.max(0.05, Math.min(0.3, (frame.timestamp - previous.timestamp) / 1_000))
      : 0;
    const torsoVertical = average(hipVertical, shoulderVertical);
    const headShoulderVertical = average(headVertical, shoulderVertical);
    const previousTorsoVertical = previous
      ? average(
          (previous.value.hipY - baseline.hipY) / baseline.bodyHeight,
          (previous.value.shoulderY - baseline.shoulderY) / baseline.bodyHeight,
        )
      : torsoVertical;
    const upwardVelocity = elapsedSeconds
      ? (torsoVertical - previousTorsoVertical) / elapsedSeconds
      : 0;
    const previousHeadShoulderVertical = previous
      ? average(
          (previous.value.headY - baseline.headY) / baseline.bodyHeight,
          (previous.value.shoulderY - baseline.shoulderY) / baseline.bodyHeight,
        )
      : headShoulderVertical;
    const headShoulderVelocity = elapsedSeconds
      ? (headShoulderVertical - previousHeadShoulderVertical) / elapsedSeconds
      : 0;
    const ankleVertical =
      current.ankleY !== null && baseline.ankleY !== null
        ? (current.ankleY - baseline.ankleY) / baseline.bodyHeight
        : null;
    const torsoCompression = (baseline.torso - current.torso) / baseline.torso;
    const duckNeutral =
      Math.abs(hipVertical) < 0.045 &&
      Math.abs(shoulderVertical) < 0.045 &&
      Math.abs(headVertical) < 0.055 &&
      torsoCompression < 0.1;
    const isNeutral =
      Math.abs(hipVertical) < 0.055 &&
      Math.abs(shoulderVertical) < 0.055 &&
      Math.abs(horizontal) < 0.24 &&
      current.kneeBend < 0.42;

    if (isNeutral) {
      if (!this.neutralSince) this.neutralSince = frame.timestamp;
      if (frame.timestamp - this.neutralSince >= REARM_MS) {
        this.armedMoves = new Set(ALL_MOVES);
        if (!duckNeutral) this.armedMoves.delete('Duck');
        else this.duckSuppressedUntilNeutral = false;
        this.reacquireNeedsNeutral = false;
      }
      // Slowly follow stance/camera drift, but never movement peaks.
      baseline.centerX += (current.centerX - baseline.centerX) * 0.012;
      baseline.hipY += (current.hipY - baseline.hipY) * 0.012;
      baseline.shoulderY += (current.shoulderY - baseline.shoulderY) * 0.012;
    } else {
      this.neutralSince = 0;
    }

    // Duck uses two native-shaped, smoothed frames rather than one deep peak.
    // A squat moves shoulders and pelvis down together. A hinge/dip lowers the
    // upper torso while shortening it relative to the pelvis. Both paths use
    // only torso keypoints and reject lateral steps, low-confidence geometry,
    // abrupt camera scale changes, and static forward leans.
    const coordinatedCrouch =
      hipVertical > 0.05 &&
      shoulderVertical > 0.052 &&
      headVertical > 0.055 &&
      Math.abs(hipVertical - shoulderVertical) < 0.065;
    const torsoDip =
      shoulderVertical > 0.058 &&
      headVertical > 0.065 &&
      hipVertical > -0.02 &&
      torsoCompression > 0.12 &&
      shoulderVertical - hipVertical > 0.04;
    const duckDepth = coordinatedCrouch || torsoDip;
    const duckGeometryStable =
      current.confidence >= 0.5 &&
      Math.abs(horizontal) < 0.36 &&
      current.shoulderWidth / baseline.shoulderWidth > 0.78 &&
      current.shoulderWidth / baseline.shoulderWidth < 1.16;
    const descending =
      upwardVelocity > 0.075 ||
      headShoulderVelocity > 0.09;
    if (duckDepth && duckGeometryStable) {
      this.duckEvidenceFrames += 1;
      this.duckDescentSeen ||= descending;
    } else {
      this.duckEvidenceFrames = 0;
      this.duckDescentSeen = false;
    }
    const duck =
      this.duckEvidenceFrames >= DUCK_EVIDENCE_FRAMES &&
      this.duckDescentSeen &&
      !this.duckSuppressedUntilNeutral;

    let move: Move | null = null;
    if (!this.reacquireNeedsNeutral && frame.timestamp - this.lastMoveAt >= COOLDOWN_MS) {
      // A short real jump is heavily attenuated by keypoint smoothing. Require
      // coordinated torso/hip lift plus either upward velocity or a strong
      // displacement. Ankles add corroboration when visible but are optional.
      const ankleSupportsJump = ankleVertical !== null && ankleVertical < -0.035;
      const coordinatedJump =
        hipVertical < -0.045 &&
        shoulderVertical < -0.04 &&
        torsoVertical < -0.048 &&
        (upwardVelocity < -0.18 || torsoVertical < -0.078 || ankleSupportsJump);
      // Native x coordinates are already in the mirrored preview's space.
      // Equal thresholds make visible left/right movement intentionally
      // symmetric; direction does not depend on anatomical joint labels.
      const candidates: [Move, boolean][] = [
        ['Jump', coordinatedJump],
        ['Duck', duck],
        ['Left', horizontal < -0.52],
        ['Right', horizontal > 0.52],
      ];
      move = candidates.find(([candidate, matches]) => matches && this.armedMoves.has(candidate))?.[0] ?? null;
    }

    if (move) {
      // Latch only the emitted action. A Left or Duck must not silently block
      // a subsequent different action before the user reaches neutral.
      this.armedMoves.delete(move);
      this.lastMoveAt = frame.timestamp;
      if (move === 'Jump') {
        // Landing can resemble a crouch after smoothing. Duck remains blocked
        // until the player has demonstrably returned to the calibrated stance.
        this.duckSuppressedUntilNeutral = true;
        this.duckEvidenceFrames = 0;
        this.duckDescentSeen = false;
      } else if (move === 'Duck') {
        this.duckEvidenceFrames = 0;
        this.duckDescentSeen = false;
      }
    }
    this.previousGeometry = { value: current, timestamp: frame.timestamp };

    const waitingForNeutral =
      this.reacquireNeedsNeutral || this.armedMoves.size < ALL_MOVES.length;

    return {
      keypoints,
      status: 'tracking',
      move,
      feedback: this.feedback(
        frame.timestamp < this.reconnectedUntil
          ? 'Reconnected'
          : waitingForNeutral
          ? isNeutral
            ? 'Hold center — rearming'
            : 'Return to center — other moves ready'
          : 'Ready — move!',
        'Shoulders + hips required; knees help, full body gives best jump accuracy',
        waitingForNeutral ? 'return-to-center' : 'ready',
      ),
    };
  }

  private confirmReacquisition(
    current: Geometry,
    keypoints: PoseKeypoint[],
    frame: PoseFrame,
  ): ReturnType<PoseAnalyzer['process']> {
    const { timestamp } = frame;
    const baseline = this.baseline!;
    this.reacquisition.push(current);
    this.reacquisition = this.reacquisition.slice(-POSE_REACQUIRE_FRAMES);

    if (this.reacquisition.length < POSE_REACQUIRE_FRAMES) {
      return {
        keypoints,
        status: 'reconnecting',
        move: null,
        feedback: this.feedback('Reconnecting…', 'Confirming body position'),
      };
    }

    const sample = medianGeometry(this.reacquisition);
    if (isMajorGeometryMismatch(sample, baseline)) {
      // A genuinely different camera distance/body geometry is unsafe to score
      // against the old reference. Start one clean hard calibration.
      this.reset();
      return this.process({
        ...frame,
        keypoints,
      });
    }

    if (isNearNeutralForAdaptation(sample, baseline)) {
      // Correct a changed standing position quickly enough to prevent a
      // displaced re-entry from looking like Left/Right, then return to the
      // normal very-slow neutral-only drift follower.
      // Horizontal displacement is the main source of false Left/Right on
      // return. The three-frame neutral median makes a strong, still-bounded
      // correction safe; subsequent drift remains deliberately slow.
      baseline.centerX += (sample.centerX - baseline.centerX) * 0.9;
      baseline.hipY += (sample.hipY - baseline.hipY) * 0.22;
      baseline.shoulderY += (sample.shoulderY - baseline.shoulderY) * 0.22;
      baseline.headY += (sample.headY - baseline.headY) * 0.22;
      baseline.torso += (sample.torso - baseline.torso) * 0.18;
      baseline.bodyHeight += (sample.bodyHeight - baseline.bodyHeight) * 0.18;
      baseline.shoulderWidth += (sample.shoulderWidth - baseline.shoulderWidth) * 0.18;
      if (sample.ankleY !== null && baseline.ankleY !== null) {
        baseline.ankleY += (sample.ankleY - baseline.ankleY) * 0.18;
      }
      this.neutralSince = timestamp;
    } else {
      this.neutralSince = 0;
    }

    this.lossStartedAt = 0;
    this.reacquisition = [];
    this.reacquireNeedsNeutral = true;
    this.reconnectedUntil = timestamp + RECONNECTED_MS;
    this.previousGeometry = { value: current, timestamp };
    return {
      keypoints,
      status: 'tracking',
      move: null,
      feedback: this.feedback('Reconnected'),
    };
  }

  private feedback(
    instruction: string,
    framingHint = INITIAL_POSE_FEEDBACK.framingHint,
    readiness: PoseReadiness = 'ready',
  ): PoseFeedback {
    return {
      calibrationProgress: this.baseline
        ? 1
        : Math.min(1, this.calibration.length / CALIBRATION_FRAMES),
      instruction,
      framingHint,
      readiness,
      reference: this.baseline
        ? {
            centerX: this.baseline.centerX,
            floorY: this.baseline.ankleY,
            bodyHeight: this.baseline.bodyHeight,
            bodyWidth: this.baseline.shoulderWidth,
          }
        : null,
    };
  }
}

export function isValidCalibrationSnapshot(
  value: unknown,
  now = Date.now(),
): value is PoseCalibrationSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<PoseCalibrationSnapshot>;
  const baseline = snapshot.baseline as Partial<Baseline> | undefined;
  const finitePositive = (candidate: unknown) =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0;
  const finite = (candidate: unknown) =>
    typeof candidate === 'number' && Number.isFinite(candidate);
  if (
    snapshot.version !== 1 ||
    !finite(snapshot.capturedAt) ||
    snapshot.capturedAt! > now + 1_000 ||
    now - snapshot.capturedAt! > POSE_LOSS_GRACE_MS ||
    !finitePositive(snapshot.sourceWidth) ||
    !finitePositive(snapshot.sourceHeight) ||
    !baseline
  ) {
    return false;
  }
  return (
    finite(baseline.centerX) &&
    baseline.centerX! >= 0 &&
    baseline.centerX! <= 1 &&
    finite(baseline.hipY) &&
    finite(baseline.shoulderY) &&
    finite(baseline.headY) &&
    (baseline.ankleY === null || finite(baseline.ankleY)) &&
    finitePositive(baseline.torso) &&
    finitePositive(baseline.bodyHeight) &&
    finitePositive(baseline.shoulderWidth)
  );
}

function medianGeometry(samples: Geometry[]): Geometry {
  const middle = (key: keyof Geometry) =>
    [...samples].sort((a, b) => Number(a[key] ?? 0) - Number(b[key] ?? 0))[
      Math.floor(samples.length / 2)
    ][key];
  return {
    centerX: middle('centerX') as number,
    hipY: middle('hipY') as number,
    shoulderY: middle('shoulderY') as number,
    headY: middle('headY') as number,
    ankleY: middle('ankleY') as number | null,
    torso: middle('torso') as number,
    bodyHeight: middle('bodyHeight') as number,
    shoulderWidth: middle('shoulderWidth') as number,
    kneeBend: middle('kneeBend') as number,
    confidence: middle('confidence') as number,
  };
}

function isMajorGeometryMismatch(current: Geometry, baseline: Baseline) {
  const torsoRatio = current.torso / baseline.torso;
  const heightRatio = current.bodyHeight / baseline.bodyHeight;
  const widthRatio = current.shoulderWidth / baseline.shoulderWidth;
  const shapeRatio =
    (current.shoulderWidth / current.torso) /
    (baseline.shoulderWidth / baseline.torso);
  return (
    torsoRatio < 0.65 ||
    torsoRatio > 1.45 ||
    heightRatio < 0.65 ||
    heightRatio > 1.45 ||
    widthRatio < 0.6 ||
    widthRatio > 1.55 ||
    shapeRatio < 0.68 ||
    shapeRatio > 1.48
  );
}

function isNearNeutralForAdaptation(current: Geometry, baseline: Baseline) {
  const hipOffset = (current.hipY - baseline.hipY) / baseline.bodyHeight;
  const shoulderOffset = (current.shoulderY - baseline.shoulderY) / baseline.bodyHeight;
  return (
    Math.abs(hipOffset) < 0.075 &&
    Math.abs(shoulderOffset) < 0.075 &&
    Math.abs(hipOffset - shoulderOffset) < 0.1 &&
    current.kneeBend < 0.42
  );
}

function medianNullable(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (present.length < values.length / 2) return null;
  return present[Math.floor(present.length / 2)];
}

export function applyRecognizedMove(state: PoseScore, move: Move, timestamp: number): PoseScore {
  const combo = timestamp - state.latestMoveAt <= 3_000 ? state.combo + 1 : 1;
  // Calm HUD scale: base ~30, small combo steps, hard-capped per action.
  return {
    score: state.score + 30 + Math.min(70, (combo - 1) * 5),
    combo,
    latestMove: move,
    latestMoveAt: timestamp,
    counts: { ...state.counts, [move]: state.counts[move] + 1 },
  };
}

/** Max points earned purely by watching the workout video to completion. */
export const PROGRESS_SCORE_CAP = 500;

/**
 * Deterministic progress points from playback position.
 * `PoseScore.score` remains action-only; callers compose via `totalWorkoutScore`.
 */
export function progressScoreFromPlayback(
  elapsedSeconds: number,
  durationSeconds: number,
): number {
  if (!(durationSeconds > 0) || !Number.isFinite(elapsedSeconds)) return 0;
  const ratio = Math.min(1, Math.max(0, elapsedSeconds / durationSeconds));
  return Math.floor(ratio * PROGRESS_SCORE_CAP);
}

/** Live HUD / summary total: progress base + pose action bonuses. */
export function totalWorkoutScore(
  actionScore: number,
  elapsedSeconds: number,
  durationSeconds: number,
): number {
  return (
    progressScoreFromPlayback(elapsedSeconds, durationSeconds) +
    Math.max(0, Number.isFinite(actionScore) ? actionScore : 0)
  );
}

const DEMO_NEUTRAL: Record<PoseJoint, [number, number]> = {
  nose: [0.5, 0.13],
  neck: [0.5, 0.23],
  leftShoulder: [0.39, 0.25],
  rightShoulder: [0.61, 0.25],
  leftElbow: [0.34, 0.4],
  rightElbow: [0.66, 0.4],
  leftWrist: [0.32, 0.55],
  rightWrist: [0.68, 0.55],
  root: [0.5, 0.52],
  leftHip: [0.44, 0.53],
  rightHip: [0.56, 0.53],
  leftKnee: [0.43, 0.72],
  rightKnee: [0.57, 0.72],
  leftAnkle: [0.42, 0.92],
  rightAnkle: [0.58, 0.92],
};

/** Deterministic animated frames for simulator/fallback use only. */
export function createDemoPoseFrame(timestamp: number, animationTime = timestamp): PoseFrame {
  const isCalibrating = animationTime < 2_200;
  const cycle = Math.max(0, animationTime - 2_200) % 10_000;
  const actionIndex = Math.floor(cycle / 2_500);
  const phase = (cycle % 2_500) / 2_500;
  const pulse =
    !isCalibrating && phase > 0.38 && phase < 0.7
      ? Math.sin(((phase - 0.38) / 0.32) * Math.PI)
      : 0;
  const move: Move = (['Jump', 'Duck', 'Left', 'Right'] as Move[])[actionIndex];

  return {
    timestamp,
    origin: 'demo',
    sourceWidth: 720,
    sourceHeight: 1280,
    keypoints: POSE_JOINTS.map((name) => {
      let [x, y] = DEMO_NEUTRAL[name];
      if (move === 'Jump') y -= pulse * 0.16;
      if (move === 'Duck') {
        if (!['leftAnkle', 'rightAnkle'].includes(name)) y += pulse * 0.15;
        if (name === 'leftKnee') x -= pulse * 0.08;
        if (name === 'rightKnee') x += pulse * 0.08;
      }
      if (move === 'Left') x -= pulse * 0.14;
      if (move === 'Right') x += pulse * 0.14;
      return { name, x, y, confidence: 0.96 };
    }),
  };
}

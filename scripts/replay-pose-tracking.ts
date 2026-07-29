import assert from 'node:assert/strict';
// Node 24 executes this TypeScript replay directly; the app compiler otherwise
// intentionally disallows source imports with a .ts suffix.
// @ts-expect-error -- required by Node's type-stripping ESM resolver
import { applyRecognizedMove, INITIAL_POSE_SCORE, POSE_JOINTS, PoseAnalyzer } from '../src/lib/poseTracking.ts';
import type { Move, PoseFrame, PoseJoint } from '../src/lib/poseTracking';
// @ts-expect-error -- required by Node's type-stripping ESM resolver
import { INITIAL_PREFLIGHT_STATE, reducePreflight } from '../src/lib/preflightState.ts';

const previewNeutral: Record<PoseJoint, [number, number]> = {
  nose: [0.5, 0.1],
  neck: [0.5, 0.2],
  leftShoulder: [0.39, 0.23],
  rightShoulder: [0.61, 0.23],
  leftElbow: [0.34, 0.38],
  rightElbow: [0.66, 0.38],
  leftWrist: [0.32, 0.52],
  rightWrist: [0.68, 0.52],
  root: [0.5, 0.5],
  leftHip: [0.44, 0.51],
  rightHip: [0.56, 0.51],
  leftKnee: [0.43, 0.7],
  rightKnee: [0.57, 0.7],
  leftAnkle: [0.42, 0.9],
  rightAnkle: [0.58, 0.9],
};

let timestamp = 1_000;

type FrameOptions = {
  move?: Move | null;
  duckForm?: 'shallow-crouch' | 'deep-squat' | 'torso-dip';
  xOffset?: number;
  yOffset?: number;
  omit?: PoseJoint[];
  scale?: number;
};

/**
 * Reproduce the iOS front-camera path: construct sensor-space coordinates,
 * then mirror x into the selfie preview space consumed by PoseAnalyzer.
 * This prevents direction tests from passing with only hand-authored,
 * already-screen-space keypoints.
 */
function nativeFrame({
  move = null,
  duckForm,
  xOffset = 0,
  yOffset = 0,
  omit = [],
  scale = 1,
}: FrameOptions = {}): PoseFrame {
  timestamp += 100;
  const omitted = new Set(omit);
  return {
    origin: 'native',
    timestamp,
    sourceWidth: 720,
    sourceHeight: 1280,
    keypoints: POSE_JOINTS.filter((name) => !omitted.has(name)).map((name) => {
      let [previewX, y] = previewNeutral[name];
      if (move === 'Jump') y -= 0.085;
      const activeDuckForm = duckForm ?? (move === 'Duck' ? 'deep-squat' : null);
      if (activeDuckForm === 'shallow-crouch' || activeDuckForm === 'deep-squat') {
        const depth = activeDuckForm === 'shallow-crouch' ? 0.07 : 0.13;
        if (name !== 'leftAnkle' && name !== 'rightAnkle') y += depth;
        if (name === 'leftKnee') previewX -= 0.09;
        if (name === 'rightKnee') previewX += 0.09;
      }
      if (activeDuckForm === 'torso-dip') {
        if (name === 'nose' || name === 'neck') y += 0.105;
        if (name === 'leftShoulder' || name === 'rightShoulder') y += 0.09;
        if (name === 'leftElbow' || name === 'rightElbow') y += 0.075;
        if (name === 'leftWrist' || name === 'rightWrist') y += 0.06;
        if (name === 'root') y += 0.045;
        if (name === 'leftHip' || name === 'rightHip') y += 0.015;
      }
      if (move === 'Left') previewX -= 0.14;
      if (move === 'Right') previewX += 0.14;
      previewX = 0.5 + (previewX - 0.5) * scale;
      y = 0.5 + (y - 0.5) * scale;
      previewX += xOffset;
      y += yOffset;
      const sensorX = 1 - previewX;
      return {
        name,
        // AVCapture mirrors the delivered front-camera buffer before Vision,
        // so Vision's normalized x is the mirrored preview coordinate.
        x: 1 - sensorX,
        y,
        confidence: 0.94,
      };
    }),
  };
}

function processFrames(
  analyzer: PoseAnalyzer,
  options: FrameOptions,
  count: number,
) {
  const moves: Move[] = [];
  let result = analyzer.process(nativeFrame(options));
  if (result.move) moves.push(result.move);
  for (let index = 1; index < count; index += 1) {
    result = analyzer.process(nativeFrame(options));
    if (result.move) moves.push(result.move);
  }
  return { moves, result };
}

function calibratedAnalyzer(partialBody = false) {
  const analyzer = new PoseAnalyzer();
  const omit: PoseJoint[] = partialBody ? ['leftAnkle', 'rightAnkle'] : [];
  const calibration = processFrames(analyzer, { omit }, 20);
  assert.equal(
    calibration.result.status,
    'tracking',
    'shoulders and hips must calibrate without ankles',
  );
  assert.equal(calibration.result.feedback.calibrationProgress, 1);
  assert.ok(calibration.result.feedback.reference);
  return analyzer;
}

// Mirrored native input must map visible left and right symmetrically.
for (const [expected, xOffset] of [['Left', -0.14], ['Right', 0.14]] as const) {
  const analyzer = calibratedAnalyzer();
  assert.deepEqual(processFrames(analyzer, { xOffset: xOffset / 2 }, 3).moves, []);
  assert.deepEqual(processFrames(analyzer, { xOffset }, 3).moves, [expected]);
}

// Short, ankle-free lift survives smoothing; ordinary standing sway does not.
const jumpAnalyzer = calibratedAnalyzer(true);
assert.deepEqual(processFrames(jumpAnalyzer, { yOffset: -0.025, omit: ['leftAnkle', 'rightAnkle'] }, 3).moves, []);
processFrames(jumpAnalyzer, { omit: ['leftAnkle', 'rightAnkle'] }, 4);
const shortJump = processFrames(
  jumpAnalyzer,
  { move: 'Jump', omit: ['leftAnkle', 'rightAnkle'] },
  1,
);
assert.deepEqual(shortJump.moves, ['Jump']);

// Smoothed iPhone-shaped torso frames recognize both common safe forms. The
// shallow path needs temporal evidence, while neither path requires ankles.
for (const duckForm of ['shallow-crouch', 'deep-squat', 'torso-dip'] as const) {
  const analyzer = calibratedAnalyzer(true);
  assert.deepEqual(
    processFrames(analyzer, { duckForm, omit: ['leftAnkle', 'rightAnkle'] }, 4).moves,
    ['Duck'],
    `${duckForm} should score exactly once without ankles`,
  );
}

// Ordinary vertical sway stays below depth, and lateral stepping cannot be
// stolen by Duck even when the torso bobs downward.
const swayAnalyzer = calibratedAnalyzer(true);
assert.deepEqual(
  processFrames(
    swayAnalyzer,
    { yOffset: 0.045, omit: ['leftAnkle', 'rightAnkle'] },
    5,
  ).moves,
  [],
);
processFrames(swayAnalyzer, { omit: ['leftAnkle', 'rightAnkle'] }, 4);
assert.deepEqual(
  processFrames(
    swayAnalyzer,
    {
      duckForm: 'shallow-crouch',
      xOffset: 0.14,
      omit: ['leftAnkle', 'rightAnkle'],
    },
    4,
  ).moves,
  ['Right'],
  'a sideways step with a body bob should retain direction priority',
);

// Briefly leaning toward the phone enlarges the torso as it dips. Camera-scale
// conflict prevents those consecutive frames from becoming Duck evidence.
const leanAnalyzer = calibratedAnalyzer(true);
assert.deepEqual(
  processFrames(
    leanAnalyzer,
    {
      duckForm: 'torso-dip',
      scale: 1.22,
      omit: ['leftAnkle', 'rightAnkle'],
    },
    3,
  ).moves,
  [],
);
assert.deepEqual(
  processFrames(leanAnalyzer, { omit: ['leftAnkle', 'rightAnkle'] }, 3).moves,
  [],
);

// A jump's smoothed landing may pass through crouch geometry, but Duck remains
// blocked until a sustained neutral return.
const landingAnalyzer = calibratedAnalyzer(true);
assert.deepEqual(
  processFrames(
    landingAnalyzer,
    { move: 'Jump', omit: ['leftAnkle', 'rightAnkle'] },
    1,
  ).moves,
  ['Jump'],
);
assert.deepEqual(
  processFrames(
    landingAnalyzer,
    { duckForm: 'deep-squat', omit: ['leftAnkle', 'rightAnkle'] },
    5,
  ).moves,
  [],
  'jump landing must not score as Duck',
);

// Duck stays latched while held and rearms only after enough true neutral.
const repeatedDuckAnalyzer = calibratedAnalyzer(true);
assert.deepEqual(
  processFrames(
    repeatedDuckAnalyzer,
    { duckForm: 'shallow-crouch', omit: ['leftAnkle', 'rightAnkle'] },
    5,
  ).moves,
  ['Duck'],
);
assert.deepEqual(
  processFrames(
    repeatedDuckAnalyzer,
    { duckForm: 'deep-squat', omit: ['leftAnkle', 'rightAnkle'] },
    4,
  ).moves,
  [],
);
processFrames(repeatedDuckAnalyzer, { omit: ['leftAnkle', 'rightAnkle'] }, 5);
assert.deepEqual(
  processFrames(
    repeatedDuckAnalyzer,
    { duckForm: 'torso-dip', omit: ['leftAnkle', 'rightAnkle'] },
    4,
  ).moves,
  ['Duck'],
);

// A different action remains available after a latched move and global
// cooldown; the emitted action itself requires a neutral reset.
const sequenceAnalyzer = calibratedAnalyzer(true);
const backToBack = [
  ...processFrames(sequenceAnalyzer, { move: 'Duck', omit: ['leftAnkle', 'rightAnkle'] }, 3).moves,
  ...processFrames(sequenceAnalyzer, { move: 'Right', omit: ['leftAnkle', 'rightAnkle'] }, 5).moves,
];
assert.deepEqual(backToBack, ['Duck', 'Right']);
assert.equal(
  processFrames(sequenceAnalyzer, { move: 'Right', omit: ['leftAnkle', 'rightAnkle'] }, 4).moves.length,
  0,
  'the same held action must stay latched',
);
const waiting = processFrames(sequenceAnalyzer, { move: 'Right', omit: ['leftAnkle', 'rightAnkle'] }, 1).result;
assert.equal(waiting.feedback.readiness, 'return-to-center');
processFrames(sequenceAnalyzer, { omit: ['leftAnkle', 'rightAnkle'] }, 5);
assert.deepEqual(
  processFrames(sequenceAnalyzer, { move: 'Left', omit: ['leftAnkle', 'rightAnkle'] }, 4).moves,
  ['Left'],
  'neutral must rearm directions',
);

let score = INITIAL_POSE_SCORE;
for (const move of backToBack) score = applyRecognizedMove(score, move, timestamp);
score = applyRecognizedMove(score, 'Jump', timestamp + 100);
score = applyRecognizedMove(score, 'Left', timestamp + 200);
assert.deepEqual(score.counts, { Jump: 1, Duck: 1, Left: 1, Right: 1 });
assert.equal(score.combo, 4);
assert.equal(score.score, 150);

timestamp += 1_600;
const noImplicitLoss = processFrames(sequenceAnalyzer, {}, 3);
assert.equal(
  noImplicitLoss.result.status,
  'tracking',
  'ordinary frame gaps inside grace preserve calibration after confirmation',
);

function loseAndReacquire(
  analyzer: PoseAnalyzer,
  duration: number,
  options: FrameOptions = {},
) {
  analyzer.markTrackingLost(timestamp);
  timestamp += duration;
  return processFrames(analyzer, options, 3);
}

// A sub-second detector miss freezes scoring, preserves the baseline, and
// returns after exactly three confidence frames without a calibration bar.
const blinkAnalyzer = calibratedAnalyzer();
const blink = loseAndReacquire(blinkAnalyzer, 500, { move: 'Right' });
assert.deepEqual(blink.moves, [], 'reacquisition guard must suppress a held action');
assert.equal(blink.result.status, 'tracking');
assert.equal(blink.result.feedback.instruction, 'Reconnected');
assert.equal(blink.result.feedback.calibrationProgress, 1);

// Reappearing already crouched is guarded just like directions. Neutral must
// rearm scoring before a subsequent real Duck can count.
const duckReacquireAnalyzer = calibratedAnalyzer(true);
const crouchedReentry = loseAndReacquire(
  duckReacquireAnalyzer,
  500,
  { duckForm: 'deep-squat', omit: ['leftAnkle', 'rightAnkle'] },
);
assert.deepEqual(crouchedReentry.moves, []);
assert.deepEqual(
  processFrames(
    duckReacquireAnalyzer,
    { duckForm: 'deep-squat', omit: ['leftAnkle', 'rightAnkle'] },
    4,
  ).moves,
  [],
);
processFrames(duckReacquireAnalyzer, { omit: ['leftAnkle', 'rightAnkle'] }, 8);
assert.deepEqual(
  processFrames(
    duckReacquireAnalyzer,
    { duckForm: 'shallow-crouch', omit: ['leftAnkle', 'rightAnkle'] },
    4,
  ).moves,
  ['Duck'],
);

// Several seconds remain within grace. A horizontally displaced neutral
// re-entry is softly recentered and cannot score as a direction.
const graceAnalyzer = calibratedAnalyzer();
const displaced = loseAndReacquire(graceAnalyzer, 4_000, { xOffset: 0.14 });
assert.deepEqual(displaced.moves, []);
assert.equal(displaced.result.status, 'tracking');
assert.equal(displaced.result.feedback.calibrationProgress, 1);
assert.deepEqual(processFrames(graceAnalyzer, { xOffset: 0.14 }, 3).moves, []);

// Once neutral confidence has rearmed scoring, a genuine action works.
processFrames(graceAnalyzer, { xOffset: 0.14 }, 3);
assert.deepEqual(
  processFrames(graceAnalyzer, { move: 'Left', xOffset: 0.14 }, 4).moves,
  ['Left'],
  'a valid action after re-entry must score once',
);

// Score/combo state is external to tracking and remains untouched by brief
// loss. Its existing three-second action timer still expires long combos.
let preservedScore = applyRecognizedMove(INITIAL_POSE_SCORE, 'Jump', timestamp);
loseAndReacquire(calibratedAnalyzer(), 500);
assert.equal(preservedScore.combo, 1);
preservedScore = applyRecognizedMove(preservedScore, 'Duck', timestamp);
assert.equal(preservedScore.combo, 2, 'sub-second loss preserves combo continuity');

// More than six seconds requires one clean hard calibration.
const prolongedAnalyzer = calibratedAnalyzer();
prolongedAnalyzer.markTrackingLost(timestamp);
timestamp += 6_100;
const prolonged = prolongedAnalyzer.process(nativeFrame());
assert.equal(prolonged.status, 'calibrating');
assert.equal(prolonged.feedback.calibrationProgress, 0.05);

// A major body/camera scale mismatch is confirmed over three frames before
// discarding the saved reference; it cannot emit a move while deciding.
const scaleAnalyzer = calibratedAnalyzer();
const scaleMismatch = loseAndReacquire(scaleAnalyzer, 500, { scale: 1.6 });
assert.deepEqual(scaleMismatch.moves, []);
assert.equal(scaleMismatch.result.status, 'calibrating');
assert.equal(scaleMismatch.result.feedback.calibrationProgress, 0.05);

// A moderate scale change keeps the reference and uses neutral-only soft
// adaptation rather than showing calibration again.
const moderateScaleAnalyzer = calibratedAnalyzer();
const moderateScale = loseAndReacquire(moderateScaleAnalyzer, 500, { scale: 1.2 });
assert.deepEqual(moderateScale.moves, []);
assert.equal(moderateScale.result.status, 'tracking');
assert.equal(moderateScale.result.feedback.calibrationProgress, 1);

// Preflight only counts down after calibration plus stable frames, and any loss
// during countdown returns to framing instead of starting the run.
let preflight = reducePreflight(INITIAL_PREFLIGHT_STATE, { type: 'PERMISSION_GRANTED' });
preflight = reducePreflight(preflight, { type: 'CALIBRATION_PROGRESS' });
preflight = reducePreflight(preflight, { type: 'CALIBRATION_READY' });
for (let index = 0; index < 6; index += 1) {
  preflight = reducePreflight(preflight, { type: 'STABLE_FRAME' });
}
assert.equal(preflight.phase, 'countdown');
assert.equal(preflight.countdown, 3);
preflight = reducePreflight(preflight, { type: 'TRACKING_LOST' });
assert.equal(preflight.phase, 'calibrating');
assert.equal(preflight.countdown, null);

// A serialized setup baseline hydrates into guarded reacquisition. It cannot
// score an already-displaced body on camera remount and expires after grace.
const setupAnalyzer = calibratedAnalyzer();
const setupSnapshot = setupAnalyzer.calibrationSnapshot(timestamp);
assert.ok(setupSnapshot);
const workoutAnalyzer = new PoseAnalyzer();
assert.equal(workoutAnalyzer.hydrateCalibration(setupSnapshot, timestamp + 500), true);
timestamp += 500;
const handoffReentry = processFrames(workoutAnalyzer, { xOffset: 0.14 }, 3);
assert.deepEqual(handoffReentry.moves, []);
assert.equal(handoffReentry.result.status, 'tracking');
const expiredAnalyzer = new PoseAnalyzer();
assert.equal(expiredAnalyzer.hydrateCalibration(setupSnapshot, timestamp + 6_100), false);

console.log(
  'Pose replay passed: actions, calibration handoff, preflight countdown, transient grace, displaced re-entry, guarded scoring, prolonged loss, scale adaptation/mismatch, combo continuity',
);

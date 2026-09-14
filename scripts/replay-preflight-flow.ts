import assert from 'node:assert/strict';
// Node 24 executes this TypeScript replay directly; the app compiler otherwise
// intentionally disallows source imports with a .ts suffix.
import {
  createPreflightFlowState,
  END_CARD_MS,
  flowElapsedSeconds,
  FRAMING_DEBOUNCE_MS,
  HOLD_LOCK_GRACE_MS,
  HOLD_MS,
  holdProgress,
  isCameraPhase,
  reducePreflightFlow,
  spokenPrompt,
  type PreflightFlowEvent,
  type PreflightFlowState,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/preflightFlow.ts';
import {
  bodyVisible,
  FRAMING_HEAD_MARGIN,
  FRAMING_MAX_TORSO,
  FRAMING_MIN_TORSO,
  FRAMING_WORD,
  skeletonFraming,
  type FramingVerdict,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/skeletonFraming.ts';
import {
  CALIBRATION_SESSION_MS,
  hasFreshCalibration,
  shouldShowWarmup,
  WARMUP_RUN_COUNT,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/calibrationSession.ts';
import {
  INITIAL_SPEECH_GATE,
  nextUtterance,
  SPEECH_MIN_GAP_MS,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/speechGate.ts';
import type { Move, PoseFrame, PoseJoint, TrackingStatus } from '../src/lib/poseTracking';

// ---------------------------------------------------------------------------
// skeletonFraming: synthetic frames with a given torso fraction / clipping.

/**
 * Body whose shoulder→hip distance spans `torso` of the frame, hips centred
 * at (`x`, `hipY`). Legs extend below the hips by 1.5 torso (may run off the
 * frame — that is the point).
 */
function bodyFrame(
  torso: number,
  options: { hipY?: number; x?: number; drop?: PoseJoint[]; lowConfidence?: PoseJoint[] } = {},
): PoseFrame {
  const hipY = options.hipY ?? 0.55;
  const x = options.x ?? 0.5;
  const shoulderY = hipY - torso;
  const w = torso * 0.55;
  const layout: Record<PoseJoint, [number, number]> = {
    nose: [x, shoulderY - torso * 0.42],
    neck: [x, shoulderY - torso * 0.12],
    leftShoulder: [x - w / 2, shoulderY],
    rightShoulder: [x + w / 2, shoulderY],
    leftElbow: [x - w * 0.7, shoulderY + torso * 0.55],
    rightElbow: [x + w * 0.7, shoulderY + torso * 0.55],
    leftWrist: [x - w * 0.8, hipY + torso * 0.1],
    rightWrist: [x + w * 0.8, hipY + torso * 0.1],
    root: [x, hipY - 0.01],
    leftHip: [x - w * 0.3, hipY],
    rightHip: [x + w * 0.3, hipY],
    leftKnee: [x - w * 0.3, hipY + torso * 0.75],
    rightKnee: [x + w * 0.3, hipY + torso * 0.75],
    leftAnkle: [x - w * 0.33, hipY + torso * 1.5],
    rightAnkle: [x + w * 0.33, hipY + torso * 1.5],
  };
  const drop = new Set(options.drop ?? []);
  const low = new Set(options.lowConfidence ?? []);
  return {
    origin: 'native',
    timestamp: 0,
    sourceWidth: 720,
    sourceHeight: 1280,
    keypoints: (Object.keys(layout) as PoseJoint[])
      .filter((name) => !drop.has(name))
      // Anything outside the frame is simply not detected.
      .filter((name) => layout[name][1] >= 0 && layout[name][1] <= 1)
      .map((name) => ({
        name,
        x: layout[name][0],
        y: layout[name][1],
        confidence: low.has(name) ? 0.2 : 0.9,
      })),
  };
}

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} expected ${expected}, got ${actual}`);

{
  assert.equal(skeletonFraming(null).verdict, 'searching');
  const empty = skeletonFraming({ ...bodyFrame(0.25), keypoints: [] });
  assert.equal(empty.verdict, 'searching');
  assert.equal(empty.torsoFraction, 0);

  // Legs optional: a frame with no knees or ankles at all frames fine.
  const legless = skeletonFraming(
    bodyFrame(0.25, { drop: ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] }),
  );
  close(legless.torsoFraction, 0.25, 'torso');
  assert.equal(legless.verdict, 'ok', 'head + shoulders + hips is enough');
  assert.equal(legless.ok, true);
  assert.deepEqual(legless.clippedJoints, []);
  assert.equal(bodyVisible(bodyFrame(0.25, { drop: ['leftAnkle', 'rightAnkle'] })), true);

  // Legs running off the bottom of the frame (phone on a desk) is not clipping.
  const desk = skeletonFraming(bodyFrame(0.3, { hipY: 0.98 }));
  assert.equal(desk.verdict, 'back', 'hips against the bottom edge are clipped');
  const deskOk = skeletonFraming(bodyFrame(0.3, { hipY: 0.82 }));
  assert.equal(deskOk.verdict, 'ok', 'hips in, knees off the bottom → fine');

  const small = skeletonFraming(bodyFrame(0.12));
  assert.equal(small.verdict, 'closer', 'below the torso floor → come closer');
  assert.equal(skeletonFraming(bodyFrame(FRAMING_MIN_TORSO)).verdict, 'ok', 'floor is inclusive');

  const huge = skeletonFraming(bodyFrame(0.4, { hipY: 0.8 }));
  assert.equal(huge.verdict, 'back', 'above the torso ceiling → step back');
  assert.equal(
    skeletonFraming(bodyFrame(FRAMING_MAX_TORSO, { hipY: 0.8 })).verdict,
    'ok',
    'ceiling is inclusive',
  );

  // No headroom for a jump: nose too close to the top → step back.
  const headHigh = skeletonFraming(bodyFrame(0.25, { hipY: 0.25 + 0.25 * 0.42 + FRAMING_HEAD_MARGIN - 0.01 }));
  assert.ok(headHigh.clippedJoints.includes('nose'));
  assert.equal(headHigh.verdict, 'back');

  // A shoulder off the side of the frame → clipped → back.
  const sideCut = skeletonFraming(bodyFrame(0.25, { x: 0.95 }));
  assert.ok(sideCut.clippedJoints.includes('rightShoulder'));
  assert.equal(sideCut.verdict, 'back');

  // Off-centre but inside the frame → center up.
  assert.equal(skeletonFraming(bodyFrame(0.22, { x: 0.15 })).verdict, 'center');
  assert.equal(skeletonFraming(bodyFrame(0.22, { x: 0.85 })).verdict, 'center');
  assert.equal(bodyVisible(bodyFrame(0.22, { x: 0.15 })), true, 'visible even when off-centre');

  // Low-confidence hips are not "seen": a single hip missing still frames
  // (as clipped), both missing means no body.
  assert.equal(skeletonFraming(bodyFrame(0.25, { lowConfidence: ['leftHip'] })).verdict, 'back');
  assert.equal(
    skeletonFraming(bodyFrame(0.25, { lowConfidence: ['leftHip', 'rightHip'] })).verdict,
    'searching',
  );
  assert.equal(bodyVisible(bodyFrame(0.25, { lowConfidence: ['leftHip', 'rightHip'] })), false);

  // Every verdict has a big word.
  for (const verdict of ['searching', 'closer', 'back', 'center', 'ok'] as FramingVerdict[]) {
    assert.ok(FRAMING_WORD[verdict].length > 0 && FRAMING_WORD[verdict].length <= 10, verdict);
  }
}

// ---------------------------------------------------------------------------
// preflightFlow reducer.

type Flow = { state: PreflightFlowState; now: number };

function start(firstRun: boolean): Flow {
  const now = 1_000_000;
  let state = createPreflightFlowState({ firstRun, now });
  assert.equal(state.phase, 'permission');
  assert.equal(isCameraPhase(state.phase), false);
  assert.equal(flowElapsedSeconds(state, now + 5_000), 0, 'timer idle before the camera');
  state = reducePreflightFlow(state, { type: 'PERMISSION_GRANTED', now });
  assert.equal(state.phase, 'framing');
  return { state, now };
}

function send(flow: Flow, event: PreflightFlowEvent) {
  flow.state = reducePreflightFlow(flow.state, event);
}

/** One analyzer result at the 10 Hz cadence. */
function frame(
  flow: Flow,
  framing: FramingVerdict,
  status: TrackingStatus = 'tracking',
  move: Move | null = null,
) {
  flow.now += 100;
  send(flow, { type: 'FRAME', now: flow.now, framing, status, move });
}

function frames(
  flow: Flow,
  count: number,
  framing: FramingVerdict,
  status: TrackingStatus = 'tracking',
  move: Move | null = null,
) {
  for (let index = 0; index < count; index += 1) frame(flow, framing, status, move);
}

// Framing words debounce: a new verdict needs ≥ 400 ms before it shows.
{
  const flow = start(false);
  assert.equal(flow.state.framing, 'searching');
  assert.equal(spokenPrompt(flow.state), 'Step into frame');
  frame(flow, 'closer', 'calibrating');
  assert.equal(flow.state.framing, 'searching', 'first differing frame only starts the candidate');
  frames(flow, 3, 'closer', 'calibrating'); // 300 ms after candidate start
  assert.equal(flow.state.framing, 'searching', 'still debouncing at 300 ms');
  frame(flow, 'closer', 'calibrating'); // 400 ms
  assert.equal(flow.state.framing, 'closer', `shows after ${FRAMING_DEBOUNCE_MS} ms`);
  assert.equal(spokenPrompt(flow.state), 'Come closer');

  // Flicker: a single 'back' frame between 'closer' frames never shows.
  frame(flow, 'back', 'calibrating');
  frame(flow, 'closer', 'calibrating');
  frame(flow, 'back', 'calibrating');
  frame(flow, 'closer', 'calibrating');
  assert.equal(flow.state.framing, 'closer', 'flicker suppressed');
  assert.equal(flow.state.framingCandidate, null, 'candidate cleared when the shown verdict recurs');

  // Analyzer calibrated but framing not ok → still framing (no hold).
  frames(flow, 5, 'closer', 'tracking');
  assert.equal(flow.state.calibrated, true);
  assert.equal(flow.state.phase, 'framing');

  // Framing ok (debounced) → the hold starts without any tap.
  frames(flow, 4, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'framing', '300 ms after the first ok frame: still debouncing');
  frame(flow, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'hold', 'hold starts on the frame that settles the debounce');
  assert.equal(flow.state.holdStartedAt, flow.now);
  assert.equal(holdProgress(flow.state, flow.now), 0);
  assert.equal(spokenPrompt(flow.state), 'Perfect, hold still');
}

// The hold does not wait for the analyzer: framing ok alone starts the ring,
// the baseline usually lands during it, and the flow completes on its own.
{
  const flow = start(false);
  frames(flow, 5, 'ok', 'calibrating');
  assert.equal(flow.state.phase, 'hold', 'ring starts while the analyzer is still calibrating');
  frames(flow, 15, 'ok', 'calibrating'); // 1.5 s
  close(holdProgress(flow.state, flow.now), 0.5, 'ring half full');
  frames(flow, 14, 'ok', 'tracking'); // 2.9 s
  assert.equal(flow.state.phase, 'hold');
  frame(flow, 'ok', 'tracking'); // 3.0 s
  assert.equal(flow.state.phase, 'complete', `completes at ${HOLD_MS} ms`);
  assert.equal(flow.state.outcome, 'calibrated');
  assert.equal(spokenPrompt(flow.state), "You're set");
  // Terminal for user events.
  send(flow, { type: 'SKIP', now: flow.now });
  send(flow, { type: 'RETRY', now: flow.now });
  frame(flow, 'back', 'tracking');
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'calibrated');
}

// Moving during the hold restarts the ring, not the phase.
{
  const flow = start(false);
  frames(flow, 5, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'hold');
  frames(flow, 20, 'ok', 'tracking'); // 2 s in
  close(holdProgress(flow.state, flow.now), 2 / 3, 'ring at 2 s');
  frame(flow, 'ok', 'tracking', 'Jump');
  assert.equal(flow.state.phase, 'hold', 'still holding');
  assert.equal(holdProgress(flow.state, flow.now), 0, 'a move restarts the ring');
  assert.equal(flow.state.holdRestarts, 1);
  frames(flow, 30, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'complete');
}

// Drifting out of frame during the hold drops back to framing (debounced),
// keeps the verdict that caused it, and the ring starts over once re-framed.
{
  const flow = start(false);
  frames(flow, 5, 'ok', 'tracking');
  frames(flow, 10, 'ok', 'tracking');
  frames(flow, 4, 'back', 'tracking');
  assert.equal(flow.state.phase, 'hold', 'a short wobble is debounced');
  frame(flow, 'back', 'tracking');
  assert.equal(flow.state.phase, 'framing', 'sustained "back" drops the hold');
  assert.equal(flow.state.framing, 'back', 'the big word is instant');
  assert.equal(flow.state.holdRestarts, 1);
  assert.equal(flow.state.calibrated, true, 'the analyzer baseline is not forgotten');
  frames(flow, 5, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'hold');
  assert.equal(holdProgress(flow.state, flow.now), 0);
}

// Native "searching" (no frames) during the hold: debounced, then drops.
{
  const flow = start(false);
  frames(flow, 5, 'ok', 'tracking');
  flow.now += 100;
  send(flow, { type: 'TRACKING_LOST', now: flow.now });
  assert.equal(flow.state.trackingLost, true);
  assert.equal(flow.state.phase, 'hold', 'debounced');
  flow.now += FRAMING_DEBOUNCE_MS;
  send(flow, { type: 'TRACKING_LOST', now: flow.now });
  assert.equal(flow.state.phase, 'framing');
  assert.equal(flow.state.framing, 'searching');
}

// Ring full but no analyzer lock: "Hold still" stays up for the grace, then
// the run starts on defaults (calibrates live) — nobody is trapped here.
{
  const flow = start(false);
  frames(flow, 5, 'ok', 'calibrating');
  frames(flow, 30, 'ok', 'calibrating'); // 3 s
  assert.equal(flow.state.phase, 'hold', 'ring full, waiting on the baseline');
  assert.equal(holdProgress(flow.state, flow.now), 1);
  send(flow, { type: 'TICK', now: flow.now + HOLD_LOCK_GRACE_MS - 1 });
  assert.equal(flow.state.phase, 'hold');
  send(flow, { type: 'TICK', now: flow.now + HOLD_LOCK_GRACE_MS });
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'defaults');

  // …but a late lock inside the grace completes calibrated.
  const late = start(false);
  frames(late, 35, 'ok', 'calibrating');
  frame(late, 'ok', 'tracking');
  assert.equal(late.state.outcome, 'calibrated');
}

// Skip: calibrated → hands off; not calibrated → defaults. Ignored elsewhere.
{
  const flow = start(false);
  frames(flow, 3, 'closer', 'calibrating');
  send(flow, { type: 'SKIP', now: flow.now });
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'defaults');

  const locked = start(false);
  frames(locked, 6, 'closer', 'tracking');
  send(locked, { type: 'SKIP', now: locked.now });
  assert.equal(locked.state.outcome, 'calibrated');

  let idle = createPreflightFlowState({ firstRun: false, now: 0 });
  idle = reducePreflightFlow(idle, { type: 'SKIP', now: 0 });
  assert.equal(idle.phase, 'permission', 'skip needs a live camera');
}

// Denied / unavailable: explicit continue-without-camera → outcome 'off'.
{
  const now = 5_000;
  let state = createPreflightFlowState({ firstRun: true, now });
  state = reducePreflightFlow(state, { type: 'CONTINUE_WITHOUT_CAMERA', now });
  assert.equal(state.phase, 'complete');
  assert.equal(state.outcome, 'off');
  assert.equal(spokenPrompt(state), null, 'nothing to say without a camera');

  const flow = start(false);
  send(flow, { type: 'UNAVAILABLE', now: flow.now });
  assert.equal(flow.state.phase, 'unavailable');
  send(flow, { type: 'FRAME', now: flow.now, framing: 'ok', status: 'tracking', move: null });
  assert.equal(flow.state.phase, 'unavailable', 'frames ignored while unavailable');
  send(flow, { type: 'RETRY', now: flow.now });
  assert.equal(flow.state.phase, 'framing');
  assert.equal(flow.state.holdStartedAt, null);
  send(flow, { type: 'UNAVAILABLE', now: flow.now });
  send(flow, { type: 'CONTINUE_WITHOUT_CAMERA', now: flow.now });
  assert.equal(flow.state.outcome, 'off');
  // Terminal for user events…
  send(flow, { type: 'RETRY', now: flow.now });
  send(flow, { type: 'SKIP', now: flow.now });
  assert.equal(flow.state.phase, 'complete');
  // …but a failed handoff after completion must still be surfaceable.
  send(flow, { type: 'UNAVAILABLE', now: flow.now });
  assert.equal(flow.state.phase, 'unavailable');
  assert.equal(flow.state.outcome, null);
}

// First run and repeat run take the same path now (no move test drive).
{
  const first = start(true);
  const repeat = start(false);
  for (const flow of [first, repeat]) {
    frames(flow, 5, 'ok', 'calibrating');
    frames(flow, 30, 'ok', 'tracking');
    assert.equal(flow.state.phase, 'complete');
    assert.equal(flow.state.outcome, 'calibrated');
  }
  assert.equal(first.state.firstRun, true);
}

// Happy-path budget: ~2 s walking in + 3 s hold ≈ 5 s (+ the first-run card).
{
  const flow = start(true);
  const t0 = flow.now;
  frames(flow, 15, 'closer', 'calibrating'); // 1.5 s walking in
  frames(flow, 5, 'ok', 'calibrating'); // 0.5 s debounce → hold
  assert.equal(flow.state.phase, 'hold');
  const framingMs = flow.now - t0;
  frames(flow, 20, 'ok', 'calibrating'); // analyzer's 20 stable frames
  frames(flow, 10, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'calibrated');
  const total = flow.now - t0;
  assert.ok(framingMs <= 2_000, `framing ${framingMs} ms`);
  assert.equal(total - framingMs, HOLD_MS, 'hold is exactly the ring');
  assert.ok(total + END_CARD_MS <= 7_000, `happy path ${total + END_CARD_MS} ms must stay within ~7 s`);
  close(flowElapsedSeconds(flow.state, flow.now), (flow.now - t0) / 1000, 'dev timer');
}

// ---------------------------------------------------------------------------
// Once per session: the stored baseline decides whether preflight is skipped.
{
  const now = 1_700_000_000_000;
  const baseline = {
    capturedAt: now - 60_000,
    cameraFacing: 'front' as const,
    orientation: 'portrait' as const,
    torsoRatio: 0.3,
    shoulderRatio: 0.2,
  };
  assert.equal(hasFreshCalibration(null, now), false, 'no baseline → full preflight');
  assert.equal(hasFreshCalibration(baseline, now), true, 'a minute old → skip');
  assert.equal(
    hasFreshCalibration(baseline, baseline.capturedAt + CALIBRATION_SESSION_MS),
    true,
    'exactly 12 h → still fresh',
  );
  assert.equal(
    hasFreshCalibration(baseline, baseline.capturedAt + CALIBRATION_SESSION_MS + 1),
    false,
    'older than 12 h → full preflight',
  );
  assert.equal(hasFreshCalibration({ ...baseline, capturedAt: now + 5_000 }, now), false, 'clock skew → not fresh');
  assert.equal(CALIBRATION_SESSION_MS, 12 * 3_600_000);

  // Warm-up: the first WARMUP_RUN_COUNT runs only.
  assert.equal(WARMUP_RUN_COUNT, 2);
  assert.equal(shouldShowWarmup(null), true);
  assert.equal(shouldShowWarmup({ warmupRunsCompleted: 0 }), true);
  assert.equal(shouldShowWarmup({ warmupRunsCompleted: 1 }), true);
  assert.equal(shouldShowWarmup({ warmupRunsCompleted: 2 }), false);
}

// ---------------------------------------------------------------------------
// Spoken prompts: ≥ 2.5 s apart, never the same line twice in a row.
{
  let gate = INITIAL_SPEECH_GATE;
  let decision = nextUtterance(gate, 'Step back', 0);
  assert.equal(decision.speak, true);
  gate = decision.gate;
  decision = nextUtterance(gate, 'Step back', 1_000);
  assert.equal(decision.speak, false, 'same line is not repeated');
  decision = nextUtterance(gate, 'Come closer', 1_000);
  assert.equal(decision.speak, false, 'inside the minimum gap');
  decision = nextUtterance(gate, 'Come closer', SPEECH_MIN_GAP_MS);
  assert.equal(decision.speak, true, 'gap elapsed → new line spoken');
  gate = decision.gate;
  decision = nextUtterance(gate, null, 10_000);
  assert.equal(decision.speak, false, 'nothing to say');
  decision = nextUtterance(gate, 'Come closer', 10_000, true);
  assert.equal(decision.speak, true, 'urgent skips the de-dup');
  gate = decision.gate;
  decision = nextUtterance(gate, "You're set", 10_000 + SPEECH_MIN_GAP_MS - 1, true);
  assert.equal(decision.speak, false, 'urgent never skips the gap');
  assert.equal(SPEECH_MIN_GAP_MS, 2_500);
}

console.log(
  'Preflight flow replay passed: upper-body framing (legs optional, torso band 0.16–0.34, head margin, centre band), 400 ms debounce, framing → 3 s hold → auto-complete, move/drift/loss restart the ring, lock grace → defaults, skip, denied/unavailable → off, ~5 s happy path, 12 h session skip, warm-up count, spoken prompt gate',
);

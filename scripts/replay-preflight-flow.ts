import assert from 'node:assert/strict';
// Node 24 executes this TypeScript replay directly; the app compiler otherwise
// intentionally disallows source imports with a .ts suffix.
import {
  createPreflightFlowState,
  currentTestMove,
  END_CARD_MS,
  flowElapsedSeconds,
  FRAMING_DEBOUNCE_MS,
  FRAMING_FALLBACK_MS,
  isCameraPhase,
  MOVE_TEST_ORDER,
  reducePreflightFlow,
  type PreflightFlowEvent,
  type PreflightFlowState,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/preflightFlow.ts';
import {
  PREFLIGHT_COUNTDOWN_SECONDS,
  PREFLIGHT_EXPRESS_COUNTDOWN_SECONDS,
  PREFLIGHT_STABLE_FRAMES,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/preflightState.ts';
import {
  FRAMING_MAX_HEIGHT,
  FRAMING_MIN_HEIGHT,
  skeletonFraming,
  type FramingVerdict,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/skeletonFraming.ts';
import type { Move, PoseFrame, PoseJoint, TrackingStatus } from '../src/lib/poseTracking';

// ---------------------------------------------------------------------------
// skeletonFraming: synthetic frames with a given height fraction / clipping.

/** Standing body whose skeleton spans `height` of the frame, centered at `centerY`. */
function bodyFrame(
  height: number,
  options: { centerY?: number; drop?: PoseJoint[]; shiftX?: number; lowConfidence?: PoseJoint[] } = {},
): PoseFrame {
  const centerY = options.centerY ?? 0.5;
  const top = centerY - height / 2;
  const at = (fraction: number) => top + fraction * height;
  const x = 0.5 + (options.shiftX ?? 0);
  const layout: Record<PoseJoint, [number, number]> = {
    nose: [x, at(0)],
    neck: [x, at(0.1)],
    leftShoulder: [x - 0.07, at(0.13)],
    rightShoulder: [x + 0.07, at(0.13)],
    leftElbow: [x - 0.1, at(0.32)],
    rightElbow: [x + 0.1, at(0.32)],
    leftWrist: [x - 0.12, at(0.5)],
    rightWrist: [x + 0.12, at(0.5)],
    root: [x, at(0.47)],
    leftHip: [x - 0.045, at(0.48)],
    rightHip: [x + 0.045, at(0.48)],
    leftKnee: [x - 0.045, at(0.74)],
    rightKnee: [x + 0.045, at(0.74)],
    leftAnkle: [x - 0.05, at(1)],
    rightAnkle: [x + 0.05, at(1)],
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
  const empty = skeletonFraming({ ...bodyFrame(0.7), keypoints: [] });
  assert.equal(empty.verdict, 'searching');
  assert.equal(empty.heightFraction, 0);

  const small = skeletonFraming(bodyFrame(0.45));
  close(small.heightFraction, 0.45, 'height');
  assert.equal(small.verdict, 'closer', 'below 0.6 → move closer');
  assert.equal(small.ok, false);

  const edge = skeletonFraming(bodyFrame(FRAMING_MIN_HEIGHT));
  assert.equal(edge.verdict, 'ok', 'exactly 0.6 is inside the band');

  const good = skeletonFraming(bodyFrame(0.7));
  assert.equal(good.verdict, 'ok');
  assert.equal(good.ok, true);
  assert.deepEqual(good.clippedJoints, []);

  const tall = skeletonFraming(bodyFrame(0.85));
  assert.equal(tall.verdict, 'back', 'above 0.8 → move back');
  assert.equal(skeletonFraming(bodyFrame(FRAMING_MAX_HEIGHT)).verdict, 'ok', 'exactly 0.8 is inside');

  // Feet run off the bottom edge: ankles missing while the knees sit at the floor.
  const feetCut = skeletonFraming(bodyFrame(0.7, { centerY: 0.62, drop: ['leftAnkle', 'rightAnkle'] }));
  assert.equal(feetCut.verdict, 'closer', 'small visible height without an edge contact is not clipping');
  const feetAtEdge = skeletonFraming(
    bodyFrame(0.9, { centerY: 0.77, drop: ['leftAnkle', 'rightAnkle'] }),
  );
  assert.ok(feetAtEdge.clippedJoints.includes('leftAnkle'), 'knees at the bottom edge → feet clipped');
  assert.equal(feetAtEdge.verdict, 'back');

  // Head against the top edge (0.7 tall, centered high) → clipped → back.
  const headCut = skeletonFraming(bodyFrame(0.7, { centerY: 0.36 }));
  assert.ok(headCut.clippedJoints.includes('nose'));
  assert.equal(headCut.verdict, 'back');

  // Ankles visible but pressed against the bottom edge count as clipped.
  const anklesEdge = skeletonFraming(bodyFrame(0.7, { centerY: 0.64 }));
  assert.ok(anklesEdge.clippedJoints.includes('leftAnkle'));
  assert.equal(anklesEdge.verdict, 'back');

  // A shoulder off the side of the frame → clipped → back.
  const sideCut = skeletonFraming(bodyFrame(0.7, { shiftX: 0.43 }));
  assert.ok(sideCut.clippedJoints.includes('rightShoulder'));
  assert.equal(sideCut.verdict, 'back');

  // Low-confidence hips are not "seen": a single hip missing still frames,
  // both missing means no body.
  assert.equal(skeletonFraming(bodyFrame(0.7, { lowConfidence: ['leftHip'] })).verdict, 'back');
  assert.equal(
    skeletonFraming(bodyFrame(0.7, { lowConfidence: ['leftHip', 'rightHip'] })).verdict,
    'searching',
  );
}

// ---------------------------------------------------------------------------
// preflightFlow reducer.

type Flow = { state: PreflightFlowState; now: number };

function start(firstRun: boolean, express = false): Flow {
  const now = 1_000_000;
  let state = createPreflightFlowState({ firstRun, express, now });
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
  readiness: 'ready' | 'return-to-center' = 'ready',
) {
  flow.now += 100;
  send(flow, { type: 'FRAME', now: flow.now, framing, status, move, readiness });
}

function frames(
  flow: Flow,
  count: number,
  framing: FramingVerdict,
  status: TrackingStatus = 'tracking',
  move: Move | null = null,
  readiness: 'ready' | 'return-to-center' = 'ready',
) {
  for (let index = 0; index < count; index += 1) frame(flow, framing, status, move, readiness);
}

// Framing messages debounce: a new verdict needs ≥ 400 ms before it shows.
{
  const flow = start(false);
  assert.equal(flow.state.framing, 'searching');
  frame(flow, 'closer', 'calibrating');
  assert.equal(flow.state.framing, 'searching', 'first differing frame only starts the candidate');
  frames(flow, 3, 'closer', 'calibrating'); // 300 ms after candidate start
  assert.equal(flow.state.framing, 'searching', 'still debouncing at 300 ms');
  frame(flow, 'closer', 'calibrating'); // 400 ms
  assert.equal(flow.state.framing, 'closer', `shows after ${FRAMING_DEBOUNCE_MS} ms`);

  // Flicker: a single 'back' frame between 'closer' frames never shows.
  frame(flow, 'back', 'calibrating');
  frame(flow, 'closer', 'calibrating');
  frame(flow, 'back', 'calibrating');
  frame(flow, 'closer', 'calibrating');
  assert.equal(flow.state.framing, 'closer', 'flicker suppressed');
  assert.equal(flow.state.framingCandidate, null, 'candidate cleared when the shown verdict recurs');

  // Analyzer calibrated but framing not ok → stay in Phase 1.
  frames(flow, 5, 'closer', 'tracking');
  assert.equal(flow.state.calibrated, true);
  assert.equal(flow.state.phase, 'framing');

  // Framing ok → advance as soon as both hold (repeat run → handoff).
  frames(flow, 5, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'handoff', 'repeat runs skip the test drive');
}

// Calibrated arriving AFTER framing ok also advances.
{
  const flow = start(false);
  frames(flow, 6, 'ok', 'calibrating');
  assert.equal(flow.state.framing, 'ok');
  assert.equal(flow.state.phase, 'framing', 'waits for the analyzer baseline');
  frame(flow, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'handoff');
}

// Native "searching" (no frames) shows the searching line after the debounce
// and flags tracking lost.
{
  const flow = start(false);
  frames(flow, 6, 'closer', 'calibrating');
  assert.equal(flow.state.framing, 'closer');
  flow.now += 100;
  send(flow, { type: 'TRACKING_LOST', now: flow.now });
  assert.equal(flow.state.trackingLost, true);
  assert.equal(flow.state.framing, 'closer', 'debounced');
  flow.now += FRAMING_DEBOUNCE_MS;
  send(flow, { type: 'TRACKING_LOST', now: flow.now });
  assert.equal(flow.state.framing, 'searching');
}

// 10 s fallback: offered on the reducer clock, from ticks or frames.
{
  const flow = start(false);
  send(flow, { type: 'TICK', now: flow.now + FRAMING_FALLBACK_MS - 1 });
  assert.equal(flow.state.fallbackOffered, false);
  send(flow, { type: 'TICK', now: flow.now + FRAMING_FALLBACK_MS });
  assert.equal(flow.state.fallbackOffered, true, 'offered at 10 s');
  // Not calibrated → defaults: the run starts without a snapshot.
  send(flow, { type: 'FALLBACK_CONTINUE', now: flow.now + FRAMING_FALLBACK_MS + 500 });
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'defaults');

  // Calibrated but framing never ok → "good enough" advances normally.
  const stuck = start(true);
  frames(stuck, 105, 'closer', 'tracking'); // 10.5 s of frames
  assert.equal(stuck.state.fallbackOffered, true, 'frames also advance the fallback clock');
  assert.equal(stuck.state.calibrated, true);
  send(stuck, { type: 'FALLBACK_CONTINUE', now: stuck.now });
  assert.equal(stuck.state.phase, 'moves', 'calibrated fallback keeps the flow, first run → moves');
  assert.equal(stuck.state.outcome, null);

  // Ignored outside Phase 1.
  send(stuck, { type: 'FALLBACK_CONTINUE', now: stuck.now });
  assert.equal(stuck.state.phase, 'moves');
}

// Denied / unavailable: explicit continue-without-camera → outcome 'off'.
{
  const now = 5_000;
  let state = createPreflightFlowState({ firstRun: true, now });
  state = reducePreflightFlow(state, { type: 'CONTINUE_WITHOUT_CAMERA', now });
  assert.equal(state.phase, 'complete');
  assert.equal(state.outcome, 'off');

  const flow = start(false);
  send(flow, { type: 'UNAVAILABLE', now: flow.now });
  assert.equal(flow.state.phase, 'unavailable');
  send(flow, { type: 'FRAME', now: flow.now, framing: 'ok', status: 'tracking', move: null, readiness: 'ready' });
  assert.equal(flow.state.phase, 'unavailable', 'frames ignored while unavailable');
  send(flow, { type: 'RETRY', now: flow.now });
  assert.equal(flow.state.phase, 'framing');
  assert.equal(flow.state.fallbackOffered, false);
  send(flow, { type: 'UNAVAILABLE', now: flow.now });
  send(flow, { type: 'CONTINUE_WITHOUT_CAMERA', now: flow.now });
  assert.equal(flow.state.outcome, 'off');
  // Terminal for user events…
  send(flow, { type: 'RETRY', now: flow.now });
  send(flow, { type: 'FALLBACK_CONTINUE', now: flow.now });
  send(flow, { type: 'COUNTDOWN_TICK', now: flow.now });
  assert.equal(flow.state.phase, 'complete');
  // …but a failed handoff after completion must still be surfaceable.
  send(flow, { type: 'UNAVAILABLE', now: flow.now });
  assert.equal(flow.state.phase, 'unavailable');
  assert.equal(flow.state.outcome, null);
}

// First run: framing → moves (JUMP, DUCK, DODGE LEFT, DODGE RIGHT) → handoff.
function toMoves(): Flow {
  const flow = start(true);
  frames(flow, 6, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'moves');
  assert.equal(currentTestMove(flow.state), 'Jump');
  return flow;
}

{
  const flow = toMoves();
  assert.deepEqual(MOVE_TEST_ORDER, ['Jump', 'Duck', 'Left', 'Right']);

  // Wrong move does not advance; the expected one does.
  frame(flow, 'ok', 'tracking', 'Left');
  assert.equal(flow.state.moveIndex, 0, 'a different move is ignored');
  frame(flow, 'ok', 'tracking', 'Jump');
  assert.equal(flow.state.moveIndex, 1);
  assert.deepEqual(flow.state.completedMoves, ['Jump']);
  assert.equal(currentTestMove(flow.state), 'Duck');

  // Neutral frames between moves (analyzer cooldown/rearm) change nothing.
  frames(flow, 4, 'ok', 'tracking', null, 'return-to-center');
  assert.equal(flow.state.moveIndex, 1);

  frame(flow, 'ok', 'tracking', 'Duck');
  frame(flow, 'ok', 'tracking', 'Left');
  assert.equal(currentTestMove(flow.state), 'Right');
  frame(flow, 'ok', 'tracking', 'Right');
  assert.equal(flow.state.phase, 'handoff', 'fourth move completes the test drive');
  assert.equal(flow.state.movesDone, true);
  assert.deepEqual(flow.state.completedMoves, ['Jump', 'Duck', 'Left', 'Right']);
  assert.deepEqual(flow.state.skippedMoves, []);
}

// Skipping never blocks: each skip advances and is recorded.
{
  const flow = toMoves();
  send(flow, { type: 'SKIP_MOVE', now: flow.now });
  assert.equal(currentTestMove(flow.state), 'Duck');
  frame(flow, 'ok', 'tracking', 'Duck');
  send(flow, { type: 'SKIP_MOVE', now: flow.now });
  send(flow, { type: 'SKIP_MOVE', now: flow.now });
  assert.equal(flow.state.phase, 'handoff');
  assert.deepEqual(flow.state.skippedMoves, ['Jump', 'Left', 'Right']);
  assert.deepEqual(flow.state.completedMoves, ['Duck']);
  send(flow, { type: 'SKIP_MOVE', now: flow.now });
  assert.equal(flow.state.phase, 'handoff', 'skip outside Phase 2 is a no-op');
}

// Body lost during the test drive: a brief loss keeps the phase; the analyzer
// dropping its baseline (status calibrating) returns to framing with the
// earned moves intact, then resumes where it left off.
{
  const flow = toMoves();
  frame(flow, 'ok', 'tracking', 'Jump');
  frame(flow, 'searching', 'searching');
  assert.equal(flow.state.phase, 'moves');
  assert.equal(flow.state.trackingLost, true);
  frame(flow, 'ok', 'reconnecting');
  frame(flow, 'ok', 'tracking');
  assert.equal(flow.state.trackingLost, false);

  frame(flow, 'ok', 'calibrating');
  assert.equal(flow.state.phase, 'framing', 'baseline lost → re-frame');
  assert.equal(flow.state.calibrated, false);
  assert.equal(flow.state.moveIndex, 1, 'progress kept');
  frames(flow, 6, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'moves');
  assert.equal(currentTestMove(flow.state), 'Duck');
}

// Phase 3: PREFLIGHT_STABLE_FRAMES neutral frames start the countdown; any
// move or non-ready frame restarts the hold; the countdown reaching 0
// completes with a calibrated handoff. Guided = 3 s, express = 2 s.
function toHandoff(express: boolean): Flow {
  const flow = start(false, express);
  frames(flow, 4, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'framing', '300 ms after the first ok frame: still debouncing');
  frame(flow, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'handoff', 'advances on the frame that settles the debounce');
  assert.equal(flow.state.stableFrames, 0);
  return flow;
}

{
  const flow = toHandoff(false);
  frames(flow, PREFLIGHT_STABLE_FRAMES - 1, 'ok', 'tracking');
  assert.equal(flow.state.countdown, null);
  frame(flow, 'ok', 'tracking', 'Jump');
  assert.equal(flow.state.stableFrames, 0, 'a move restarts the hold');
  frames(flow, PREFLIGHT_STABLE_FRAMES - 1, 'ok', 'tracking');
  frame(flow, 'ok', 'tracking', null, 'return-to-center');
  assert.equal(flow.state.stableFrames, 0, 'not-ready restarts the hold');
  frames(flow, PREFLIGHT_STABLE_FRAMES, 'ok', 'tracking');
  assert.equal(flow.state.countdown, PREFLIGHT_COUNTDOWN_SECONDS, 'guided countdown');

  // Tracking lost from the native side during the countdown cancels it.
  send(flow, { type: 'TRACKING_LOST', now: flow.now });
  assert.equal(flow.state.countdown, null);
  assert.equal(flow.state.phase, 'handoff');
  frames(flow, PREFLIGHT_STABLE_FRAMES, 'ok', 'tracking');
  assert.equal(flow.state.countdown, PREFLIGHT_COUNTDOWN_SECONDS);

  // Steady frames during the countdown do not change it; ticks do.
  frames(flow, 3, 'ok', 'tracking');
  assert.equal(flow.state.countdown, PREFLIGHT_COUNTDOWN_SECONDS);
  for (let remaining = PREFLIGHT_COUNTDOWN_SECONDS; remaining > 1; remaining -= 1) {
    send(flow, { type: 'COUNTDOWN_TICK', now: flow.now });
    assert.equal(flow.state.countdown, remaining - 1);
  }
  send(flow, { type: 'COUNTDOWN_TICK', now: flow.now });
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'calibrated');
  send(flow, { type: 'COUNTDOWN_TICK', now: flow.now });
  assert.equal(flow.state.phase, 'complete', 'terminal');
}

{
  const flow = toHandoff(true);
  frames(flow, PREFLIGHT_STABLE_FRAMES, 'ok', 'tracking');
  assert.equal(flow.state.countdown, PREFLIGHT_EXPRESS_COUNTDOWN_SECONDS, 'express countdown');
  // Express can be revoked (proportion mismatch) — only affects the next lock.
  send(flow, { type: 'SET_EXPRESS', express: false });
  assert.equal(flow.state.countdown, PREFLIGHT_EXPRESS_COUNTDOWN_SECONDS);
  send(flow, { type: 'TRACKING_LOST', now: flow.now });
  frames(flow, PREFLIGHT_STABLE_FRAMES, 'ok', 'tracking');
  assert.equal(flow.state.countdown, PREFLIGHT_COUNTDOWN_SECONDS);
}

// Baseline lost in Phase 3 → back to framing, and (first run) straight back to
// handoff afterwards because the test drive is already done.
{
  const flow = toMoves();
  for (const move of MOVE_TEST_ORDER) frame(flow, 'ok', 'tracking', move);
  assert.equal(flow.state.phase, 'handoff');
  frame(flow, 'ok', 'calibrating');
  assert.equal(flow.state.phase, 'framing');
  frames(flow, 6, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'handoff', 'moves are not repeated');
}

// Happy-path budget: Phase 1 ≈ 5 s, Phase 2 ≈ 4 × 3 s, Phase 3 ≈ 2–3 s.
{
  const flow = start(true);
  const t0 = flow.now;
  frames(flow, 20, 'closer', 'calibrating'); // 2 s walking in
  frames(flow, 25, 'ok', 'calibrating'); // 2.5 s: analyzer's 20 stable frames
  frame(flow, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'moves');
  const phase1 = flow.now - t0;
  for (const move of MOVE_TEST_ORDER) {
    frames(flow, 20, 'ok', 'tracking', null, 'return-to-center'); // ~2 s settle
    frame(flow, 'ok', 'tracking', move);
  }
  assert.equal(flow.state.phase, 'handoff');
  const phase2 = flow.now - t0 - phase1;
  frames(flow, PREFLIGHT_STABLE_FRAMES, 'ok', 'tracking');
  for (let tick = 0; tick < PREFLIGHT_COUNTDOWN_SECONDS; tick += 1) {
    flow.now += 1_000;
    send(flow, { type: 'COUNTDOWN_TICK', now: flow.now });
  }
  assert.equal(flow.state.phase, 'complete');
  const total = flow.now - t0 + END_CARD_MS;
  assert.ok(phase1 <= 5_000, `phase 1 ${phase1} ms`);
  assert.ok(phase2 <= 12_000, `phase 2 ${phase2} ms`);
  assert.ok(total <= 30_000, `happy path ${total} ms must stay within ~30 s`);
  close(flowElapsedSeconds(flow.state, flow.now), (flow.now - t0) / 1000, 'dev timer');
}

console.log(
  'Preflight flow replay passed: framing verdicts at 0.6/0.8 with edge clipping, 400 ms debounce, calibrated+ok gate, 10 s fallback (defaults vs good-enough), denied/unavailable → off, test drive advance/skip/lost, handoff hold + guided/express countdown, first-run vs repeat paths, ≤ 30 s happy path',
);

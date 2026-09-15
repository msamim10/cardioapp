import assert from 'node:assert/strict';
// Node 24 executes this TypeScript replay directly; the app compiler otherwise
// intentionally disallows source imports with a .ts suffix.
import {
  createPreflightFlowState,
  currentTeaserClip,
  flowElapsedSeconds,
  FRAMING_DEBOUNCE_MS,
  HOLD_LOCK_GRACE_MS,
  HOLD_MS,
  holdProgress,
  isCameraPhase,
  MOVE_ORDER,
  reducePreflightFlow,
  SCORE_CARD_MS,
  spokenPrompt,
  TEASER_CLIPS,
  TEASER_END_TOLERANCE_MS,
  TEASER_INTERSTITIAL_MS,
  TEASER_MAX_MS,
  TEASER_MIN_MS,
  TEASER_PLAY_GRACE_MS,
  TEASER_STEP_IN_MS,
  TEASER_TAIL_MS,
  teaserHit,
  teaserLandedCount,
  teaserOnLastClip,
  teaserStepDeadline,
  type PreflightFlowEvent,
  type PreflightFlowState,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/preflightFlow.ts';
import {
  CALIBRATION_TEASER,
  CALIBRATION_TEASER_DURATION_MS,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/data/calibrationTeaser.ts';
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
// Teaser data: four clips, one per move, contiguous, inside the bundled file.
{
  assert.equal(CALIBRATION_TEASER.levelId, 'neon-rails');
  assert.equal(TEASER_CLIPS, CALIBRATION_TEASER.clips);
  assert.deepEqual(TEASER_CLIPS.map((clip) => clip.move), [...MOVE_ORDER], 'one clip per move, in MOVE_ORDER');
  assert.equal(TEASER_CLIPS[0].startMs, 0, 'the file starts with the first clip');
  for (let index = 0; index < TEASER_CLIPS.length; index += 1) {
    const clip = TEASER_CLIPS[index];
    const length = clip.endMs - clip.startMs;
    assert.ok(length >= 1_800 && length <= 2_600, `${clip.move} clip is ${length} ms; expected ~2–2.5 s`);
    assert.ok(clip.reactMs > clip.startMs + 800, `${clip.move}: ≥ 0.8 s of approach before the dodge`);
    assert.ok(clip.endMs - clip.reactMs >= 600, `${clip.move}: ≥ 0.6 s of follow-through after the dodge`);
    if (index > 0) assert.equal(clip.startMs, TEASER_CLIPS[index - 1].endMs, 'clips are back to back');
  }
  assert.equal(TEASER_CLIPS[TEASER_CLIPS.length - 1].endMs, CALIBRATION_TEASER_DURATION_MS);
  assert.ok(CALIBRATION_TEASER_DURATION_MS >= 8_000 && CALIBRATION_TEASER_DURATION_MS <= 10_000, 'about 9 s of footage');
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

/** Reducer clock ticks (100 ms) with no frames, e.g. the body left the frame. */
function ticks(flow: Flow, count: number) {
  for (let index = 0; index < count; index += 1) {
    flow.now += 100;
    send(flow, { type: 'TICK', now: flow.now });
  }
}

/**
 * A healthy player: from the moment a clip starts playing, `timeUpdate`
 * ticks arrive every 100 ms with the position advancing from startMs. One
 * call = 100 ms of wall time and one position report (plus one analyzer
 * frame so the body stays "seen").
 */
function playerTick(flow: Flow, framing: FramingVerdict = 'ok', status: TrackingStatus = 'tracking', move: Move | null = null) {
  const clip = currentTeaserClip(flow.state);
  const step = flow.state.teaserStep;
  const started = flow.state.teaserStepStartedAt ?? flow.now;
  flow.now += 100;
  if (clip && step === 'playing') {
    send(flow, { type: 'VIDEO_TIME', now: flow.now, positionMs: clip.startMs + (flow.now - started) });
  }
  send(flow, { type: 'FRAME', now: flow.now, framing, status, move });
}

function playerTicks(flow: Flow, count: number, framing: FramingVerdict = 'ok', status: TrackingStatus = 'tracking') {
  for (let index = 0; index < count; index += 1) playerTick(flow, framing, status);
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
// the baseline usually lands during it, and the ring hands over to the
// teaser on its own.
{
  const flow = start(false);
  frames(flow, 5, 'ok', 'calibrating');
  assert.equal(flow.state.phase, 'hold', 'ring starts while the analyzer is still calibrating');
  frames(flow, 15, 'ok', 'calibrating'); // 1.5 s
  close(holdProgress(flow.state, flow.now), 0.5, 'ring half full');
  frames(flow, 14, 'ok', 'tracking'); // 2.9 s
  assert.equal(flow.state.phase, 'hold');
  frame(flow, 'ok', 'tracking'); // 3.0 s
  assert.equal(flow.state.phase, 'teaser', `ring full at ${HOLD_MS} ms → teaser`);
  assert.equal(flow.state.teaserClip, 0);
  assert.equal(flow.state.teaserStep, 'playing');
  assert.equal(flow.state.teaserStartedAt, flow.now);
  assert.equal(currentTeaserClip(flow.state)?.move, 'Jump');
  assert.equal(spokenPrompt(flow.state), null, 'the teaser is silent');
  assert.equal(flow.state.bodyVisible, true, 'ring is green straight out of the hold');
  assert.equal(holdProgress(flow.state, flow.now), 0, 'ring is gone');
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
  assert.equal(flow.state.phase, 'teaser');
}

// ---------------------------------------------------------------------------
// Teaser: four clips from the bundled MP4, the user copies each dodge.

/** Drive a flow to the first clip (analyzer locked). */
function toTeaser(firstRun = false): Flow {
  const flow = start(firstRun);
  frames(flow, 35, 'ok', 'tracking'); // 0.5 s debounce + 3 s ring
  assert.equal(flow.state.phase, 'teaser');
  assert.equal(flow.state.teaserClip, 0);
  assert.equal(flow.state.teaserStep, 'playing');
  assert.equal(teaserHit(flow.state), null);
  return flow;
}

/** Let one clip play out with a healthy player and nobody moving. */
function playClipThrough(flow: Flow) {
  const clip = currentTeaserClip(flow.state)!;
  const index = flow.state.teaserClip;
  let guard = 0;
  while (flow.state.teaserClip === index && flow.state.teaserStep === 'playing' && guard < 100) {
    playerTick(flow);
    guard += 1;
  }
  assert.ok(guard < 100, `${clip.move} clip must end`);
}

// All landed: every move detected while its clip plays → perfect, no tail,
// interstitial, next clip; score card 4/4; complete with the baseline.
{
  const flow = toTeaser();
  const t0 = flow.now;
  for (const clip of TEASER_CLIPS) {
    assert.equal(currentTeaserClip(flow.state), clip);
    assert.equal(flow.state.teaserStep, 'playing');
    playerTicks(flow, 5); // 0.5 s in, nothing yet
    assert.equal(teaserHit(flow.state), null);
    playerTick(flow, 'ok', 'tracking', clip.move);
    assert.equal(teaserHit(flow.state), 'perfect', `${clip.move} lands as perfect`);
    assert.equal(flow.state.teaserHitAt, flow.now);
    assert.equal(flow.state.teaserStep, 'playing', 'the clip keeps playing so the dodge is seen');
    playerTick(flow, 'ok', 'tracking', clip.move);
    assert.equal(flow.state.teaserHits.filter(Boolean).length, flow.state.teaserClip + 1, 'a second detection is ignored');
    const started = flow.state.teaserStepStartedAt!;
    playClipThrough(flow);
    assert.equal(flow.state.teaserStep, 'interstitial', 'landed → straight to the interstitial, no tail');
    const played = flow.state.teaserStepStartedAt! - started;
    assert.ok(
      played >= clip.endMs - clip.startMs - TEASER_END_TOLERANCE_MS - 100 && played <= clip.endMs - clip.startMs + 100,
      `${clip.move}: ended on the player's clock (${played} ms for a ${clip.endMs - clip.startMs} ms clip)`,
    );
    assert.equal(teaserOnLastClip(flow.state), clip === TEASER_CLIPS[TEASER_CLIPS.length - 1]);
    ticks(flow, TEASER_INTERSTITIAL_MS / 100 - 1);
    assert.equal(flow.state.teaserStep, 'interstitial', 'interstitial is up for its full second');
    ticks(flow, 1);
  }
  assert.equal(flow.state.teaserStep, 'done', 'after the last interstitial: the score card');
  assert.equal(flow.state.teaserClip, TEASER_CLIPS.length);
  assert.equal(currentTeaserClip(flow.state), null);
  assert.equal(teaserLandedCount(flow.state), 4);
  assert.deepEqual(flow.state.teaserHits, ['perfect', 'perfect', 'perfect', 'perfect']);
  assert.equal(spokenPrompt(flow.state), "You're set", 'sign-off on the score card');
  frame(flow, 'ok', 'tracking', 'Jump');
  assert.equal(teaserLandedCount(flow.state), 4, 'moves on the score card do not count');
  ticks(flow, SCORE_CARD_MS / 100 - 2); // (the frame above already spent 100 ms)
  assert.equal(flow.state.phase, 'teaser');
  ticks(flow, 1);
  assert.equal(flow.state.phase, 'complete', `score card → complete after ${SCORE_CARD_MS} ms`);
  assert.equal(flow.state.outcome, 'calibrated');
  assert.equal(flow.state.skipped, false);
  assert.equal(flow.state.teaserStep, null);
  assert.equal(spokenPrompt(flow.state), "You're set");
  const total = flow.now - t0;
  assert.ok(total <= TEASER_MIN_MS + 4 * 200, `all landed: ${total} ms ≈ TEASER_MIN_MS ${TEASER_MIN_MS}`);
  // Terminal for user events.
  send(flow, { type: 'SKIP', now: flow.now });
  send(flow, { type: 'RETRY', now: flow.now });
  frame(flow, 'back', 'tracking');
  send(flow, { type: 'VIDEO_TIME', now: flow.now, positionMs: 0 });
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'calibrated');
}

// None landed: every clip plays, freezes for the tail, shows the
// interstitial and moves on — no miss, no retry; score card 0/4; still
// calibrated. Exactly clip + tail + interstitial per clip.
{
  const flow = toTeaser();
  const t0 = flow.now;
  for (const clip of TEASER_CLIPS) {
    const clipStart = flow.now;
    playClipThrough(flow);
    assert.equal(flow.state.teaserStep, 'tail', 'nothing landed → frozen frame, window stays open');
    assert.equal(teaserStepDeadline(flow.state), flow.state.teaserStepStartedAt! + TEASER_TAIL_MS);
    ticks(flow, TEASER_TAIL_MS / 100 - 1);
    assert.equal(flow.state.teaserStep, 'tail');
    ticks(flow, 1);
    assert.equal(flow.state.teaserStep, 'interstitial', `tail over after ${TEASER_TAIL_MS} ms`);
    assert.equal(teaserHit(flow.state), null);
    ticks(flow, TEASER_INTERSTITIAL_MS / 100);
    const slot = flow.now - clipStart;
    const expected = clip.endMs - clip.startMs + TEASER_TAIL_MS + TEASER_INTERSTITIAL_MS;
    assert.ok(Math.abs(slot - expected) <= TEASER_END_TOLERANCE_MS + 100, `${clip.move} slot ${slot} ms ≈ ${expected} ms`);
  }
  assert.equal(flow.state.teaserStep, 'done');
  assert.equal(teaserLandedCount(flow.state), 0);
  assert.deepEqual(flow.state.teaserHits, [null, null, null, null]);
  ticks(flow, SCORE_CARD_MS / 100);
  assert.equal(flow.state.phase, 'complete', 'auto-advances all the way out');
  assert.equal(flow.state.outcome, 'calibrated', 'the baseline from the hold is kept');
  const total = flow.now - t0;
  assert.ok(total < TEASER_MAX_MS, `none landed with a healthy player: ${total} ms < TEASER_MAX_MS ${TEASER_MAX_MS}`);
  assert.ok(total <= 18_000, `teaser worst case with a healthy player ${total} ms stays under 18 s`);
}

// Late and lenient: a move in the tail lands (skipping the rest of the
// tail); a DIFFERENT move than the clip's lands as "good".
{
  const flow = toTeaser();
  playClipThrough(flow); // Jump clip, nothing yet
  assert.equal(flow.state.teaserStep, 'tail');
  ticks(flow, 3);
  frame(flow, 'ok', 'tracking', 'Jump'); // 0.4 s into the tail
  assert.equal(teaserHit(flow.state), 'perfect', 'the tail is part of the window');
  assert.equal(flow.state.teaserStep, 'interstitial', 'landing in the tail ends it at once');
  ticks(flow, TEASER_INTERSTITIAL_MS / 100);
  assert.equal(currentTeaserClip(flow.state)?.move, 'Duck');
  playerTicks(flow, 3);
  playerTick(flow, 'ok', 'tracking', 'Left');
  assert.equal(teaserHit(flow.state), 'good', 'any classified move counts, shown as GOOD');
  playerTick(flow, 'ok', 'tracking', 'Duck');
  assert.equal(teaserHit(flow.state), 'good', 'the first hit stands');
  playClipThrough(flow);
  assert.equal(flow.state.teaserStep, 'interstitial');
  ticks(flow, TEASER_INTERSTITIAL_MS / 100);
  assert.equal(currentTeaserClip(flow.state)?.move, 'Left');
  // Moves during the interstitial do not count for the next clip.
  playClipThrough(flow);
  ticks(flow, TEASER_TAIL_MS / 100);
  assert.equal(flow.state.teaserStep, 'interstitial');
  frame(flow, 'ok', 'tracking', 'Right');
  assert.equal(teaserHit(flow.state), null, 'interstitial is outside every window');
  ticks(flow, TEASER_INTERSTITIAL_MS / 100);
  assert.equal(currentTeaserClip(flow.state)?.move, 'Right');
  assert.equal(teaserHit(flow.state), null, 'and not carried into the next clip');
  playerTick(flow, 'ok', 'tracking', 'Right');
  playClipThrough(flow);
  ticks(flow, TEASER_INTERSTITIAL_MS / 100);
  assert.equal(flow.state.teaserStep, 'done');
  assert.deepEqual(flow.state.teaserHits, ['perfect', 'good', null, 'perfect']);
  assert.equal(teaserLandedCount(flow.state), 3, 'score card reads 3/4');
}

// Stalled player: no VIDEO_TIME at all (or a frozen position) can never hang
// the flow — the wall clock ends each clip TEASER_PLAY_GRACE_MS past its
// own length, and the whole teaser stays under TEASER_MAX_MS.
{
  const flow = toTeaser();
  const t0 = flow.now;
  const jump = TEASER_CLIPS[0];
  const length = jump.endMs - jump.startMs;
  assert.equal(teaserStepDeadline(flow.state), flow.state.teaserStepStartedAt! + length + TEASER_PLAY_GRACE_MS);
  ticks(flow, Math.floor((length + TEASER_PLAY_GRACE_MS) / 100) - 1);
  assert.equal(flow.state.teaserStep, 'playing', 'still waiting on the player inside the grace');
  ticks(flow, 2);
  assert.equal(flow.state.teaserStep, 'tail', 'grace over → the flow moves on without the player');
  // A frozen position (the player reports the same early time forever).
  ticks(flow, TEASER_TAIL_MS / 100 + TEASER_INTERSTITIAL_MS / 100);
  assert.equal(currentTeaserClip(flow.state)?.move, 'Duck');
  const duck = TEASER_CLIPS[1];
  for (let i = 0; i < 40; i += 1) {
    flow.now += 100;
    send(flow, { type: 'VIDEO_TIME', now: flow.now, positionMs: duck.startMs + 300 });
  }
  assert.equal(flow.state.teaserStep, 'tail', 'a stuck position still times out');
  // Stale positions from before the seek never end a clip early.
  ticks(flow, TEASER_TAIL_MS / 100 + TEASER_INTERSTITIAL_MS / 100);
  assert.equal(currentTeaserClip(flow.state)?.move, 'Left');
  send(flow, { type: 'VIDEO_TIME', now: flow.now, positionMs: duck.startMs + 300 });
  assert.equal(flow.state.teaserStep, 'playing', 'a position from the previous clip is ignored');
  assert.equal(flow.state.teaserVideoMs, null);
  send(flow, { type: 'VIDEO_TIME', now: flow.now, positionMs: CALIBRATION_TEASER_DURATION_MS });
  assert.equal(flow.state.teaserStep, 'tail', 'the player racing to the end of the file ends the clip');
  // Finish with nobody moving and no player.
  let guard = 0;
  while (flow.state.phase === 'teaser' && guard < 400) {
    ticks(flow, 1);
    guard += 1;
  }
  assert.equal(flow.state.phase, 'complete', 'the teaser always finishes on the clock alone');
  assert.equal(flow.state.outcome, 'calibrated');
  const total = flow.now - t0;
  assert.ok(total <= TEASER_MAX_MS + 200, `stalled player: ${total} ms ≤ TEASER_MAX_MS ${TEASER_MAX_MS}`);
  assert.ok(TEASER_MAX_MS <= 25_000, `TEASER_MAX_MS ${TEASER_MAX_MS} ms must stay within ~25 s`);

  // A player that fails outright: finish with the baseline, no score card.
  const broken = toTeaser();
  playerTick(broken, 'ok', 'tracking', 'Jump');
  send(broken, { type: 'VIDEO_FAILED', now: broken.now });
  assert.equal(broken.state.phase, 'complete');
  assert.equal(broken.state.outcome, 'calibrated');
  assert.equal(broken.state.skipped, false);
  const idle = start(false);
  send(idle, { type: 'VIDEO_FAILED', now: idle.now });
  assert.equal(idle.state.phase, 'framing', 'ignored outside the teaser');
}

// Tracking loss never blocks the teaser: the body leaving turns the ring
// amber, "Step in" is due after TEASER_STEP_IN_MS, clips keep ending on the
// clock, and the body coming back clears both.
{
  const flow = toTeaser();
  assert.equal(flow.state.bodyVisible, true);
  playerTicks(flow, 3);
  flow.now += 100;
  send(flow, { type: 'TRACKING_LOST', now: flow.now });
  assert.equal(flow.state.phase, 'teaser', 'no drop to framing');
  assert.equal(flow.state.teaserStep, 'playing');
  assert.equal(flow.state.bodyVisible, false, 'ring goes amber');
  assert.equal(flow.state.bodyLostSince, flow.now);
  assert.equal(flow.state.trackingLost, true);
  assert.equal(spokenPrompt(flow.state), null, 'nothing said yet');
  ticks(flow, TEASER_STEP_IN_MS / 100 - 1);
  assert.equal(flow.state.teaserStepIn, false);
  ticks(flow, 1);
  assert.equal(flow.state.teaserStepIn, true, `"Step in" after ${TEASER_STEP_IN_MS} ms without a body`);
  assert.equal(spokenPrompt(flow.state), 'Step in');
  // The clip ends on the clock with nobody in frame…
  let guard = 0;
  while (flow.state.teaserStep === 'playing' && guard < 100) {
    ticks(flow, 1);
    guard += 1;
  }
  assert.equal(flow.state.teaserStep, 'tail', 'clip ended without the body');
  // …frames with only the head visible keep the ring amber…
  frame(flow, 'searching', 'searching');
  assert.equal(flow.state.bodyVisible, false);
  assert.equal(flow.state.teaserStepIn, true);
  // …and the body coming back clears everything, at any framing verdict.
  frame(flow, 'closer', 'tracking');
  assert.equal(flow.state.bodyVisible, true, 'shoulders + hips seen → green (framing not judged)');
  assert.equal(flow.state.bodyLostSince, null);
  assert.equal(flow.state.teaserStepIn, false);
  assert.equal(spokenPrompt(flow.state), null);
  assert.equal(flow.state.framing, 'ok', 'framing verdicts are not even applied');
  // A reconnecting analyzer counts as lost too; a short loss says nothing.
  frame(flow, 'ok', 'reconnecting');
  assert.equal(flow.state.bodyVisible, false);
  frames(flow, 5, 'ok', 'reconnecting');
  assert.equal(flow.state.teaserStepIn, false, 'under 2 s: silent');
  frame(flow, 'ok', 'tracking');
  assert.equal(flow.state.bodyVisible, true);
  // Losing the body for the rest of the teaser still finishes it.
  send(flow, { type: 'TRACKING_LOST', now: (flow.now += 100) });
  guard = 0;
  while (flow.state.phase === 'teaser' && guard < 400) {
    ticks(flow, 1);
    guard += 1;
  }
  assert.equal(flow.state.phase, 'complete', 'finishes even if the body never comes back');
  assert.equal(flow.state.outcome, 'calibrated');
  assert.equal(flow.state.teaserStepIn, false, 'prompt flag cleared on completion');
}

// Skip mid-teaser: straight out, with the baseline when there is one, no
// score card; flagged for analytics.
{
  const flow = toTeaser();
  playerTick(flow, 'ok', 'tracking', 'Jump');
  playClipThrough(flow);
  ticks(flow, TEASER_INTERSTITIAL_MS / 100);
  playerTicks(flow, 4);
  assert.equal(currentTeaserClip(flow.state)?.move, 'Duck');
  send(flow, { type: 'SKIP', now: flow.now });
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'calibrated');
  assert.equal(flow.state.skipped, true);
  assert.equal(flow.state.teaserStep, null);
  assert.equal(teaserLandedCount(flow.state), 1, 'hits so far survive for the analytics event');
  assert.equal(flow.state.teaserStartedAt !== null, true);

  // Skip on the score card too.
  const card = toTeaser();
  for (let i = 0; i < TEASER_CLIPS.length; i += 1) {
    playClipThrough(card);
    ticks(card, TEASER_TAIL_MS / 100 + TEASER_INTERSTITIAL_MS / 100);
  }
  assert.equal(card.state.teaserStep, 'done');
  send(card, { type: 'SKIP', now: card.now });
  assert.equal(card.state.phase, 'complete');
  assert.equal(card.state.skipped, true);
}

// Spoken prompts through the real gate: framing → hold → (silence) → sign-off.
// The teaser adds no lines unless the body goes missing.
{
  const flow = start(false);
  let gate = INITIAL_SPEECH_GATE;
  const spokenLines: string[] = [];
  let last: string | null = null;
  const observe = () => {
    const line = spokenPrompt(flow.state);
    if (line === last) return;
    last = line;
    if (line === null) return;
    const decision = nextUtterance(gate, line, flow.now, line === "You're set" || line === 'Step in');
    if (decision.speak) {
      gate = decision.gate;
      spokenLines.push(line);
    }
  };
  observe();
  for (let i = 0; i < 35; i += 1) {
    frame(flow, 'ok', 'tracking');
    observe();
  }
  assert.equal(flow.state.phase, 'teaser');
  for (const clip of TEASER_CLIPS) {
    playerTick(flow, 'ok', 'tracking', clip.move);
    observe();
    while (flow.state.teaserStep === 'playing') {
      playerTick(flow);
      observe();
    }
    for (let i = 0; i < TEASER_INTERSTITIAL_MS / 100; i += 1) {
      ticks(flow, 1);
      observe();
    }
  }
  assert.equal(flow.state.teaserStep, 'done');
  for (let i = 0; i < SCORE_CARD_MS / 100; i += 1) {
    ticks(flow, 1);
    observe();
  }
  assert.equal(flow.state.phase, 'complete');
  // "Perfect, hold still" lands 0.5 s after "Step into frame" here and is
  // gated (pre-existing behaviour); the sign-off clears the gate.
  assert.deepEqual(spokenLines, ['Step into frame', "You're set"]);
  assert.ok(SPEECH_MIN_GAP_MS <= TEASER_STEP_IN_MS + TEASER_TAIL_MS, 'a "Step in" always has room to clear the gate');
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
// the teaser runs and the run starts on defaults (calibrates live) — nobody
// is trapped here.
{
  const flow = start(false);
  frames(flow, 5, 'ok', 'calibrating');
  frames(flow, 30, 'ok', 'calibrating'); // 3 s
  assert.equal(flow.state.phase, 'hold', 'ring full, waiting on the baseline');
  assert.equal(holdProgress(flow.state, flow.now), 1);
  send(flow, { type: 'TICK', now: flow.now + HOLD_LOCK_GRACE_MS - 1 });
  assert.equal(flow.state.phase, 'hold');
  flow.now += HOLD_LOCK_GRACE_MS;
  send(flow, { type: 'TICK', now: flow.now });
  assert.equal(flow.state.phase, 'teaser', 'grace over → the teaser runs anyway');
  let guard = 0;
  while (flow.state.phase === 'teaser' && guard < 400) {
    playerTick(flow, 'ok', 'calibrating');
    guard += 1;
  }
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'defaults');

  // …but a late lock inside the grace completes calibrated.
  const late = start(false);
  frames(late, 35, 'ok', 'calibrating');
  frame(late, 'ok', 'tracking');
  assert.equal(late.state.phase, 'teaser');
  guard = 0;
  while (late.state.phase === 'teaser' && guard < 400) {
    playerTick(late);
    guard += 1;
  }
  assert.equal(late.state.outcome, 'calibrated');

  // A lock that only arrives during the teaser still counts.
  const later = start(false);
  frames(later, 35, 'ok', 'calibrating');
  send(later, { type: 'TICK', now: (later.now += HOLD_LOCK_GRACE_MS) });
  assert.equal(later.state.phase, 'teaser');
  playerTicks(later, 3, 'ok', 'tracking');
  guard = 0;
  while (later.state.phase === 'teaser' && guard < 400) {
    playerTick(later);
    guard += 1;
  }
  assert.equal(later.state.outcome, 'calibrated');
}

// Skip: calibrated → hands off; not calibrated → defaults. Ignored elsewhere.
{
  const flow = start(false);
  frames(flow, 3, 'closer', 'calibrating');
  send(flow, { type: 'SKIP', now: flow.now });
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'defaults');
  assert.equal(flow.state.skipped, true);

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

  // Camera dying mid-teaser: unavailable card, teaser state cleared; retry
  // starts a fresh cycle from framing.
  const mid = toTeaser();
  playerTicks(mid, 4);
  send(mid, { type: 'UNAVAILABLE', now: mid.now });
  assert.equal(mid.state.phase, 'unavailable');
  assert.equal(mid.state.teaserStep, null);
  send(mid, { type: 'RETRY', now: mid.now });
  assert.equal(mid.state.phase, 'framing');
  assert.equal(mid.state.teaserClip, 0);
  assert.deepEqual(mid.state.teaserHits, []);
  assert.equal(mid.state.teaserStartedAt, null);
}

// First run and repeat run take the same path (hold → teaser → score card).
{
  const first = start(true);
  const repeat = start(false);
  for (const flow of [first, repeat]) {
    frames(flow, 5, 'ok', 'calibrating');
    frames(flow, 30, 'ok', 'tracking');
    assert.equal(flow.state.phase, 'teaser');
    let guard = 0;
    while (flow.state.phase === 'teaser' && guard < 400) {
      playerTick(flow);
      guard += 1;
    }
    assert.equal(flow.state.outcome, 'calibrated');
  }
  assert.equal(first.state.firstRun, true);
}

// Happy-path budget: ~2 s walking in + 3 s hold + the teaser (+ score card).
{
  const flow = start(true);
  const t0 = flow.now;
  frames(flow, 15, 'closer', 'calibrating'); // 1.5 s walking in
  frames(flow, 5, 'ok', 'calibrating'); // 0.5 s debounce → hold
  assert.equal(flow.state.phase, 'hold');
  const framingMs = flow.now - t0;
  frames(flow, 20, 'ok', 'calibrating'); // analyzer's 20 stable frames
  frames(flow, 10, 'ok', 'tracking');
  assert.equal(flow.state.phase, 'teaser');
  const holdMs = flow.now - t0 - framingMs;
  const teaserStart = flow.now;
  // Realistic: each dodge copied ~0.6 s after the runner's, healthy player.
  for (const clip of TEASER_CLIPS) {
    while (flow.state.teaserStep === 'playing' || flow.state.teaserStep === 'tail') {
      const at = flow.state.teaserStep === 'playing' ? clip.startMs + (flow.now + 100 - flow.state.teaserStepStartedAt!) : Infinity;
      const react = at >= clip.reactMs + 600 && teaserHit(flow.state) === null;
      playerTick(flow, 'ok', 'tracking', react ? clip.move : null);
    }
    ticks(flow, TEASER_INTERSTITIAL_MS / 100);
  }
  assert.deepEqual(flow.state.teaserHits, ['perfect', 'perfect', 'perfect', 'perfect']);
  ticks(flow, SCORE_CARD_MS / 100);
  assert.equal(flow.state.phase, 'complete');
  assert.equal(flow.state.outcome, 'calibrated');
  const teaserMs = flow.now - teaserStart;
  const total = flow.now - t0;
  assert.ok(framingMs <= 2_000, `framing ${framingMs} ms`);
  assert.equal(holdMs, HOLD_MS, 'hold is exactly the ring');
  assert.ok(teaserMs >= 13_000 && teaserMs <= 18_000, `teaser ${teaserMs} ms must be ≈ 13–18 s`);
  assert.ok(total >= 18_000 && total <= 25_000, `happy path ${total} ms must land in ≈ 20–25 s`);
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
  `Preflight flow replay passed: upper-body framing (legs optional, torso band 0.16–0.34, head margin, centre band), 400 ms debounce, framing → 3 s hold → teaser (${TEASER_CLIPS.length} clips ${CALIBRATION_TEASER_DURATION_MS} ms, perfect/good/none, ${TEASER_TAIL_MS} ms tail, ${TEASER_INTERSTITIAL_MS} ms interstitial, ${TEASER_PLAY_GRACE_MS} ms stall guard, min ${TEASER_MIN_MS} / max ${TEASER_MAX_MS} ms) → ${SCORE_CARD_MS} ms score card → complete; all landed, none landed, lenient/late hits, stalled + failed player, tracking loss never blocks, skip mid-teaser, lock grace → defaults, denied/unavailable → off, 12 h session skip, spoken prompt gate`,
);

// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
/**
 * Replay for FEATURE 2 (leaderboards): the shared server-side run verifier.
 *
 * A synthetic 60 s timed run is played through the app's real `CueJudge`, its
 * judgement log is packaged exactly as `submitRunIfEligible` would, and the
 * shared `validateSubmission` must accept it and re-derive the identical
 * score / combo / accuracy. Then every rejection path is exercised by
 * tampering with one field at a time. Nonce timing and rate limits are pure
 * helpers and are checked here too. No Firebase involved.
 */
import assert from 'node:assert/strict';
import { CueJudge } from '../src/lib/cueScoring.ts';
import {
  beatmapHash,
  consumeSampleReport,
  consumeStartRun,
  consumeSubmitRun,
  cuesForLoopedPlayback,
  DETECTION_LATENCY_COMPENSATION_MS,
  EMPTY_RATE_LIMIT,
  FREE_MOVE_MAX_POINTS,
  FREE_MOVE_MIN_POINTS,
  isProvisionalPayload,
  MAX_MOVE_SAMPLES,
  nonceTimingOk,
  NONCE_MAX_AGE_S,
  parseBeatmap,
  parseSubmitRunPayload,
  PROVISIONAL_BEATMAP_HASH,
  PROVISIONAL_MAX_MOVES_PER_MIN,
  replayJudgements,
  SAMPLE_COUNT_TOLERANCE,
  SAMPLE_DAILY_LIMIT,
  samplesConsistent,
  START_RUN_DAILY_LIMIT,
  SUBMIT_DAILY_LIMIT,
  validateProvisionalSubmission,
  validateSubmission,
  type JudgeEvent,
  type MoveSample,
  type SubmitRunPayload,
} from '../shared/scoring/index.ts';

// ---------------------------------------------------------------------------
// Fixture: a 20 s chart looped through a 90 s run at 1.0x.
// ---------------------------------------------------------------------------
const beatmap = parseBeatmap({
  version: 1,
  levelId: 'neon-rails',
  videoDurationSec: 20,
  orientation: 'vertical',
  cues: [
    { t: 2, move: 'jump' },
    { t: 5, move: 'duck' },
    { t: 8.5, move: 'left' },
    { t: 12, move: 'right' },
    { t: 15, move: 'jump' },
    { t: 18, move: 'duck' },
  ],
});
assert.ok(beatmap, 'fixture beatmap must parse');
const hash = beatmapHash(beatmap);
const COMP_S = DETECTION_LATENCY_COMPENSATION_MS / 1000;
const TARGET_S = 90;
const RATE = 1;
const TICK_S = 0.25;

const MOVE_FOR_CUE = { jump: 'Jump', duck: 'Duck', left: 'Left', right: 'Right' } as const;

/**
 * Drive the judge like the workout does: ticks every 250 ms and a move for
 * each scheduled cue at `cue.at + comp + offset`. `plan(loopIndex, cueIndex)`
 * returns the offset in ms (null to skip the cue so it expires, 'wrong' to
 * perform the wrong move, 'spurious' to add an extra move mid-gap).
 */
function simulateRun(plan: (loop: number, index: number) => number | null | 'wrong' | 'spurious') {
  const judge = new CueJudge(beatmap);
  const videoEnd = TARGET_S * RATE;
  const cues = cuesForLoopedPlayback(beatmap, 0, videoEnd + 5);
  const actions: { t: number; run: () => void }[] = [];
  for (const cue of cues) {
    const decision = plan(cue.loop, cue.index);
    if (decision === null) continue;
    if (decision === 'spurious') {
      // A move in a gap with no cue in the ±400 ms window.
      actions.push({ t: cue.at + COMP_S + 1.2, run: () => judge.onMove('Jump', cue.at + COMP_S + 1.2) });
      actions.push({ t: cue.at + COMP_S, run: () => judge.onMove(MOVE_FOR_CUE[cue.move], cue.at + COMP_S) });
      continue;
    }
    const at = cue.at + COMP_S + (decision === 'wrong' ? 0 : decision / 1000);
    const move = decision === 'wrong' ? (cue.move === 'jump' ? 'Duck' : 'Jump') : MOVE_FOR_CUE[cue.move];
    actions.push({ t: at, run: () => judge.onMove(move, at) });
  }
  actions.sort((a, b) => a.t - b.t);
  let next = 0;
  for (let t = 0; t <= videoEnd + 1e-9; t += TICK_S) {
    while (next < actions.length && actions[next].t <= t) {
      if (actions[next].t <= videoEnd) actions[next].run();
      next += 1;
    }
    judge.onTick(t);
  }
  return judge;
}

/** Consensus samples the workout would have recorded for a judged run: one per judged cue. */
function samplesFor(judge: CueJudge): MoveSample[] {
  return judge.events
    .filter((e) => e.i >= 0)
    .map((e) => ({ m: beatmap.cues[e.i].move, t: Math.round((e.t % beatmap.videoDurationSec) * 1000) / 1000 }));
}

function payloadFor(judge: CueJudge, overrides: Partial<SubmitRunPayload> = {}): SubmitRunPayload {
  const score = judge.score;
  const samples = samplesFor(judge);
  return {
    runId: 'run-1',
    levelId: beatmap.levelId,
    beatmapHash: hash,
    beatmapVersion: 1,
    classKey: 'beginner',
    intensity: 'steady',
    playbackRate: RATE,
    targetSeconds: TARGET_S,
    elapsedSeconds: TARGET_S + 0.4,
    videoLengthSec: beatmap.videoDurationSec,
    nonce: 'nonce-1',
    cues: judge.events,
    spurious: score.spurious,
    score: score.score,
    maxCombo: score.maxCombo,
    accuracy: judge.accuracy,
    recorded: true,
    appVersion: '1.1.0',
    dateKey: '2026-09-13',
    moveCount: samples.length,
    samples,
    naturalPlaySec: TARGET_S,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path: perfect run, mixed run, run with expiries and spurious moves.
// ---------------------------------------------------------------------------
{
  const judge = simulateRun(() => 40);
  const payload = payloadFor(judge);
  const parsed = parseSubmitRunPayload(JSON.parse(JSON.stringify(payload)));
  assert.ok(parsed.ok, 'wire shape must parse');
  const verdict = validateSubmission(parsed.payload, beatmap, hash);
  assert.ok(verdict.ok, `perfect run accepted (${!verdict.ok && verdict.code})`);
  assert.equal(verdict.totals.score, judge.score.score);
  assert.equal(verdict.totals.maxCombo, judge.score.maxCombo);
  assert.ok(judge.score.score > 0 && judge.score.perfect >= 26, 'covers four and a half loops of cues');
  assert.equal(verdict.totals.accuracy, 1);
}
{
  // Good / miss / expired / wrong-move / spurious all present.
  const judge = simulateRun((loop, index) => {
    if (loop === 0 && index === 1) return 200; // good
    if (loop === 0 && index === 3) return 330; // miss (in window, late)
    if (loop === 1 && index === 0) return null; // expired on tick
    if (loop === 1 && index === 2) return 'wrong';
    if (loop === 2 && index === 1) return 'spurious';
    return -60; // perfect, slightly early
  });
  assert.ok(judge.score.good >= 1 && judge.score.miss >= 3 && judge.score.spurious === 1, 'fixture mixes grades');
  const payload = payloadFor(judge);
  const verdict = validateSubmission(payload, beatmap, hash);
  assert.ok(verdict.ok, `mixed run accepted (${!verdict.ok && `${verdict.code} ${verdict.detail}`})`);
  assert.equal(verdict.totals.score, payload.score);
  assert.equal(verdict.totals.maxCombo, payload.maxCombo);
  assert.ok(Math.abs(verdict.totals.accuracy - payload.accuracy) < 1e-12);
  assert.equal(verdict.totals.spurious, 1);
  // Elapsed anywhere inside [target − 2, target + 5] is fine as long as the
  // judgements fit inside it (the last tick landed at 90.0 s here).
  assert.ok(validateSubmission(payloadFor(judge, { elapsedSeconds: TARGET_S - 0.5 }), beatmap, hash).ok);
  assert.ok(validateSubmission(payloadFor(judge, { elapsedSeconds: TARGET_S + 0.9 }), beatmap, hash).ok);
  // Over-reporting elapsed (still inside the target tolerance) demands cues
  // the run never reached → rejected. Under-reporting is covered below by
  // `event-after-end`.
  const long = validateSubmission(payloadFor(judge, { elapsedSeconds: TARGET_S + 4.9 }), beatmap, hash);
  assert.equal(long.ok, false);
  assert.equal(long.code, 'missing-cues');
}

// ---------------------------------------------------------------------------
// Rejections: one tampered field each.
// ---------------------------------------------------------------------------
const base = simulateRun(() => 30);
const reject = (overrides: Partial<SubmitRunPayload>, code: string, label = code) => {
  const verdict = validateSubmission(payloadFor(base, overrides), beatmap, hash);
  assert.equal(verdict.ok, false, `${label} must be rejected`);
  assert.equal(verdict.code, code, `${label}: ${verdict.ok ? 'ok' : verdict.detail ?? ''}`);
};

reject({ levelId: 'dino-escape' }, 'level-mismatch');
reject({ beatmapHash: 'b1-deadbeef' }, 'hash-mismatch', 'wrong hash');
reject({ beatmapVersion: 0 }, 'bad-version', 'verified run claiming version 0');
assert.equal(isProvisionalPayload(payloadFor(base)), false, 'charted payload is not provisional');
reject({ playbackRate: 1.5 }, 'bad-rate');
reject({ targetSeconds: 45, elapsedSeconds: 45.2 }, 'bad-elapsed', 'under 60 s');
reject({ targetSeconds: 4 * 3600, elapsedSeconds: 4 * 3600 }, 'bad-elapsed', 'impossible duration (4 h)');
reject({ targetSeconds: null }, 'bad-target', 'untimed run');
reject({ elapsedSeconds: TARGET_S + 6 }, 'bad-target', 'past the late tolerance');
reject({ elapsedSeconds: TARGET_S - 2.5 }, 'bad-target', 'before the early tolerance');
reject({ videoLengthSec: beatmap.videoDurationSec + 3 }, 'bad-video-length');
reject({ cues: [...base.events, base.events[0]] }, 'events-out-of-order', 'duplicate appended out of order');
{
  // Duplicate cue in order: repeat the first event right after itself.
  const [first, ...rest] = base.events;
  reject({ cues: [first, { ...first }, ...rest] }, 'duplicate-cue');
}
{
  // Grade says perfect but the delta is in the good band.
  const cues = base.events.map((e, i) => (i === 0 ? { ...e, d: 200 } : e));
  reject({ cues }, 'grade-delta-mismatch', 'grade/delta mismatch');
}
{
  // Delta consistent with its grade but not with the cue time.
  const cues = base.events.map((e, i) => (i === 0 ? { ...e, d: -30 } : e));
  reject({ cues }, 'delta-inconsistent');
}
{
  // A cue from a loop the run never reached.
  const cues = [...base.events, { i: 0, l: 9, g: 'p', d: 0, t: 9 * 20 + 2 + COMP_S }];
  reject({ cues }, 'event-after-end', 'cue beyond the run');
}
{
  const cues = base.events.map((e, i) => (i === 0 ? { ...e, i: 42 } : e));
  reject({ cues }, 'unknown-cue');
}
{
  // Drop a judged cue whose window closed mid-run → the server insists on it.
  const cues = base.events.filter((_, i) => i !== 2);
  reject({ cues }, 'missing-cues');
}
{
  // Claim a spurious count that the log does not contain.
  reject({ spurious: base.score.spurious + 1 }, 'spurious-mismatch');
}
reject({ score: base.score.score + 100 }, 'score-mismatch', 'inflated score');
reject({ maxCombo: base.score.maxCombo + 1 }, 'combo-mismatch');
reject({ accuracy: base.accuracy - 0.01 }, 'accuracy-mismatch');
{
  // Turning a recorded miss into a perfect also inflates the score → caught
  // by the replay even though the delta itself is edited to look consistent.
  const judge = simulateRun((loop, index) => (loop === 0 && index === 2 ? 330 : 20));
  const missIndex = judge.events.findIndex((e) => e.g === 'm');
  assert.ok(missIndex >= 0);
  const cues = judge.events.map((e, i) => (i === missIndex ? { ...e, g: 'p', d: 100 } : e));
  const verdict = validateSubmission(payloadFor(judge, { cues }), beatmap, hash);
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.code === 'delta-inconsistent' || verdict.code === 'score-mismatch',
    `upgraded miss caught (${verdict.code})`,
  );
}

// Wire-shape parser refuses malformed payloads outright.
{
  const bad = parseSubmitRunPayload({ ...payloadFor(base), cues: [{ i: 0, l: 0, g: 'perfect', d: 0, t: 1 }] });
  assert.equal(bad.ok, false);
  assert.equal(parseSubmitRunPayload(null).ok, false);
  assert.equal(parseSubmitRunPayload({ ...payloadFor(base), score: 12.5 }).ok, false);
  assert.equal(parseSubmitRunPayload({ ...payloadFor(base), accuracy: 1.2 }).ok, false);
  assert.equal(parseSubmitRunPayload({ ...payloadFor(base), beatmapVersion: -1 }).ok, false, 'negative version');
  assert.equal(parseSubmitRunPayload({ ...payloadFor(base), beatmapVersion: 1.5 }).ok, false, 'fractional version');
  assert.equal(parseSubmitRunPayload({ ...payloadFor(base), samples: [{ m: 'spin', t: 1 }] }).ok, false, 'unknown move');
  assert.equal(parseSubmitRunPayload({ ...payloadFor(base), samples: [{ m: 'jump', t: -1 }] }).ok, false, 'negative time');
  assert.equal(parseSubmitRunPayload({ ...payloadFor(base), moveCount: 2.5 }).ok, false, 'fractional moveCount');
  const legacy = parseSubmitRunPayload({ ...payloadFor(base), moveCount: undefined, samples: undefined, naturalPlaySec: undefined });
  assert.ok(legacy.ok, 'payload without sample fields still parses');
  assert.equal(legacy.payload.moveCount, 0);
  assert.deepEqual(legacy.payload.samples, []);
}

// ---------------------------------------------------------------------------
// Samples ride along with verified runs: consistent → kept, else dropped
// (the verdict itself is unaffected; the Function skips storage).
// ---------------------------------------------------------------------------
{
  const payload = payloadFor(base);
  assert.equal(samplesConsistent(payload), true, 'one sample per judged move');
  assert.equal(validateSubmission(payload, beatmap, hash).ok, true);
  const short = payloadFor(base, { samples: payload.samples.slice(0, payload.samples.length - SAMPLE_COUNT_TOLERANCE) });
  assert.equal(samplesConsistent(short), true, 'inside the count tolerance');
  const shorter = payloadFor(base, { samples: payload.samples.slice(0, payload.samples.length - SAMPLE_COUNT_TOLERANCE - 1) });
  assert.equal(samplesConsistent(shorter), false, 'count drifts from the move tally');
  assert.equal(validateSubmission(shorter, beatmap, hash).ok, true, 'verified verdict does not depend on samples');
  const outside = payloadFor(base, { samples: [...payload.samples, { m: 'jump', t: beatmap.videoDurationSec + 5 }], moveCount: payload.moveCount + 1 });
  assert.equal(samplesConsistent(outside), false, 'sample past the source length');
  const flood = payloadFor(base, { samples: Array.from({ length: MAX_MOVE_SAMPLES + 1 }, () => ({ m: 'jump', t: 1 })), moveCount: MAX_MOVE_SAMPLES + 1 });
  assert.equal(samplesConsistent(flood), false, 'over the per-run cap');
  // Capped runs: the tally may exceed the cap; the sample count matches the cap.
  const capped = payloadFor(base, { samples: Array.from({ length: MAX_MOVE_SAMPLES }, () => ({ m: 'jump', t: 1 })), moveCount: MAX_MOVE_SAMPLES + 50 });
  assert.equal(samplesConsistent(capped), true);
}

// ---------------------------------------------------------------------------
// Provisional path: no chart when the run started → free-move score accepted
// after plausibility checks (session bounds, human move rate, score inside
// the free-scoring band, samples matching the tally). Nothing replays.
// ---------------------------------------------------------------------------
{
  const moves = 120; // 80/min over 90 s — a busy but human run
  const samples: MoveSample[] = Array.from({ length: moves }, (_, i) => ({
    m: (['jump', 'duck', 'left', 'right'] as const)[i % 4],
    t: Math.round(((i * 0.75) % beatmap.videoDurationSec) * 1000) / 1000,
  }));
  const provisional = (overrides: Partial<SubmitRunPayload> = {}): SubmitRunPayload => ({
    ...payloadFor(base),
    beatmapHash: PROVISIONAL_BEATMAP_HASH,
    beatmapVersion: 0,
    cues: [],
    spurious: 0,
    accuracy: 0,
    score: moves * 45,
    maxCombo: 30,
    moveCount: moves,
    samples,
    ...overrides,
  });
  assert.equal(isProvisionalPayload(provisional()), true);
  const wire = parseSubmitRunPayload(JSON.parse(JSON.stringify(provisional())));
  assert.ok(wire.ok, 'provisional wire shape parses');
  const verdict = validateProvisionalSubmission(wire.payload);
  assert.ok(verdict.ok, `provisional run accepted (${!verdict.ok && `${verdict.code} ${verdict.detail ?? ''}`})`);
  assert.equal(verdict.totals.score, moves * 45, 'client score is taken as-is');
  assert.equal(verdict.totals.maxCombo, 30);
  assert.equal(verdict.totals.accuracy, 0);
  assert.equal(verdict.videoEndSec, (TARGET_S + 0.4) * RATE);

  const rejectProvisional = (overrides: Partial<SubmitRunPayload>, code: string, label = code) => {
    const result = validateProvisionalSubmission(provisional(overrides));
    assert.equal(result.ok, false, `${label} must be rejected`);
    assert.equal(result.code, code, `${label}: ${result.ok ? 'ok' : result.detail ?? ''}`);
  };
  // A provisional claim on a charted run is not a way around the replay.
  rejectProvisional({ beatmapHash: hash }, 'bad-version', 'real hash with version 0');
  rejectProvisional({ beatmapVersion: 1 }, 'bad-version', 'none hash with version 1');
  assert.equal(validateSubmission(provisional({ beatmapHash: hash }), beatmap, hash).code, 'bad-version', 'verified path refuses version 0 too');
  // Session bounds are shared with the verified path.
  rejectProvisional({ playbackRate: 1.5 }, 'bad-rate');
  rejectProvisional({ targetSeconds: null }, 'bad-target', 'untimed run');
  rejectProvisional({ elapsedSeconds: TARGET_S + 6 }, 'bad-target', 'past the late tolerance');
  rejectProvisional({ targetSeconds: 45, elapsedSeconds: 45.2 }, 'bad-elapsed', 'under 60 s');
  // No judgements can exist without a chart.
  rejectProvisional({ cues: base.events.slice(0, 1) }, 'bad-event', 'judgement log present');
  rejectProvisional({ spurious: 1 }, 'bad-event');
  rejectProvisional({ accuracy: 0.5 }, 'bad-event');
  rejectProvisional({ videoLengthSec: 0 }, 'bad-video-length');
  // Plausibility.
  const tooMany = Math.floor(PROVISIONAL_MAX_MOVES_PER_MIN * ((TARGET_S + 0.4) / 60)) + 1;
  rejectProvisional({ moveCount: tooMany, score: tooMany * 45, samples: Array.from({ length: Math.min(tooMany, MAX_MOVE_SAMPLES) }, () => ({ m: 'jump', t: 1 })) }, 'bad-moves', 'inhuman move rate');
  rejectProvisional({ maxCombo: moves + 1 }, 'combo-mismatch', 'combo longer than the move tally');
  rejectProvisional({ score: moves * FREE_MOVE_MAX_POINTS + 1 }, 'score-mismatch', 'score above the free-scoring ceiling');
  rejectProvisional({ score: moves * FREE_MOVE_MIN_POINTS - 1 }, 'score-mismatch', 'score below the floor');
  assert.equal(validateProvisionalSubmission(provisional({ score: moves * FREE_MOVE_MAX_POINTS })).ok, true, 'ceiling inclusive');
  assert.equal(validateProvisionalSubmission(provisional({ score: moves * FREE_MOVE_MIN_POINTS })).ok, true, 'floor inclusive');
  // Samples ARE the evidence on this path.
  rejectProvisional({ samples: samples.slice(0, moves - SAMPLE_COUNT_TOLERANCE - 1) }, 'bad-samples', 'sample count off the tally');
  rejectProvisional({ samples: [] }, 'bad-samples', 'no samples for a run with moves');
  rejectProvisional({ samples: samples.map((s, i) => (i === 0 ? { ...s, t: beatmap.videoDurationSec + 9 } : s)) }, 'bad-samples', 'sample outside the video');
  // A run with zero moves is plausible (score 0) and carries no samples.
  assert.equal(validateProvisionalSubmission(provisional({ moveCount: 0, score: 0, maxCombo: 0, samples: [] })).ok, true, 'idle run');
}

// ---------------------------------------------------------------------------
// Sample storage budget: per uid per UTC day, independent of submit budget.
// ---------------------------------------------------------------------------
{
  const day = Date.UTC(2026, 8, 13, 12);
  let state = EMPTY_RATE_LIMIT;
  for (let i = 0; i < SAMPLE_DAILY_LIMIT; i += 1) {
    const step = consumeSampleReport(state, day + i * 1000);
    assert.equal(step.allowed, true, `sample report #${i + 1}`);
    state = step.next;
  }
  assert.equal(consumeSampleReport(state, day + 90_000).allowed, false, 'over the daily sample budget');
  assert.equal(consumeSampleReport(state, day + 24 * 3_600_000).allowed, true, 'fresh day');
  assert.equal(state.submitCount, 0, 'sample budget does not touch the submit budget');
}

// The replay is the single source of truth for totals.
{
  const events: JudgeEvent[] = [
    { i: 0, l: 0, g: 'p', d: 10, t: 2 },
    { i: 1, l: 0, g: 'p', d: 10, t: 5 },
    { i: 2, l: 0, g: 'g', d: 200, t: 8.7 },
    { i: -1, l: -1, g: 'x', d: null, t: 10 },
    { i: 3, l: 0, g: 'p', d: 0, t: 12 },
    { i: 4, l: 0, g: 'm', d: null, t: 16 },
  ];
  const totals = replayJudgements(events);
  // 100×1.00 + 100×1.05 + 50×1.10 → 100 + 105 + 55 = 260, then combo resets, 100.
  assert.equal(totals.score, 360);
  assert.equal(totals.maxCombo, 3);
  assert.equal(totals.perfect, 3);
  assert.equal(totals.good, 1);
  assert.equal(totals.miss, 1);
  assert.equal(totals.spurious, 1);
  assert.equal(totals.accuracy, (3 + 0.5) / 5);
}

// ---------------------------------------------------------------------------
// Nonce timing: serverNow − issuedAt ≥ elapsed − 5 s, and not older than 6 h.
// ---------------------------------------------------------------------------
{
  const issued = 1_000_000_000_000;
  assert.equal(nonceTimingOk({ issuedAtMs: issued, serverNowMs: issued + 61_000, elapsedSeconds: 60 }), true);
  assert.equal(nonceTimingOk({ issuedAtMs: issued, serverNowMs: issued + 55_000, elapsedSeconds: 60 }), true, 'slack');
  assert.equal(nonceTimingOk({ issuedAtMs: issued, serverNowMs: issued + 54_000, elapsedSeconds: 60 }), false, 'too fast');
  assert.equal(
    nonceTimingOk({ issuedAtMs: issued, serverNowMs: issued + (NONCE_MAX_AGE_S + 1) * 1000, elapsedSeconds: 60 }),
    false,
    'expired nonce',
  );
  assert.equal(nonceTimingOk({ issuedAtMs: Number.NaN, serverNowMs: issued, elapsedSeconds: 60 }), false);
}

// ---------------------------------------------------------------------------
// Rate limits as pure state transitions.
// ---------------------------------------------------------------------------
{
  const day = Date.UTC(2026, 8, 13, 12);
  let state = EMPTY_RATE_LIMIT;
  for (let i = 0; i < START_RUN_DAILY_LIMIT; i += 1) {
    const step = consumeStartRun(state, day + i * 1000);
    assert.equal(step.allowed, true, `startRun #${i + 1}`);
    state = step.next;
  }
  assert.equal(consumeStartRun(state, day + 60_000).allowed, false, '31st startRun refused');
  // Counters roll over at UTC midnight.
  assert.equal(consumeStartRun(state, day + 24 * 3_600_000).allowed, true, 'fresh day');

  // Submissions: one accepted per (elapsed − 30 s), ≤ 12/day.
  let s = EMPTY_RATE_LIMIT;
  let now = day;
  const first = consumeSubmitRun(s, now, 300);
  assert.equal(first.allowed, true);
  s = first.next;
  assert.deepEqual(consumeSubmitRun(s, now + 200_000, 300).allowed, false, 'inside cooldown');
  assert.equal(consumeSubmitRun(s, now + 200_000, 300).reason, 'cooldown');
  assert.equal(consumeSubmitRun(s, now + 270_000, 300).allowed, true, 'elapsed − 30 s later');
  // Daily cap.
  s = EMPTY_RATE_LIMIT;
  for (let i = 0; i < SUBMIT_DAILY_LIMIT; i += 1) {
    now += 120_000;
    const step = consumeSubmitRun(s, now, 60);
    assert.equal(step.allowed, true, `submit #${i + 1}`);
    s = step.next;
  }
  const capped = consumeSubmitRun(s, now + 120_000, 60);
  assert.equal(capped.allowed, false);
  assert.equal(capped.reason, 'daily-limit');
  // Rejected submissions do not consume budget: state is only persisted when allowed.
  assert.equal(capped.next.submitCount, SUBMIT_DAILY_LIMIT);
}

console.log('submit-validation replay OK');

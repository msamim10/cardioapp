// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beatmapDurationMismatch,
  cuesForLoopedPlayback,
  parseBeatmap,
  serializeBeatmap,
} from '../src/lib/beatmaps.ts';
import {
  comboBonusFactor,
  CUE_WINDOW_MS,
  cueAccuracy,
  CueJudge,
  DETECTION_LATENCY_COMPENSATION_MS,
  GOOD_MS,
  gradeForDelta,
  PERFECT_MS,
  toBeatmapMove,
} from '../src/lib/cueScoring.ts';

const here = dirname(fileURLToPath(import.meta.url));
const COMP_S = DETECTION_LATENCY_COMPENSATION_MS / 1000;

// --- Beatmap parsing / looping -------------------------------------------

const example = parseBeatmap(
  JSON.parse(readFileSync(join(here, '..', 'src', 'data', 'beatmaps', 'example.dev.json'), 'utf8')),
);
assert.ok(example, 'shipped dev example must validate');
assert.equal(example.levelId, 'example-dev-level');
assert.equal(example.cues.length, 11);

{
  const parsed = parseBeatmap({
    version: 1,
    levelId: 'x',
    videoDurationSec: 10,
    orientation: 'vertical',
    cues: [
      { t: 5, move: 'jump' },
      { t: 2, move: 'duck' },
      { t: 5, move: 'jump' }, // exact duplicate
      { t: 5, move: 'left' }, // same time, different move — kept
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(
    parsed.cues.map((c) => `${c.t}:${c.move}`),
    ['2:duck', '5:jump', '5:left'],
    'cues are sorted by t and exact duplicates dropped',
  );
  assert.equal(parseBeatmap(null), null);
  assert.equal(parseBeatmap({ version: 2, levelId: 'x', videoDurationSec: 10, orientation: 'vertical', cues: [] }), null);
  assert.equal(parseBeatmap({ version: 1, levelId: 'x', videoDurationSec: 10, orientation: 'vertical', cues: [{ t: 11, move: 'jump' }] }), null, 'cue past the duration is rejected');
  assert.equal(parseBeatmap({ version: 1, levelId: 'x', videoDurationSec: 10, orientation: 'vertical', cues: [{ t: 1, move: 'spin' }] }), null);
  assert.equal(parseBeatmap({ version: 1, levelId: '', videoDurationSec: 10, orientation: 'vertical', cues: [] }), null);
  // Round-trips through the export serializer.
  assert.deepEqual(parseBeatmap(JSON.parse(serializeBeatmap(parsed))), parsed);
  assert.equal(beatmapDurationMismatch(parsed, 10.4), false);
  assert.equal(beatmapDurationMismatch(parsed, 10.6), true);
  assert.equal(beatmapDurationMismatch(parsed, 0), false);
}

const loopMap = parseBeatmap({
  version: 1,
  levelId: 'loop',
  videoDurationSec: 10,
  orientation: 'vertical',
  cues: [
    { t: 1, move: 'jump' },
    { t: 4, move: 'duck' },
    { t: 9.5, move: 'left' },
  ],
})!;

{
  // Second pass through a 10 s video: cues appear at t + 10.
  const second = cuesForLoopedPlayback(loopMap, 10, 20);
  assert.deepEqual(second.map((c) => [c.at, c.move, c.loop]), [[11, 'jump', 1], [14, 'duck', 1], [19.5, 'left', 1]]);
  // A range straddling the wrap.
  const straddle = cuesForLoopedPlayback(loopMap, 9, 11.5);
  assert.deepEqual(straddle.map((c) => c.at), [9.5, 11]);
  // Actual source shorter than authored: cues past the real end are unreachable.
  const short = cuesForLoopedPlayback(loopMap, 0, 20, 9);
  assert.deepEqual(short.map((c) => c.at), [1, 4, 10, 13, 19], 'the 9.5 s cue never fires on a 9 s source');
  assert.deepEqual(cuesForLoopedPlayback(loopMap, 5, 5), []);
}

// --- Grading primitives --------------------------------------------------

assert.equal(gradeForDelta(0), 'perfect');
assert.equal(gradeForDelta(PERFECT_MS), 'perfect');
assert.equal(gradeForDelta(-PERFECT_MS), 'perfect');
assert.equal(gradeForDelta(PERFECT_MS + 1), 'good');
assert.equal(gradeForDelta(GOOD_MS), 'good');
assert.equal(gradeForDelta(GOOD_MS + 1), 'miss');
assert.equal(gradeForDelta(CUE_WINDOW_MS), 'miss');
assert.equal(comboBonusFactor(1), 1);
assert.equal(comboBonusFactor(2), 1.05);
assert.equal(comboBonusFactor(15), 1.7);
assert.equal(comboBonusFactor(50), 1.7, 'bonus caps at +70%');
assert.equal(toBeatmapMove('Jump'), 'jump');
assert.equal(toBeatmapMove('Duck'), 'duck');
assert.equal(cueAccuracy({ perfect: 0, good: 0, miss: 0 }), 0);
assert.equal(cueAccuracy({ perfect: 3, good: 2, miss: 5 }), 0.4);

/** A move whose body motion happened at cue time + `offsetMs`, as the pipeline reports it. */
const reported = (cueAt: number, offsetMs: number) => cueAt + offsetMs / 1000 + COMP_S;

// --- Perfect / Good / Miss boundaries + latency compensation ---------------
{
  const judge = new CueJudge(loopMap);
  judge.onTick(0);
  // Exactly on the cue once compensation is removed → Perfect, 100 pts at combo 1.
  let j = judge.onMove('Jump', reported(1, 0));
  assert.equal(j.grade, 'perfect');
  assert.equal(j.deltaMs, 0);
  assert.equal(j.points, 100);
  assert.equal(judge.score.combo, 1);
  // Without compensation the same reported time would read 150 ms late (Good).
  const raw = new CueJudge(loopMap, { latencyCompensationMs: 0 });
  raw.onTick(0);
  assert.equal(raw.onMove('Jump', reported(1, 0)).grade, 'good', 'compensation is what makes an on-time move Perfect');

  // 120 ms late → still Perfect; combo 2 → 100 × 1.05 = 105.
  j = judge.onMove('Duck', reported(4, PERFECT_MS));
  assert.equal(j.grade, 'perfect');
  assert.equal(j.points, 105);
  assert.equal(judge.score.combo, 2);
  // 250 ms early → Good; combo 3 → 50 × 1.10 = 55.
  j = judge.onMove('Left', reported(9.5, -GOOD_MS));
  assert.equal(j.grade, 'good');
  assert.equal(j.deltaMs, -GOOD_MS);
  assert.equal(j.points, 55);
  assert.equal(judge.score.score, 260);
  assert.equal(judge.score.maxCombo, 3);
  assert.equal(judge.score.perfect, 2);
  assert.equal(judge.score.good, 1);
  assert.equal(judge.accuracy, (2 + 0.5) / 3);

  // Loop 2: 251 ms late → Miss (cue consumed, combo breaks).
  judge.onTick(10);
  j = judge.onMove('Jump', reported(11, GOOD_MS + 1));
  assert.equal(j.grade, 'miss');
  assert.equal(j.cue?.at, 11, 'the cue is consumed even on a timing miss');
  assert.equal(judge.score.combo, 0);
  assert.equal(judge.score.miss, 1);
  // The consumed cue cannot be hit again.
  j = judge.onMove('Jump', reported(11, 0));
  assert.equal(j.cue, null, 'consumed cue is gone → spurious');
  assert.equal(judge.score.spurious, 1);
  assert.equal(judge.score.miss, 1, 'spurious moves do not count as cue misses');
}

// --- Wrong move within window consumes the cue as a Miss -------------------
{
  const judge = new CueJudge(loopMap);
  judge.onTick(0);
  judge.onMove('Jump', reported(1, 0));
  assert.equal(judge.score.combo, 1);
  const j = judge.onMove('Left', reported(4, 50));
  assert.equal(j.grade, 'miss');
  assert.equal(j.cue?.move, 'duck');
  assert.equal(judge.score.miss, 1);
  assert.equal(judge.score.combo, 0, 'wrong move breaks the combo');
  // The duck cue is gone; a correct duck now is spurious.
  assert.equal(judge.onMove('Duck', reported(4, 100)).cue, null);
}

// --- Two cues in one window: prefer the matching move -----------------------
{
  const dense = parseBeatmap({
    version: 1,
    levelId: 'dense',
    videoDurationSec: 20,
    orientation: 'vertical',
    cues: [
      { t: 5.0, move: 'jump' },
      { t: 5.3, move: 'left' },
    ],
  })!;
  const judge = new CueJudge(dense);
  judge.onTick(0);
  // Reported at 5.2 (adjusted): nearest is 5.3 left, but the move is a jump → hits 5.0.
  const j = judge.onMove('Jump', reported(5.2, 0));
  assert.equal(j.grade, 'good');
  assert.equal(j.cue?.at, 5);
  assert.equal(judge.upcoming(5.2)[0]?.move, 'left');
}

// --- No cue in window: spurious miss, combo breaks, nothing consumed -------
{
  const judge = new CueJudge(loopMap);
  judge.onTick(0);
  judge.onMove('Jump', reported(1, 0));
  const j = judge.onMove('Jump', reported(2.5, 0));
  assert.equal(j.grade, 'miss');
  assert.equal(j.cue, null);
  assert.equal(judge.score.combo, 0);
  assert.equal(judge.score.spurious, 1);
  assert.equal(judge.score.miss, 0);
  // The 4 s duck is still hittable.
  assert.equal(judge.onMove('Duck', reported(4, 0)).grade, 'perfect');
}

// --- Expiry on tick breaks the combo -----------------------------------------
{
  const judge = new CueJudge(loopMap);
  judge.onTick(0);
  judge.onMove('Jump', reported(1, 0));
  judge.onMove('Duck', reported(4, 0));
  assert.equal(judge.score.combo, 2);
  // Just before the 9.5 cue's window (plus compensation) closes: nothing expires.
  assert.equal(judge.onTick(9.5 + CUE_WINDOW_MS / 1000 + COMP_S - 0.01), 0);
  assert.equal(judge.score.combo, 2);
  // Past it: expired → Miss, combo 0.
  assert.equal(judge.onTick(9.5 + CUE_WINDOW_MS / 1000 + COMP_S + 0.01), 1);
  assert.equal(judge.score.miss, 1);
  assert.equal(judge.score.combo, 0);
  assert.equal(judge.score.lastGrade, 'miss');
  assert.equal(judge.accuracy, 2 / 3);
}

// --- Loop-wrapped cues are hittable on later passes -------------------------
{
  const judge = new CueJudge(loopMap);
  for (let t = 0; t <= 30; t += 0.5) judge.onTick(t);
  // Passes 1–3 expired (the 29.5 s cue's window is still open at t = 30).
  assert.equal(judge.score.miss, 8, 'eight cues expired by t = 30');
  assert.equal(judge.onTick(30.6), 1, 'the 29.5 s cue expires once its window (+ compensation) closes');
  const j = judge.onMove('Jump', reported(31, 0));
  assert.equal(j.grade, 'perfect');
  assert.equal(j.cue?.loop, 3);
  assert.equal(j.cue?.at, 31);
  assert.deepEqual(judge.upcoming(31, 2).map((c) => c.at), [34], 'lookahead is 3 s');
  assert.deepEqual(judge.upcoming(37, 2).map((c) => c.at), [39.5]);
}

// --- Actual source length differs from authored (AirPlay cut) ---------------
{
  const judge = new CueJudge(loopMap, { videoLengthSec: 12, lookaheadSec: 12 });
  judge.onTick(0);
  judge.onTick(12);
  const second = judge.upcoming(12, 3);
  assert.deepEqual(second.map((c) => c.at), [13, 16, 21.5], 'loop wraps at the real length, cue offsets from the vertical map');
}

// --- Combo scaling shape over a long streak ---------------------------------
{
  const many = parseBeatmap({
    version: 1,
    levelId: 'many',
    videoDurationSec: 100,
    orientation: 'vertical',
    cues: Array.from({ length: 20 }, (_, i) => ({ t: 2 + i * 2, move: 'jump' })),
  })!;
  const judge = new CueJudge(many);
  let total = 0;
  for (let i = 0; i < 20; i++) {
    judge.onTick(2 + i * 2);
    const j = judge.onMove('Jump', reported(2 + i * 2, 0));
    assert.equal(j.grade, 'perfect');
    total += Math.round(100 * comboBonusFactor(i + 1));
  }
  assert.equal(judge.score.score, total);
  assert.equal(judge.score.maxCombo, 20);
  assert.equal(judge.accuracy, 1);
  // Last hits are at the +70% cap: 170 each.
  assert.equal(Math.round(100 * comboBonusFactor(20)), 170);
}

console.log(
  'Cue scoring replay passed: beatmap parse/sort/dedupe/round-trip, loop-wrapped cue scheduling, perfect/good/miss boundaries, latency compensation, wrong move consumes cue, matching-move preference, spurious miss, expiry breaks combo, wrapped hits, length mismatch, combo scaling',
);

// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
/**
 * Replay for consensus beatmaps (`shared/scoring/consensus.ts`): the pure
 * function that turns real players' move samples into a level's chart.
 *
 * Synthetic runs perform a hidden "true" chart with human jitter and the
 * consensus must recover it; then the guarantees that matter for a public
 * board are checked one by one — spammers cannot outvote honest runs,
 * conflicting moves at the same moment resolve to the stronger one, cues
 * respect the judging window spacing, the support threshold scales with the
 * pool, the output is deterministic and hashes like any other beatmap, and
 * the version-change threshold ignores sub-150 ms drift. No Firebase involved.
 */
import assert from 'node:assert/strict';
import {
  beatmapHash,
  buildConsensusBeatmap,
  CONSENSUS_DEFAULTS,
  CUE_WINDOW_MS,
  MAX_MOVE_SAMPLES,
  materiallyDifferent,
  parseBeatmap,
  parseMoveSamples,
  requiredSupport,
  type BeatmapCue,
  type ConsensusRun,
  type MoveSample,
} from '../shared/scoring/index.ts';

// Deterministic PRNG (mulberry32) so the "random" jitter replays identically.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VIDEO_S = 40;
const TRUTH: BeatmapCue[] = [
  { t: 3, move: 'jump' },
  { t: 6.4, move: 'duck' },
  { t: 10, move: 'left' },
  { t: 13.2, move: 'right' },
  { t: 17, move: 'jump' },
  { t: 21.5, move: 'jump' },
  { t: 25, move: 'duck' },
  { t: 29.1, move: 'left' },
  { t: 33, move: 'right' },
  { t: 37.4, move: 'jump' },
];

/**
 * One player's run: performs each true cue with Gaussian-ish jitter (sum of
 * uniforms, σ ≈ `jitterS`), skips a cue with probability `missRate`, and adds
 * `strayMoves` random moves at random times (reaction to nothing).
 */
function performRun(
  random: () => number,
  options: { jitterS?: number; missRate?: number; strayMoves?: number; truth?: BeatmapCue[] } = {},
): ConsensusRun {
  const { jitterS = 0.12, missRate = 0.1, strayMoves = 2, truth = TRUTH } = options;
  const samples: MoveSample[] = [];
  for (const cue of truth) {
    if (random() < missRate) continue;
    const noise = (random() + random() + random() - 1.5) * 2 * jitterS;
    const t = Math.min(VIDEO_S, Math.max(0, cue.t + noise));
    samples.push({ m: cue.move, t: Math.round(t * 1000) / 1000 });
  }
  const moves = ['jump', 'duck', 'left', 'right'] as const;
  for (let i = 0; i < strayMoves; i += 1) {
    samples.push({ m: moves[Math.floor(random() * 4)], t: Math.round(random() * VIDEO_S * 1000) / 1000 });
  }
  return { samples: samples.sort((a, b) => a.t - b.t) };
}

const build = (runs: ConsensusRun[], options = CONSENSUS_DEFAULTS) =>
  buildConsensusBeatmap({ levelId: 'neon-rails', videoDurationSec: VIDEO_S, runs }, options);

/** Match every true cue to a produced cue of the same move within `toleranceS`. */
function recovered(cues: readonly BeatmapCue[], truth: readonly BeatmapCue[], toleranceS: number) {
  const hits = truth.filter((cue) => cues.some((c) => c.move === cue.move && Math.abs(c.t - cue.t) <= toleranceS));
  return { hits: hits.length, extras: cues.length - hits.length };
}

// ---------------------------------------------------------------------------
// 1. Recovery: 12 honest runs with jitter → the true chart, within 150 ms.
// ---------------------------------------------------------------------------
{
  const random = rng(7);
  const runs = Array.from({ length: 12 }, () => performRun(random));
  const result = build(runs);
  assert.ok(result, 'twelve runs produce a chart');
  assert.equal(result.runCount, 12);
  assert.equal(result.requiredSupport, requiredSupport(12), 'threshold = max(3, ceil(0.35 × 12)) = 5');
  assert.equal(result.requiredSupport, 5);
  const { hits, extras } = recovered(result.beatmap.cues, TRUTH, 0.15);
  assert.equal(hits, TRUTH.length, `every true cue recovered (${hits}/${TRUTH.length})`);
  assert.equal(extras, 0, 'stray moves never reach the support threshold');
  for (const cue of result.cues) {
    assert.ok(cue.support >= 5 && cue.support <= 12, 'support is a run count');
    assert.ok(Math.abs(cue.confidence - cue.support / 12) < 1e-3, 'confidence = support / runs');
    assert.ok(cue.confidence >= 0.35, 'published cues clear the relative threshold');
  }
  // Cue times are rounded to ms and sorted, so the chart parses and hashes
  // exactly like an authored one.
  const parsed = parseBeatmap(JSON.parse(JSON.stringify(result.beatmap)));
  assert.ok(parsed, 'consensus chart round-trips through the beatmap parser');
  assert.equal(beatmapHash(parsed), result.hash, 'hash matches the shared beatmap hash');
  for (let i = 1; i < result.beatmap.cues.length; i += 1) {
    assert.ok(result.beatmap.cues[i].t - result.beatmap.cues[i - 1].t >= CONSENSUS_DEFAULTS.minGapS - 1e-9, 'min gap respected');
  }
  assert.equal(CONSENSUS_DEFAULTS.minGapS, (2 * CUE_WINDOW_MS) / 1000, 'gap = two judging windows');
}

// ---------------------------------------------------------------------------
// 2. Determinism: same runs in any order → identical chart and hash.
// ---------------------------------------------------------------------------
{
  const random = rng(11);
  const runs = Array.from({ length: 8 }, () => performRun(random));
  const a = build(runs);
  const b = build(runs.slice().reverse());
  const c = build(runs.map((run) => ({ samples: run.samples.slice().reverse() })));
  assert.ok(a && b && c);
  assert.deepEqual(a.beatmap, b.beatmap, 'run order does not matter');
  assert.deepEqual(a.beatmap, c.beatmap, 'sample order does not matter');
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash, c.hash);
}

// ---------------------------------------------------------------------------
// 3. Cold start: fewer than MIN_RUNS → nothing; exactly MIN_RUNS → a chart
//    that needs all three to agree.
// ---------------------------------------------------------------------------
{
  const random = rng(3);
  const two = Array.from({ length: 2 }, () => performRun(random, { missRate: 0 }));
  assert.equal(build(two), null, 'two runs are not a consensus');
  const three = Array.from({ length: 3 }, () => performRun(random, { missRate: 0, strayMoves: 0 }));
  const result = build(three);
  assert.ok(result, 'three agreeing runs publish');
  assert.equal(result.requiredSupport, 3);
  assert.equal(recovered(result.beatmap.cues, TRUTH, 0.2).hits, TRUTH.length);
  // Runs that contributed no samples do not count towards the pool.
  assert.equal(build([...two, { samples: [] }]), null, 'empty run does not make a third');
  // A chart with too few agreed cues is not worth publishing.
  const sparse = Array.from({ length: 3 }, () => ({ samples: [{ m: 'jump', t: 5 }, { m: 'duck', t: 9 }] as MoveSample[] }));
  assert.equal(build(sparse), null, `fewer than ${CONSENSUS_DEFAULTS.minCues} cues stays provisional`);
}

// ---------------------------------------------------------------------------
// 4. Spammer normalisation: one run that jumps every 200 ms cannot create
//    cues; honest runs still recover the chart. Support counts runs.
// ---------------------------------------------------------------------------
{
  const random = rng(5);
  const honest = Array.from({ length: 6 }, () => performRun(random, { strayMoves: 0 }));
  const spam: MoveSample[] = [];
  for (let t = 0.1; t < VIDEO_S && spam.length < MAX_MOVE_SAMPLES; t += 0.2) spam.push({ m: 'jump', t: Math.round(t * 1000) / 1000 });
  const spammer: ConsensusRun = { samples: spam };
  const result = build([...honest, spammer]);
  assert.ok(result);
  assert.equal(result.runCount, 7);
  const { hits } = recovered(result.beatmap.cues, TRUTH, 0.15);
  assert.equal(hits, TRUTH.length, 'honest chart survives a spammer');
  // Nowhere should a jump cue exist that only the spammer performed: every
  // jump cue must sit on a true jump.
  for (const cue of result.beatmap.cues.filter((c) => c.move === 'jump')) {
    assert.ok(TRUTH.some((t) => t.move === 'jump' && Math.abs(t.t - cue.t) <= 0.15), `jump at ${cue.t} is a real beat`);
  }
  // The spammer's single vote per window shows up as at most +1 support.
  const clean = build(honest);
  assert.ok(clean);
  for (const cue of result.cues) {
    const before = clean.cues.find((c) => c.move === cue.move && Math.abs(c.t - cue.t) <= 0.15);
    if (before) assert.ok(cue.support <= before.support + 1, 'a run counts once per cue');
  }
  // Three spammers alone (each with 200 samples) never reach a chart of true cues:
  // they produce a wall of jump peaks — but every one has support 3 = "all runs", so
  // the algorithm can only publish what everyone did. That is by design; the
  // fraud vector is covered by the server (one run per uid per cooldown).
  const wall = build([spammer, spammer, spammer]);
  assert.ok(wall === null || wall.beatmap.cues.every((c) => c.move === 'jump'), 'unanimous spam is at least self-consistent');
}

// ---------------------------------------------------------------------------
// 5. Conflict resolution: two moves at the same moment → the one more runs
//    performed wins; nothing else survives inside the min gap.
// ---------------------------------------------------------------------------
{
  const base: MoveSample[] = [
    { m: 'jump', t: 4 },
    { m: 'duck', t: 12 },
    { m: 'left', t: 20 },
    { m: 'right', t: 28 },
  ];
  const runs: ConsensusRun[] = [];
  // 7 runs duck at 8.0; 4 of them ALSO jump at 8.1 (ambiguous beat).
  for (let i = 0; i < 7; i += 1) {
    const samples = [...base, { m: 'duck', t: 8 + (i % 3) * 0.02 }];
    if (i < 4) samples.push({ m: 'jump', t: 8.1 });
    runs.push({ samples: samples.sort((a, b) => a.t - b.t) });
  }
  const result = build(runs);
  assert.ok(result);
  const near8 = result.cues.filter((c) => Math.abs(c.t - 8) < 0.5);
  assert.equal(near8.length, 1, 'one cue survives at the contested moment');
  assert.equal(near8[0].move, 'duck', 'the move more runs performed wins');
  assert.equal(near8[0].support, 7);
  // Equal support → the earlier candidate wins (deterministic tie-break).
  const tie: ConsensusRun[] = Array.from({ length: 5 }, () => ({
    samples: [...base, { m: 'left', t: 15.9 }, { m: 'right', t: 16.2 }].sort((a, b) => a.t - b.t),
  }));
  const tied = build(tie);
  assert.ok(tied);
  const near16 = tied.cues.filter((c) => Math.abs(c.t - 16) < 0.6);
  assert.equal(near16.length, 1);
  assert.equal(near16[0].move, 'left', 'tie goes to the earlier cue');
}

// ---------------------------------------------------------------------------
// 6. Support threshold scales: a cue 30 % of players perform is dropped
//    from a large pool, and a cue every third player performs stays in a
//    small one (absolute floor of 3).
// ---------------------------------------------------------------------------
{
  const random = rng(21);
  const minority: BeatmapCue = { t: 35, move: 'duck' };
  const runs = Array.from({ length: 20 }, (_, i) =>
    performRun(random, { strayMoves: 0, missRate: 0, truth: i < 6 ? [...TRUTH, minority] : TRUTH }),
  );
  const result = build(runs);
  assert.ok(result);
  assert.equal(result.requiredSupport, 7, 'ceil(0.35 × 20)');
  assert.equal(recovered(result.beatmap.cues, [minority], 0.2).hits, 0, '6/20 (30 %) is below the 35 % bar');
  const relaxed = build(runs, { ...CONSENSUS_DEFAULTS, supportFraction: 0.25 });
  assert.ok(relaxed);
  assert.equal(recovered(relaxed.beatmap.cues, [minority], 0.2).hits, 1, 'tuning supportFraction admits it');
  assert.equal(requiredSupport(3), 3);
  assert.equal(requiredSupport(8), 3, 'ceil(0.35 × 8) = 3');
  assert.equal(requiredSupport(9), 4);
  assert.equal(requiredSupport(5, { ...CONSENSUS_DEFAULTS, minRuns: 5 }), 5, 'MIN_RUNS raises the floor');
}

// ---------------------------------------------------------------------------
// 7. Weighted median: the cue lands where the middle player reacted, so one
//    early bird does not drag it; per-run weighting caps a double-tapper.
// ---------------------------------------------------------------------------
{
  const late = [4.97, 5.0, 5.02, 5.05, 5.4]; // one straggler, still inside the ±450 ms window
  const runs: ConsensusRun[] = late.map((t) => ({
    samples: [{ m: 'jump', t }, { m: 'duck', t: 12 }, { m: 'left', t: 20 }, { m: 'right', t: 28 }],
  }));
  const result = build(runs);
  assert.ok(result);
  const jump = result.cues.find((c) => c.move === 'jump');
  assert.ok(jump);
  assert.equal(jump.t, 5.02, 'median of five reactions');
  // A run that tapped twice in the window carries the same weight as one tap.
  runs[4] = { samples: [{ m: 'jump', t: 5.4 }, { m: 'jump', t: 5.42 }, { m: 'duck', t: 12 }, { m: 'left', t: 20 }, { m: 'right', t: 28 }] };
  const doubled = build(runs);
  assert.ok(doubled);
  assert.equal(doubled.cues.find((c) => c.move === 'jump')?.t, 5.02, 'double tap does not shift the median');
}

// ---------------------------------------------------------------------------
// 8. Version-change threshold: drift ≤ 150 ms is not a new chart; a cue
//    added, removed, moved further, or changed move is.
// ---------------------------------------------------------------------------
{
  const previous: BeatmapCue[] = [
    { t: 3, move: 'jump' },
    { t: 6.4, move: 'duck' },
    { t: 10, move: 'left' },
    { t: 13.2, move: 'right' },
  ];
  const drift = previous.map((c, i) => ({ ...c, t: c.t + (i % 2 ? 0.14 : -0.1) }));
  assert.equal(materiallyDifferent(previous, drift), false, 'sub-tolerance drift keeps the version');
  assert.equal(materiallyDifferent(previous, previous.map((c, i) => (i === 2 ? { ...c, t: c.t + 0.16 } : c))), true, 'one cue moved > 150 ms');
  assert.equal(materiallyDifferent(previous, previous.slice(0, 3)), true, 'cue removed');
  assert.equal(materiallyDifferent(previous, [...previous, { t: 17, move: 'jump' }]), true, 'cue added');
  assert.equal(materiallyDifferent(previous, previous.map((c, i) => (i === 0 ? { ...c, move: 'duck' } : c))), true, 'move changed');
  assert.equal(materiallyDifferent(previous, previous.map((c) => ({ ...c }))), false, 'identical');
  assert.equal(materiallyDifferent(previous, drift, { ...CONSENSUS_DEFAULTS, moveToleranceS: 0.05 }), true, 'tolerance is tunable');
}

// ---------------------------------------------------------------------------
// 9. Wire parser for samples: shape, move set, bounds, cap.
// ---------------------------------------------------------------------------
{
  assert.deepEqual(parseMoveSamples([{ m: 'jump', t: 1.5 }, { m: 'duck', t: 0 }], 40), [{ m: 'jump', t: 1.5 }, { m: 'duck', t: 0 }]);
  assert.equal(parseMoveSamples([{ m: 'spin', t: 1 }], 40), null, 'unknown move');
  assert.equal(parseMoveSamples([{ m: 'jump', t: 41 }], 40), null, 'past the bound');
  assert.equal(parseMoveSamples([{ m: 'jump', t: -0.1 }], 40), null, 'negative time');
  assert.equal(parseMoveSamples([{ m: 'jump', t: 'now' }], 40), null, 'non-numeric time');
  assert.equal(parseMoveSamples('nope', 40), null, 'not an array');
  assert.equal(parseMoveSamples(Array.from({ length: MAX_MOVE_SAMPLES + 1 }, () => ({ m: 'jump', t: 1 })), 40), null, 'over the cap');
  assert.equal(parseMoveSamples([], 40)?.length, 0);
}

console.log('consensus replay OK');

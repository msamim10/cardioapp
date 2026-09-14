/**
 * Consensus beatmaps: derive a level's cue chart from how real players move.
 *
 * Every submitted run reports the moves it detected as `{m, t}` samples on
 * the VIDEO timeline (`t` = seconds into the vertical cut, already shifted
 * back by DETECTION_LATENCY_COMPENSATION_MS so it marks when the player
 * reacted, not when the pipeline noticed). This module turns a pile of such
 * runs into a `Beatmap` in the existing format — "the average of how every
 * user performs the exercise at that time".
 *
 * Algorithm (all constants in `CONSENSUS_DEFAULTS`, tune there):
 *
 *   1. Per move type, bucket sample times into `binMs` (200 ms) bins over
 *      [0, videoDurationSec]. A run counts AT MOST ONCE per bin, so the
 *      histogram is "how many runs did this move here", not "how many
 *      samples" — a player who jumps non-stop cannot outvote three players
 *      who jumped once.
 *   2. Smooth with a small symmetric kernel (1 2 3 2 1) so a beat that lands
 *      on a bin edge still produces a single peak.
 *   3. Peaks = local maxima of the smoothed histogram. For each peak, the
 *      support is the number of DISTINCT runs with a sample of that move
 *      within ±`windowMs` (450 ms) of the peak bin centre. Keep peaks with
 *      support ≥ max(`minRuns`, ceil(`supportFraction` × runs)).
 *   4. The cue time is the weighted median of the samples inside the window,
 *      each run's samples sharing a total weight of 1.
 *   5. Candidates closer than `minGapS` (2 × CUE_WINDOW = 0.8 s, so two
 *      cues' ±400 ms judging windows never overlap) are merged: the higher
 *      support wins, ties go to the earlier cue. This also resolves
 *      different move types claiming the same moment.
 *   6. Output is sorted by time (then move) and rounded to milliseconds so
 *      the chart is deterministic and `beatmapHash` is stable.
 *
 * `confidence` per cue is support / runCount. `materiallyDifferent` decides
 * whether a rebuild is worth a new chart version (≥1 cue added/removed or any
 * cue moved by more than `moveToleranceS`).
 *
 * SHARED between the Cloud Functions (`rebuildConsensusBeatmaps`) and the
 * replay test (`npm run test:consensus`); keep it dependency-free.
 */

import {
  BEATMAP_MOVES,
  beatmapHash,
  isBeatmapMove,
  type Beatmap,
  type BeatmapCue,
  type BeatmapMove,
} from './beatmap';
import { CUE_WINDOW_MS } from './grading';

/** One detected move on the video timeline (compact wire/storage shape). */
export type MoveSample = {
  /** Move performed. */
  m: BeatmapMove;
  /** Seconds into the vertical video when the player reacted. */
  t: number;
};

/** A run's worth of samples (one document under `moveSamples/{levelId}/runs`). */
export type ConsensusRun = {
  samples: readonly MoveSample[];
};

export type ConsensusOptions = {
  /** Histogram bin width. */
  binMs: number;
  /** Half-width around a peak within which a run's sample supports it. */
  windowMs: number;
  /** Absolute minimum number of supporting runs for a cue. */
  minRuns: number;
  /** Relative minimum: fraction of all runs that must support a cue. */
  supportFraction: number;
  /** Minimum spacing between any two cues (any move). */
  minGapS: number;
  /** A cue that moved by more than this counts as a material change. */
  moveToleranceS: number;
  /** Below this many cues a chart is not worth publishing. */
  minCues: number;
};

export const CONSENSUS_DEFAULTS: ConsensusOptions = {
  binMs: 200,
  windowMs: 450,
  minRuns: 3,
  supportFraction: 0.35,
  minGapS: (2 * CUE_WINDOW_MS) / 1000,
  moveToleranceS: 0.15,
  minCues: 4,
};

/** Smoothing kernel applied to the per-run histogram (symmetric, sums to 9). */
const KERNEL = [1, 2, 3, 2, 1];

/** Hard cap on samples per run, enforced by the client and the server parser. */
export const MAX_MOVE_SAMPLES = 600;
/** Runs with less natural playback than this contribute no samples. */
export const MIN_SAMPLE_RUN_PLAY_S = 30;

export type ConsensusCue = BeatmapCue & {
  /** Supporting runs / total runs, 0–1. */
  confidence: number;
  /** Number of distinct runs that performed this move in the window. */
  support: number;
};

export type ConsensusResult = {
  beatmap: Beatmap;
  hash: string;
  cues: ConsensusCue[];
  runCount: number;
  /** The support threshold that was applied (runs). */
  requiredSupport: number;
};

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Shape-check one untrusted sample. */
export function parseMoveSample(raw: unknown): MoveSample | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!isBeatmapMove(s.m)) return null;
  if (!finite(s.t) || s.t < 0) return null;
  return { m: s.m, t: s.t };
}

/**
 * Shape-check an untrusted sample list: ≤ MAX_MOVE_SAMPLES, every entry valid,
 * every time inside [0, maxT]. Returns null when anything is off.
 */
export function parseMoveSamples(raw: unknown, maxT: number): MoveSample[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_MOVE_SAMPLES) return null;
  const out: MoveSample[] = [];
  for (const entry of raw) {
    const sample = parseMoveSample(entry);
    if (!sample || sample.t > maxT) return null;
    out.push(sample);
  }
  return out;
}

/** Support required for a cue given how many runs were pooled. */
export function requiredSupport(runCount: number, options: ConsensusOptions = CONSENSUS_DEFAULTS): number {
  return Math.max(options.minRuns, Math.ceil(options.supportFraction * runCount));
}

type Candidate = { move: BeatmapMove; t: number; support: number };

/**
 * Weighted median of `times`, where every run's samples share a weight of 1.
 * `owners[i]` is the run index of `times[i]`.
 */
function weightedMedian(times: number[], owners: number[]): number {
  const perRun = new Map<number, number>();
  owners.forEach((run) => perRun.set(run, (perRun.get(run) ?? 0) + 1));
  const order = times.map((_, index) => index).sort((a, b) => times[a] - times[b] || owners[a] - owners[b]);
  const total = perRun.size;
  let acc = 0;
  for (const index of order) {
    acc += 1 / (perRun.get(owners[index]) ?? 1);
    if (acc >= total / 2 - 1e-9) return times[index];
  }
  return times[order[order.length - 1]];
}

function candidatesForMove(
  move: BeatmapMove,
  runs: readonly ConsensusRun[],
  videoDurationSec: number,
  options: ConsensusOptions,
  threshold: number,
): Candidate[] {
  const binS = options.binMs / 1000;
  const windowS = options.windowMs / 1000;
  const binCount = Math.max(1, Math.ceil(videoDurationSec / binS));

  // Per-run de-duplicated histogram plus a flat list of (time, run) pairs.
  const histogram = new Array<number>(binCount).fill(0);
  const times: number[] = [];
  const owners: number[] = [];
  runs.forEach((run, runIndex) => {
    const seenBins = new Set<number>();
    for (const sample of run.samples) {
      if (sample.m !== move) continue;
      if (!(sample.t >= 0) || sample.t > videoDurationSec) continue;
      times.push(sample.t);
      owners.push(runIndex);
      const bin = Math.min(binCount - 1, Math.floor(sample.t / binS));
      if (!seenBins.has(bin)) {
        seenBins.add(bin);
        histogram[bin] += 1;
      }
    }
  });
  if (times.length === 0) return [];

  const half = (KERNEL.length - 1) / 2;
  const smooth = histogram.map((_, index) => {
    let sum = 0;
    for (let k = 0; k < KERNEL.length; k += 1) {
      const j = index + k - half;
      if (j >= 0 && j < binCount) sum += histogram[j] * KERNEL[k];
    }
    return sum;
  });

  const candidates: Candidate[] = [];
  for (let bin = 0; bin < binCount; bin += 1) {
    const value = smooth[bin];
    if (value <= 0) continue;
    const prev = bin > 0 ? smooth[bin - 1] : -1;
    const next = bin + 1 < binCount ? smooth[bin + 1] : -1;
    // First bin of a plateau counts as the peak; the merge step handles the rest.
    if (!(value >= prev && value > next)) continue;
    const centre = (bin + 0.5) * binS;
    const inWindowTimes: number[] = [];
    const inWindowOwners: number[] = [];
    const supporters = new Set<number>();
    for (let index = 0; index < times.length; index += 1) {
      if (Math.abs(times[index] - centre) <= windowS + 1e-9) {
        inWindowTimes.push(times[index]);
        inWindowOwners.push(owners[index]);
        supporters.add(owners[index]);
      }
    }
    if (supporters.size < threshold) continue;
    candidates.push({
      move,
      t: weightedMedian(inWindowTimes, inWindowOwners),
      support: supporters.size,
    });
  }
  return candidates;
}

/**
 * Drop candidates that sit closer than `minGapS` to a stronger one. Higher
 * support wins; ties go to the earlier time, then to BEATMAP_MOVES order.
 */
function mergeCandidates(candidates: Candidate[], options: ConsensusOptions): Candidate[] {
  const ranked = candidates
    .slice()
    .sort(
      (a, b) =>
        b.support - a.support ||
        a.t - b.t ||
        BEATMAP_MOVES.indexOf(a.move) - BEATMAP_MOVES.indexOf(b.move),
    );
  const kept: Candidate[] = [];
  for (const candidate of ranked) {
    if (kept.some((other) => Math.abs(other.t - candidate.t) < options.minGapS - 1e-9)) continue;
    kept.push(candidate);
  }
  return kept.sort((a, b) => a.t - b.t || BEATMAP_MOVES.indexOf(a.move) - BEATMAP_MOVES.indexOf(b.move));
}

function roundMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * Build the consensus chart for a level. Returns null when fewer than
 * `minRuns` runs were pooled or fewer than `minCues` cues reached the support
 * threshold (nothing worth publishing yet — the level stays provisional).
 */
export function buildConsensusBeatmap(
  input: { levelId: string; videoDurationSec: number; runs: readonly ConsensusRun[] },
  options: ConsensusOptions = CONSENSUS_DEFAULTS,
): ConsensusResult | null {
  const { levelId, videoDurationSec } = input;
  if (!finite(videoDurationSec) || videoDurationSec <= 0) return null;
  const runs = input.runs.filter((run) => run.samples.length > 0);
  const runCount = runs.length;
  if (runCount < options.minRuns) return null;
  const threshold = requiredSupport(runCount, options);

  const candidates: Candidate[] = [];
  for (const move of BEATMAP_MOVES) {
    candidates.push(...candidatesForMove(move, runs, videoDurationSec, options, threshold));
  }
  const merged = mergeCandidates(candidates, options);
  if (merged.length < options.minCues) return null;

  const cues: ConsensusCue[] = merged.map((candidate) => ({
    t: Math.min(roundMs(candidate.t), roundMs(videoDurationSec)),
    move: candidate.move,
    support: candidate.support,
    confidence: Math.round((candidate.support / runCount) * 1000) / 1000,
  }));
  const beatmap: Beatmap = {
    version: 1,
    levelId,
    videoDurationSec: roundMs(videoDurationSec),
    orientation: 'vertical',
    cues: cues.map((cue) => ({ t: cue.t, move: cue.move })),
  };
  return { beatmap, hash: beatmapHash(beatmap), cues, runCount, requiredSupport: threshold };
}

/**
 * Whether replacing `previous` with `next` is worth a new chart version: a
 * cue was added or removed, a move changed, or any cue moved by more than
 * `moveToleranceS`. Both lists are expected sorted by time (as the parser
 * and the builder emit them).
 */
export function materiallyDifferent(
  previous: readonly BeatmapCue[],
  next: readonly BeatmapCue[],
  options: ConsensusOptions = CONSENSUS_DEFAULTS,
): boolean {
  if (previous.length !== next.length) return true;
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index].move !== next[index].move) return true;
    if (Math.abs(previous[index].t - next[index].t) > options.moveToleranceS + 1e-9) return true;
  }
  return false;
}

/**
 * Timing-window grading constants + the pure combo/score replay.
 *
 * SHARED between the app's `CueJudge` (`src/lib/cueScoring.ts`) and the
 * server-side `submitRun` verifier, so both grade a run identically. Keep it
 * dependency-free.
 *
 * Points: pts = base × comboBonusFactor(combo), where combo is the value
 * AFTER this hit incremented it and
 *   comboBonusFactor(c) = 1 + min(70, (c − 1) × 5) / 100
 * (×1.00 at combo 1 … ×1.70 from combo 15 on). Misses — bad timing, wrong
 * move, expired cue, or a spurious move with no cue in the window — reset the
 * combo to 0. Accuracy = (perfect + 0.5 × good) / (perfect + good + miss),
 * 0 with no cues; spurious moves are tallied separately.
 */

/**
 * Subtracted from a move's video time before matching. Default chosen from the
 * audit's derived floor; TUNE FROM `pose_latency` p50 (total) once measured on
 * a device build — the right value is roughly that p50 plus the analyzer's
 * two-frame evidence delay for ducks.
 */
export const DETECTION_LATENCY_COMPENSATION_MS = 150;
/** A cue can be hit within ±this of its time. */
export const CUE_WINDOW_MS = 400;
export const PERFECT_MS = 120;
export const GOOD_MS = 250;
export const PERFECT_POINTS = 100;
export const GOOD_POINTS = 50;
/** Cues are scheduled this far ahead of the clock (also feeds the HUD). */
export const CUE_LOOKAHEAD_S = 3;

export type CueGrade = 'perfect' | 'good' | 'miss';

export function comboBonusFactor(combo: number): number {
  return 1 + Math.min(70, Math.max(0, combo - 1) * 5) / 100;
}

export function gradeForDelta(deltaMs: number): CueGrade {
  const abs = Math.abs(deltaMs);
  if (abs <= PERFECT_MS) return 'perfect';
  if (abs <= GOOD_MS) return 'good';
  return 'miss';
}

export function cueAccuracy(score: { perfect: number; good: number; miss: number }): number {
  const total = score.perfect + score.good + score.miss;
  if (total <= 0) return 0;
  return (score.perfect + 0.5 * score.good) / total;
}

export function pointsForHit(grade: 'perfect' | 'good', comboAfterHit: number): number {
  const base = grade === 'perfect' ? PERFECT_POINTS : GOOD_POINTS;
  return Math.round(base * comboBonusFactor(comboAfterHit));
}

/** Compact grade codes used on the wire (`JudgeEvent.g`). */
export type JudgeEventGrade = 'p' | 'g' | 'm' | 'x';

/**
 * One judgement the `CueJudge` made, in the order it made them. This is what
 * the client submits and what the server replays.
 *
 *   i  cue index within the beatmap (−1 for a spurious move)
 *   l  loop (pass through the video) the cue was scheduled on (−1 spurious)
 *   g  'p' perfect · 'g' good · 'm' miss (bad timing / wrong move / expired)
 *      · 'x' spurious move (no cue in the window; breaks the combo)
 *   d  signed ms early/late for a move that consumed a cue; null when the
 *      cue expired on a clock tick or the move was spurious
 *   t  accumulated video seconds at which the judgement happened
 */
export type JudgeEvent = {
  i: number;
  l: number;
  g: JudgeEventGrade;
  d: number | null;
  t: number;
};

export type ReplayTotals = {
  score: number;
  maxCombo: number;
  perfect: number;
  good: number;
  miss: number;
  spurious: number;
  accuracy: number;
};

export function gradeToCode(grade: CueGrade, spurious: boolean): JudgeEventGrade {
  if (spurious) return 'x';
  return grade === 'perfect' ? 'p' : grade === 'good' ? 'g' : 'm';
}

/**
 * Replay a judgement sequence with the same combo rules the `CueJudge` uses,
 * so a submitted score can be re-derived from its events alone.
 */
export function replayJudgements(events: readonly JudgeEvent[]): ReplayTotals {
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let perfect = 0;
  let good = 0;
  let miss = 0;
  let spurious = 0;
  for (const event of events) {
    if (event.g === 'p' || event.g === 'g') {
      combo += 1;
      maxCombo = Math.max(maxCombo, combo);
      score += pointsForHit(event.g === 'p' ? 'perfect' : 'good', combo);
      if (event.g === 'p') perfect += 1;
      else good += 1;
      continue;
    }
    combo = 0;
    if (event.g === 'm') miss += 1;
    else spurious += 1;
  }
  return {
    score,
    maxCombo,
    perfect,
    good,
    miss,
    spurious,
    accuracy: cueAccuracy({ perfect, good, miss }),
  };
}

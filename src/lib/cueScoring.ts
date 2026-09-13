/**
 * Timing-window scoring against a beatmap.
 *
 * `CueJudge` is a pure state machine fed with (a) classified moves stamped
 * with the scoring clock (accumulated VIDEO seconds, see runClock.ts) and
 * (b) clock ticks. It never touches the analyzer: debounce, cooldown and
 * rearm stay in PoseAnalyzer.
 *
 * Grading a move at video time `v`:
 *   1. adjusted = v − DETECTION_LATENCY_COMPENSATION_MS / 1000
 *      (the pose pipeline reports a move later than the body did it)
 *   2. candidates = unconsumed scheduled cues with |cue.at − adjusted| ≤ CUE_WINDOW_MS
 *   3. prefer the nearest candidate whose move matches; else the nearest
 *      candidate (wrong move) → Miss, cue consumed; no candidate → Miss,
 *      combo breaks, nothing consumed (a "spurious" move)
 *   4. |Δ| ≤ PERFECT_MS → Perfect (100), ≤ GOOD_MS → Good (50), else Miss (0);
 *      the cue is consumed in every case
 *
 * On a clock tick, any unconsumed cue with `at + CUE_WINDOW_MS` in the past
 * expires → Miss, combo breaks.
 *
 * Points: pts = base × comboBonusFactor(combo), where combo is the value
 * AFTER this hit incremented it and
 *   comboBonusFactor(c) = 1 + min(70, (c − 1) × 5) / 100
 * — the same 30 + min(70, (combo−1)×5) shape the free-scoring path uses,
 * expressed as a multiplier (×1.00 at combo 1 … ×1.70 from combo 15 on).
 *
 * Accuracy = (perfect + 0.5 × good) / (perfect + good + miss), 0 with no cues,
 * where `miss` counts beatmap cues that were missed (bad timing, wrong move,
 * or expired). Spurious moves (no cue in window) break the combo and flash
 * MISS but are tallied separately in `spurious` so analyzer false positives
 * cannot drag accuracy below what the chart itself allows.
 */

import { cuesForLoopedPlayback, type Beatmap, type BeatmapMove, type ScheduledCue } from '@/lib/beatmaps';
import type { Move } from '@/lib/poseTracking';
import {
  CUE_LOOKAHEAD_S,
  CUE_WINDOW_MS,
  DETECTION_LATENCY_COMPENSATION_MS,
  GOOD_POINTS,
  PERFECT_POINTS,
  comboBonusFactor,
  cueAccuracy,
  gradeForDelta,
  type CueGrade,
  type JudgeEvent,
} from '@shared/scoring/grading';

// Grading constants + pure helpers live in the shared package so the server
// replays a run with the exact same rules; re-exported for existing callers.
export {
  CUE_LOOKAHEAD_S,
  CUE_WINDOW_MS,
  DETECTION_LATENCY_COMPENSATION_MS,
  GOOD_MS,
  GOOD_POINTS,
  PERFECT_MS,
  PERFECT_POINTS,
  comboBonusFactor,
  cueAccuracy,
  gradeForDelta,
  type CueGrade,
  type JudgeEvent,
} from '@shared/scoring/grading';

export type CueScore = {
  /** Action points only; compose with playback via `totalWorkoutScore`. */
  score: number;
  combo: number;
  maxCombo: number;
  perfect: number;
  good: number;
  /** Beatmap cues missed: bad timing, wrong move, or expired. */
  miss: number;
  /** Moves with no cue in the window (combo-breaking, not in accuracy). */
  spurious: number;
  lastGrade: CueGrade | null;
  /** Monotonic counter so the HUD can re-trigger a flash for repeated grades. */
  judgements: number;
  /** Signed ms of the last graded hit (negative = early), null for miss/expiry. */
  lastDeltaMs: number | null;
};

export const INITIAL_CUE_SCORE: CueScore = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfect: 0,
  good: 0,
  miss: 0,
  spurious: 0,
  lastGrade: null,
  judgements: 0,
  lastDeltaMs: null,
};

export type CueJudgement = {
  grade: CueGrade;
  /** The cue consumed by this move, or null for a spurious move. */
  cue: ScheduledCue | null;
  deltaMs: number | null;
  points: number;
};

const MOVE_TO_CUE: Record<Move, BeatmapMove> = {
  Jump: 'jump',
  Duck: 'duck',
  Left: 'left',
  Right: 'right',
};

export function toBeatmapMove(move: Move): BeatmapMove {
  return MOVE_TO_CUE[move];
}

/** Hard cap on the judgement log so a runaway session cannot grow unbounded. */
export const MAX_JUDGE_EVENTS = 5000;

export type CueJudgeOptions = {
  /** Length of the source actually playing; defaults to the authored duration. */
  videoLengthSec?: number;
  latencyCompensationMs?: number;
  lookaheadSec?: number;
};

export class CueJudge {
  readonly beatmap: Beatmap;
  private videoLength: number;
  private readonly compensationS: number;
  private readonly lookaheadS: number;
  /** Scheduled, not yet consumed/expired cues, sorted by `at`. */
  private active: ScheduledCue[] = [];
  /** Accumulated video time up to which cues have been scheduled. */
  private scheduledTo = 0;
  private state: CueScore = { ...INITIAL_CUE_SCORE };
  /**
   * Every judgement in order (hits, misses, expiries, spurious moves) in the
   * compact wire shape the leaderboard submission replays server-side.
   */
  private readonly log: JudgeEvent[] = [];

  constructor(beatmap: Beatmap, options: CueJudgeOptions = {}) {
    this.beatmap = beatmap;
    this.videoLength =
      options.videoLengthSec && options.videoLengthSec > 0
        ? options.videoLengthSec
        : beatmap.videoDurationSec;
    this.compensationS = (options.latencyCompensationMs ?? DETECTION_LATENCY_COMPENSATION_MS) / 1000;
    this.lookaheadS = options.lookaheadSec ?? CUE_LOOKAHEAD_S;
  }

  get score(): CueScore {
    return this.state;
  }

  get accuracy(): number {
    return cueAccuracy(this.state);
  }

  /** Snapshot of the judgement log (see `JudgeEvent`). */
  get events(): JudgeEvent[] {
    return this.log.slice();
  }

  private record(event: JudgeEvent): void {
    if (this.log.length < MAX_JUDGE_EVENTS) this.log.push(event);
  }

  /** Adopt a new source length (AirPlay swap); affects cues not yet scheduled. */
  setVideoLength(lengthSec: number): void {
    if (Number.isFinite(lengthSec) && lengthSec > 0) this.videoLength = lengthSec;
  }

  private scheduleThrough(untilSec: number): void {
    if (untilSec <= this.scheduledTo) return;
    const fresh = cuesForLoopedPlayback(this.beatmap, this.scheduledTo, untilSec, this.videoLength);
    if (fresh.length) this.active.push(...fresh);
    this.scheduledTo = untilSec;
  }

  /**
   * Clock tick at accumulated video time `videoTimeSec`. Expires cues whose
   * window has closed (each a Miss that breaks the combo). Returns how many.
   */
  onTick(videoTimeSec: number): number {
    this.scheduleThrough(videoTimeSec + this.lookaheadS);
    // A move reported now may still be compensated back into a cue's window;
    // only expire cues that even a compensated move could no longer reach.
    const horizon = videoTimeSec - this.compensationS - CUE_WINDOW_MS / 1000;
    let expired = 0;
    const remaining: ScheduledCue[] = [];
    for (const cue of this.active) {
      if (cue.at < horizon) {
        expired += 1;
        this.record({ i: cue.index, l: cue.loop, g: 'm', d: null, t: videoTimeSec });
      } else remaining.push(cue);
    }
    if (expired) {
      this.active = remaining;
      this.state = {
        ...this.state,
        miss: this.state.miss + expired,
        combo: 0,
        lastGrade: 'miss',
        lastDeltaMs: null,
        judgements: this.state.judgements + expired,
      };
    }
    return expired;
  }

  /** A classified move at accumulated video time `videoTimeSec`. */
  onMove(move: Move, videoTimeSec: number): CueJudgement {
    const adjusted = videoTimeSec - this.compensationS;
    const window = CUE_WINDOW_MS / 1000;
    this.scheduleThrough(Math.max(videoTimeSec, adjusted + window) + this.lookaheadS);
    const wanted = toBeatmapMove(move);

    type Candidate = { cue: ScheduledCue; index: number; delta: number };
    let best: Candidate | null = null;
    let bestAny: Candidate | null = null;
    for (let index = 0; index < this.active.length; index++) {
      const cue = this.active[index];
      const delta = adjusted - cue.at;
      if (Math.abs(delta) > window + 1e-9) continue;
      if (!bestAny || Math.abs(delta) < Math.abs(bestAny.delta)) bestAny = { cue, index, delta };
      if (cue.move === wanted && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { cue, index, delta };
      }
    }

    const match = best ?? bestAny;
    if (!match) {
      // Spurious move: nothing to consume, combo breaks.
      this.state = {
        ...this.state,
        spurious: this.state.spurious + 1,
        combo: 0,
        lastGrade: 'miss',
        lastDeltaMs: null,
        judgements: this.state.judgements + 1,
      };
      this.record({ i: -1, l: -1, g: 'x', d: null, t: videoTimeSec });
      return { grade: 'miss', cue: null, deltaMs: null, points: 0 };
    }

    this.active.splice(match.index, 1);
    const deltaMs = Math.round(match.delta * 1000) || 0; // normalize -0
    const grade: CueGrade = match.cue.move === wanted ? gradeForDelta(deltaMs) : 'miss';
    this.record({
      i: match.cue.index,
      l: match.cue.loop,
      g: grade === 'perfect' ? 'p' : grade === 'good' ? 'g' : 'm',
      d: deltaMs,
      t: videoTimeSec,
    });
    if (grade === 'miss') {
      this.state = {
        ...this.state,
        miss: this.state.miss + 1,
        combo: 0,
        lastGrade: 'miss',
        lastDeltaMs: deltaMs,
        judgements: this.state.judgements + 1,
      };
      return { grade, cue: match.cue, deltaMs, points: 0 };
    }

    const combo = this.state.combo + 1;
    const base = grade === 'perfect' ? PERFECT_POINTS : GOOD_POINTS;
    const points = Math.round(base * comboBonusFactor(combo));
    this.state = {
      ...this.state,
      score: this.state.score + points,
      combo,
      maxCombo: Math.max(this.state.maxCombo, combo),
      perfect: this.state.perfect + (grade === 'perfect' ? 1 : 0),
      good: this.state.good + (grade === 'good' ? 1 : 0),
      lastGrade: grade,
      lastDeltaMs: deltaMs,
      judgements: this.state.judgements + 1,
    };
    return { grade, cue: match.cue, deltaMs, points };
  }

  /**
   * Next unconsumed cues at or after `videoTimeSec` (for the HUD's upcoming
   * indicator). Cues already inside their window but not yet hit are included.
   */
  upcoming(videoTimeSec: number, count = 1): ScheduledCue[] {
    this.scheduleThrough(videoTimeSec + this.lookaheadS);
    const window = CUE_WINDOW_MS / 1000;
    return this.active
      .filter((cue) => cue.at >= videoTimeSec - this.compensationS - window)
      .sort((a, b) => a.at - b.at)
      .slice(0, count);
  }
}

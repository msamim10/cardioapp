/**
 * Server-side verification of a submitted run, as PURE functions so the
 * Cloud Function stays thin and `npm run test:submit-validation` can exercise
 * every rejection path without Firebase.
 *
 * What is verified (see docs/LEADERBOARDS.md for the rationale):
 *   - the chart: level id + content hash match the server's published copy
 *   - the session: playback rate ∈ {0.85, 1, 1.2}, 60 s ≤ elapsed ≤ 3 h,
 *     timed runs land inside [target − 2 s, target + 5 s], the source length
 *     is within tolerance of the authored duration
 *   - the judgements: every (loop, index) exists on the looped timeline the
 *     run actually covered, none is judged twice, every cue whose window
 *     closed before the run ended was judged, deltas are consistent with the
 *     cue time and with the grade, event times are non-decreasing and inside
 *     the run
 *   - the totals: replaying the judgements with the shared combo rules yields
 *     exactly the submitted score / max combo / accuracy
 *
 * Nonce timing and per-user rate limits are pure helpers here too; the
 * Function supplies the persisted state and the server clock.
 */

import { cuesForLoopedPlayback, type Beatmap } from './beatmap';
import { MAX_MOVE_SAMPLES, parseMoveSamples, type MoveSample } from './consensus';
import {
  CUE_LOOKAHEAD_S,
  CUE_WINDOW_MS,
  DETECTION_LATENCY_COMPENSATION_MS,
  GOOD_MS,
  PERFECT_MS,
  replayJudgements,
  type JudgeEvent,
  type ReplayTotals,
} from './grading';

export const ALLOWED_PLAYBACK_RATES: readonly number[] = [0.85, 1, 1.2];
/**
 * `beatmapHash` a run carries when the server had no published chart for the
 * level at run start. Such runs are scored with the free-move rules and land
 * on the board as `provisional: true, beatmapVersion: 0`.
 */
export const PROVISIONAL_BEATMAP_HASH = 'none';
/**
 * Free-scoring plausibility (provisional runs). The analyzer needs
 * COOLDOWN 280 ms + REARM 220 ms between moves, so ~120/min is the physical
 * ceiling; 100/min leaves headroom for a real sprint and still rejects a
 * fabricated log.
 */
export const PROVISIONAL_MAX_MOVES_PER_MIN = 100;
/** Free scoring awards 30 + min(70, (combo − 1) × 5) per move (`applyRecognizedMove`). */
export const FREE_MOVE_MIN_POINTS = 30;
export const FREE_MOVE_MAX_POINTS = 100;
/**
 * The sample list and the move tally are kept in the same code path, but the
 * tally is React state (flushed a frame later); allow a few moves of drift.
 */
export const SAMPLE_COUNT_TOLERANCE = 3;
/** Sample-bearing submissions stored per uid per UTC day (any board outcome). */
export const SAMPLE_DAILY_LIMIT = 60;
export const MIN_ELAPSED_SECONDS = 60;
export const MAX_ELAPSED_SECONDS = 3 * 3600;
export const TIMED_RUN_EARLY_TOLERANCE_S = 2;
export const TIMED_RUN_LATE_TOLERANCE_S = 5;
/** Looser than the in-app 0.5 s warning: AirPlay cuts drift; the chart is still the vertical one. */
export const VIDEO_LENGTH_TOLERANCE_S = 1.0;
/**
 * The judge extrapolates the clock by up to 0.75 s between ticks and the last
 * tick may land just past the target, so event times and the required/allowed
 * cue horizons get this much slack at the tail.
 */
export const TAIL_SLACK_S = 1.0;
/** Rounding of `d` (ms) plus float drift in `t`. */
export const DELTA_CONSISTENCY_MS = 2;
export const MAX_EVENTS = 5000;
/** The nonce must have been issued at least (elapsed − this) before submit. */
export const NONCE_ELAPSED_SLACK_S = 5;
export const NONCE_MAX_AGE_S = 6 * 3600;
export const START_RUN_DAILY_LIMIT = 30;
export const SUBMIT_DAILY_LIMIT = 12;
/** Next accepted run must start ≥ (elapsed − this) after the previous acceptance. */
export const SUBMIT_COOLDOWN_MARGIN_S = 30;

export type SubmitRunPayload = {
  runId: string;
  levelId: string;
  /** Hash of the chart the run was scored against, or PROVISIONAL_BEATMAP_HASH. */
  beatmapHash: string;
  /** Chart revision (`beatmaps/{levelId}.chartVersion`); 0 for a provisional run. */
  beatmapVersion: number;
  classKey: string | null;
  /** Intensity key the player chose (light / active / intense), if known. */
  intensity: string | null;
  playbackRate: number;
  /** Wall-clock target of a timed run. Only timed runs are accepted today. */
  targetSeconds: number | null;
  /** Wall-clock seconds the run lasted (rate divided out). */
  elapsedSeconds: number;
  /** Length of the source that actually played (loop wraps use it). */
  videoLengthSec: number;
  nonce: string;
  cues: JudgeEvent[];
  spurious: number;
  /** Action points from the cue judge (not the composed workout score). */
  score: number;
  maxCombo: number;
  accuracy: number;
  /** Whether the client persisted the run locally before submitting. */
  recorded: boolean;
  appVersion: string;
  /** Client-local `YYYY-MM-DD` of the run, for the daily board. */
  dateKey: string;
  /** Every recognized move (any scoring mode), for the free-scoring check. */
  moveCount: number;
  /** Detected moves on the video timeline (≤ MAX_MOVE_SAMPLES), for consensus charts. */
  samples: MoveSample[];
  /** Seconds of natural playback the run accumulated (RunClock credit). */
  naturalPlaySec: number;
};

export type RejectCode =
  | 'bad-payload'
  | 'bad-version'
  | 'bad-samples'
  | 'bad-moves'
  | 'level-mismatch'
  | 'hash-mismatch'
  | 'bad-rate'
  | 'bad-elapsed'
  | 'bad-target'
  | 'bad-video-length'
  | 'too-many-events'
  | 'bad-event'
  | 'events-out-of-order'
  | 'event-after-end'
  | 'unknown-cue'
  | 'duplicate-cue'
  | 'grade-delta-mismatch'
  | 'delta-inconsistent'
  | 'expiry-inconsistent'
  | 'missing-cues'
  | 'spurious-mismatch'
  | 'score-mismatch'
  | 'combo-mismatch'
  | 'accuracy-mismatch';

export type SubmissionVerdict =
  | { ok: true; totals: ReplayTotals; videoEndSec: number }
  | { ok: false; code: RejectCode; detail?: string };

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 200;

function parseEvent(raw: unknown): JudgeEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (!Number.isInteger(e.i) || !Number.isInteger(e.l)) return null;
  if (e.g !== 'p' && e.g !== 'g' && e.g !== 'm' && e.g !== 'x') return null;
  if (!(e.d === null || Number.isInteger(e.d))) return null;
  if (!finite(e.t) || (e.t as number) < 0) return null;
  return { i: e.i as number, l: e.l as number, g: e.g, d: e.d as number | null, t: e.t as number };
}

/** Shape-check an untrusted callable payload. Semantic checks live in `validateSubmission`. */
export function parseSubmitRunPayload(
  raw: unknown,
): { ok: true; payload: SubmitRunPayload } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload must be an object' };
  const p = raw as Record<string, unknown>;
  if (!nonEmptyString(p.runId)) return { ok: false, reason: 'runId' };
  if (!nonEmptyString(p.levelId)) return { ok: false, reason: 'levelId' };
  if (!nonEmptyString(p.beatmapHash)) return { ok: false, reason: 'beatmapHash' };
  if (!Number.isInteger(p.beatmapVersion) || (p.beatmapVersion as number) < 0) {
    return { ok: false, reason: 'beatmapVersion' };
  }
  if (!(p.classKey === null || p.classKey === undefined || nonEmptyString(p.classKey))) {
    return { ok: false, reason: 'classKey' };
  }
  if (!(p.intensity === null || p.intensity === undefined || nonEmptyString(p.intensity))) {
    return { ok: false, reason: 'intensity' };
  }
  if (!finite(p.playbackRate)) return { ok: false, reason: 'playbackRate' };
  if (!(p.targetSeconds === null || p.targetSeconds === undefined || finite(p.targetSeconds))) {
    return { ok: false, reason: 'targetSeconds' };
  }
  if (!finite(p.elapsedSeconds)) return { ok: false, reason: 'elapsedSeconds' };
  if (!finite(p.videoLengthSec)) return { ok: false, reason: 'videoLengthSec' };
  if (!nonEmptyString(p.nonce)) return { ok: false, reason: 'nonce' };
  if (!Array.isArray(p.cues)) return { ok: false, reason: 'cues' };
  if (p.cues.length > MAX_EVENTS) return { ok: false, reason: 'too many cues' };
  const cues: JudgeEvent[] = [];
  for (const entry of p.cues) {
    const event = parseEvent(entry);
    if (!event) return { ok: false, reason: 'cue event shape' };
    cues.push(event);
  }
  if (!Number.isInteger(p.spurious) || (p.spurious as number) < 0) return { ok: false, reason: 'spurious' };
  if (!Number.isInteger(p.score) || (p.score as number) < 0) return { ok: false, reason: 'score' };
  if (!Number.isInteger(p.maxCombo) || (p.maxCombo as number) < 0) return { ok: false, reason: 'maxCombo' };
  if (!finite(p.accuracy) || p.accuracy < 0 || p.accuracy > 1) return { ok: false, reason: 'accuracy' };
  if (typeof p.recorded !== 'boolean') return { ok: false, reason: 'recorded' };
  if (typeof p.appVersion !== 'string' || p.appVersion.length > 40) return { ok: false, reason: 'appVersion' };
  if (!nonEmptyString(p.dateKey)) return { ok: false, reason: 'dateKey' };
  const moveCount = p.moveCount === undefined ? 0 : p.moveCount;
  if (!Number.isInteger(moveCount) || (moveCount as number) < 0) return { ok: false, reason: 'moveCount' };
  // Samples sit on the video timeline; a generous ceiling here, the exact
  // bound against the source length is applied in the semantic checks.
  const samples = parseMoveSamples(p.samples ?? [], MAX_ELAPSED_SECONDS);
  if (!samples) return { ok: false, reason: 'samples' };
  const naturalPlaySec = p.naturalPlaySec === undefined ? 0 : p.naturalPlaySec;
  if (!finite(naturalPlaySec) || naturalPlaySec < 0) return { ok: false, reason: 'naturalPlaySec' };
  return {
    ok: true,
    payload: {
      runId: p.runId,
      levelId: p.levelId,
      beatmapHash: p.beatmapHash,
      beatmapVersion: p.beatmapVersion as number,
      classKey: typeof p.classKey === 'string' ? p.classKey : null,
      intensity: typeof p.intensity === 'string' ? p.intensity : null,
      playbackRate: p.playbackRate,
      targetSeconds: typeof p.targetSeconds === 'number' ? p.targetSeconds : null,
      elapsedSeconds: p.elapsedSeconds,
      videoLengthSec: p.videoLengthSec,
      nonce: p.nonce,
      cues,
      spurious: p.spurious as number,
      score: p.score as number,
      maxCombo: p.maxCombo as number,
      accuracy: p.accuracy,
      recorded: p.recorded,
      appVersion: p.appVersion,
      dateKey: p.dateKey,
      moveCount: moveCount as number,
      samples,
      naturalPlaySec,
    },
  };
}

export function isAllowedPlaybackRate(rate: number): boolean {
  return ALLOWED_PLAYBACK_RATES.some((allowed) => Math.abs(allowed - rate) < 1e-9);
}

/** Accumulated video seconds a timed run covered: wall seconds × playback rate. */
export function videoEndForRun(elapsedSeconds: number, playbackRate: number): number {
  return elapsedSeconds * playbackRate;
}

/** Whether a payload claims the provisional (no chart at run start) path. */
export function isProvisionalPayload(payload: Pick<SubmitRunPayload, 'beatmapHash' | 'beatmapVersion'>): boolean {
  return payload.beatmapHash === PROVISIONAL_BEATMAP_HASH || payload.beatmapVersion === 0;
}

/**
 * Session checks shared by the verified and provisional paths: rate, elapsed
 * bounds, timed-run target tolerance.
 */
function validateSession(payload: SubmitRunPayload): SubmissionVerdict | null {
  if (!isAllowedPlaybackRate(payload.playbackRate)) return { ok: false, code: 'bad-rate' };
  const elapsed = payload.elapsedSeconds;
  if (elapsed < MIN_ELAPSED_SECONDS || elapsed > MAX_ELAPSED_SECONDS) {
    return { ok: false, code: 'bad-elapsed', detail: `${elapsed}s` };
  }
  // Only timed (looping) runs are accepted: their elapsed wall time maps to
  // accumulated video time as elapsed × rate. Untimed play-to-end runs report
  // the raw video position and are not submitted by the client.
  if (payload.targetSeconds === null || !(payload.targetSeconds > 0)) {
    return { ok: false, code: 'bad-target', detail: 'untimed run' };
  }
  if (
    elapsed < payload.targetSeconds - TIMED_RUN_EARLY_TOLERANCE_S ||
    elapsed > payload.targetSeconds + TIMED_RUN_LATE_TOLERANCE_S
  ) {
    return { ok: false, code: 'bad-target', detail: `${elapsed}s vs target ${payload.targetSeconds}s` };
  }
  return null;
}

/**
 * Whether the sample list is consistent with the run: every sample inside
 * the source length (+ tail slack) and the count matching the move tally up
 * to the cap and a small tolerance. Samples that fail this are dropped from
 * a verified run and reject a provisional one (there they are the evidence).
 */
export function samplesConsistent(payload: SubmitRunPayload): boolean {
  if (payload.samples.length > MAX_MOVE_SAMPLES) return false;
  if (!(payload.videoLengthSec > 0)) return payload.samples.length === 0;
  for (const sample of payload.samples) {
    if (sample.t < 0 || sample.t > payload.videoLengthSec + TAIL_SLACK_S) return false;
  }
  const expected = Math.min(payload.moveCount, MAX_MOVE_SAMPLES);
  return Math.abs(payload.samples.length - expected) <= SAMPLE_COUNT_TOLERANCE;
}

/**
 * Verify a run scored with the FREE-move rules because the server had no
 * chart for the level when the run started. Nothing can be replayed, so this
 * is a plausibility check: session bounds, a move rate a human can produce,
 * a score inside what `applyRecognizedMove` can award for that many moves,
 * and a sample list that matches the move tally. The nonce/timing checks in
 * the Function guarantee the run took at least as long as it claims.
 */
export function validateProvisionalSubmission(payload: SubmitRunPayload): SubmissionVerdict {
  if (payload.beatmapHash !== PROVISIONAL_BEATMAP_HASH || payload.beatmapVersion !== 0) {
    return { ok: false, code: 'bad-version', detail: 'provisional runs carry no chart' };
  }
  const session = validateSession(payload);
  if (session) return session;
  if (payload.cues.length !== 0 || payload.spurious !== 0 || payload.accuracy !== 0) {
    return { ok: false, code: 'bad-event', detail: 'provisional runs have no judgements' };
  }
  if (!(payload.videoLengthSec > 0)) return { ok: false, code: 'bad-video-length' };
  const minutes = payload.elapsedSeconds / 60;
  if (payload.moveCount > PROVISIONAL_MAX_MOVES_PER_MIN * minutes) {
    return { ok: false, code: 'bad-moves', detail: `${payload.moveCount} moves in ${minutes.toFixed(1)} min` };
  }
  if (payload.maxCombo > payload.moveCount) return { ok: false, code: 'combo-mismatch' };
  const minScore = payload.moveCount * FREE_MOVE_MIN_POINTS;
  const maxScore = payload.moveCount * FREE_MOVE_MAX_POINTS;
  if (payload.score < minScore || payload.score > maxScore) {
    return { ok: false, code: 'score-mismatch', detail: `${payload.score} for ${payload.moveCount} moves` };
  }
  if (!samplesConsistent(payload)) return { ok: false, code: 'bad-samples' };
  const totals: ReplayTotals = {
    score: payload.score,
    maxCombo: payload.maxCombo,
    perfect: 0,
    good: 0,
    miss: 0,
    spurious: 0,
    accuracy: 0,
  };
  return { ok: true, totals, videoEndSec: videoEndForRun(payload.elapsedSeconds, payload.playbackRate) };
}

/**
 * Verify a shape-checked payload against the server's copy of the chart.
 * `serverBeatmapHash` is the hash stored alongside the published beatmap.
 */
export function validateSubmission(
  payload: SubmitRunPayload,
  beatmap: Beatmap,
  serverBeatmapHash: string,
): SubmissionVerdict {
  if (payload.levelId !== beatmap.levelId) return { ok: false, code: 'level-mismatch' };
  if (payload.beatmapHash !== serverBeatmapHash) return { ok: false, code: 'hash-mismatch' };
  if (payload.beatmapVersion < 1) return { ok: false, code: 'bad-version' };
  const session = validateSession(payload);
  if (session) return session;
  const elapsed = payload.elapsedSeconds;
  if (
    !(payload.videoLengthSec > 0) ||
    Math.abs(payload.videoLengthSec - beatmap.videoDurationSec) > VIDEO_LENGTH_TOLERANCE_S
  ) {
    return { ok: false, code: 'bad-video-length' };
  }
  if (payload.cues.length > MAX_EVENTS) return { ok: false, code: 'too-many-events' };

  const videoEnd = videoEndForRun(elapsed, payload.playbackRate);
  const compS = DETECTION_LATENCY_COMPENSATION_MS / 1000;
  const windowS = CUE_WINDOW_MS / 1000;

  // Cues the run could have scheduled (through the lookahead) and cues whose
  // window definitely closed before the run ended (must have been judged).
  const allowed = new Map<string, { at: number }>();
  const required = new Set<string>();
  const requiredBefore = videoEnd - compS - windowS - TAIL_SLACK_S;
  for (const cue of cuesForLoopedPlayback(
    beatmap,
    0,
    videoEnd + CUE_LOOKAHEAD_S + TAIL_SLACK_S,
    payload.videoLengthSec,
  )) {
    const key = `${cue.loop}:${cue.index}`;
    allowed.set(key, { at: cue.at });
    if (cue.at < requiredBefore) required.add(key);
  }

  const seen = new Set<string>();
  let spurious = 0;
  let lastT = -Infinity;
  for (const event of payload.cues) {
    if (event.t < lastT) return { ok: false, code: 'events-out-of-order' };
    lastT = event.t;
    if (event.t > videoEnd + TAIL_SLACK_S) return { ok: false, code: 'event-after-end' };

    if (event.g === 'x') {
      if (event.i !== -1 || event.l !== -1 || event.d !== null) return { ok: false, code: 'bad-event' };
      spurious += 1;
      continue;
    }

    const key = `${event.l}:${event.i}`;
    const cue = allowed.get(key);
    if (!cue) return { ok: false, code: 'unknown-cue', detail: key };
    if (seen.has(key)) return { ok: false, code: 'duplicate-cue', detail: key };
    seen.add(key);

    if (event.d === null) {
      // Expired on a tick: only a miss, and only once the window had closed.
      if (event.g !== 'm') return { ok: false, code: 'grade-delta-mismatch', detail: key };
      if (!(cue.at < event.t - compS - windowS + 1e-6)) {
        return { ok: false, code: 'expiry-inconsistent', detail: key };
      }
      continue;
    }

    const abs = Math.abs(event.d);
    if (abs > CUE_WINDOW_MS) return { ok: false, code: 'grade-delta-mismatch', detail: key };
    if (event.g === 'p' && abs > PERFECT_MS) return { ok: false, code: 'grade-delta-mismatch', detail: key };
    if (event.g === 'g' && (abs <= PERFECT_MS || abs > GOOD_MS)) {
      return { ok: false, code: 'grade-delta-mismatch', detail: key };
    }
    // The delta must be the (compensated) event time minus the cue time.
    const derived = (event.t - compS - cue.at) * 1000;
    if (Math.abs(derived - event.d) > DELTA_CONSISTENCY_MS) {
      return { ok: false, code: 'delta-inconsistent', detail: key };
    }
  }

  for (const key of required) {
    if (!seen.has(key)) return { ok: false, code: 'missing-cues', detail: key };
  }
  if (spurious !== payload.spurious) return { ok: false, code: 'spurious-mismatch' };

  const totals = replayJudgements(payload.cues);
  if (totals.score !== payload.score) {
    return { ok: false, code: 'score-mismatch', detail: `${totals.score} vs ${payload.score}` };
  }
  if (totals.maxCombo !== payload.maxCombo) return { ok: false, code: 'combo-mismatch' };
  if (Math.abs(totals.accuracy - payload.accuracy) > 1e-9) return { ok: false, code: 'accuracy-mismatch' };

  return { ok: true, totals, videoEndSec: videoEnd };
}

// ---------------------------------------------------------------------------
// Nonce timing
// ---------------------------------------------------------------------------

/**
 * A run of `elapsedSeconds` cannot legitimately finish sooner than that after
 * its nonce was issued (minus a little slack), and nonces do not live forever.
 */
export function nonceTimingOk(input: {
  issuedAtMs: number;
  serverNowMs: number;
  elapsedSeconds: number;
}): boolean {
  const ageS = (input.serverNowMs - input.issuedAtMs) / 1000;
  if (!Number.isFinite(ageS)) return false;
  if (ageS < input.elapsedSeconds - NONCE_ELAPSED_SLACK_S) return false;
  return ageS <= NONCE_MAX_AGE_S;
}

// ---------------------------------------------------------------------------
// Rate limits (state persisted per uid by the Function)
// ---------------------------------------------------------------------------

export type RateLimitState = {
  /** UTC day the counters belong to. */
  dayKey: string;
  startCount: number;
  submitCount: number;
  /** Server ms of the last accepted submission (0 = never). */
  lastAcceptedAt: number;
  lastAcceptedElapsed: number;
  /** Sample-bearing runs stored today (consensus input), any board outcome. */
  sampleCount: number;
};

export const EMPTY_RATE_LIMIT: RateLimitState = {
  dayKey: '',
  startCount: 0,
  submitCount: 0,
  lastAcceptedAt: 0,
  lastAcceptedElapsed: 0,
  sampleCount: 0,
};

export function utcDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, '0')}-${`${d.getUTCDate()}`.padStart(2, '0')}`;
}

function rolled(state: RateLimitState | null | undefined, nowMs: number): RateLimitState {
  const day = utcDayKey(nowMs);
  const base = state ?? EMPTY_RATE_LIMIT;
  if (base.dayKey === day) return { ...base, sampleCount: base.sampleCount ?? 0 };
  return { ...base, dayKey: day, startCount: 0, submitCount: 0, sampleCount: 0 };
}

/**
 * Count a stored sample set; `allowed` false once today's budget is spent.
 * Independent of the board budget so a rate-limited score still teaches the
 * chart (the run itself was still real).
 */
export function consumeSampleReport(
  state: RateLimitState | null | undefined,
  nowMs: number,
): { allowed: boolean; next: RateLimitState } {
  const next = rolled(state, nowMs);
  if (next.sampleCount >= SAMPLE_DAILY_LIMIT) return { allowed: false, next };
  next.sampleCount += 1;
  return { allowed: true, next };
}

/** Count a `startRun` call; `allowed` false when today's budget is spent. */
export function consumeStartRun(
  state: RateLimitState | null | undefined,
  nowMs: number,
): { allowed: boolean; next: RateLimitState } {
  const next = rolled(state, nowMs);
  if (next.startCount >= START_RUN_DAILY_LIMIT) return { allowed: false, next };
  next.startCount += 1;
  return { allowed: true, next };
}

/**
 * Whether a submission may be ACCEPTED now, and the state to persist if so.
 * Rejected submissions do not consume budget (they never touched the board).
 */
export function consumeSubmitRun(
  state: RateLimitState | null | undefined,
  nowMs: number,
  elapsedSeconds: number,
): { allowed: boolean; reason?: 'daily-limit' | 'cooldown'; next: RateLimitState } {
  const next = rolled(state, nowMs);
  if (next.submitCount >= SUBMIT_DAILY_LIMIT) return { allowed: false, reason: 'daily-limit', next };
  const minGapMs = Math.max(0, elapsedSeconds - SUBMIT_COOLDOWN_MARGIN_S) * 1000;
  if (next.lastAcceptedAt > 0 && nowMs - next.lastAcceptedAt < minGapMs) {
    return { allowed: false, reason: 'cooldown', next };
  }
  next.submitCount += 1;
  next.lastAcceptedAt = nowMs;
  next.lastAcceptedElapsed = elapsedSeconds;
  return { allowed: true, next };
}

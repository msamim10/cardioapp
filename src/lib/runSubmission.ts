/**
 * In-memory hand-off of leaderboard submission material between the workout
 * and the summary screen.
 *
 * The summary receives its numbers as route params, but the full judgement
 * log (`CueJudge.events`, up to a few KB) and the server nonce are kept here
 * instead: route params are strings with practical size limits and the log
 * must be passed verbatim for the server replay to match. Keyed by runId so
 * a stale entry from an abandoned run can never attach to a later one.
 * Device-local and never persisted — a killed app simply does not submit.
 */

import type { Beatmap } from '@shared/scoring/beatmap';
import type { MoveSample } from '@shared/scoring/consensus';
import type { JudgeEvent } from '@shared/scoring/grading';

/**
 * What `startRun` handed back for a run: the single-use nonce plus the chart
 * the server wants this run scored against (null → provisional free-move
 * scoring, `beatmapHash` = PROVISIONAL_BEATMAP_HASH, `beatmapVersion` = 0).
 */
export type RunNonce = {
  nonce: string;
  issuedAt: number;
  beatmapHash: string;
  beatmapVersion: number;
  beatmap: Beatmap | null;
};

export type RunSubmissionMaterial = {
  runId: string;
  levelId: string;
  beatmapHash: string;
  beatmapVersion: number;
  nonce: string;
  playbackRate: number;
  intensity: string | null;
  targetSeconds: number | null;
  elapsedSeconds: number;
  videoLengthSec: number;
  events: JudgeEvent[];
  spurious: number;
  /** Cue action score, or the free-move action score for a provisional run. */
  score: number;
  maxCombo: number;
  accuracy: number;
  /** Every recognized move while the scoring gate was open. */
  moveCount: number;
  /** Detected moves on the video timeline (consensus input). */
  samples: MoveSample[];
  /** Seconds of natural playback the RunClock credited. */
  naturalPlaySec: number;
};

const nonces = new Map<string, RunNonce>();
const material = new Map<string, RunSubmissionMaterial>();

export function stageRunNonce(runId: string, nonce: RunNonce): void {
  nonces.set(runId, nonce);
}

export function peekRunNonce(runId: string | undefined): RunNonce | null {
  return runId ? nonces.get(runId) ?? null : null;
}

export function stageRunSubmission(input: RunSubmissionMaterial): void {
  material.set(input.runId, input);
}

/** Whether the workout staged submission material for this run. */
export function hasStagedSubmission(runId: string | undefined): boolean {
  return runId ? material.has(runId) : false;
}

/** Take (and forget) the material for a run; null when nothing was staged. */
export function consumeRunSubmission(runId: string | undefined): RunSubmissionMaterial | null {
  if (!runId) return null;
  const found = material.get(runId) ?? null;
  material.delete(runId);
  nonces.delete(runId);
  return found;
}

export function discardRunSubmission(runId: string | undefined): void {
  if (!runId) return;
  material.delete(runId);
  nonces.delete(runId);
}

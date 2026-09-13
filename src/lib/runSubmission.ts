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

import type { JudgeEvent } from '@shared/scoring/grading';

export type RunNonce = { nonce: string; issuedAt: number; beatmapHash: string };

export type RunSubmissionMaterial = {
  runId: string;
  levelId: string;
  beatmapHash: string;
  nonce: string;
  playbackRate: number;
  targetSeconds: number | null;
  elapsedSeconds: number;
  videoLengthSec: number;
  events: JudgeEvent[];
  spurious: number;
  score: number;
  maxCombo: number;
  accuracy: number;
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

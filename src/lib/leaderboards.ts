/**
 * Per-level leaderboards + beat-my-score, backed by Cloud Functions.
 *
 * Writes go through callables (`startRun` / `submitRun`) — the client never
 * writes a board document. Reads are plain Firestore queries under the rules
 * in firestore.rules (signed-in read). All fetchers resolve to empty data
 * rather than throwing when Firebase is unavailable, so the UI can render an
 * offline/empty state.
 */

import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { localDateKey } from '@shared/scoring/daily';
import type { JudgeEvent } from '@shared/scoring/grading';
import { PROVISIONAL_BEATMAP_HASH, type SubmitRunPayload } from '@shared/scoring/submission';
import { adoptChart, refreshBeatmap } from './beatmapRegistry';
import { isFirebaseConfigured } from './config';
import { getFirebaseDb } from './firebase';
import { CallableError, callFunction } from './functionsClient';
import { consumeRunSubmission, type RunNonce } from './runSubmission';

export const LEADERBOARD_PAGE = 50;
/** Firestore `in` queries take at most 30 values. */
export const IN_QUERY_CHUNK = 30;
export const MAX_FOLLOWING = 100;

export type LeaderboardEntry = {
  uid: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  at: number;
  recorded: boolean;
  runId: string;
  username: string | null;
  photoURL: string | null;
  classKey: string | null;
  level: number;
  playbackRate: number;
  /** Scored with the free-move rules because the level had no chart at run start. */
  provisional: boolean;
  /** Chart revision the run was verified against; 0 for provisional entries. */
  beatmapVersion: number;
};

export type ChallengeCard = {
  runId: string;
  uid: string;
  username: string | null;
  levelId: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  at: number;
  recorded: boolean;
};

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function toEntry(id: string, data: Record<string, unknown>): LeaderboardEntry {
  return {
    uid: str(data.uid) ?? id,
    score: Math.max(0, Math.round(num(data.score))),
    accuracy: Math.min(1, Math.max(0, num(data.accuracy))),
    maxCombo: Math.max(0, Math.round(num(data.maxCombo))),
    at: num(data.at),
    recorded: data.recorded === true,
    runId: str(data.runId) ?? '',
    username: str(data.username),
    photoURL: str(data.photoURL),
    classKey: str(data.classKey),
    level: Math.max(1, Math.round(num(data.level, 1))),
    playbackRate: num(data.playbackRate, 1),
    provisional: data.provisional === true || num(data.beatmapVersion, 1) === 0,
    beatmapVersion: Math.max(0, Math.round(num(data.beatmapVersion, data.provisional === true ? 0 : 1))),
  };
}

function entries(board: 'leaderboards' | 'dailyLeaderboards', key: string) {
  return collection(getFirebaseDb(), board, key, 'entries');
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

type StartRunReply = {
  nonce: string;
  issuedAt: number;
  beatmapHash: string;
  beatmapVersion: number;
  beatmap: Record<string, unknown> | null;
};

/**
 * Ask the server for a single-use nonce before a timed run starts. The reply
 * also carries the chart the run must be scored against (or none → the run
 * scores provisionally); it is adopted into the local chart mirror. Failure
 * is non-fatal: the run still records locally, it just cannot be submitted.
 */
export async function requestRunNonce(levelId: string): Promise<RunNonce | null> {
  try {
    const result = await callFunction<{ levelId: string }, StartRunReply>('startRun', { levelId });
    if (!result || typeof result.nonce !== 'string') return null;
    const chart = adoptChart(levelId, result.beatmap && typeof result.beatmap === 'object' ? result.beatmap : null);
    const beatmapHash =
      typeof result.beatmapHash === 'string' && result.beatmapHash ? result.beatmapHash : PROVISIONAL_BEATMAP_HASH;
    // The chart is only usable when the hash the nonce was issued for matches
    // what we could parse; otherwise score provisionally and let the server
    // decide (it will reject a mismatch rather than accept a wrong chart).
    const usable = chart !== null && chart.hash === beatmapHash;
    return {
      nonce: result.nonce,
      issuedAt: num(result.issuedAt, Date.now()),
      beatmapHash,
      beatmapVersion: usable ? Math.max(1, Math.round(num(result.beatmapVersion, chart.chartVersion))) : 0,
      beatmap: usable ? chart.beatmap : null,
    };
  } catch (error) {
    if (__DEV__) console.info('[leaderboards] startRun unavailable:', (error as Error).message);
    return null;
  }
}

export type SubmitRunResult =
  | {
      accepted: true;
      rank: number;
      dailyRank: number | null;
      improved: boolean;
      best: number;
      provisional?: boolean;
      beatmapVersion?: number;
    }
  | { accepted: false; reason: string; detail?: string };

export type SubmitOutcome =
  | { status: 'submitted'; result: Extract<SubmitRunResult, { accepted: true }> }
  | { status: 'rejected'; reason: string }
  | { status: 'skipped'; reason: 'not-signed-in' | 'no-material' | 'not-recorded' | 'offline' | 'not-configured' }
  | { status: 'error'; message: string };

/**
 * Submit the run that just reached the summary, if it can be. Requires: a
 * signed-in user, a locally recorded (finished-to-end) run, and staged
 * material (nonce + judgement log) from the workout for that runId.
 */
export async function submitRunIfEligible(input: {
  runId: string;
  signedIn: boolean;
  recorded: boolean;
  classKey: string | null;
  appVersion: string;
  /** Local timestamp of the run's completion, for the daily-board date key. */
  completedAt: number;
}): Promise<SubmitOutcome> {
  const material = consumeRunSubmission(input.runId);
  if (!input.signedIn) return { status: 'skipped', reason: 'not-signed-in' };
  if (!input.recorded) return { status: 'skipped', reason: 'not-recorded' };
  if (!material) return { status: 'skipped', reason: 'no-material' };
  if (!isFirebaseConfigured) return { status: 'skipped', reason: 'not-configured' };

  const payload: SubmitRunPayload = {
    runId: material.runId,
    levelId: material.levelId,
    beatmapHash: material.beatmapHash,
    beatmapVersion: material.beatmapVersion,
    classKey: input.classKey,
    intensity: material.intensity,
    playbackRate: material.playbackRate,
    targetSeconds: material.targetSeconds,
    elapsedSeconds: material.elapsedSeconds,
    videoLengthSec: material.videoLengthSec,
    nonce: material.nonce,
    cues: material.events as JudgeEvent[],
    spurious: material.spurious,
    score: material.score,
    maxCombo: material.maxCombo,
    accuracy: material.accuracy,
    recorded: input.recorded,
    appVersion: input.appVersion,
    dateKey: localDateKey(new Date(input.completedAt)),
    moveCount: material.moveCount,
    samples: material.samples,
    naturalPlaySec: material.naturalPlaySec,
  };
  try {
    const result = await callFunction<SubmitRunPayload, SubmitRunResult>('submitRun', payload);
    if (result.accepted) return { status: 'submitted', result };
    return { status: 'rejected', reason: result.reason };
  } catch (error) {
    if (error instanceof CallableError && error.code === 'unavailable') {
      return { status: 'skipped', reason: 'offline' };
    }
    return { status: 'error', message: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function safely<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  if (!isFirebaseConfigured) return fallback;
  try {
    return await run();
  } catch (error) {
    if (__DEV__) console.warn('[leaderboards] read failed:', (error as Error).message);
    return fallback;
  }
}

export async function fetchTopEntries(
  levelId: string,
  options: { classKey?: string | null; max?: number } = {},
): Promise<LeaderboardEntry[]> {
  return safely([], async () => {
    const constraints = options.classKey
      ? [where('classKey', '==', options.classKey), orderBy('score', 'desc')]
      : [orderBy('score', 'desc')];
    const snapshot = await getDocs(
      query(entries('leaderboards', levelId), ...constraints, limit(options.max ?? LEADERBOARD_PAGE)),
    );
    return snapshot.docs.map((d) => toEntry(d.id, d.data()));
  });
}

export async function fetchMyEntry(levelId: string, uid: string): Promise<LeaderboardEntry | null> {
  return safely(null, async () => {
    const snapshot = await getDoc(doc(entries('leaderboards', levelId), uid));
    return snapshot.exists() ? toEntry(snapshot.id, snapshot.data()) : null;
  });
}

/** Rank of `score` on a level: 1 + entries strictly above it (count aggregation). */
export async function fetchRank(levelId: string, score: number): Promise<number | null> {
  return safely(null, async () => {
    const snapshot = await getCountFromServer(query(entries('leaderboards', levelId), where('score', '>', score)));
    return snapshot.data().count + 1;
  });
}

/** Real number of players on a level's board (replaces the old simulated "runners"). */
export async function fetchEntryCount(levelId: string): Promise<number | null> {
  return safely(null, async () => {
    const snapshot = await getCountFromServer(entries('leaderboards', levelId));
    return snapshot.data().count;
  });
}

export async function fetchDailyTop(dateKey: string, max = LEADERBOARD_PAGE): Promise<LeaderboardEntry[]> {
  return safely([], async () => {
    const snapshot = await getDocs(query(entries('dailyLeaderboards', dateKey), orderBy('score', 'desc'), limit(max)));
    return snapshot.docs.map((d) => toEntry(d.id, d.data()));
  });
}

export async function fetchDailyMyEntry(dateKey: string, uid: string): Promise<LeaderboardEntry | null> {
  return safely(null, async () => {
    const snapshot = await getDoc(doc(entries('dailyLeaderboards', dateKey), uid));
    return snapshot.exists() ? toEntry(snapshot.id, snapshot.data()) : null;
  });
}

export async function fetchDailyRank(dateKey: string, score: number): Promise<number | null> {
  return safely(null, async () => {
    const snapshot = await getCountFromServer(
      query(entries('dailyLeaderboards', dateKey), where('score', '>', score)),
    );
    return snapshot.data().count + 1;
  });
}

/** Board rows for a set of uids (the following list), fetched in `in` chunks of 30. */
export async function fetchEntriesForUids(levelId: string, uids: readonly string[]): Promise<LeaderboardEntry[]> {
  const unique = Array.from(new Set(uids)).slice(0, MAX_FOLLOWING);
  if (unique.length === 0) return [];
  return safely([], async () => {
    const chunks: string[][] = [];
    for (let offset = 0; offset < unique.length; offset += IN_QUERY_CHUNK) {
      chunks.push(unique.slice(offset, offset + IN_QUERY_CHUNK));
    }
    const snapshots = await Promise.all(
      chunks.map((chunk) => getDocs(query(entries('leaderboards', levelId), where(documentId(), 'in', chunk)))),
    );
    return snapshots
      .flatMap((snapshot) => snapshot.docs.map((d) => toEntry(d.id, d.data())))
      .sort((a, b) => b.score - a.score || a.at - b.at);
  });
}

export async function fetchChallenge(runId: string): Promise<ChallengeCard | null> {
  return safely(null, async () => {
    const snapshot = await getDoc(doc(getFirebaseDb(), 'challenges', runId));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    const levelId = str(data.levelId);
    if (!levelId) return null;
    return {
      runId: snapshot.id,
      uid: str(data.uid) ?? '',
      username: str(data.username),
      levelId,
      score: Math.max(0, Math.round(num(data.score))),
      accuracy: Math.min(1, Math.max(0, num(data.accuracy))),
      maxCombo: Math.max(0, Math.round(num(data.maxCombo))),
      at: num(data.at),
      recorded: data.recorded === true,
    };
  });
}

/** Rows with a 1-based rank attached (ties share the higher rank). */
export function rankRows(rows: readonly LeaderboardEntry[]): (LeaderboardEntry & { rank: number })[] {
  const out: (LeaderboardEntry & { rank: number })[] = [];
  rows.forEach((row, index) => {
    const previous = out[index - 1];
    const rank = previous && previous.score === row.score ? previous.rank : index + 1;
    out.push({ ...row, rank });
  });
  return out;
}

export function displayHandle(entry: { username: string | null; uid: string }): string {
  return entry.username ? `@${entry.username}` : `runner-${entry.uid.slice(0, 4)}`;
}

// ---------------------------------------------------------------------------
// Admin: consensus chart rebuild
// ---------------------------------------------------------------------------

/** Whether this uid may force a chart rebuild (`admins/{uid}` exists; owner-readable). */
export async function fetchIsAdmin(uid: string | null): Promise<boolean> {
  if (!uid) return false;
  return safely(false, async () => {
    const snapshot = await getDoc(doc(getFirebaseDb(), 'admins', uid));
    return snapshot.exists();
  });
}

export type ChartRebuildSummary = {
  levelId: string;
  status: 'not-enough-runs' | 'no-consensus' | 'unchanged' | 'published' | 'locked' | 'error';
  runs: number;
  cues: number;
  chartVersion: number | null;
  detail?: string;
};

/** Admin-only callable: rebuild every level's consensus chart now. Throws `CallableError`. */
export async function rebuildChartsNow(): Promise<ChartRebuildSummary[]> {
  const result = await callFunction<Record<string, never>, { levels: ChartRebuildSummary[] }>(
    'rebuildConsensusBeatmaps',
    {},
  );
  const levels = Array.isArray(result?.levels) ? result.levels : [];
  // Published charts should take effect on this device immediately.
  await Promise.all(
    levels.filter((entry) => entry.status === 'published').map((entry) => refreshBeatmap(entry.levelId, { force: true })),
  );
  return levels;
}

/** One line per level for the admin alert after a rebuild. */
export function describeChartRebuild(levels: ChartRebuildSummary[]): string {
  if (levels.length === 0) return 'No levels processed.';
  return levels
    .map((entry) => {
      const version = entry.chartVersion ? ` v${entry.chartVersion}` : '';
      const detail = entry.detail ? ` (${entry.detail})` : '';
      return `${entry.levelId}: ${entry.status}${version} · ${entry.runs} runs · ${entry.cues} cues${detail}`;
    })
    .join('\n');
}

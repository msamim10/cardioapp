/**
 * CardioSurf leaderboards backend (Cloud Functions for Firebase, 2nd gen).
 *
 *   startRun                     issue a single-use nonce + the current chart before a run
 *   submitRun                    verify a finished run (replay, or provisional plausibility),
 *                                place it on the boards, store its move samples
 *   rebuildConsensusBeatmaps     admin callable: rebuild every level's consensus chart now
 *   rebuildConsensusBeatmapsJob  the same, scheduled every 30 minutes
 *   reserveUsername              claim a unique handle (transactional)
 *   onUserDeleted                scrub every public trace of a deleted account
 *
 * All scoring / validation / consensus logic is imported from the
 * dependency-free shared package (`shared/scoring`) so the server replays a
 * run with EXACTLY the rules the app used. This file is Firestore plumbing.
 *
 * Collections (see docs/LEADERBOARDS.md):
 *   beatmaps/{levelId}                    published chart + `hash`, `chartVersion`, `source`
 *   beatmaps/{levelId}/versions/{v}       every published revision (audit; older runs verify against it)
 *   moveSamples/{levelId}/runs/{runId}    {uid, at, rate, samples:[{m,t}]} — consensus input
 *   runNonces/{nonce}                     {uid, levelId, beatmapHash, beatmapVersion, issuedAt, used}
 *   rateLimits/{uid}                      per-user counters (shared RateLimitState)
 *   submissions/{runId}                   accepted-run audit trail
 *   leaderboards/{levelId}/entries/{uid}  best per user per level (+ provisional, beatmapVersion)
 *   dailyLeaderboards/{dateKey}/entries/{uid} + `expiresAt` (TTL)
 *   challenges/{runId}                    public "beat my score" cards
 *   profiles/{uid}                        public profile (username is server-written)
 *   usernames/{handle}                    {uid}
 *   admins/{uid}                          presence grants the rebuild callable
 */

import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentReference,
  type Query,
} from 'firebase-admin/firestore';
import { region as v1Region } from 'firebase-functions/v1';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import {
  CANONICAL_LEVEL_IDS,
  CONSENSUS_DEFAULTS,
  EVERY_LEVEL_SCORABLE,
  MIN_SAMPLE_RUN_PLAY_S,
  PROVISIONAL_BEATMAP_HASH,
  VIDEO_LENGTH_TOLERANCE_S,
  buildConsensusBeatmap,
  checkUsernameClaim,
  consumeSampleReport,
  consumeStartRun,
  consumeSubmitRun,
  dailyChallengeLevelId,
  dailyChallengePool,
  dailyEntryExpiresAt,
  dateKeyPlausibleAt,
  isCanonicalLevelId,
  isProvisionalPayload,
  materiallyDifferent,
  nonceTimingOk,
  parseBeatmap,
  parseMoveSamples,
  parseSubmitRunPayload,
  samplesConsistent,
  serializeBeatmap,
  validateProvisionalSubmission,
  validateSubmission,
  type Beatmap,
  type ConsensusRun,
  type RateLimitState,
  type SubmissionVerdict,
  type SubmitRunPayload,
} from '../../shared/scoring';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const db = getFirestore();

/** Most recent sample runs pooled per level per rebuild. */
const MAX_RUNS_PER_REBUILD = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to use leaderboards.');
  return uid;
}

/** Owner / admin: a custom claim, or presence of `admins/{uid}` (Function-only doc). */
async function requireAdmin(request: CallableRequest<unknown>): Promise<string> {
  const uid = requireUid(request);
  if (request.auth?.token?.admin === true) return uid;
  const snapshot = await db.doc(`admins/${uid}`).get();
  if (!snapshot.exists) throw new HttpsError('permission-denied', 'admin-only');
  return uid;
}

type PublishedBeatmap = {
  beatmap: Beatmap;
  hash: string;
  chartVersion: number;
  runCount: number;
  source: string;
};

function readPublished(levelId: string, data: Record<string, unknown> | undefined): PublishedBeatmap | null {
  if (!data || data.published !== true || typeof data.hash !== 'string') return null;
  const beatmap = parseBeatmap(data);
  if (!beatmap || beatmap.levelId !== levelId) return null;
  const version = typeof data.chartVersion === 'number' && data.chartVersion >= 1 ? Math.floor(data.chartVersion) : 1;
  return {
    beatmap,
    hash: data.hash,
    chartVersion: version,
    runCount: typeof data.runCount === 'number' ? data.runCount : 0,
    source: typeof data.source === 'string' ? data.source : 'manual',
  };
}

/** The server's current chart for a level, or null when none is published. */
async function loadPublishedBeatmap(levelId: string): Promise<PublishedBeatmap | null> {
  if (!isCanonicalLevelId(levelId)) return null;
  const snapshot = await db.doc(`beatmaps/${levelId}`).get();
  return snapshot.exists ? readPublished(levelId, snapshot.data()) : null;
}

/** An archived revision (`beatmaps/{levelId}/versions/{v}`), for runs started before a rebuild. */
async function loadBeatmapVersion(levelId: string, chartVersion: number): Promise<PublishedBeatmap | null> {
  if (!isCanonicalLevelId(levelId) || !Number.isInteger(chartVersion) || chartVersion < 1) return null;
  const snapshot = await db.doc(`beatmaps/${levelId}/versions/${chartVersion}`).get();
  return snapshot.exists ? readPublished(levelId, snapshot.data()) : null;
}

/** Wire shape of a chart handed to the client by `startRun`. */
function chartPayload(published: PublishedBeatmap): Record<string, unknown> {
  return {
    ...JSON.parse(serializeBeatmap(published.beatmap)),
    hash: published.hash,
    chartVersion: published.chartVersion,
    runCount: published.runCount,
    source: published.source,
  };
}

function readRateLimit(value: unknown): RateLimitState | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return {
    dayKey: typeof v.dayKey === 'string' ? v.dayKey : '',
    startCount: num(v.startCount),
    submitCount: num(v.submitCount),
    lastAcceptedAt: num(v.lastAcceptedAt),
    lastAcceptedElapsed: num(v.lastAcceptedElapsed),
    sampleCount: num(v.sampleCount),
  };
}

type PublicProfile = {
  username: string | null;
  photoURL: string | null;
  level: number;
};

function readProfile(value: unknown): PublicProfile {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    username: typeof v.username === 'string' && v.username ? v.username : null,
    photoURL: typeof v.photoURL === 'string' && v.photoURL ? v.photoURL : null,
    level: typeof v.level === 'number' && Number.isFinite(v.level) ? Math.max(1, Math.floor(v.level)) : 1,
  };
}

async function deleteQuery(query: Query, batchSize = 400): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snapshot = await query.limit(batchSize).get();
    if (snapshot.empty) return deleted;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < batchSize) return deleted;
  }
}

/** Rank = 1 + number of entries strictly above `score`, via count() aggregation. */
async function rankFor(entries: Query, score: number): Promise<number> {
  const above = await entries.where('score', '>', score).count().get();
  return above.data().count + 1;
}

// ---------------------------------------------------------------------------
// startRun
// ---------------------------------------------------------------------------

type StartRunInput = { levelId?: unknown; beatmapHash?: unknown };
type StartRunResult = {
  nonce: string;
  issuedAt: number;
  /** Hash of the chart this run must be scored against; PROVISIONAL_BEATMAP_HASH when none. */
  beatmapHash: string;
  /** 0 when the level has no published chart (provisional run). */
  beatmapVersion: number;
  /** The chart itself (format of `beatmaps/{levelId}`), or null. */
  beatmap: Record<string, unknown> | null;
};

export const startRun = onCall<StartRunInput>(async (request): Promise<StartRunResult> => {
  const uid = requireUid(request);
  const { levelId } = request.data ?? {};
  if (typeof levelId !== 'string' || !isCanonicalLevelId(levelId)) {
    throw new HttpsError('invalid-argument', 'levelId is required.');
  }
  // The server's chart is the truth for this run: the client adopts whatever
  // comes back (or scores provisionally when nothing is published yet).
  const published = await loadPublishedBeatmap(levelId);
  const beatmapHash = published?.hash ?? PROVISIONAL_BEATMAP_HASH;
  const beatmapVersion = published?.chartVersion ?? 0;

  const now = Date.now();
  const nonce = randomUUID();
  const limitRef = db.doc(`rateLimits/${uid}`);
  await db.runTransaction(async (tx) => {
    const limitSnap = await tx.get(limitRef);
    const { allowed, next } = consumeStartRun(readRateLimit(limitSnap.data()), now);
    if (!allowed) throw new HttpsError('resource-exhausted', 'start-limit');
    tx.set(limitRef, next, { merge: true });
    tx.set(db.doc(`runNonces/${nonce}`), {
      uid,
      levelId,
      beatmapHash,
      beatmapVersion,
      issuedAt: now,
      used: false,
    });
  });
  return {
    nonce,
    issuedAt: now,
    beatmapHash,
    beatmapVersion,
    beatmap: published ? chartPayload(published) : null,
  };
});

// ---------------------------------------------------------------------------
// submitRun
// ---------------------------------------------------------------------------

type SubmitRunResult =
  | {
      accepted: true;
      rank: number;
      dailyRank: number | null;
      improved: boolean;
      best: number;
      provisional: boolean;
      beatmapVersion: number;
    }
  | { accepted: false; reason: string; detail?: string };

function entryDoc(
  uid: string,
  payload: SubmitRunPayload,
  profile: PublicProfile,
  now: number,
  provisional: boolean,
): Record<string, unknown> {
  return {
    uid,
    score: payload.score,
    accuracy: payload.accuracy,
    maxCombo: payload.maxCombo,
    at: now,
    recorded: payload.recorded,
    runId: payload.runId,
    username: profile.username,
    photoURL: profile.photoURL,
    classKey: payload.classKey,
    level: profile.level,
    playbackRate: payload.playbackRate,
    elapsedSeconds: payload.elapsedSeconds,
    provisional,
    beatmapVersion: provisional ? 0 : payload.beatmapVersion,
    beatmapHash: payload.beatmapHash,
  };
}

export const submitRun = onCall<unknown>(async (request): Promise<SubmitRunResult> => {
  const uid = requireUid(request);
  const parsed = parseSubmitRunPayload(request.data);
  if (!parsed.ok) throw new HttpsError('invalid-argument', `bad-payload: ${parsed.reason}`);
  const payload = parsed.payload;
  if (!isCanonicalLevelId(payload.levelId)) return { accepted: false, reason: 'level-mismatch' };

  // Which chart (if any) the run claims. A run started before a rebuild
  // carries the previous revision's hash: verify it against that archived
  // revision rather than rejecting the player for a chart change mid-run.
  const provisional = isProvisionalPayload(payload);
  let verdict: SubmissionVerdict;
  if (provisional) {
    verdict = validateProvisionalSubmission(payload);
  } else {
    const current = await loadPublishedBeatmap(payload.levelId);
    const chart =
      current && current.hash === payload.beatmapHash
        ? current
        : await loadBeatmapVersion(payload.levelId, payload.beatmapVersion);
    if (!chart || chart.hash !== payload.beatmapHash) {
      logger.info('submitRun rejected', { uid, runId: payload.runId, code: 'hash-mismatch' });
      return { accepted: false, reason: 'hash-mismatch' };
    }
    verdict = validateSubmission(payload, chart.beatmap, chart.hash);
  }
  if (!verdict.ok) {
    logger.info('submitRun rejected', { uid, runId: payload.runId, code: verdict.code, detail: verdict.detail });
    return { accepted: false, reason: verdict.code, detail: verdict.detail };
  }

  const now = Date.now();
  // Daily challenge: same deterministic pick the client shows, over every
  // level (all are scorable now). The client's local date key is only
  // trusted inside that date's global span (+ submit slack).
  const { pool } = dailyChallengePool(EVERY_LEVEL_SCORABLE, CANONICAL_LEVEL_IDS);
  const dailyLevelId = dailyChallengeLevelId(payload.dateKey, pool);
  const dailyEligible = dailyLevelId === payload.levelId && dateKeyPlausibleAt(payload.dateKey, now);

  // Consensus input: only runs with enough natural playback and a sample list
  // consistent with the move tally. Verified runs with odd samples still
  // post (the replay is the evidence); their samples are simply not stored.
  const storeSamples =
    payload.samples.length > 0 && payload.naturalPlaySec >= MIN_SAMPLE_RUN_PLAY_S && samplesConsistent(payload);
  const sampleDoc = storeSamples
    ? {
        uid,
        at: now,
        rate: payload.playbackRate,
        intensity: payload.intensity,
        durationTarget: payload.targetSeconds,
        naturalPlaySec: payload.naturalPlaySec,
        videoLengthSec: payload.videoLengthSec,
        provisional,
        beatmapVersion: provisional ? 0 : payload.beatmapVersion,
        appVersion: payload.appVersion,
        samples: payload.samples,
      }
    : null;

  const nonceRef = db.doc(`runNonces/${payload.nonce}`);
  const submissionRef = db.doc(`submissions/${payload.runId}`);
  const limitRef = db.doc(`rateLimits/${uid}`);
  const profileRef = db.doc(`profiles/${uid}`);
  const entryRef = db.doc(`leaderboards/${payload.levelId}/entries/${uid}`);
  const dailyRef = db.doc(`dailyLeaderboards/${payload.dateKey}/entries/${uid}`);
  const challengeRef = db.doc(`challenges/${payload.runId}`);
  const sampleRef = db.doc(`moveSamples/${payload.levelId}/runs/${payload.runId}`);

  // Mutable holder: TypeScript does not track assignments made inside the
  // transaction closure on plain `let` bindings.
  const outcome: {
    rejection: SubmitRunResult | null;
    best: number;
    improved: boolean;
    dailyBest: number;
    samplesStored: boolean;
  } = { rejection: null, best: payload.score, improved: false, dailyBest: payload.score, samplesStored: false };

  await db.runTransaction(async (tx) => {
    const [nonceSnap, submissionSnap, limitSnap, profileSnap, entrySnap, dailySnap] = await Promise.all([
      tx.get(nonceRef),
      tx.get(submissionRef),
      tx.get(limitRef),
      tx.get(profileRef),
      tx.get(entryRef),
      dailyEligible ? tx.get(dailyRef) : Promise.resolve(null),
    ]);

    const nonce = nonceSnap.data();
    if (!nonceSnap.exists || !nonce) {
      outcome.rejection = { accepted: false, reason: 'nonce-unknown' };
      return;
    }
    if (nonce.used === true) {
      outcome.rejection = { accepted: false, reason: 'nonce-used' };
      return;
    }
    // The nonce pins the chart the server handed out at run start. A
    // provisional run is only accepted when the server itself had no chart
    // then — a client cannot opt into free scoring on a charted level.
    if (nonce.uid !== uid || nonce.levelId !== payload.levelId || nonce.beatmapHash !== payload.beatmapHash) {
      outcome.rejection = { accepted: false, reason: 'nonce-mismatch' };
      return;
    }
    if (!nonceTimingOk({ issuedAtMs: Number(nonce.issuedAt), serverNowMs: now, elapsedSeconds: payload.elapsedSeconds })) {
      outcome.rejection = { accepted: false, reason: 'nonce-timing' };
      return;
    }
    if (submissionSnap.exists) {
      outcome.rejection = { accepted: false, reason: 'duplicate-run' };
      return;
    }
    const limitState = readRateLimit(limitSnap.data());
    const limit = consumeSubmitRun(limitState, now, payload.elapsedSeconds);
    if (!limit.allowed) {
      // The board budget is spent, but the run was real: keep its samples
      // (own budget) so the chart still learns from it.
      if (sampleDoc) {
        const sampleBudget = consumeSampleReport(limit.next, now);
        if (sampleBudget.allowed) {
          tx.set(limitRef, sampleBudget.next, { merge: true });
          tx.set(sampleRef, sampleDoc);
          outcome.samplesStored = true;
        }
      }
      outcome.rejection = { accepted: false, reason: limit.reason ?? 'rate-limit' };
      return;
    }
    let nextLimit = limit.next;
    if (sampleDoc) {
      const sampleBudget = consumeSampleReport(nextLimit, now);
      if (sampleBudget.allowed) {
        nextLimit = sampleBudget.next;
        tx.set(sampleRef, sampleDoc);
        outcome.samplesStored = true;
      }
    }

    const profile = readProfile(profileSnap.data());
    const existing = entrySnap.exists ? Number(entrySnap.data()?.score ?? 0) : null;
    outcome.improved = existing === null || payload.score > existing;
    outcome.best = existing === null ? payload.score : Math.max(existing, payload.score);

    tx.update(nonceRef, { used: true, usedAt: now, runId: payload.runId });
    tx.set(limitRef, nextLimit, { merge: true });
    tx.set(submissionRef, {
      uid,
      levelId: payload.levelId,
      beatmapHash: payload.beatmapHash,
      beatmapVersion: provisional ? 0 : payload.beatmapVersion,
      provisional,
      classKey: payload.classKey,
      intensity: payload.intensity,
      playbackRate: payload.playbackRate,
      targetSeconds: payload.targetSeconds,
      elapsedSeconds: payload.elapsedSeconds,
      naturalPlaySec: payload.naturalPlaySec,
      videoLengthSec: payload.videoLengthSec,
      nonce: payload.nonce,
      cues: payload.cues,
      spurious: payload.spurious,
      moveCount: payload.moveCount,
      sampleCount: payload.samples.length,
      score: payload.score,
      maxCombo: payload.maxCombo,
      accuracy: payload.accuracy,
      recorded: payload.recorded,
      appVersion: payload.appVersion,
      dateKey: payload.dateKey,
      totals: verdict.totals,
      dailyEligible,
      acceptedAt: now,
    });
    const entry = entryDoc(uid, payload, profile, now, provisional);
    if (outcome.improved) tx.set(entryRef, entry);
    if (dailyEligible) {
      const existingDaily = dailySnap?.exists ? Number(dailySnap.data()?.score ?? 0) : null;
      const dailyImproved = existingDaily === null || payload.score > existingDaily;
      outcome.dailyBest = existingDaily === null ? payload.score : Math.max(existingDaily, payload.score);
      if (dailyImproved) {
        tx.set(dailyRef, {
          ...entry,
          levelId: payload.levelId,
          dateKey: payload.dateKey,
          expiresAt: Timestamp.fromMillis(dailyEntryExpiresAt(payload.dateKey)),
        });
      }
    }
    tx.set(challengeRef, {
      uid,
      username: profile.username,
      levelId: payload.levelId,
      score: payload.score,
      accuracy: payload.accuracy,
      maxCombo: payload.maxCombo,
      at: now,
      recorded: payload.recorded,
      provisional,
    });
  });

  if (outcome.rejection) {
    const rejected = outcome.rejection;
    logger.info('submitRun rejected', {
      uid,
      runId: payload.runId,
      reason: rejected.accepted ? '' : rejected.reason,
      samplesStored: outcome.samplesStored,
    });
    return rejected;
  }

  const rank = await rankFor(db.collection(`leaderboards/${payload.levelId}/entries`), outcome.best);
  const dailyRank = dailyEligible
    ? await rankFor(db.collection(`dailyLeaderboards/${payload.dateKey}/entries`), outcome.dailyBest)
    : null;
  logger.info('submitRun accepted', {
    uid,
    runId: payload.runId,
    score: payload.score,
    rank,
    dailyRank,
    provisional,
    samplesStored: outcome.samplesStored,
  });
  return {
    accepted: true,
    rank,
    dailyRank,
    improved: outcome.improved,
    best: outcome.best,
    provisional,
    beatmapVersion: provisional ? 0 : payload.beatmapVersion,
  };
});

// ---------------------------------------------------------------------------
// Consensus beatmaps
// ---------------------------------------------------------------------------

type RebuildStatus =
  | 'not-enough-runs'
  | 'no-consensus'
  | 'unchanged'
  | 'published'
  | 'locked'
  | 'error';

type RebuildSummary = {
  levelId: string;
  status: RebuildStatus;
  runs: number;
  cues: number;
  chartVersion: number | null;
  detail?: string;
};

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Rebuild one level's chart from its stored sample runs. Publishes a new
 * `chartVersion` only when the chart changed materially; archives every
 * published revision under `versions/{v}`. A `locked: true` doc (hand-tuned
 * chart) is never overwritten.
 */
async function rebuildConsensusForLevel(levelId: string, now: number): Promise<RebuildSummary> {
  const base: RebuildSummary = { levelId, status: 'not-enough-runs', runs: 0, cues: 0, chartVersion: null };
  const runsSnap = await db
    .collection(`moveSamples/${levelId}/runs`)
    .orderBy('at', 'desc')
    .limit(MAX_RUNS_PER_REBUILD)
    .get();
  const lengths: number[] = [];
  const raw: { length: number; run: ConsensusRun }[] = [];
  for (const doc of runsSnap.docs) {
    const data = doc.data();
    const length = typeof data.videoLengthSec === 'number' && data.videoLengthSec > 0 ? data.videoLengthSec : null;
    if (length === null) continue;
    const samples = parseMoveSamples(data.samples, length + 1);
    if (!samples || samples.length === 0) continue;
    lengths.push(length);
    raw.push({ length, run: { samples } });
  }
  if (raw.length === 0) return base;
  // The vertical cut is the timeline; runs on a different cut (AirPlay
  // horizontal source) would smear the histogram, so keep the majority length.
  const videoDurationSec = median(lengths);
  const runs = raw
    .filter((entry) => Math.abs(entry.length - videoDurationSec) <= VIDEO_LENGTH_TOLERANCE_S)
    .map((entry) => entry.run);
  base.runs = runs.length;
  if (runs.length < CONSENSUS_DEFAULTS.minRuns) return base;

  const currentRef = db.doc(`beatmaps/${levelId}`);
  const currentSnap = await currentRef.get();
  const currentData = currentSnap.exists ? currentSnap.data() ?? {} : null;
  if (currentData?.locked === true) {
    return { ...base, status: 'locked', chartVersion: Number(currentData.chartVersion ?? 1) };
  }
  const current = currentData ? readPublished(levelId, currentData) : null;

  const result = buildConsensusBeatmap({ levelId, videoDurationSec, runs });
  if (!result) {
    return { ...base, status: 'no-consensus', chartVersion: current?.chartVersion ?? null };
  }
  base.cues = result.cues.length;
  if (current && !materiallyDifferent(current.beatmap.cues, result.beatmap.cues)) {
    // Cheap bookkeeping only: no version churn for a chart that did not move.
    await currentRef.set({ runCount: result.runCount, checkedAt: now }, { merge: true });
    return { ...base, status: 'unchanged', chartVersion: current.chartVersion };
  }

  const chartVersion = (current?.chartVersion ?? Number(currentData?.chartVersion ?? 0)) + 1;
  const doc = {
    ...JSON.parse(serializeBeatmap(result.beatmap)),
    hash: result.hash,
    published: true,
    source: 'consensus',
    chartVersion,
    runCount: result.runCount,
    requiredSupport: result.requiredSupport,
    confidence: result.cues.map((cue) => cue.confidence),
    generatedAt: now,
    checkedAt: now,
    publishedAt: now,
  };
  const batch = db.batch();
  batch.set(currentRef, doc);
  batch.set(db.doc(`beatmaps/${levelId}/versions/${chartVersion}`), doc);
  await batch.commit();
  return { ...base, status: 'published', chartVersion };
}

async function rebuildAllConsensusBeatmaps(trigger: string): Promise<RebuildSummary[]> {
  const now = Date.now();
  const summaries: RebuildSummary[] = [];
  for (const levelId of CANONICAL_LEVEL_IDS) {
    try {
      summaries.push(await rebuildConsensusForLevel(levelId, now));
    } catch (error) {
      logger.error('consensus rebuild failed', { levelId, error: String(error) });
      summaries.push({ levelId, status: 'error', runs: 0, cues: 0, chartVersion: null, detail: String(error) });
    }
  }
  logger.info('consensus rebuild', {
    trigger,
    published: summaries.filter((s) => s.status === 'published').map((s) => s.levelId),
    summary: summaries.map((s) => `${s.levelId}:${s.status}:${s.runs}r/${s.cues}c/v${s.chartVersion ?? 0}`),
  });
  return summaries;
}

/** Admin-only: rebuild every level's chart now (dev screen / owner). */
export const rebuildConsensusBeatmaps = onCall<unknown>(
  { timeoutSeconds: 300, memory: '512MiB' },
  async (request): Promise<{ levels: RebuildSummary[]; at: number }> => {
    const uid = await requireAdmin(request);
    const levels = await rebuildAllConsensusBeatmaps(`callable:${uid}`);
    return { levels, at: Date.now() };
  },
);

/** Scheduled: every 30 minutes, same rebuild. */
export const rebuildConsensusBeatmapsJob = onSchedule(
  { schedule: 'every 30 minutes', timeoutSeconds: 300, memory: '512MiB', retryCount: 0 },
  async () => {
    await rebuildAllConsensusBeatmaps('schedule');
  },
);

// ---------------------------------------------------------------------------
// reserveUsername
// ---------------------------------------------------------------------------

type ReserveUsernameInput = { handle?: unknown };
type ReserveUsernameResult = { ok: true; handle: string } | { ok: false; reason: 'taken' | 'invalid'; message: string };

export const reserveUsername = onCall<ReserveUsernameInput>(async (request): Promise<ReserveUsernameResult> => {
  const uid = requireUid(request);
  const claim = checkUsernameClaim(request.data?.handle);
  if (!claim.ok) return { ok: false, reason: 'invalid', message: claim.reason };
  const handle = claim.handle;

  const handleRef = db.doc(`usernames/${handle}`);
  const profileRef = db.doc(`profiles/${uid}`);
  let previous: string | null = null;
  let taken = false;

  await db.runTransaction(async (tx) => {
    const [handleSnap, profileSnap] = await Promise.all([tx.get(handleRef), tx.get(profileRef)]);
    const owner = handleSnap.exists ? handleSnap.data()?.uid : null;
    if (owner && owner !== uid) {
      taken = true;
      return;
    }
    previous = readProfile(profileSnap.data()).username;
    let previousRef: DocumentReference | null = null;
    if (previous && previous !== handle) {
      previousRef = db.doc(`usernames/${previous}`);
      const previousSnap = await tx.get(previousRef);
      if (previousSnap.exists && previousSnap.data()?.uid !== uid) previousRef = null;
    }
    if (previousRef) tx.delete(previousRef);
    tx.set(handleRef, { uid, reservedAt: FieldValue.serverTimestamp() });
    tx.set(profileRef, { username: handle, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  if (taken) return { ok: false, reason: 'taken', message: 'That handle is already taken.' };

  // Best-effort: refresh the snapshot handle on this user's public rows.
  if (previous !== handle) {
    try {
      const [entries, challenges] = await Promise.all([
        db.collectionGroup('entries').where('uid', '==', uid).limit(400).get(),
        db.collection('challenges').where('uid', '==', uid).limit(400).get(),
      ]);
      const batch = db.batch();
      entries.docs.forEach((doc) => batch.update(doc.ref, { username: handle }));
      challenges.docs.forEach((doc) => batch.update(doc.ref, { username: handle }));
      await batch.commit();
    } catch (error) {
      logger.warn('reserveUsername fan-out failed', { uid, error: String(error) });
    }
  }
  return { ok: true, handle };
});

// ---------------------------------------------------------------------------
// onUserDeleted (Auth trigger — 1st gen API; there is no 2nd-gen onDelete)
// ---------------------------------------------------------------------------

export const onUserDeleted = v1Region('us-central1')
  .auth.user()
  .onDelete(async (user) => {
    const uid = user.uid;
    let samples = 0;
    for (const levelId of CANONICAL_LEVEL_IDS) {
      samples += await deleteQuery(db.collection(`moveSamples/${levelId}/runs`).where('uid', '==', uid));
    }
    const counts = {
      entries: await deleteQuery(db.collectionGroup('entries').where('uid', '==', uid)),
      challenges: await deleteQuery(db.collection('challenges').where('uid', '==', uid)),
      usernames: await deleteQuery(db.collection('usernames').where('uid', '==', uid)),
      nonces: await deleteQuery(db.collection('runNonces').where('uid', '==', uid)),
      samples,
    };
    await Promise.all([
      db.doc(`profiles/${uid}`).delete(),
      db.doc(`rateLimits/${uid}`).delete(),
      db.doc(`admins/${uid}`).delete(),
      // The client already removed what it could; sweep the rest of the
      // subtree (following/, any stragglers) with admin privileges.
      db.recursiveDelete(db.doc(`users/${uid}`)),
    ]);
    logger.info('onUserDeleted scrubbed', { uid, ...counts });
  });

export * from './seed';

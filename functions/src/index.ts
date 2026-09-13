/**
 * CardioSurf leaderboards backend (Cloud Functions for Firebase, 2nd gen).
 *
 *   startRun        issue a single-use nonce before a cued run begins
 *   submitRun       verify a finished run and place it on the boards
 *   reserveUsername claim a unique handle (transactional)
 *   onUserDeleted   scrub every public trace of a deleted account
 *
 * All scoring / validation logic is imported from the dependency-free shared
 * package (`shared/scoring`) so the server replays a run with EXACTLY the
 * rules the app used. This file is Firestore plumbing only.
 *
 * Collections (see docs/LEADERBOARDS.md):
 *   beatmaps/{levelId}                    published chart + `hash`
 *   runNonces/{nonce}                     {uid, levelId, beatmapHash, issuedAt, used}
 *   rateLimits/{uid}                      per-user counters (shared RateLimitState)
 *   submissions/{runId}                   accepted-run audit trail
 *   leaderboards/{levelId}/entries/{uid}  best per user per level
 *   dailyLeaderboards/{dateKey}/entries/{uid} + `expiresAt` (TTL)
 *   challenges/{runId}                    public "beat my score" cards
 *   profiles/{uid}                        public profile (username is server-written)
 *   usernames/{handle}                    {uid}
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
import { logger } from 'firebase-functions';
import {
  CANONICAL_LEVEL_IDS,
  checkUsernameClaim,
  consumeStartRun,
  consumeSubmitRun,
  dailyChallengeLevelId,
  dailyChallengePool,
  dailyEntryExpiresAt,
  dateKeyPlausibleAt,
  isCanonicalLevelId,
  nonceTimingOk,
  parseBeatmap,
  parseSubmitRunPayload,
  validateSubmission,
  type Beatmap,
  type RateLimitState,
  type SubmitRunPayload,
} from '../../shared/scoring';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const db = getFirestore();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to use leaderboards.');
  return uid;
}

type PublishedBeatmap = { beatmap: Beatmap; hash: string };

/** The server's copy of a level's chart, or null when none is published. */
async function loadPublishedBeatmap(levelId: string): Promise<PublishedBeatmap | null> {
  if (!isCanonicalLevelId(levelId)) return null;
  const snapshot = await db.doc(`beatmaps/${levelId}`).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  if (data.published !== true || typeof data.hash !== 'string') return null;
  const beatmap = parseBeatmap(data);
  if (!beatmap || beatmap.levelId !== levelId) return null;
  return { beatmap, hash: data.hash };
}

/** Ids of every published chart, for the daily-challenge pool. */
async function publishedLevelIds(): Promise<Set<string>> {
  const snapshot = await db.collection('beatmaps').where('published', '==', true).select().get();
  return new Set(snapshot.docs.map((doc) => doc.id));
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

export const startRun = onCall<StartRunInput>(async (request) => {
  const uid = requireUid(request);
  const { levelId, beatmapHash } = request.data ?? {};
  if (typeof levelId !== 'string' || typeof beatmapHash !== 'string' || !levelId || !beatmapHash) {
    throw new HttpsError('invalid-argument', 'levelId and beatmapHash are required.');
  }
  const published = await loadPublishedBeatmap(levelId);
  if (!published) throw new HttpsError('failed-precondition', 'no-beatmap');
  if (published.hash !== beatmapHash) throw new HttpsError('failed-precondition', 'hash-mismatch');

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
      issuedAt: now,
      used: false,
    });
  });
  return { nonce, issuedAt: now };
});

// ---------------------------------------------------------------------------
// submitRun
// ---------------------------------------------------------------------------

type SubmitRunResult =
  | { accepted: true; rank: number; dailyRank: number | null; improved: boolean; best: number }
  | { accepted: false; reason: string; detail?: string };

function entryDoc(
  uid: string,
  payload: SubmitRunPayload,
  profile: PublicProfile,
  now: number,
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
  };
}

export const submitRun = onCall<unknown>(async (request): Promise<SubmitRunResult> => {
  const uid = requireUid(request);
  const parsed = parseSubmitRunPayload(request.data);
  if (!parsed.ok) throw new HttpsError('invalid-argument', `bad-payload: ${parsed.reason}`);
  const payload = parsed.payload;

  const published = await loadPublishedBeatmap(payload.levelId);
  if (!published) return { accepted: false, reason: 'no-beatmap' };

  const verdict = validateSubmission(payload, published.beatmap, published.hash);
  if (!verdict.ok) {
    logger.info('submitRun rejected', { uid, runId: payload.runId, code: verdict.code, detail: verdict.detail });
    return { accepted: false, reason: verdict.code, detail: verdict.detail };
  }

  const now = Date.now();
  // Daily challenge: same deterministic pick the client shows, over the set
  // of PUBLISHED charts in canonical order. The client's local date key is
  // only trusted inside that date's global span (+ submit slack).
  const publishedIds = await publishedLevelIds();
  const { pool } = dailyChallengePool((id) => publishedIds.has(id), CANONICAL_LEVEL_IDS);
  const dailyLevelId = dailyChallengeLevelId(payload.dateKey, pool);
  const dailyEligible = dailyLevelId === payload.levelId && dateKeyPlausibleAt(payload.dateKey, now);

  const nonceRef = db.doc(`runNonces/${payload.nonce}`);
  const submissionRef = db.doc(`submissions/${payload.runId}`);
  const limitRef = db.doc(`rateLimits/${uid}`);
  const profileRef = db.doc(`profiles/${uid}`);
  const entryRef = db.doc(`leaderboards/${payload.levelId}/entries/${uid}`);
  const dailyRef = db.doc(`dailyLeaderboards/${payload.dateKey}/entries/${uid}`);
  const challengeRef = db.doc(`challenges/${payload.runId}`);

  // Mutable holder: TypeScript does not track assignments made inside the
  // transaction closure on plain `let` bindings.
  const outcome: {
    rejection: SubmitRunResult | null;
    best: number;
    improved: boolean;
    dailyBest: number;
  } = { rejection: null, best: payload.score, improved: false, dailyBest: payload.score };

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
    const limit = consumeSubmitRun(readRateLimit(limitSnap.data()), now, payload.elapsedSeconds);
    if (!limit.allowed) {
      outcome.rejection = { accepted: false, reason: limit.reason ?? 'rate-limit' };
      return;
    }

    const profile = readProfile(profileSnap.data());
    const existing = entrySnap.exists ? Number(entrySnap.data()?.score ?? 0) : null;
    outcome.improved = existing === null || payload.score > existing;
    outcome.best = existing === null ? payload.score : Math.max(existing, payload.score);

    tx.update(nonceRef, { used: true, usedAt: now, runId: payload.runId });
    tx.set(limitRef, limit.next, { merge: true });
    tx.set(submissionRef, {
      uid,
      levelId: payload.levelId,
      beatmapHash: payload.beatmapHash,
      classKey: payload.classKey,
      playbackRate: payload.playbackRate,
      targetSeconds: payload.targetSeconds,
      elapsedSeconds: payload.elapsedSeconds,
      videoLengthSec: payload.videoLengthSec,
      nonce: payload.nonce,
      cues: payload.cues,
      spurious: payload.spurious,
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
    const entry = entryDoc(uid, payload, profile, now);
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
    });
  });

  if (outcome.rejection) {
    const rejected = outcome.rejection;
    logger.info('submitRun rejected', { uid, runId: payload.runId, reason: rejected.accepted ? '' : rejected.reason });
    return rejected;
  }

  const rank = await rankFor(db.collection(`leaderboards/${payload.levelId}/entries`), outcome.best);
  const dailyRank = dailyEligible
    ? await rankFor(db.collection(`dailyLeaderboards/${payload.dateKey}/entries`), outcome.dailyBest)
    : null;
  logger.info('submitRun accepted', { uid, runId: payload.runId, score: payload.score, rank, dailyRank });
  return { accepted: true, rank, dailyRank, improved: outcome.improved, best: outcome.best };
});

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
    const counts = {
      entries: await deleteQuery(db.collectionGroup('entries').where('uid', '==', uid)),
      challenges: await deleteQuery(db.collection('challenges').where('uid', '==', uid)),
      usernames: await deleteQuery(db.collection('usernames').where('uid', '==', uid)),
      nonces: await deleteQuery(db.collection('runNonces').where('uid', '==', uid)),
    };
    await Promise.all([
      db.doc(`profiles/${uid}`).delete(),
      db.doc(`rateLimits/${uid}`).delete(),
      // The client already removed what it could; sweep the rest of the
      // subtree (following/, any stragglers) with admin privileges.
      db.recursiveDelete(db.doc(`users/${uid}`)),
    ]);
    logger.info('onUserDeleted scrubbed', { uid, ...counts });
  });

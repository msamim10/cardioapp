/**
 * Ghost runners — launch-time leaderboard seeding (see docs/LEADERBOARDS.md →
 * "Ghost runners").
 *
 *   reconcileGhosts     v2 onSchedule, hourly: bring every board to its target
 *   reconcileGhostsNow  admin callable: same, on demand (+ dry run / overrides)
 *
 * Ghosts are ORDINARY entry documents (`leaderboards/{levelId}/entries/{uid}`,
 * `dailyLeaderboards/{dateKey}/entries/{uid}`) plus `profiles/{uid}` and a
 * `usernames/{handle}` reservation, all tagged `ghost: true` and keyed by a
 * `ghost_…` uid. The client renders them like any other row and `count()`
 * based runner counts include them. All content comes from the deterministic
 * generator in `shared/scoring/ghosts.ts`; this file is Firestore plumbing.
 *
 * Per board: realCount = count(all) − count(ghost == true);
 *            target    = clamp(TARGET − realCount, 0, TARGET);
 *            keep the `target` highest-scoring ghosts of the fixed set, so
 *            ghosts leave from the BOTTOM as real players arrive.
 *
 * Invariants: only documents whose id starts with `ghost_` AND carry
 * `ghost: true` are ever written or deleted; real players' docs are never
 * touched. Idempotent; batches ≤ 400 writes per commit.
 *
 * Admin: `admin` custom claim, an `admins/{uid}` document, or the
 * `ADMIN_UIDS` param (comma-separated Auth uids; functions/.env, gitignored).
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type WriteBatch,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineString } from 'firebase-functions/params';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  CANONICAL_LEVEL_IDS,
  dailyChallengeLevelId,
  dailyChallengePool,
  dailyEntryExpiresAt,
  dateKeyToUtcMidnight,
  parseBeatmap,
} from '../../shared/scoring';
import {
  activeDailyKeys,
  chartCuesPerMin,
  dailyBoardFingerprint,
  defaultCuesPerMin,
  generateDailyGhosts,
  generateLevelGhosts,
  GHOST_DAILY_TARGET,
  GHOST_STALE_AT_DAYS,
  GHOST_TARGET_TOTAL,
  ghostChartFields,
  ghostDailyUid,
  ghostEntryFields,
  ghostProfileFields,
  ghostTarget,
  isGhostUid,
  levelBoardFingerprint,
  staleDailyKeys,
  type GhostChartRef,
  type GhostRunner,
} from '../../shared/scoring/ghosts';

/** Comma-separated Firebase Auth uids allowed to call `reconcileGhostsNow`. */
const ADMIN_UIDS = defineString('ADMIN_UIDS', {
  default: '',
  description: 'Comma-separated Firebase Auth uids allowed to call admin callables (reconcileGhostsNow).',
});

const MAX_BATCH = 400;
/** Deterministic daily uids to sweep per stale day (≥ any plausible GHOST_DAILY_TARGET). */
const DAILY_SWEEP_SLOTS = 16;

function firestore(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

// ---------------------------------------------------------------------------
// Batched writer (≤ 400 ops per commit; counts instead of writing on dry run)
// ---------------------------------------------------------------------------

class BatchWriter {
  private batch: WriteBatch | null = null;
  private ops = 0;
  writes = 0;
  deletes = 0;

  constructor(
    private readonly db: Firestore,
    readonly dryRun: boolean,
  ) {}

  async set(ref: DocumentReference, data: Record<string, unknown>, merge = false): Promise<void> {
    this.writes += 1;
    await this.op((batch) => (merge ? batch.set(ref, data, { merge: true }) : batch.set(ref, data)));
  }

  async delete(ref: DocumentReference): Promise<void> {
    this.deletes += 1;
    await this.op((batch) => batch.delete(ref));
  }

  private async op(apply: (batch: WriteBatch) => void): Promise<void> {
    if (this.dryRun) return;
    if (!this.batch) this.batch = this.db.batch();
    apply(this.batch);
    this.ops += 1;
    if (this.ops >= MAX_BATCH) await this.flush();
  }

  async flush(): Promise<void> {
    if (!this.batch || this.ops === 0) return;
    const batch = this.batch;
    this.batch = null;
    this.ops = 0;
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// Ghost document helpers
// ---------------------------------------------------------------------------

/** Only ever touch a document that is unmistakably a ghost's. */
function isGhostDoc(snapshot: DocumentSnapshot): boolean {
  return isGhostUid(snapshot.id) && snapshot.data()?.ghost === true;
}

/**
 * Handle to write for a ghost: its current one when it still owns the
 * reservation, else the first candidate that is free (or already its own).
 * Returns null when a real player holds every candidate (practically never).
 */
async function resolveHandle(
  db: Firestore,
  ghost: GhostRunner,
  current: unknown,
): Promise<string | null> {
  const candidates = Array.from(
    new Set([...(typeof current === 'string' && current ? [current] : []), ...ghost.handleCandidates]),
  );
  const snapshots = await db.getAll(...candidates.map((handle) => db.doc(`usernames/${handle}`)));
  for (const [index, snapshot] of snapshots.entries()) {
    const owner = snapshot.exists ? snapshot.data()?.uid : null;
    if (!snapshot.exists || owner === ghost.uid) return candidates[index];
  }
  return null;
}

/** Delete every `usernames/{handle}` reservation owned by `uid` (ghosts only). */
async function releaseHandles(db: Firestore, uid: string, writer: BatchWriter): Promise<number> {
  if (!isGhostUid(uid)) return 0;
  const owned = await db.collection('usernames').where('uid', '==', uid).get();
  for (const doc of owned.docs) await writer.delete(doc.ref);
  return owned.size;
}

/**
 * Remove a ghost entirely. Every ghost uid exists on exactly ONE board (uids
 * embed the level id or date key), so deleting its entry always removes its
 * last entry — the profile and handle go with it.
 */
async function removeGhost(db: Firestore, entryRef: DocumentReference, uid: string, writer: BatchWriter): Promise<void> {
  if (!isGhostUid(uid)) return;
  await writer.delete(entryRef);
  await writer.delete(db.doc(`profiles/${uid}`));
  await releaseHandles(db, uid, writer);
}

// ---------------------------------------------------------------------------
// One board
// ---------------------------------------------------------------------------

type BoardSpec = {
  label: string;
  entries: CollectionReference;
  /** Full ghost set for this board, sorted by score DESC. */
  ghosts: GhostRunner[];
  fingerprint: string;
  targetTotal: number;
  /** Entry `at` for a ghost. */
  atFor: (ghost: GhostRunner) => number;
  /** Extra entry fields (daily: levelId, dateKey, expiresAt). */
  extra: Record<string, unknown>;
  /** Existing ghost doc still matches beyond the fingerprint? */
  fresh: (data: Record<string, unknown>) => boolean;
};

export type BoardSummary = {
  board: string;
  total: number;
  real: number;
  ghostsBefore: number;
  target: number;
  added: number;
  refreshed: number;
  removed: number;
  skipped: number;
};

async function reconcileBoard(db: Firestore, spec: BoardSpec, writer: BatchWriter): Promise<BoardSummary> {
  const [totalSnap, ghostCountSnap, existingSnap] = await Promise.all([
    spec.entries.count().get(),
    spec.entries.where('ghost', '==', true).count().get(),
    spec.entries.where('ghost', '==', true).get(),
  ]);
  const total = totalSnap.data().count;
  const ghostsBefore = ghostCountSnap.data().count;
  // Real docs carry no `ghost` field at all, so `!= true` would miss them: subtract instead.
  const real = Math.max(0, total - ghostsBefore);
  const target = ghostTarget(real, spec.targetTotal);
  const desired = spec.ghosts.slice(0, target);
  const desiredUids = new Set(desired.map((ghost) => ghost.uid));

  const existing = new Map<string, DocumentSnapshot>();
  for (const doc of existingSnap.docs) if (isGhostDoc(doc)) existing.set(doc.id, doc);

  const summary: BoardSummary = { board: spec.label, total, real, ghostsBefore, target, added: 0, refreshed: 0, removed: 0, skipped: 0 };

  // Ghosts that should no longer be here (below the target line, or from an old generator).
  for (const [uid, doc] of existing) {
    if (desiredUids.has(uid)) continue;
    await removeGhost(db, doc.ref, uid, writer);
    summary.removed += 1;
  }

  // Missing or stale ghosts.
  for (const ghost of desired) {
    const doc = existing.get(ghost.uid);
    const data = (doc?.data() ?? null) as Record<string, unknown> | null;
    if (data && data.ghostGen === spec.fingerprint && spec.fresh(data)) continue;

    const username = await resolveHandle(db, ghost, data?.username);
    if (!username) {
      logger.warn('reconcileGhosts: no free handle', { board: spec.label, uid: ghost.uid });
      summary.skipped += 1;
      continue;
    }
    const at = typeof data?.at === 'number' && spec.fresh(data) ? (data.at as number) : spec.atFor(ghost);
    await writer.set(spec.entries.doc(ghost.uid), { ...ghostEntryFields(ghost, username, at, spec.fingerprint), ...spec.extra });
    await writer.set(
      db.doc(`profiles/${ghost.uid}`),
      { ...ghostProfileFields(ghost, username), updatedAt: FieldValue.serverTimestamp() },
      true,
    );
    await writer.set(db.doc(`usernames/${username}`), { uid: ghost.uid, reservedAt: FieldValue.serverTimestamp(), ghost: true }, true);
    if (data) summary.refreshed += 1;
    else summary.added += 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// All boards
// ---------------------------------------------------------------------------

export type ReconcileOptions = {
  dryRun?: boolean;
  /** Override `GHOST_TARGET_TOTAL` for this run (e.g. 0 to purge level ghosts). */
  targetTotal?: number;
  /** Override `GHOST_DAILY_TARGET` for this run. */
  dailyTarget?: number;
  nowMs?: number;
};

export type ReconcileResult = {
  dryRun: boolean;
  targetTotal: number;
  dailyTarget: number;
  boards: BoardSummary[];
  sweptDaily: { dateKey: string; removed: number }[];
  writes: number;
  deletes: number;
  ms: number;
};

type ChartInfo = GhostChartRef & {
  /** Cue density of the published chart (score model). */
  cuesPerMin: number;
};

/**
 * Published charts by level id. Density and chart fields come from the
 * shared helpers so the client's instant boards (`src/lib/ghostBoards.ts`)
 * derive byte-identical ghosts from its chart mirror.
 */
async function loadPublishedCharts(db: Firestore): Promise<Map<string, ChartInfo>> {
  const snapshot = await db.collection('beatmaps').where('published', '==', true).get();
  const charts = new Map<string, ChartInfo>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const beatmap = parseBeatmap(data);
    if (!beatmap || beatmap.videoDurationSec <= 0 || beatmap.cues.length === 0) continue;
    if (typeof data.hash !== 'string' || !data.hash) continue;
    const version = typeof data.chartVersion === 'number' && data.chartVersion >= 1 ? Math.floor(data.chartVersion) : 1;
    charts.set(doc.id, {
      cuesPerMin: chartCuesPerMin(beatmap.cues.length, beatmap.videoDurationSec),
      chartVersion: version,
      hash: data.hash,
    });
  }
  return charts;
}

const chartFields = (chart: ChartInfo | undefined): Record<string, unknown> => ghostChartFields(chart ?? null);

/** Sweep ghosts of daily boards nobody can see any more (TTL is the backstop). */
async function sweepStaleDaily(db: Firestore, dateKey: string, writer: BatchWriter): Promise<number> {
  let removed = 0;
  const entries = db.collection(`dailyLeaderboards/${dateKey}/entries`);
  const ghosts = await entries.where('ghost', '==', true).get();
  const seen = new Set<string>();
  for (const doc of ghosts.docs) {
    if (!isGhostDoc(doc)) continue;
    await removeGhost(db, doc.ref, doc.id, writer);
    seen.add(doc.id);
    removed += 1;
  }
  // Entries may already be gone (TTL) while profiles/handles linger.
  const uids = Array.from({ length: DAILY_SWEEP_SLOTS }, (_, n) => ghostDailyUid(dateKey, n)).filter((uid) => !seen.has(uid));
  if (uids.length === 0) return removed;
  const profiles = await db.getAll(...uids.map((uid) => db.doc(`profiles/${uid}`)));
  for (const profile of profiles) {
    if (!isGhostDoc(profile)) continue;
    await writer.delete(profile.ref);
    await releaseHandles(db, profile.id, writer);
    removed += 1;
  }
  return removed;
}

async function reconcileAllGhosts(options: ReconcileOptions = {}): Promise<ReconcileResult> {
  const started = Date.now();
  const now = options.nowMs ?? started;
  const dryRun = options.dryRun === true;
  const targetTotal = clampTarget(options.targetTotal, GHOST_TARGET_TOTAL);
  const dailyTarget = clampTarget(options.dailyTarget, GHOST_DAILY_TARGET);
  const db = firestore();
  const writer = new BatchWriter(db, dryRun);
  const charts = await loadPublishedCharts(db);
  const staleAtBefore = now - GHOST_STALE_AT_DAYS * 86_400_000;
  const boards: BoardSummary[] = [];

  for (const levelId of CANONICAL_LEVEL_IDS) {
    const chart = charts.get(levelId);
    // Real chart density when published, else the generator's default assumption.
    const cuesPerMin = chart?.cuesPerMin ?? defaultCuesPerMin(levelId);
    const ghosts = generateLevelGhosts(levelId, targetTotal, { cuesPerMin });
    boards.push(
      await reconcileBoard(
        db,
        {
          label: `leaderboards/${levelId}`,
          entries: db.collection(`leaderboards/${levelId}/entries`),
          ghosts,
          // A new chart (density or hash) rewrites the ghosts against it.
          fingerprint: levelBoardFingerprint(cuesPerMin, chart ?? null),
          targetTotal,
          atFor: (ghost) => now - ghost.atOffsetMs,
          extra: chartFields(chart),
          fresh: (data) => typeof data.at === 'number' && data.at >= staleAtBefore,
        },
        writer,
      ),
    );
  }

  // Every level is scorable (with a chart, or provisionally without), so the
  // daily pool is the full roster — the same predicate `submitRun` uses.
  const { pool } = dailyChallengePool(() => true, CANONICAL_LEVEL_IDS);
  for (const dateKey of activeDailyKeys(now)) {
    const levelId = dailyChallengeLevelId(dateKey, pool);
    if (!levelId) continue;
    const chart = charts.get(levelId);
    const cuesPerMin = chart?.cuesPerMin ?? defaultCuesPerMin(levelId);
    const ghosts = generateDailyGhosts(dateKey, levelId, dailyTarget, { cuesPerMin });
    const midnightOffset = dateKeyToUtcMidnight(dateKey);
    boards.push(
      await reconcileBoard(
        db,
        {
          label: `dailyLeaderboards/${dateKey}`,
          entries: db.collection(`dailyLeaderboards/${dateKey}/entries`),
          ghosts,
          fingerprint: dailyBoardFingerprint(cuesPerMin, chart ?? null, levelId),
          targetTotal: dailyTarget,
          atFor: (ghost) => midnightOffset + ghost.atOffsetMs,
          extra: {
            ...chartFields(chart),
            levelId,
            dateKey,
            expiresAt: Timestamp.fromMillis(dailyEntryExpiresAt(dateKey)),
          },
          fresh: (data) => data.levelId === levelId,
        },
        writer,
      ),
    );
  }

  const sweptDaily: { dateKey: string; removed: number }[] = [];
  for (const dateKey of staleDailyKeys(now)) {
    sweptDaily.push({ dateKey, removed: await sweepStaleDaily(db, dateKey, writer) });
  }

  await writer.flush();
  const result: ReconcileResult = {
    dryRun,
    targetTotal,
    dailyTarget,
    boards,
    sweptDaily,
    writes: writer.writes,
    deletes: writer.deletes,
    ms: Date.now() - started,
  };
  logger.info('reconcileGhosts summary', {
    dryRun,
    targetTotal,
    dailyTarget,
    writes: result.writes,
    deletes: result.deletes,
    ms: result.ms,
    boards: boards.map((b) => `${b.board}: total=${b.total} real=${b.real} ghosts=${b.ghostsBefore}→${b.target} +${b.added} ~${b.refreshed} -${b.removed}${b.skipped ? ` skipped=${b.skipped}` : ''}`),
    sweptDaily: sweptDaily.filter((s) => s.removed > 0),
  });
  return result;
}

function clampTarget(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(200, Math.max(0, Math.floor(value)));
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** Hourly: keep every board at its target as real players arrive. */
export const reconcileGhosts = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'Etc/UTC', timeoutSeconds: 300, memory: '256MiB', maxInstances: 1 },
  async () => {
    await reconcileAllGhosts();
  },
);

type ReconcileNowInput = { dryRun?: unknown; targetTotal?: unknown; dailyTarget?: unknown };

/**
 * Same admin mechanism as the rest of the backend (`admin` custom claim or
 * presence of `admins/{uid}`), plus the `ADMIN_UIDS` param for a no-Firestore
 * bootstrap.
 */
async function requireAdmin(request: CallableRequest<unknown>): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in.');
  if (request.auth?.token?.admin === true) return uid;
  const allowed = ADMIN_UIDS.value()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes(uid)) return uid;
  const adminDoc = await firestore().doc(`admins/${uid}`).get();
  if (adminDoc.exists) return uid;
  throw new HttpsError('permission-denied', 'admin-only');
}

/**
 * Admin: run the reconcile now. `{dryRun: true}` reports without writing;
 * `{targetTotal: 0, dailyTarget: 0}` purges every ghost immediately (the
 * hourly schedule re-seeds unless the constants are also set to 0 and
 * redeployed — see docs).
 */
export const reconcileGhostsNow = onCall<ReconcileNowInput>({ timeoutSeconds: 300, memory: '256MiB' }, async (request) => {
  const uid = await requireAdmin(request);
  const input = request.data ?? {};
  const result = await reconcileAllGhosts({
    dryRun: input.dryRun === true,
    targetTotal: typeof input.targetTotal === 'number' ? input.targetTotal : undefined,
    dailyTarget: typeof input.dailyTarget === 'number' ? input.dailyTarget : undefined,
  });
  logger.info('reconcileGhostsNow', { uid, dryRun: result.dryRun, writes: result.writes, deletes: result.deletes });
  return result;
});

/**
 * Ghost runners — launch-time seeding of the leaderboards.
 *
 * Pure, deterministic generator: `(levelId | dateKey, n)` always yields the
 * same runner (handle, uid, score, combo, accuracy, profile). The Cloud
 * Function `reconcileGhosts` (functions/src/seed.ts) writes these as ORDINARY
 * board entries + profiles + username reservations, tagged `ghost: true`, and
 * phases them out from the bottom as real players arrive. Nothing in the
 * client knows about ghosts; see docs/LEADERBOARDS.md → "Ghost runners".
 *
 * Scores are not invented numbers: every ghost run is a synthetic judgement
 * sequence (hit / miss / spurious, perfect vs good) replayed through the same
 * `replayJudgements` the server uses to verify real runs, so `score`,
 * `maxCombo` and `accuracy` are mutually consistent exactly like a real run.
 * The TOP ghost sits just under the 67th percentile of what a decent real
 * player scores on the default 5-minute run (`ghostScoreCap`), so a real
 * player reaches #1 within a few tries; every other ghost is below it.
 *
 * Dependency-free (only sibling modules of this package).
 */

import { hashSeed, dateKeyToUtcMidnight } from './daily';
import { replayJudgements, type JudgeEvent } from './grading';
import { CANONICAL_LEVEL_IDS } from './levelIds';
import { RESERVED_USERNAMES, validateUsername } from './username';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Desired board size while real players are scarce (ghosts + real). 0 = off. */
export const GHOST_TARGET_TOTAL = 24;
/** Same for each day's daily board. 0 = off. */
export const GHOST_DAILY_TARGET = 10;
/**
 * Bump when the generator changes in a way that should rewrite existing ghost
 * documents (the reconcile compares `ghostGen`).
 */
export const GHOST_GEN_VERSION = 1;
/** Ghost `at` timestamps are refreshed once they are older than this. */
export const GHOST_STALE_AT_DAYS = 21;
/** Ghost `at` on a global board is spread over the past 1–14 days. */
export const GHOST_AT_MIN_DAYS = 1;
export const GHOST_AT_MAX_DAYS = 14;
/** Percentile of a decent player's 5-minute runs the top ghost may not exceed. */
export const GHOST_CAP_PERCENTILE = 0.67;
/** Ghost #0 ("the anchor") is re-rolled until it lands in [this × cap, cap]. */
export const GHOST_ANCHOR_FRACTION = 0.985;
/** Default cue density when a level has no published beatmap to read it from. */
export const GHOST_DEFAULT_CUES_PER_MIN_MIN = 20;
export const GHOST_DEFAULT_CUES_PER_MIN_MAX = 30;
/** Ghost profile levels. */
export const GHOST_LEVEL_MIN = 3;
export const GHOST_LEVEL_MAX = 18;

export const GHOST_UID_PREFIX = 'ghost_';
const DAILY_UID_PREFIX = 'ghost_d_';

/** Real badge ids (`LEVEL_REWARDS` in src/lib/levels.ts) with their unlock level. */
export const GHOST_BADGES: readonly { level: number; id: string }[] = [
  { level: 2, id: 'first-stride' },
  { level: 5, id: 'cadence' },
  { level: 10, id: 'trailblazer' },
  { level: 15, id: 'summit' },
];
/** Real HUD theme ids (`src/lib/hudThemes.ts`) with their unlock level. */
export const GHOST_HUD_THEMES: readonly { level: number; id: string }[] = [
  { level: 1, id: 'volt' },
  { level: 3, id: 'glacier' },
  { level: 8, id: 'ember' },
  { level: 12, id: 'ultraviolet' },
  { level: 18, id: 'rose' },
];

const PLAYBACK_RATES: readonly { rate: number; weight: number }[] = [
  { rate: 0.85, weight: 0.25 },
  { rate: 1, weight: 0.55 },
  { rate: 1.2, weight: 0.2 },
];
const DURATIONS_MIN: readonly { minutes: number; weight: number }[] = [
  { minutes: 5, weight: 0.75 },
  { minutes: 10, weight: 0.25 },
];
const CLASS_KEYS: readonly { key: string | null; weight: number }[] = [
  { key: 'beginner', weight: 0.4 },
  { key: 'intermediate', weight: 0.25 },
  { key: 'hard', weight: 0.1 },
  { key: null, weight: 0.25 },
];

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/** mulberry32 — tiny, good enough for cosmetic distributions. */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(rng: () => number, items: readonly (T & { weight: number })[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

/** Ordinary first names / nicknames, lowercase. No celebrities, no brands. */
const NAMES: readonly string[] = [
  'maya', 'theo', 'nadia', 'jonas', 'priya', 'liam', 'sofia', 'omar', 'elena', 'kai',
  'zoe', 'mateo', 'aisha', 'noah', 'lena', 'ravi', 'chloe', 'dani', 'hana', 'felix',
  'ines', 'tariq', 'mila', 'arjun', 'rosa', 'leo', 'nina', 'yusuf', 'ella', 'sam',
  'tomas', 'leila', 'ben', 'anya', 'marco', 'sara', 'ivan', 'freya', 'amir', 'clara',
  'josh', 'mira', 'diego', 'ruth', 'kenji', 'lucy', 'niko', 'ada', 'rafa', 'tess',
  'eli', 'noor', 'jules', 'dora', 'tobi', 'maja', 'luca', 'iris', 'zane', 'greta',
  'ezra', 'yara', 'oscar', 'lina', 'pavel', 'suki', 'remy', 'aline', 'jude', 'kira',
  'hugo', 'meera', 'colin', 'asha', 'emil', 'talia', 'nate', 'lior', 'bea', 'kofi',
  'anders', 'sana', 'mick', 'ida', 'jamal', 'rhea', 'owen', 'vera', 'teo', 'amara',
  'finn', 'lotte', 'gabe', 'nia', 'joel', 'selin', 'rory', 'mei', 'zack', 'petra',
  'alex', 'naomi', 'dev', 'juno', 'kian', 'lara', 'milo', 'esme', 'ayo', 'joy',
  'quinn', 'wes', 'bruno', 'tara', 'ali', 'cass', 'ronan', 'lou', 'kaya', 'arlo',
];

/** Short suffix words that read like real handles. */
const SUFFIX_WORDS: readonly string[] = [
  'runs', 'flow', 'pace', 'sprint', 'dash', 'moves', 'fit', 'jumps', 'cardio', 'stride',
  'go', 'ok', 'x', 'k', 'j', 'r', 'v', 'm', 'b', 'lee', 'kay', 'jay', 'dee',
];
const PREFIX_WORDS: readonly string[] = ['lil', 'the', 'iron', 'fast', 'just', 'hey', 'its', 'run'];

type HandleStyle = (name: string, rng: () => number) => string;

const twoDigits = (rng: () => number) => `${Math.floor(rng() * 90) + 10}`;
const initial = (rng: () => number) => 'abcdefghjklmnprstvwz'[Math.floor(rng() * 20)];

const STYLES: readonly HandleStyle[] = [
  (name) => name,
  (name, rng) => `${name}_${SUFFIX_WORDS[Math.floor(rng() * SUFFIX_WORDS.length)]}`,
  (name, rng) => `${name}${SUFFIX_WORDS[Math.floor(rng() * 10)]}`,
  (name, rng) => `${name}_${initial(rng)}`,
  (name, rng) => `${name}${initial(rng)}`,
  (name, rng) => `${name}${twoDigits(rng)}`,
  (name, rng) => `${name}_${twoDigits(rng)}`,
  (name, rng) => `${PREFIX_WORDS[Math.floor(rng() * PREFIX_WORDS.length)]}_${name}`,
  (name, rng) => `${PREFIX_WORDS[Math.floor(rng() * 3)]}${name}`,
  (name, rng) => `${initial(rng)}${initial(rng)}_${SUFFIX_WORDS[Math.floor(rng() * 10)]}`,
  (name, rng) => `${name}_${name.slice(0, 1)}${initial(rng)}`,
  (name, rng) => `${name}${initial(rng)}${twoDigits(rng)}`,
];

export function isValidGhostHandle(handle: string): boolean {
  return validateUsername(handle).valid && !RESERVED_USERNAMES.has(handle);
}

/**
 * The global handle pool: every (name × style) combination, generated with a
 * fixed seed, de-duplicated, validated and shuffled once. ~1,400 handles.
 * Slot assignment below guarantees two ghosts never share a handle.
 */
function buildHandlePool(): string[] {
  const rng = seededRandom('cardiosurf-ghost-handles-v1');
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const name of NAMES) {
    for (const style of STYLES) {
      const handle = style(name, rng);
      if (!isValidGhostHandle(handle) || seen.has(handle)) continue;
      seen.add(handle);
      pool.push(handle);
    }
  }
  return shuffled(pool, seededRandom('cardiosurf-ghost-handles-shuffle-v1'));
}

let handlePool: string[] | null = null;
export function ghostHandlePool(): readonly string[] {
  if (!handlePool) handlePool = buildHandlePool();
  return handlePool;
}

/** Slots per level reserved in the pool (≥ any plausible GHOST_TARGET_TOTAL). */
const LEVEL_SLOTS = 32;
/** Slots per day for daily ghosts (≥ any plausible GHOST_DAILY_TARGET). */
const DAILY_SLOTS = 16;
/** Levels can be appended to CANONICAL_LEVEL_IDS without moving daily slots. */
const LEVEL_POOL_SIZE = LEVEL_SLOTS * 24;

function levelSlotBase(levelId: string): number {
  const index = CANONICAL_LEVEL_IDS.indexOf(levelId);
  if (index >= 0) return index * LEVEL_SLOTS;
  // Unknown level: hash into the level region (only used off the canonical list).
  return (hashSeed(`level:${levelId}`) % (LEVEL_POOL_SIZE / LEVEL_SLOTS)) * LEVEL_SLOTS;
}

function dayNumber(dateKey: string): number {
  const midnight = dateKeyToUtcMidnight(dateKey);
  return Number.isFinite(midnight) ? Math.floor(midnight / 86_400_000) : hashSeed(dateKey) % 100_000;
}

/** Primary handle for slot `n` of a level board. */
export function ghostLevelHandle(levelId: string, n: number): string {
  const pool = ghostHandlePool();
  return pool[(levelSlotBase(levelId) + (n % LEVEL_SLOTS)) % pool.length];
}

/** Primary handle for slot `n` of a daily board; consecutive days never collide. */
export function ghostDailyHandle(dateKey: string, n: number): string {
  const pool = ghostHandlePool();
  const region = pool.length - LEVEL_POOL_SIZE;
  const slot = ((dayNumber(dateKey) * DAILY_SLOTS + (n % DAILY_SLOTS)) % region + region) % region;
  return pool[LEVEL_POOL_SIZE + slot];
}

/**
 * Fallbacks when a REAL player already owns the primary handle: the primary
 * plus a deterministic numeric tail. Fallbacks never equal another ghost's
 * primary because no style ends in `_` + three digits.
 */
export function ghostHandleCandidates(primary: string, seed: string): string[] {
  const rng = seededRandom(`${seed}:handle-fallback`);
  const out = [primary];
  for (let i = 0; i < 3; i += 1) {
    const digits = `${Math.floor(rng() * 900) + 100}`;
    const candidate = `${primary.slice(0, 20 - 1 - digits.length)}_${digits}`;
    if (isValidGhostHandle(candidate) && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Uids
// ---------------------------------------------------------------------------

export function ghostLevelUid(levelId: string, n: number): string {
  return `${GHOST_UID_PREFIX}${levelId}_${n}`;
}

export function ghostDailyUid(dateKey: string, n: number): string {
  return `${DAILY_UID_PREFIX}${dateKey}_${n}`;
}

export function isGhostUid(uid: unknown): uid is string {
  return typeof uid === 'string' && uid.startsWith(GHOST_UID_PREFIX);
}

/** Deterministic `runId` for the entry (no `challenges/{runId}` doc exists). */
export function ghostRunId(uid: string): string {
  return `${uid}_run`;
}

// ---------------------------------------------------------------------------
// Score model
// ---------------------------------------------------------------------------

export type GhostSkill = {
  /** Probability a cue is hit at all (else it expires as a miss). */
  hitProbability: number;
  /** Share of hits graded perfect (else good). */
  perfectShare: number;
  /** Extra spurious moves per cue (combo breakers). */
  spuriousRate: number;
};

/** A "decent" real player: ~80 % accuracy with occasional combo breaks. */
export const DECENT_PLAYER: GhostSkill = { hitProbability: 0.85, perfectShare: 0.7, spuriousRate: 0.03 };

export type SimulatedRun = { score: number; maxCombo: number; accuracy: number; cues: number };

/**
 * Synthesize a judgement log for `cueCount` cues and replay it with the real
 * combo rules. Misses cluster slightly (a miss makes the next cue likelier to
 * miss), which is what real logs look like.
 */
export function simulateRun(rng: () => number, cueCount: number, skill: GhostSkill): SimulatedRun {
  const events: JudgeEvent[] = [];
  let t = 0;
  let lastMissed = false;
  for (let i = 0; i < cueCount; i += 1) {
    t += 2;
    const pHit = lastMissed ? skill.hitProbability * 0.8 : skill.hitProbability;
    if (rng() < skill.spuriousRate) events.push({ i: -1, l: -1, g: 'x', d: null, t: t - 1 });
    if (rng() < pHit) {
      const perfect = rng() < skill.perfectShare;
      events.push({ i, l: 0, g: perfect ? 'p' : 'g', d: perfect ? 60 : 180, t });
      lastMissed = false;
    } else {
      events.push({ i, l: 0, g: 'm', d: null, t: t + 0.6 });
      lastMissed = true;
    }
  }
  const totals = replayJudgements(events);
  return { score: totals.score, maxCombo: totals.maxCombo, accuracy: totals.accuracy, cues: cueCount };
}

/** Cue density to assume for a level without a published beatmap (20–30/min). */
export function defaultCuesPerMin(levelId: string): number {
  const span = GHOST_DEFAULT_CUES_PER_MIN_MAX - GHOST_DEFAULT_CUES_PER_MIN_MIN;
  return GHOST_DEFAULT_CUES_PER_MIN_MIN + (hashSeed(`density:${levelId}`) % (span + 1));
}

function cueCountFor(cuesPerMin: number, minutes: number, playbackRate: number): number {
  return Math.max(1, Math.round(cuesPerMin * minutes * playbackRate));
}

/**
 * Score a decent player must beat only ~1/3 of the time: the
 * `GHOST_CAP_PERCENTILE` of 256 simulated 5-minute runs at 1.0×. Deterministic
 * per (levelId, cuesPerMin).
 */
export function ghostScoreCap(levelId: string, cuesPerMin: number): number {
  const rng = seededRandom(`cap:${levelId}:${cuesPerMin}`);
  const cues = cueCountFor(cuesPerMin, 5, 1);
  const scores: number[] = [];
  for (let i = 0; i < 256; i += 1) scores.push(simulateRun(rng, cues, DECENT_PLAYER).score);
  scores.sort((a, b) => a - b);
  return scores[Math.min(scores.length - 1, Math.floor(GHOST_CAP_PERCENTILE * scores.length))];
}

// ---------------------------------------------------------------------------
// Ghost runners
// ---------------------------------------------------------------------------

export type GhostRunner = {
  uid: string;
  /** Primary handle; `handleCandidates[0]`. */
  username: string;
  /** Primary + fallbacks for when a real player owns the primary. */
  handleCandidates: string[];
  runId: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  playbackRate: number;
  targetSeconds: number;
  elapsedSeconds: number;
  classKey: string | null;
  /** Profile fields. */
  level: number;
  badges: string[];
  hudTheme: string;
  /**
   * Global boards: ms BEFORE `now` the run happened (1–14 days + hours).
   * Daily boards: ms AFTER the date's UTC midnight (08:00–16:00).
   */
  atOffsetMs: number;
};

export type GhostGenOptions = {
  /** Cue density of the level's chart; defaults to `defaultCuesPerMin`. */
  cuesPerMin?: number;
};

function profileFor(rng: () => number): Pick<GhostRunner, 'level' | 'badges' | 'hudTheme'> {
  const level = GHOST_LEVEL_MIN + Math.floor(rng() * (GHOST_LEVEL_MAX - GHOST_LEVEL_MIN + 1));
  const badges = GHOST_BADGES.filter((b) => b.level <= level).map((b) => b.id);
  const themes = GHOST_HUD_THEMES.filter((t) => t.level <= level);
  const hudTheme = themes[Math.floor(rng() * themes.length)].id;
  return { level, badges, hudTheme };
}

function makeGhost(
  seed: string,
  uid: string,
  primaryHandle: string,
  cuesPerMin: number,
  cap: number,
  minScore: number,
  atOffset: (rng: () => number) => number,
): GhostRunner {
  const rng = seededRandom(seed);
  const profile = profileFor(rng);
  const classKey = pickWeighted(rng, CLASS_KEYS).key;
  const atOffsetMs = atOffset(rng);

  // Re-roll skill/duration until the run is plausible AND inside [minScore, cap].
  let run: SimulatedRun | null = null;
  let playbackRate = 1;
  let minutes = 5;
  const attempts = minScore > 0 ? 200 : 24;
  for (let attempt = 0; attempt < attempts && !run; attempt += 1) {
    const s = minScore > 0 ? 0.55 + 0.45 * rng() : (rng() + rng()) / 2; // triangular, centred
    const skill: GhostSkill = {
      hitProbability: 0.75 + 0.2 * s,
      perfectShare: 0.45 + 0.45 * s,
      spuriousRate: 0.02 + 0.04 * (1 - s),
    };
    playbackRate = pickWeighted(rng, PLAYBACK_RATES).rate;
    minutes = attempt < 12 ? pickWeighted(rng, DURATIONS_MIN).minutes : 5;
    const candidate = simulateRun(rng, cueCountFor(cuesPerMin, minutes, playbackRate), skill);
    if (candidate.score > cap || candidate.score < minScore) continue;
    if (candidate.accuracy < 0.55 || candidate.accuracy > 0.9) continue;
    run = candidate;
  }
  if (!run) {
    // Worst case (tiny cap): a short weak run always fits.
    run = simulateRun(rng, cueCountFor(cuesPerMin, 5, 0.85), { hitProbability: 0.75, perfectShare: 0.45, spuriousRate: 0.06 });
    playbackRate = 0.85;
    minutes = 5;
    if (run.score > cap) run = { ...run, score: cap, maxCombo: Math.min(run.maxCombo, 8) };
  }
  const targetSeconds = minutes * 60;
  const elapsedSeconds = Math.round((targetSeconds + rng() * 3) * 10) / 10;

  return {
    uid,
    username: primaryHandle,
    handleCandidates: ghostHandleCandidates(primaryHandle, seed),
    runId: ghostRunId(uid),
    score: run.score,
    accuracy: run.accuracy,
    maxCombo: run.maxCombo,
    playbackRate,
    targetSeconds,
    elapsedSeconds,
    classKey,
    ...profile,
    atOffsetMs,
  };
}

const DAY_MS = 86_400_000;

/**
 * All ghosts for a level's global board, sorted by score DESC. The reconcile
 * keeps the first `target` of them, so ghosts always disappear from the
 * bottom as real players arrive.
 */
export function generateLevelGhosts(
  levelId: string,
  count = GHOST_TARGET_TOTAL,
  options: GhostGenOptions = {},
): GhostRunner[] {
  const cuesPerMin = options.cuesPerMin && options.cuesPerMin > 0 ? options.cuesPerMin : defaultCuesPerMin(levelId);
  const cap = ghostScoreCap(levelId, cuesPerMin);
  const ghosts: GhostRunner[] = [];
  for (let n = 0; n < count; n += 1) {
    ghosts.push(
      makeGhost(
        `ghost:v${GHOST_GEN_VERSION}:${levelId}:${n}`,
        ghostLevelUid(levelId, n),
        ghostLevelHandle(levelId, n),
        cuesPerMin,
        cap,
        n === 0 ? Math.round(cap * GHOST_ANCHOR_FRACTION) : 0,
        (rng) => Math.round((GHOST_AT_MIN_DAYS + rng() * (GHOST_AT_MAX_DAYS - GHOST_AT_MIN_DAYS)) * DAY_MS),
      ),
    );
  }
  return ghosts.sort((a, b) => b.score - a.score || a.uid.localeCompare(b.uid));
}

/** All ghosts for one day's daily board (challenge level `levelId`), sorted by score DESC. */
export function generateDailyGhosts(
  dateKey: string,
  levelId: string,
  count = GHOST_DAILY_TARGET,
  options: GhostGenOptions = {},
): GhostRunner[] {
  const cuesPerMin = options.cuesPerMin && options.cuesPerMin > 0 ? options.cuesPerMin : defaultCuesPerMin(levelId);
  const cap = ghostScoreCap(levelId, cuesPerMin);
  const ghosts: GhostRunner[] = [];
  for (let n = 0; n < count; n += 1) {
    ghosts.push(
      makeGhost(
        `ghost-daily:v${GHOST_GEN_VERSION}:${dateKey}:${n}`,
        ghostDailyUid(dateKey, n),
        ghostDailyHandle(dateKey, n),
        cuesPerMin,
        cap,
        n === 0 ? Math.round(cap * GHOST_ANCHOR_FRACTION) : 0,
        // 08:00–16:00 UTC reads as that calendar date from UTC−8 to UTC+8.
        (rng) => Math.round((8 + rng() * 8) * 3_600_000),
      ),
    );
  }
  return ghosts.sort((a, b) => b.score - a.score || a.uid.localeCompare(b.uid));
}

/** Fingerprint stored on every ghost document; a mismatch triggers a rewrite. */
export function ghostGenFingerprint(cuesPerMin: number): string {
  return `v${GHOST_GEN_VERSION}:${cuesPerMin}`;
}

/**
 * Cue density the generator reads from a published chart. ONE definition for
 * the server reconcile and the client's instant boards, so both sides feed
 * the generator the same number and produce the same ghosts.
 */
export function chartCuesPerMin(cueCount: number, videoDurationSec: number): number {
  if (!(videoDurationSec > 0) || !(cueCount > 0)) return 0;
  return Math.round((cueCount / videoDurationSec) * 60);
}

/** The published chart facts a ghost document depends on. */
export type GhostChartRef = { chartVersion: number; hash: string };

/**
 * Chart-related entry fields, shaped like `entryDoc` writes them: a level
 * with a published chart → verified against it; otherwise a provisional run
 * (`beatmapVersion: 0`, hash `'none'`, matching `PROVISIONAL_BEATMAP_HASH`).
 */
export function ghostChartFields(chart: GhostChartRef | null | undefined): Record<string, unknown> {
  return chart
    ? { provisional: false, beatmapVersion: chart.chartVersion, beatmapHash: chart.hash }
    : { provisional: true, beatmapVersion: 0, beatmapHash: 'none' };
}

/** Document fingerprint for a level board (density + chart hash). */
export function levelBoardFingerprint(cuesPerMin: number, chart: GhostChartRef | null | undefined): string {
  return `${ghostGenFingerprint(cuesPerMin)}:${chart?.hash ?? 'none'}`;
}

/** Document fingerprint for a daily board (density + chart hash + the day's level). */
export function dailyBoardFingerprint(
  cuesPerMin: number,
  chart: GhostChartRef | null | undefined,
  levelId: string,
): string {
  return `${ghostGenFingerprint(cuesPerMin)}:${chart?.hash ?? 'none'}:${levelId}`;
}

/**
 * The complete entry document for ghost `n` of a level board, exactly as the
 * reconcile writes it (minus the handle fallback a real owner can force).
 * `now` is the reconcile time the `at` spread is anchored to.
 */
export function ghostLevelEntryDoc(
  levelId: string,
  ghost: GhostRunner,
  cuesPerMin: number,
  chart: GhostChartRef | null | undefined,
  now: number,
): Record<string, unknown> {
  return {
    ...ghostEntryFields(ghost, ghost.username, now - ghost.atOffsetMs, levelBoardFingerprint(cuesPerMin, chart)),
    ...ghostChartFields(chart),
  };
}

/** Same for a daily board entry (`expiresAt` is added by the Function as a Timestamp). */
export function ghostDailyEntryDoc(
  dateKey: string,
  levelId: string,
  ghost: GhostRunner,
  cuesPerMin: number,
  chart: GhostChartRef | null | undefined,
): Record<string, unknown> {
  const midnight = dateKeyToUtcMidnight(dateKey);
  return {
    ...ghostEntryFields(ghost, ghost.username, midnight + ghost.atOffsetMs, dailyBoardFingerprint(cuesPerMin, chart, levelId)),
    ...ghostChartFields(chart),
    levelId,
    dateKey,
  };
}

// ---------------------------------------------------------------------------
// Documents (plain objects; the Function adds Firestore types like expiresAt)
// ---------------------------------------------------------------------------

/**
 * A board entry shaped like `entryDoc` in functions/src/index.ts plus the
 * `ghost` marker + fingerprint. Chart-dependent fields (`provisional`,
 * `beatmapVersion`, `beatmapHash`) and daily fields (`levelId`, `dateKey`,
 * `expiresAt`) are added by the Function, which knows the published charts.
 */
export function ghostEntryFields(
  ghost: GhostRunner,
  username: string,
  at: number,
  fingerprint: string,
): Record<string, unknown> {
  return {
    uid: ghost.uid,
    score: ghost.score,
    accuracy: ghost.accuracy,
    maxCombo: ghost.maxCombo,
    at,
    recorded: true,
    runId: ghost.runId,
    username,
    photoURL: null,
    classKey: ghost.classKey,
    level: ghost.level,
    playbackRate: ghost.playbackRate,
    elapsedSeconds: ghost.elapsedSeconds,
    ghost: true,
    ghostGen: fingerprint,
  };
}

/** `profiles/{uid}` for a ghost (username is server-written, like real ones). */
export function ghostProfileFields(ghost: GhostRunner, username: string): Record<string, unknown> {
  return {
    username,
    photoURL: null,
    level: ghost.level,
    badges: [...ghost.badges],
    hudTheme: ghost.hudTheme,
    ghost: true,
  };
}

/** Which of the full ghost set should exist given how many real players there are. */
export function ghostTarget(realCount: number, targetTotal: number): number {
  const total = Math.max(0, Math.floor(targetTotal));
  const real = Math.max(0, Math.floor(realCount));
  return Math.min(total, Math.max(0, total - real));
}

/**
 * Date keys whose daily board should be seeded at `nowMs`: UTC yesterday
 * while some zone (UTC−12) is still on it, UTC today, and UTC tomorrow
 * (pre-seeded so the board is never empty when UTC+14 crosses midnight).
 */
export function activeDailyKeys(nowMs: number): string[] {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const keys: string[] = [];
  const yesterday = today - DAY_MS;
  if (nowMs <= yesterday + 36 * 3_600_000) keys.push(utcKey(yesterday));
  keys.push(utcKey(today), utcKey(today + DAY_MS));
  return keys;
}

/** Date keys whose ghosts should be swept (2–3 days old; TTL is the backstop). */
export function staleDailyKeys(nowMs: number): string[] {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return [utcKey(today - 2 * DAY_MS), utcKey(today - 3 * DAY_MS)];
}

function utcKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, '0')}-${`${d.getUTCDate()}`.padStart(2, '0')}`;
}

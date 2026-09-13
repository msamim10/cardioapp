/**
 * Daily challenge pick, shared by the app (`getDailyChallenge` in
 * `src/lib/dailyRecommendations.ts`) and the server (`submitRun` decides
 * whether a run counts for the daily board). Both MUST produce the same level
 * for the same local date key — `npm run test:daily-key` asserts it.
 *
 * Rule: `hash(dateKey + ':' + salt) mod pool.length` over the pool of level ids
 * WITH a published beatmap, in canonical (`CANONICAL_LEVEL_IDS`) order. While
 * no beatmap is published the pool falls back to every level ("practice").
 */

import { CANONICAL_LEVEL_IDS } from './levelIds';

/** Salt so the challenge pick is independent of the featured/recommended rotation. */
export const DAILY_CHALLENGE_SALT = 'daily-challenge';

/** Local calendar key, `YYYY-MM-DD`, from a Date in the caller's local zone. */
export function localDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const utc = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const check = new Date(utc);
  return (
    check.getUTCFullYear() === Number(y) &&
    check.getUTCMonth() === Number(m) - 1 &&
    check.getUTCDate() === Number(d)
  );
}

/** UTC midnight (ms) of a `YYYY-MM-DD` key; NaN when malformed. */
export function dateKeyToUtcMidnight(dateKey: string): number {
  if (!isDateKey(dateKey)) return Number.NaN;
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** FNV-1a 32-bit — the same seed the client's discovery rotation uses. */
export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Canonical-order pool of level ids eligible for the challenge: those with a
 * published beatmap, or every level while none is published.
 */
export function dailyChallengePool(
  hasBeatmap: (levelId: string) => boolean,
  allLevelIds: readonly string[] = CANONICAL_LEVEL_IDS,
): { pool: string[]; practice: boolean } {
  const unique = Array.from(new Set(allLevelIds));
  const cued = unique.filter((id) => hasBeatmap(id));
  return cued.length > 0 ? { pool: cued, practice: false } : { pool: unique, practice: true };
}

/** The level id designated for a local date key, or null with an empty pool. */
export function dailyChallengeLevelId(dateKey: string, pool: readonly string[]): string | null {
  if (pool.length === 0) return null;
  return pool[hashSeed(`${dateKey}:${DAILY_CHALLENGE_SALT}`) % pool.length];
}

/**
 * Widest span of UTC time during which SOME local zone (UTC−12 … UTC+14) is
 * on calendar date `dateKey`: [midnightUTC − 14h, midnightUTC + 36h].
 */
export const DATE_KEY_EARLIEST_OFFSET_MS = -14 * 3_600_000;
export const DATE_KEY_LATEST_OFFSET_MS = 36 * 3_600_000;
/** Extra allowance for the submit call landing after the run ended. */
export const DATE_KEY_SUBMIT_SLACK_MS = 2 * 3_600_000;

/**
 * A client-reported local date key is plausible at `serverNowMs` when the
 * server time falls inside that date's global span plus submit slack. This
 * replaces a naive ±26h window (which would reject legitimate late-evening
 * runs in the Americas) while still refusing keys days away.
 */
export function dateKeyPlausibleAt(dateKey: string, serverNowMs: number): boolean {
  const midnight = dateKeyToUtcMidnight(dateKey);
  if (!Number.isFinite(midnight)) return false;
  const earliest = midnight + DATE_KEY_EARLIEST_OFFSET_MS;
  const latest = midnight + DATE_KEY_LATEST_OFFSET_MS + DATE_KEY_SUBMIT_SLACK_MS;
  return serverNowMs >= earliest && serverNowMs <= latest;
}

/** When a daily-board entry for `dateKey` may be swept by Firestore TTL. */
export function dailyEntryExpiresAt(dateKey: string): number {
  const midnight = dateKeyToUtcMidnight(dateKey);
  return midnight + DATE_KEY_LATEST_OFFSET_MS + 24 * 3_600_000;
}

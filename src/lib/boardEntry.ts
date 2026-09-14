/**
 * Board row shape + the Firestore document → row mapping, kept free of
 * Firebase / native imports so the instant-board helpers (`ghostBoards.ts`)
 * and the parity replay can use exactly the same parsing as the live reads
 * in `leaderboards.ts`.
 */

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

export const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** One `entries/{uid}` document (or an equivalent plain object) → row. */
export function toEntry(id: string, data: Record<string, unknown>): LeaderboardEntry {
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

/** Board order: score DESC, earlier run first on a tie. */
export function sortBoardRows(rows: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  return [...rows].sort((a, b) => b.score - a.score || a.at - b.at || a.uid.localeCompare(b.uid));
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

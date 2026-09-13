/**
 * Beatmaps: authored move cues on a level's video timeline.
 *
 * File format (JSON, one file per level id, under src/data/beatmaps/):
 *
 *   {
 *     "version": 1,
 *     "levelId": "neon-rails",
 *     "videoDurationSec": 123.4,
 *     "orientation": "vertical",
 *     "cues": [{ "t": 12.4, "move": "jump" }, ...]
 *   }
 *
 * `t` is seconds into the VERTICAL cut. The AirPlay horizontal source may be
 * a different cut; if its duration differs from `videoDurationSec` by more
 * than DURATION_TOLERANCE_S a warning is logged and the vertical timings are
 * used anyway (known limitation — cues can drift on TV until a horizontal
 * map exists). Loop wraps are handled by `cuesForLoopedPlayback`.
 *
 * This module is pure (no requires) so replay scripts can import it; the
 * static Metro registry lives in beatmapRegistry.ts.
 */

export const BEATMAP_MOVES = ['jump', 'duck', 'left', 'right'] as const;
export type BeatmapMove = (typeof BEATMAP_MOVES)[number];

export type BeatmapCue = {
  /** Seconds into the vertical video. */
  t: number;
  move: BeatmapMove;
};

export type Beatmap = {
  version: 1;
  levelId: string;
  videoDurationSec: number;
  orientation: 'vertical' | 'horizontal';
  /** Sorted by `t`, exact duplicates removed. */
  cues: BeatmapCue[];
};

/** A cue placed on the accumulated (looped) video timeline. */
export type ScheduledCue = BeatmapCue & {
  /** Absolute accumulated video seconds: `t + loop × videoLength`. */
  at: number;
  /** Which pass through the video (0-based). */
  loop: number;
  /** Index of the cue within the beatmap. */
  index: number;
};

export const DURATION_TOLERANCE_S = 0.5;
/** Two cues closer than this with the same move are treated as one when parsing. */
const DEDUPE_EPSILON_S = 0.001;

export function isBeatmapMove(value: unknown): value is BeatmapMove {
  return typeof value === 'string' && (BEATMAP_MOVES as readonly string[]).includes(value);
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Validate an untrusted JSON value into a Beatmap: cues sorted by time,
 * exact duplicates dropped, out-of-range or malformed cues rejected. Returns
 * null (never throws) when the shape is wrong, so a bad file degrades to
 * "no beatmap" (free scoring) rather than crashing the workout.
 */
export function parseBeatmap(value: unknown): Beatmap | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return null;
  if (typeof raw.levelId !== 'string' || !raw.levelId.trim()) return null;
  if (!finite(raw.videoDurationSec) || raw.videoDurationSec <= 0) return null;
  const orientation =
    raw.orientation === 'horizontal' ? 'horizontal' : raw.orientation === 'vertical' ? 'vertical' : null;
  if (!orientation) return null;
  if (!Array.isArray(raw.cues)) return null;

  const cues: BeatmapCue[] = [];
  for (const entry of raw.cues) {
    if (!entry || typeof entry !== 'object') return null;
    const cue = entry as Record<string, unknown>;
    if (!finite(cue.t) || cue.t < 0 || cue.t > raw.videoDurationSec) return null;
    if (!isBeatmapMove(cue.move)) return null;
    cues.push({ t: cue.t, move: cue.move });
  }
  cues.sort((a, b) => a.t - b.t || a.move.localeCompare(b.move));
  const deduped = cues.filter(
    (cue, index) =>
      index === 0 ||
      cue.move !== cues[index - 1].move ||
      cue.t - cues[index - 1].t > DEDUPE_EPSILON_S,
  );
  return {
    version: 1,
    levelId: raw.levelId,
    videoDurationSec: raw.videoDurationSec,
    orientation,
    cues: deduped,
  };
}

/**
 * The actual source duration differs from the authored one by more than the
 * tolerance (typically the AirPlay horizontal cut). Timings are still used.
 */
export function beatmapDurationMismatch(beatmap: Beatmap, actualDurationSec: number): boolean {
  if (!finite(actualDurationSec) || actualDurationSec <= 0) return false;
  return Math.abs(actualDurationSec - beatmap.videoDurationSec) > DURATION_TOLERANCE_S;
}

/**
 * Cues that fall inside `[fromSec, toSec)` of the accumulated video timeline
 * (the workout's monotonic `videoPlayedSec`), across as many loop wraps as
 * that range spans. `videoLength` is the length of the source actually
 * playing (falls back to the authored duration when unknown). Cues authored
 * beyond the actual length can never be reached and are skipped.
 */
export function cuesForLoopedPlayback(
  beatmap: Beatmap,
  fromSec: number,
  toSec: number,
  videoLength = beatmap.videoDurationSec,
): ScheduledCue[] {
  const length = finite(videoLength) && videoLength > 0 ? videoLength : beatmap.videoDurationSec;
  if (!(length > 0) || !(toSec > fromSec) || beatmap.cues.length === 0) return [];
  const from = Math.max(0, fromSec);
  const firstLoop = Math.floor(from / length);
  const lastLoop = Math.floor(Math.max(from, toSec - 1e-9) / length);
  const result: ScheduledCue[] = [];
  for (let loop = firstLoop; loop <= lastLoop; loop++) {
    const base = loop * length;
    beatmap.cues.forEach((cue, index) => {
      if (cue.t >= length) return;
      const at = base + cue.t;
      if (at >= from && at < toSec) result.push({ ...cue, at, loop, index });
    });
  }
  return result;
}

/** Pretty JSON for export from the authoring screen (stable key order). */
export function serializeBeatmap(beatmap: Beatmap): string {
  return JSON.stringify(
    {
      version: 1,
      levelId: beatmap.levelId,
      videoDurationSec: round3(beatmap.videoDurationSec),
      orientation: beatmap.orientation,
      cues: beatmap.cues.map((cue) => ({ t: round3(cue.t), move: cue.move })),
    },
    null,
    2,
  );
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Beatmaps: authored move cues on a level's video timeline.
 *
 * The implementation lives in the dependency-free shared package
 * (`shared/scoring/beatmap.ts`) so the Cloud Functions verify runs against
 * the exact same parser and loop scheduler. This module keeps the app's
 * historical import path working; the static Metro registry lives in
 * beatmapRegistry.ts.
 */
export {
  BEATMAP_MOVES,
  DURATION_TOLERANCE_S,
  beatmapDurationMismatch,
  beatmapHash,
  cuesForLoopedPlayback,
  isBeatmapMove,
  parseBeatmap,
  serializeBeatmap,
  type Beatmap,
  type BeatmapCue,
  type BeatmapMove,
  type ScheduledCue,
} from '@shared/scoring/beatmap';

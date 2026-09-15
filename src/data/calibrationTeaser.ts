import type { Move } from '@/lib/poseTracking';

/**
 * Calibration teaser: three short clips of real Neon Rails gameplay, one per
 * move, cut and concatenated into ONE bundled MP4
 * (`assets/video/calibration-neon-rails.mp4`, 720×1280, 30 fps CFR, H.264
 * High, ~2.4 Mbps, silent, fast-start; a copy is served from
 * `calibration/neon-rails/teaser.mp4` in the media bucket). The app pauses at
 * every clip boundary and seeks to the next `startMs`; nothing is baked in
 * between the clips.
 *
 * Times are milliseconds into the concatenated file, derived from the exact
 * frame ranges cut from `hls-v2/level13/vertical/1080/stream.m3u8` (30 fps):
 *
 *   clip   source frames   source time        frames   what the runner does
 *   Jump   447–508         14.900–16.967 s    62       red/white track barrier dead ahead, trains on both sides → hops it at 16.30 s
 *   Duck   564–620         18.800–20.700 s    57       head-height bar between two traffic-light posts → passes under it at 19.70 s
 *   Left   282–355          9.400–11.867 s    74       train coming straight at the camera → slides to the left track at 11.20 s
 *
 * The former fourth clip (Right, 6.600–9.000 s) was dropped: on device it read
 * as a second "left" and the file no longer carries it.
 *
 * `reactMs` is the moment the on-screen runner dodges; the detection window
 * for a clip is `[startMs, endMs]` plus `TEASER_TAIL_MS` after the clip ends.
 */
export type TeaserClip = {
  move: Move;
  startMs: number;
  endMs: number;
  reactMs: number;
};

export type CalibrationTeaser = {
  levelId: string;
  clips: readonly TeaserClip[];
};

/** Frame period of the concatenated file. */
const FRAME_MS = 1000 / 30;
const ms = (frames: number) => Math.round(frames * FRAME_MS);

export const CALIBRATION_TEASER: CalibrationTeaser = {
  levelId: 'neon-rails',
  clips: [
    { move: 'Jump', startMs: ms(0), endMs: ms(62), reactMs: ms(42) },
    { move: 'Duck', startMs: ms(62), endMs: ms(119), reactMs: ms(62 + 27) },
    { move: 'Left', startMs: ms(119), endMs: ms(193), reactMs: ms(119 + 54) },
  ],
};

/** Total length of the bundled file (all three clips back to back). */
export const CALIBRATION_TEASER_DURATION_MS = ms(193);

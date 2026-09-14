/**
 * The run's scoring clock is the VIDEO clock.
 *
 * `RunClock` folds expo-video `timeUpdate` ticks into monotonic accumulated
 * video seconds across loops (`videoPlayedSec`), decides which ticks may be
 * credited (natural playback vs. seek vs. loop wrap vs. AirPlay swap), and
 * exposes a "scoring active" gate: recognized moves may only score while the
 * video is actually advancing on screen. Pose tracking itself keeps running
 * while the gate is closed so calibration and tracking stay alive.
 *
 * Gate rules (all must hold):
 *   - `playing` is true (expo-video `playingChange`)
 *   - status is `readyToPlay` (expo-video `statusChange`; loading/buffering close it)
 *   - no AirPlay `replaceAsync` swap in flight
 *   - at least SEEK_SCORING_PAUSE_MS since the last detected seek
 *
 * Tick crediting (`tick`), with delta = position − last:
 *   natural  0 < delta ≤ naturalMaxS           → credited
 *   stall    delta = 0                          → nothing
 *   seek     delta > naturalMaxS, or a backward jump that is not a wrap
 *            → not credited, `last` re-anchored, scoring paused briefly
 *   wrap     delta < 0 while looping and (length − last) + position ≤
 *            LOOP_WRAP_WINDOW_S × 2 → the tail of the previous pass plus the
 *            head of this one is credited. Bounding the total travelled (not
 *            just how close `last` was to the end) tolerates a late tick that
 *            missed the last beat before the wrap, while still rejecting a
 *            seek from near the end back to somewhere mid-video.
 *
 * naturalMaxS = max(2 × tickInterval × playbackRate, 1.5): two intervals of
 * slack for a late tick, never below 1.5 s so a slow JS thread cannot turn
 * ordinary playback into a "seek".
 */

/**
 * How close to the end of the video the last position must have been for a
 * backwards jump to count as the loop wrapping (vs. a seek). timeUpdate fires
 * every 0.5s and the fastest rate is 1.2x, so a real wrap always lands inside.
 * The wrap rule accepts up to twice this as total distance travelled to cover
 * one late tick.
 */
export const LOOP_WRAP_WINDOW_S = 3;
/** Scoring stays closed this long after a detected seek. */
export const SEEK_SCORING_PAUSE_MS = 1000;
/**
 * After an AirPlay source swap, a backward jump is a seek, never a wrap: the
 * new source briefly reports ~0 before the restored position applies.
 */
export const SWAP_WRAP_SUPPRESS_MS = 2000;
/** Default expo-video `timeUpdateEventInterval` the workout uses. */
export const TICK_INTERVAL_S = 0.5;
/**
 * Video time is only known at tick granularity; between ticks it is
 * extrapolated from the wall clock while playing, capped so a stall cannot run
 * the interpolated clock ahead of the real one by more than this.
 */
export const MAX_EXTRAPOLATION_S = TICK_INTERVAL_S * 1.5;

export type TickKind = 'natural' | 'wrap' | 'seek' | 'stall' | 'ignored';

export type RunClockOptions = {
  playbackRate: number;
  loop: boolean;
  tickIntervalS?: number;
};

export function naturalMaxDeltaS(tickIntervalS: number, playbackRate: number): number {
  const rate = playbackRate > 0 && Number.isFinite(playbackRate) ? playbackRate : 1;
  return Math.max(2 * tickIntervalS * rate, 1.5);
}

export class RunClock {
  private readonly rate: number;
  private readonly loop: boolean;
  private readonly tickIntervalS: number;

  private videoPlayed = 0;
  private lastPosition = 0;
  private length = 0;
  private playing = false;
  private ready = false;
  private swapping = false;
  /** Wall ms of the last credited/anchoring tick, for extrapolation. */
  private lastTickAt = 0;
  private seekPauseUntil = 0;
  private wrapSuppressedUntil = 0;
  private seeks = 0;
  private wraps = 0;

  constructor({ playbackRate, loop, tickIntervalS = TICK_INTERVAL_S }: RunClockOptions) {
    this.rate = playbackRate > 0 && Number.isFinite(playbackRate) ? playbackRate : 1;
    this.loop = loop;
    this.tickIntervalS = tickIntervalS;
  }

  /** Anchor at the player's initial position/duration (both may still be 0). */
  start(position: number, length: number, now = Date.now()): void {
    this.lastPosition = Math.max(0, position);
    if (length > 0) this.length = length;
    this.lastTickAt = now;
  }

  /** Re-read `player.duration` — it changes after an AirPlay source swap. */
  setLength(length: number): void {
    if (Number.isFinite(length) && length > 0) this.length = length;
  }

  setReady(ready: boolean): void {
    this.ready = ready;
  }

  /**
   * `playingChange`. On resume the position is re-anchored so the time spent
   * paused (position unchanged, wall clock advanced) cannot create a phantom
   * delta, and so an external seek performed while paused is not credited.
   */
  setPlaying(isPlaying: boolean, position: number, now = Date.now()): void {
    if (isPlaying && !this.playing) {
      this.lastPosition = Math.max(0, position);
      this.lastTickAt = now;
    }
    this.playing = isPlaying;
  }

  /** AirPlay `replaceAsync` started: ignore ticks until `endSwap`. */
  beginSwap(): void {
    this.swapping = true;
  }

  /**
   * AirPlay swap finished and `currentTime` was restored to `resumeAt`. The
   * anchor moves to `resumeAt` BEFORE crediting resumes, the new source's
   * duration replaces the old one for wrap math, and wraps are suppressed
   * briefly because the new source may still report ~0 on its first tick.
   */
  endSwap(resumeAt: number, length: number, now = Date.now()): void {
    this.lastPosition = Math.max(0, resumeAt);
    this.setLength(length);
    this.swapping = false;
    this.wrapSuppressedUntil = now + SWAP_WRAP_SUPPRESS_MS;
    this.lastTickAt = now;
  }

  /** Feed one `timeUpdate`. Returns how the tick was classified. */
  tick(currentTime: number, now = Date.now()): TickKind {
    if (this.swapping) return 'ignored';
    const position = Math.max(0, Number.isFinite(currentTime) ? currentTime : 0);
    const last = this.lastPosition;
    const delta = position - last;
    const naturalMax = naturalMaxDeltaS(this.tickIntervalS, this.rate);

    if (delta === 0) {
      return 'stall';
    }

    if (delta > 0) {
      this.lastPosition = position;
      this.lastTickAt = now;
      if (delta <= naturalMax) {
        this.videoPlayed += delta;
        return 'natural';
      }
      this.noteSeek(now);
      return 'seek';
    }

    // Backward jump: loop wrap or seek.
    this.lastPosition = position;
    this.lastTickAt = now;
    const travelled = this.length - last + position;
    const wrapAllowed = this.loop && this.length > 0 && now >= this.wrapSuppressedUntil;
    if (wrapAllowed && travelled > 0 && travelled <= LOOP_WRAP_WINDOW_S * 2) {
      this.videoPlayed += travelled;
      this.wraps += 1;
      return 'wrap';
    }
    this.noteSeek(now);
    return 'seek';
  }

  private noteSeek(now: number): void {
    this.seeks += 1;
    this.seekPauseUntil = now + SEEK_SCORING_PAUSE_MS;
  }

  /** Monotonic video seconds actually played, loops included. */
  get videoPlayedSec(): number {
    return this.videoPlayed;
  }

  get videoLengthSec(): number {
    return this.length;
  }

  get lastPositionSec(): number {
    return this.lastPosition;
  }

  get seekCount(): number {
    return this.seeks;
  }

  get wrapCount(): number {
    return this.wraps;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isSwapping(): boolean {
    return this.swapping;
  }

  /** Whether the video is visibly advancing (playing, ready, not mid-swap). */
  isAdvancing(): boolean {
    return this.playing && this.ready && !this.swapping;
  }

  /** The scoring gate: advancing and past any post-seek pause. */
  isScoringActive(now = Date.now()): boolean {
    return this.isAdvancing() && now >= this.seekPauseUntil;
  }

  /**
   * Best estimate of accumulated video time right now: the last tick plus
   * wall-clock extrapolation (rate applied) while advancing, capped.
   */
  videoTimeSec(now = Date.now()): number {
    if (!this.isAdvancing() || !this.lastTickAt) return this.videoPlayed;
    const sinceTick = Math.max(0, (now - this.lastTickAt) / 1000) * this.rate;
    return this.videoPlayed + Math.min(MAX_EXTRAPOLATION_S, sinceTick);
  }

  /**
   * Best estimate of the POSITION inside the video right now (seconds into
   * the current pass), i.e. the last tick's position plus the same capped
   * extrapolation `videoTimeSec` applies, wrapped when a looping source runs
   * past its end between ticks. This is what move samples for consensus
   * charts are stamped with — the loop index is irrelevant to a chart.
   */
  videoPositionSec(now = Date.now()): number {
    let position = this.lastPosition;
    if (this.isAdvancing() && this.lastTickAt) {
      const sinceTick = Math.max(0, (now - this.lastTickAt) / 1000) * this.rate;
      position += Math.min(MAX_EXTRAPOLATION_S, sinceTick);
    }
    if (this.loop && this.length > 0 && position >= this.length) position -= this.length;
    return Math.max(0, position);
  }

  /**
   * Wall-clock seconds the run has lasted (rate divided out); same math as
   * `wallClockElapsed` in playSetup.ts, kept dependency-free for the replay.
   */
  wallElapsedSec(): number {
    return Math.max(0, this.videoPlayed / this.rate);
  }
}

/**
 * Run recording log: the compact, deterministic record of one recorded run
 * that the post-run composer needs to rebuild the game half and the HUD.
 *
 * While the camera is recording (`startRunRecording` in the pose module), the
 * workout feeds this log with:
 *   - every `CueJudgement` (grade, signed delta, move, video time, wall time)
 *     and cue expiry, with the score/combo AFTER it
 *   - `upcomingCue` transitions (HUD chevrons)
 *   - the `RunClock` segment map: contiguous stretches where the map video was
 *     visibly advancing, as (wall range ↔ video range) pairs. Loop wraps start
 *     a new segment at video 0; pauses, stalls, buffering, seeks and AirPlay
 *     swaps close the open segment (the composer freezes the last frame across
 *     the gap)
 *   - a bounded running mean of head/hip height for the camera crop bias
 *   - run metadata (level, intensity, HUD theme, duration target) and the
 *     final summary numbers
 *
 * All wall times are milliseconds relative to the first recorded camera
 * frame (`recording.startedAtEpochMs`), so the composer works in the camera
 * clip's own timeline. Memory is bounded (`MAX_LOG_EVENTS`,
 * `MAX_LOG_SEGMENTS`); past the caps entries are dropped and flagged in
 * `truncated`. The file is JSON, written next to the camera .mp4.
 *
 * Pure TypeScript, no React Native imports: replayed by
 * `npm run test:recording-log`.
 */

import type { BeatmapMove } from '@/lib/beatmaps';
import type { CueGrade, CueJudgement, CueScore } from '@/lib/cueScoring';
import type { TickKind } from '@/lib/runClock';

export const RUN_LOG_VERSION = 1 as const;
/** Hard cap on judgement/expiry/upcoming entries (matches `MAX_JUDGE_EVENTS`). */
export const MAX_LOG_EVENTS = 5000;
/** Hard cap on segments; a 15-minute run with a stall every 2 s is ~450. */
export const MAX_LOG_SEGMENTS = 2000;
/** Head/hip samples averaged for the crop bias (first N frames with both). */
export const MAX_POSE_FOCUS_SAMPLES = 600;

export type RunLogEvent =
  /** Judgement: grade, signed delta ms (null for miss/spurious), cue move, score/combo after. */
  | { k: 'j'; w: number; v: number; g: CueGrade; d: number | null; m: BeatmapMove | null; s: number; c: number }
  /** `n` cues expired on a tick; score/combo after. */
  | { k: 'e'; w: number; v: number; n: number; s: number; c: number }
  /** Upcoming-cue transition: the HUD now shows `m` (null = none) due at video `at`. */
  | { k: 'u'; w: number; m: BeatmapMove | null; at: number | null };

/**
 * A stretch of visibly advancing playback. Wall ms `ws..we` (relative to the
 * recording start, `ws` may be negative if playback began before the first
 * camera frame) maps linearly onto source video seconds `vs..ve`. `r` is the
 * nominal playback rate, informational; the composer scales by the ranges.
 */
export type RunLogSegment = { ws: number; we: number; vs: number; ve: number; r: number; loop: number };

export type RunLogPoseFocus = {
  /** Mean normalized y (0 = top) of the head (nose) across the samples. */
  headY: number;
  /** Mean normalized y of the hips (root, else left/right hip average). */
  hipY: number;
  samples: number;
};

export type RunLogSummary = {
  /** Cue (action) score. */
  score: number;
  /** Composed workout score shown on the summary. */
  totalScore: number;
  accuracy: number;
  maxCombo: number;
  perfect: number;
  good: number;
  miss: number;
  elapsedSeconds: number;
};

export type RunLogMeta = {
  levelId: string;
  levelName: string;
  intensity: string | null;
  playbackRate: number;
  targetSeconds: number;
  hudThemeId: string;
};

export type RunLogFile = RunLogMeta & {
  version: typeof RUN_LOG_VERSION;
  recording: {
    startedAtEpochMs: number;
    endedAtEpochMs: number | null;
    /** Set when iOS interrupted the camera (backgrounding) before `finish`. */
    interruptedAtEpochMs: number | null;
    cameraDurationMs: number | null;
  };
  segments: RunLogSegment[];
  events: RunLogEvent[];
  truncated: { events: boolean; segments: boolean };
  pose: RunLogPoseFocus | null;
  summary: RunLogSummary | null;
};

type OpenSegment = { ws: number; vs: number; we: number; ve: number; loop: number };

type PoseFocusFrame = { keypoints: { name: string; y: number; confidence: number }[] };

export class RunRecordingLog {
  private readonly meta: RunLogMeta;
  private readonly rate: number;
  private zero: number | null = null;
  private endedAt: number | null = null;
  private interruptedAt: number | null = null;
  private cameraDurationMs: number | null = null;
  private readonly segments: RunLogSegment[] = [];
  private readonly events: RunLogEvent[] = [];
  private truncatedEvents = false;
  private truncatedSegments = false;
  private open: OpenSegment | null = null;
  private lastPosition = 0;
  private lastCloseWall = Number.NEGATIVE_INFINITY;
  private loop = 0;
  private videoLength = 0;
  private upcomingKey: string | null = null;
  private focus = { headY: 0, hipY: 0, samples: 0 };
  private summary: RunLogSummary | null = null;

  constructor(meta: RunLogMeta) {
    this.meta = { ...meta };
    this.rate = meta.playbackRate > 0 && Number.isFinite(meta.playbackRate) ? meta.playbackRate : 1;
  }

  /** The recording's first frame: the zero of every wall time in the log. */
  begin(startedAtEpochMs: number): void {
    if (this.zero !== null) return;
    this.zero = startedAtEpochMs;
  }

  get started(): boolean {
    return this.zero !== null;
  }

  get ended(): boolean {
    return this.endedAt !== null;
  }

  get segmentCount(): number {
    return this.segments.length + (this.open ? 1 : 0);
  }

  get eventCount(): number {
    return this.events.length;
  }

  private wall(now: number): number | null {
    return this.zero === null ? null : now - this.zero;
  }

  setVideoLength(lengthSec: number): void {
    if (Number.isFinite(lengthSec) && lengthSec > 0) this.videoLength = lengthSec;
  }

  /** Player anchor before the first tick (`RunClock.start`). */
  anchor(position: number): void {
    this.lastPosition = Math.max(0, position);
  }

  /**
   * Scoring gate changed (`RunClock.isAdvancing()` after a playing/status/swap
   * update). Closing the gate freezes the game half; opening it only records
   * the anchor — the segment opens on the next natural tick, whose delta
   * back-dates the start to the moment playback actually resumed.
   */
  onGate(advancing: boolean, position: number): void {
    if (this.endedAt !== null) return;
    this.lastPosition = Math.max(0, position);
    if (!advancing) this.close();
  }

  /** One classified `RunClock.tick`. */
  onTick(kind: TickKind, position: number, advancing: boolean, now: number): void {
    if (this.endedAt !== null || kind === 'ignored') return;
    const w = this.wall(now);
    const pos = Math.max(0, Number.isFinite(position) ? position : 0);
    if (w === null) {
      this.lastPosition = pos;
      return;
    }
    switch (kind) {
      case 'natural': {
        if (!advancing) {
          this.close();
          break;
        }
        if (this.open) {
          this.open.we = w;
          this.open.ve = pos;
        } else {
          const delta = Math.max(0, pos - this.lastPosition);
          // Back-date to when playback resumed, never into the frozen period.
          const ws = Math.max(this.lastCloseWall, w - (delta / this.rate) * 1000);
          this.open = { ws, vs: pos - delta, we: w, ve: pos, loop: this.loop };
        }
        break;
      }
      case 'wrap': {
        const length = this.videoLength;
        const wrapWall = Math.max(this.open?.ws ?? w, w - (pos / this.rate) * 1000);
        if (this.open) {
          if (length > 0) {
            this.open.ve = length;
            this.open.we = wrapWall;
          }
          this.close(this.open.we);
        }
        this.loop += 1;
        if (advancing) {
          this.open = { ws: wrapWall, vs: 0, we: w, ve: pos, loop: this.loop };
        }
        break;
      }
      case 'seek':
      case 'stall':
        this.close();
        break;
    }
    this.lastPosition = pos;
  }

  /** Close the open segment at wall `atWall` (default: its last natural tick). */
  private close(atWall?: number): void {
    const open = this.open;
    this.open = null;
    if (!open) return;
    const we = atWall ?? open.we;
    this.lastCloseWall = Math.max(this.lastCloseWall, we);
    if (we - open.ws < 1 || open.ve <= open.vs) return;
    if (this.segments.length >= MAX_LOG_SEGMENTS) {
      this.truncatedSegments = true;
      return;
    }
    this.segments.push({
      ws: round1(open.ws),
      we: round1(we),
      vs: round3(open.vs),
      ve: round3(open.ve),
      r: this.rate,
      loop: open.loop,
    });
  }

  private push(event: RunLogEvent): void {
    if (this.events.length >= MAX_LOG_EVENTS) {
      this.truncatedEvents = true;
      return;
    }
    this.events.push(event);
  }

  /** A graded move (`CueJudge.onMove`), with the score AFTER it. */
  onJudgement(judgement: CueJudgement, videoSec: number, score: CueScore, now: number): void {
    const w = this.wall(now);
    if (w === null || this.endedAt !== null) return;
    this.push({
      k: 'j',
      w: round1(w),
      v: round3(videoSec),
      g: judgement.grade,
      d: judgement.deltaMs,
      m: judgement.cue?.move ?? null,
      s: score.score,
      c: score.combo,
    });
  }

  /** `count` cues expired on a tick (`CueJudge.onTick` > 0). */
  onExpiry(count: number, videoSec: number, score: CueScore, now: number): void {
    const w = this.wall(now);
    if (w === null || this.endedAt !== null || count <= 0) return;
    this.push({ k: 'e', w: round1(w), v: round3(videoSec), n: count, s: score.score, c: score.combo });
  }

  /** The HUD's upcoming cue; only transitions are recorded. */
  onUpcoming(cue: { move: BeatmapMove; at: number } | null, now: number): void {
    const w = this.wall(now);
    if (w === null || this.endedAt !== null) return;
    const key = cue ? `${cue.move}@${round3(cue.at)}` : null;
    if (key === this.upcomingKey) return;
    this.upcomingKey = key;
    this.push({ k: 'u', w: round1(w), m: cue?.move ?? null, at: cue ? round3(cue.at) : null });
  }

  /** Running mean of head/hip height (normalized y) for the crop bias. */
  onPose(frame: PoseFocusFrame): void {
    if (this.focus.samples >= MAX_POSE_FOCUS_SAMPLES) return;
    let head: number | null = null;
    let root: number | null = null;
    let leftHip: number | null = null;
    let rightHip: number | null = null;
    for (const point of frame.keypoints) {
      if (point.confidence < 0.3) continue;
      if (point.name === 'nose') head = point.y;
      else if (point.name === 'root') root = point.y;
      else if (point.name === 'leftHip') leftHip = point.y;
      else if (point.name === 'rightHip') rightHip = point.y;
    }
    const hip = root ?? (leftHip !== null && rightHip !== null ? (leftHip + rightHip) / 2 : leftHip ?? rightHip);
    if (head === null || hip === null) return;
    const n = this.focus.samples + 1;
    this.focus = {
      headY: this.focus.headY + (head - this.focus.headY) / n,
      hipY: this.focus.hipY + (hip - this.focus.hipY) / n,
      samples: n,
    };
  }

  /** iOS interrupted the camera; the clip ends here even if the run goes on. */
  markInterrupted(now: number, cameraDurationMs: number | null): void {
    if (this.interruptedAt !== null) return;
    this.interruptedAt = now;
    if (cameraDurationMs !== null) this.cameraDurationMs = cameraDurationMs;
    this.close();
    this.endedAt = now;
  }

  setSummary(summary: RunLogSummary): void {
    this.summary = { ...summary };
  }

  /** Recording stopped (`stopRunRecording` resolved). Idempotent. */
  end(now: number, cameraDurationMs: number | null): void {
    if (cameraDurationMs !== null) this.cameraDurationMs = cameraDurationMs;
    if (this.endedAt !== null) return;
    this.close();
    this.endedAt = now;
  }

  toFile(): RunLogFile {
    const segments = this.segments.slice();
    if (this.open) {
      const open = this.open;
      if (open.we - open.ws >= 1 && open.ve > open.vs && segments.length < MAX_LOG_SEGMENTS) {
        segments.push({
          ws: round1(open.ws),
          we: round1(open.we),
          vs: round3(open.vs),
          ve: round3(open.ve),
          r: this.rate,
          loop: open.loop,
        });
      }
    }
    return {
      version: RUN_LOG_VERSION,
      ...this.meta,
      recording: {
        startedAtEpochMs: this.zero ?? 0,
        endedAtEpochMs: this.endedAt,
        interruptedAtEpochMs: this.interruptedAt,
        cameraDurationMs: this.cameraDurationMs,
      },
      segments,
      events: this.events.slice(),
      truncated: { events: this.truncatedEvents, segments: this.truncatedSegments },
      pose: this.focus.samples > 0 ? { ...this.focus, headY: round3(this.focus.headY), hipY: round3(this.focus.hipY) } : null,
      summary: this.summary ? { ...this.summary } : null,
    };
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function serializeRunLog(file: RunLogFile): string {
  return JSON.stringify(file);
}

const MOVES = new Set(['jump', 'duck', 'left', 'right']);
const GRADES = new Set(['perfect', 'good', 'miss']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseSegment(raw: unknown): RunLogSegment | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!isFiniteNumber(s.ws) || !isFiniteNumber(s.we) || !isFiniteNumber(s.vs) || !isFiniteNumber(s.ve)) return null;
  if (s.we < s.ws || s.ve < s.vs) return null;
  return {
    ws: s.ws,
    we: s.we,
    vs: s.vs,
    ve: s.ve,
    r: isFiniteNumber(s.r) && s.r > 0 ? s.r : 1,
    loop: isFiniteNumber(s.loop) ? s.loop : 0,
  };
}

function parseEvent(raw: unknown): RunLogEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (!isFiniteNumber(e.w)) return null;
  switch (e.k) {
    case 'j': {
      if (!isFiniteNumber(e.v) || !GRADES.has(e.g as string) || !isFiniteNumber(e.s) || !isFiniteNumber(e.c)) return null;
      const move = typeof e.m === 'string' && MOVES.has(e.m) ? (e.m as BeatmapMove) : null;
      return { k: 'j', w: e.w, v: e.v, g: e.g as CueGrade, d: isFiniteNumber(e.d) ? e.d : null, m: move, s: e.s, c: e.c };
    }
    case 'e':
      if (!isFiniteNumber(e.v) || !isFiniteNumber(e.n) || !isFiniteNumber(e.s) || !isFiniteNumber(e.c)) return null;
      return { k: 'e', w: e.w, v: e.v, n: e.n, s: e.s, c: e.c };
    case 'u': {
      const move = typeof e.m === 'string' && MOVES.has(e.m) ? (e.m as BeatmapMove) : null;
      return { k: 'u', w: e.w, m: move, at: isFiniteNumber(e.at) ? e.at : null };
    }
    default:
      return null;
  }
}

/** Parse a serialized log; `null` on any malformed input (never throws). */
export function parseRunLog(json: string): RunLogFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const file = raw as Record<string, unknown>;
  if (file.version !== RUN_LOG_VERSION) return null;
  if (typeof file.levelId !== 'string' || !file.levelId) return null;
  const recording = (file.recording ?? {}) as Record<string, unknown>;
  if (!isFiniteNumber(recording.startedAtEpochMs)) return null;
  const segments = Array.isArray(file.segments) ? file.segments.map(parseSegment) : [];
  const events = Array.isArray(file.events) ? file.events.map(parseEvent) : [];
  if (segments.some((s) => s === null) || events.some((e) => e === null)) return null;
  const truncated = (file.truncated ?? {}) as Record<string, unknown>;
  const pose = file.pose as Record<string, unknown> | null | undefined;
  const summary = file.summary as Record<string, unknown> | null | undefined;
  return {
    version: RUN_LOG_VERSION,
    levelId: file.levelId,
    levelName: typeof file.levelName === 'string' ? file.levelName : file.levelId,
    intensity: typeof file.intensity === 'string' ? file.intensity : null,
    playbackRate: isFiniteNumber(file.playbackRate) && file.playbackRate > 0 ? file.playbackRate : 1,
    targetSeconds: isFiniteNumber(file.targetSeconds) ? file.targetSeconds : 0,
    hudThemeId: typeof file.hudThemeId === 'string' ? file.hudThemeId : 'volt',
    recording: {
      startedAtEpochMs: recording.startedAtEpochMs,
      endedAtEpochMs: isFiniteNumber(recording.endedAtEpochMs) ? recording.endedAtEpochMs : null,
      interruptedAtEpochMs: isFiniteNumber(recording.interruptedAtEpochMs) ? recording.interruptedAtEpochMs : null,
      cameraDurationMs: isFiniteNumber(recording.cameraDurationMs) ? recording.cameraDurationMs : null,
    },
    segments: segments as RunLogSegment[],
    events: events as RunLogEvent[],
    truncated: { events: truncated.events === true, segments: truncated.segments === true },
    pose:
      pose && isFiniteNumber(pose.headY) && isFiniteNumber(pose.hipY) && isFiniteNumber(pose.samples)
        ? { headY: pose.headY, hipY: pose.hipY, samples: pose.samples }
        : null,
    summary:
      summary &&
      isFiniteNumber(summary.score) &&
      isFiniteNumber(summary.totalScore) &&
      isFiniteNumber(summary.accuracy) &&
      isFiniteNumber(summary.maxCombo)
        ? {
            score: summary.score,
            totalScore: summary.totalScore,
            accuracy: summary.accuracy,
            maxCombo: summary.maxCombo,
            perfect: isFiniteNumber(summary.perfect) ? summary.perfect : 0,
            good: isFiniteNumber(summary.good) ? summary.good : 0,
            miss: isFiniteNumber(summary.miss) ? summary.miss : 0,
            elapsedSeconds: isFiniteNumber(summary.elapsedSeconds) ? summary.elapsedSeconds : 0,
          }
        : null,
  };
}

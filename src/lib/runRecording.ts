/**
 * Run recording orchestration (JS side of docs/RUN_RECORDING.md).
 *
 *   workout.tsx ── RunRecordingSession ──▶ camera .mp4 + run log .json (Caches)
 *                                            │ staged by runId
 *   summary.tsx ── consumeRecordedRun ──▶ composeRecordedRun ──▶ share .mp4
 *
 * `RunRecordingSession` wraps the pose module's writer and the
 * `RunRecordingLog`: it starts both, mirrors the writer's terminal states
 * (interrupted on backgrounding, error) into the log, and on `finish` writes
 * the log next to the clip. `composeRecordedRun` builds the pure-TS
 * `CompositionPlan` from that log and hands it to the Swift composer, which
 * writes straight into the clips library (`clipsLibrary.ts`, Documents/clips,
 * newest 10 or 1 GiB); the raw camera clip + log are then deleted.
 *
 * All file paths are absolute (no `file://`) because the native modules take
 * plain paths; `toFileUri` converts for expo-sharing / expo-media-library.
 */

import {
  addRecordingStateListener,
  cancelRunRecording,
  isRunRecordingSupported,
  startRunRecording,
  stopRunRecording,
  type RecordingStateEvent,
} from 'cardiosurf-pose';
import { File } from 'expo-file-system';
import { composeRunVideo, isComposerSupported, probeVideo } from '../../modules/cardiosurf-composer';
import { clipThumbnailPath, clipVideoPath, deleteClip, registerClip } from '@/lib/clipsLibrary';
import { getCachedCompositeAsset, prefetchCompositeAsset } from '@/lib/compositeAssetCache';
import {
  buildCompositionPlan,
  validateCompositionPlan,
  type CompositionPlan,
  type PlanThemeColors,
} from '@/lib/compositionPlan';
import {
  RunRecordingLog,
  parseRunLog,
  serializeRunLog,
  type RunLogFile,
  type RunLogMeta,
  type RunLogSummary,
} from '@/lib/runRecordingLog';

/** The raw material one recorded run leaves behind for the summary. */
export type RecordedRun = {
  runId: string;
  levelId: string;
  cameraPath: string;
  logPath: string;
  startedAtEpochMs: number;
  cameraDurationMs: number;
  interrupted: boolean;
};

export type ComposedRunVideo = {
  runId: string;
  /** Absolute path inside the clips library (no `file://`). */
  path: string;
  thumbnailPath: string | null;
  durationMs: number;
  fileBytes: number;
  composeMs: number;
  /** Set when the video is registered in the clips library (`/clip/[id]`). */
  clipId: string | null;
};

/** Sharing a run video needs the writer, the composer and iOS. */
export const isRunRecordingAvailable = isRunRecordingSupported && isComposerSupported;

// MARK: - Session (workout)

export type RunRecordingSessionOptions = RunLogMeta & { runId: string };

export class RunRecordingSession {
  readonly log: RunRecordingLog;
  readonly runId: string;
  readonly levelId: string;
  private startPromise: Promise<{ path: string; startedAtEpochMs: number }> | null = null;
  private cameraPath: string | null = null;
  private startedAtEpochMs = 0;
  private terminal: RecordingStateEvent | null = null;
  private subscription: { remove(): void } | null = null;
  private finished: Promise<RecordedRun> | null = null;
  private cancelled = false;

  constructor(options: RunRecordingSessionOptions) {
    const { runId, ...meta } = options;
    this.runId = runId;
    this.levelId = meta.levelId;
    this.log = new RunRecordingLog(meta);
    this.subscription = addRecordingStateListener((event) => this.onState(event));
  }

  /** The writer has (or had) a file: recording is on for this run. */
  get active(): boolean {
    return this.startPromise !== null && !this.cancelled;
  }

  get recording(): boolean {
    return this.log.started && !this.log.ended && !this.cancelled;
  }

  /**
   * Start the camera writer. Resolves once the first frame is written (the
   * log's wall-time zero). Safe to call once; later calls return the same
   * promise. Rejects when the native writer cannot start; the run itself is
   * unaffected — callers just drop the recording.
   */
  start(): Promise<{ path: string; startedAtEpochMs: number }> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = startRunRecording().then((result) => {
      if (this.cancelled) {
        cancelRunRecording();
        throw new Error('Recording cancelled before it started');
      }
      this.cameraPath = result.path;
      this.startedAtEpochMs = result.startedAtEpochMs;
      this.log.begin(result.startedAtEpochMs);
      return result;
    });
    return this.startPromise;
  }

  private onState(event: RecordingStateEvent): void {
    if (this.terminal) return;
    if (event.state === 'interrupted') {
      this.terminal = event;
      this.log.markInterrupted(Date.now(), event.durationMs ?? null);
    } else if (event.state === 'error' || event.state === 'cancelled' || event.state === 'finished') {
      this.terminal = event;
    }
  }

  /**
   * Stop the writer, stamp the summary, write the log next to the clip.
   * Idempotent. Rejects when nothing usable was recorded (never started,
   * cancelled, writer error) — the summary then shows no video card.
   */
  finish(summary: RunLogSummary): Promise<RecordedRun> {
    if (this.finished) return this.finished;
    this.finished = this.finishInternal(summary);
    return this.finished;
  }

  private async finishInternal(summary: RunLogSummary): Promise<RecordedRun> {
    try {
      if (!this.startPromise || this.cancelled) throw new Error('Recording never started');
      await this.startPromise;
      this.log.setSummary(summary);
      let cameraDurationMs: number;
      let interrupted = false;
      if (this.terminal?.state === 'interrupted') {
        interrupted = true;
        cameraDurationMs = this.terminal.durationMs ?? 0;
      } else if (this.terminal?.state === 'error' || this.terminal?.state === 'cancelled') {
        throw new Error(this.terminal.message ?? `Recording ${this.terminal.state}`);
      } else {
        const stopped = await stopRunRecording();
        cameraDurationMs = stopped.durationMs;
      }
      this.log.end(Date.now(), cameraDurationMs);
      const cameraPath = this.cameraPath;
      if (!cameraPath || cameraDurationMs <= 0) throw new Error('Empty recording');
      const logPath = cameraPath.replace(/\.mp4$/, '') + '.json';
      new File(toFileUri(logPath)).write(serializeRunLog(this.log.toFile()));
      return {
        runId: this.runId,
        levelId: this.levelId,
        cameraPath,
        logPath,
        startedAtEpochMs: this.startedAtEpochMs,
        cameraDurationMs,
        interrupted,
      };
    } finally {
      this.subscription?.remove();
      this.subscription = null;
    }
  }

  /** Early exit: abort the writer and delete the file. */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.subscription?.remove();
    this.subscription = null;
    cancelRunRecording();
    if (this.cameraPath) safeDelete(this.cameraPath);
  }
}

// MARK: - Staging (workout → summary)

const staged = new Map<string, Promise<RecordedRun>>();

/** Hand the (pending) recorded run to the summary screen by runId. */
export function stageRecordedRun(runId: string, recorded: Promise<RecordedRun>): void {
  staged.set(runId, recorded.catch((error) => {
    staged.delete(runId);
    throw error;
  }));
}

export function consumeRecordedRun(runId: string | undefined): Promise<RecordedRun> | null {
  if (!runId) return null;
  const pending = staged.get(runId) ?? null;
  staged.delete(runId);
  return pending;
}

export function hasStagedRecordedRun(runId: string | undefined): boolean {
  return !!runId && staged.has(runId);
}

// MARK: - Composition (summary)

export type ComposeRunOptions = {
  theme: PlanThemeColors;
  endCard: { levelName: string; score: number; accuracyPct: number; maxCombo: number; personalBest: boolean };
  /** Default false — the owner has not confirmed music rights. */
  includeGameAudio?: boolean;
  onProgress?: (progress: number) => void;
};

export class ComposeError extends Error {
  readonly stage: 'asset' | 'log' | 'plan' | 'compose';
  constructor(stage: ComposeError['stage'], message: string) {
    super(message);
    this.stage = stage;
  }
}

/** Build the plan for a recorded run (exported for diagnostics / tests via the pure builder). */
export async function planForRecordedRun(
  recorded: RecordedRun,
  gamePath: string,
  options: Pick<ComposeRunOptions, 'theme' | 'endCard' | 'includeGameAudio'>,
): Promise<{ plan: CompositionPlan; log: RunLogFile }> {
  let log: RunLogFile | null;
  try {
    log = parseRunLog(await new File(toFileUri(recorded.logPath)).text());
  } catch {
    log = null;
  }
  if (!log) throw new ComposeError('log', 'The run log could not be read');
  let gameDurationSec: number;
  try {
    gameDurationSec = (await probeVideo(gamePath)).durationSec;
  } catch {
    throw new ComposeError('asset', 'The game asset could not be read');
  }
  const plan = buildCompositionPlan(log, {
    gameDurationSec,
    cameraDurationSec: recorded.cameraDurationMs / 1000,
    theme: options.theme,
    endCard: options.endCard,
    includeGameAudio: options.includeGameAudio === true,
  });
  try {
    validateCompositionPlan(plan);
  } catch (error) {
    throw new ComposeError('plan', (error as Error).message);
  }
  return { plan, log };
}

/**
 * Compose the share video for a recorded run. Ensures the level's composite
 * game asset is cached (foreground download if the prefetch did not land),
 * builds the plan, runs the Swift composer straight into the clips directory,
 * registers the clip (which evicts what the retention policy drops), then
 * removes the raw clip and log.
 */
export async function composeRecordedRun(
  recorded: RecordedRun,
  options: ComposeRunOptions,
): Promise<ComposedRunVideo> {
  if (!isComposerSupported) throw new ComposeError('compose', 'Run video composer is not available');
  const gamePath = getCachedCompositeAsset(recorded.levelId) ?? (await prefetchCompositeAsset(recorded.levelId));
  if (!gamePath) throw new ComposeError('asset', "Recording isn't available for this map yet.");
  const { plan } = await planForRecordedRun(recorded, gamePath, options);
  const outputPath = clipVideoPath(recorded.runId);
  const thumbnailPath = clipThumbnailPath(recorded.runId);
  let result;
  try {
    result = await composeRunVideo({
      cameraPath: recorded.cameraPath,
      gamePath,
      planJson: JSON.stringify(plan),
      outputPath,
      thumbnailPath,
      onProgress: options.onProgress,
    });
  } catch (error) {
    throw new ComposeError('compose', (error as Error).message || 'Export failed');
  }
  safeDelete(recorded.cameraPath);
  safeDelete(recorded.logPath);
  const clip = registerClip({
    id: recorded.runId,
    levelId: recorded.levelId,
    score: options.endCard.score,
    accuracy: options.endCard.accuracyPct / 100,
    createdAt: recorded.startedAtEpochMs || Date.now(),
    durationMs: result.durationMs,
    sourcePath: result.path,
    sourceThumbPath: result.thumbnailPath,
  });
  return {
    runId: recorded.runId,
    path: clip?.filePath ?? result.path,
    thumbnailPath: clip ? clip.thumbFilePath : result.thumbnailPath,
    durationMs: result.durationMs,
    fileBytes: clip?.bytes ?? result.fileBytes,
    composeMs: result.composeMs,
    clipId: clip?.id ?? null,
  };
}

/** Delete one composite: its clips-library entry, video and thumbnail. */
export function deleteRunVideo(video: Pick<ComposedRunVideo, 'runId' | 'path' | 'thumbnailPath'>): void {
  deleteClip(video.runId);
  // The library and the compose output share a path, so these are normally already gone.
  safeDelete(video.path);
  if (video.thumbnailPath) safeDelete(video.thumbnailPath);
}

/** Discard a recorded run that will not be composed (raw clip + log). */
export function discardRecordedRun(recorded: Pick<RecordedRun, 'cameraPath' | 'logPath'>): void {
  safeDelete(recorded.cameraPath);
  safeDelete(recorded.logPath);
}

export function fileBytes(path: string): number {
  try {
    return new File(toFileUri(path)).size;
  } catch {
    return 0;
  }
}

function safeDelete(path: string): void {
  try {
    const file = new File(toFileUri(path));
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}

export function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${encodeURI(path)}`;
}

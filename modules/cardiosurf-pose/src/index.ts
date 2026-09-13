import {
  type EventSubscription,
  type NativeModule,
  requireNativeViewManager,
  requireOptionalNativeModule,
} from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type NativePosePoint = {
  name: string;
  x: number;
  y: number;
  confidence: number;
};

export type NativePoseFrame = {
  keypoints: NativePosePoint[];
  /** Epoch ms at dispatch on the main thread (historical field). */
  timestamp: number;
  /**
   * Latency stamps, all epoch ms in the `Date.now()` domain. Optional because
   * app builds that predate them (≤ build 19) do not emit them.
   */
  captureTs?: number;
  extractedTs?: number;
  dispatchTs?: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type CardioSurfPoseViewProps = {
  active: boolean;
  /**
   * The run may be recorded: the capture session runs at 1280x720 from its
   * first frame so a later `startRecording()` never changes the frame size
   * mid-run (which would reset the analyzer's calibration). Pass the same
   * value to every pose view of one run (preflight and workout).
   */
  recordingEnabled?: boolean;
  onPose?: (event: { nativeEvent: NativePoseFrame }) => void;
  onStatus?: (event: { nativeEvent: { status: string } }) => void;
  style?: StyleProp<ViewStyle>;
};

/** Resolved by `startRecording()` once the writer has its first camera frame. */
export type RecordingStartResult = {
  /** Absolute path of the .mp4 in Caches (not a file:// URI). */
  path: string;
  /** Epoch ms of the first recorded frame (`Date.now()` domain, via `epochOffsetMs`). */
  startedAtEpochMs: number;
};

export type RecordingStopResult = RecordingStartResult & {
  durationMs: number;
  frames: number;
  dropped: number;
};

export type RecordingState =
  | 'finished'
  /** iOS interrupted the camera (backgrounding); the file was finalized where it stopped. */
  | 'interrupted'
  | 'cancelled'
  | 'error';

export type RecordingStateEvent = Partial<RecordingStopResult> & {
  state: RecordingState;
  message?: string;
};

type CardioSurfPoseEvents = {
  onRecordingState(event: RecordingStateEvent): void;
};

declare class CardioSurfPoseNativeModule extends NativeModule<CardioSurfPoseEvents> {
  startRecording(): Promise<RecordingStartResult>;
  stopRecording(): Promise<RecordingStopResult>;
  cancelRecording(): void;
  isRecording(): boolean;
}

const nativeModule = requireOptionalNativeModule<CardioSurfPoseNativeModule>('CardioSurfPose');

export const isCardioSurfPoseAvailable = nativeModule !== null;

/**
 * The binary includes the recording functions (builds before them expose the
 * view but no `startRecording`).
 */
export const isRunRecordingSupported =
  nativeModule !== null && typeof nativeModule.startRecording === 'function';

let NativeView: ComponentType<CardioSurfPoseViewProps> | null = null;
if (isCardioSurfPoseAvailable) {
  NativeView = requireNativeViewManager<CardioSurfPoseViewProps>('CardioSurfPose');
}

export function getCardioSurfPoseView() {
  return NativeView;
}

function unsupported(): Error {
  return new Error('Run recording is not available in this build');
}

/**
 * Start writing the camera feed (720p H.264) to a temp .mp4 in Caches.
 * Requires an active pose view. Resolves on the first written frame.
 */
export function startRunRecording(): Promise<RecordingStartResult> {
  if (!isRunRecordingSupported || !nativeModule) return Promise.reject(unsupported());
  return nativeModule.startRecording();
}

/** Finalize the current recording. Rejects when nothing is recording. */
export function stopRunRecording(): Promise<RecordingStopResult> {
  if (!isRunRecordingSupported || !nativeModule) return Promise.reject(unsupported());
  return nativeModule.stopRecording();
}

/** Abort and delete the current recording (no-op when idle / unsupported). */
export function cancelRunRecording(): void {
  if (!isRunRecordingSupported || !nativeModule) return;
  try {
    nativeModule.cancelRecording();
  } catch {
    // Nothing to cancel.
  }
}

export function isRunRecordingActive(): boolean {
  if (!isRunRecordingSupported || !nativeModule) return false;
  try {
    return nativeModule.isRecording();
  } catch {
    return false;
  }
}

/** Terminal recording states (finished / interrupted / cancelled / error). */
export function addRecordingStateListener(
  listener: (event: RecordingStateEvent) => void,
): EventSubscription {
  if (!isRunRecordingSupported || !nativeModule) return { remove() {} };
  return nativeModule.addListener('onRecordingState', listener);
}

import type { EventSubscription } from 'expo-modules-core';
import CardioSurfComposerModule, {
  type ComposeProgressEvent,
  type NativeComposeOptions,
  type NativeComposeResult,
  type NativeProbeResult,
} from './src/CardioSurfComposerModule';

export type { ComposeProgressEvent, NativeComposeOptions, NativeComposeResult, NativeProbeResult };

/** Duration and dimensions of a local video file. */
export function probeVideo(path: string): Promise<NativeProbeResult> {
  if (!CardioSurfComposerModule) {
    return Promise.reject(new Error('Run video composer is not available in this build'));
  }
  return CardioSurfComposerModule.probe(path);
}

/** True on an iOS build that links the local module. */
export const isComposerSupported = CardioSurfComposerModule !== null;

export type ComposeOptions = Omit<NativeComposeOptions, 'jobId'> & {
  jobId?: string;
  onProgress?: (progress: number) => void;
};

let jobCounter = 0;

/**
 * Run one composition. Progress events for other jobs are ignored. Rejects
 * where the module is missing so callers can show "not available" rather
 * than hang.
 */
export async function composeRunVideo(options: ComposeOptions): Promise<NativeComposeResult> {
  if (!CardioSurfComposerModule) {
    throw new Error('Run video composer is not available in this build');
  }
  const jobId = options.jobId ?? `compose-${Date.now()}-${++jobCounter}`;
  let subscription: EventSubscription | null = null;
  if (options.onProgress) {
    const onProgress = options.onProgress;
    subscription = CardioSurfComposerModule.addListener('onComposeProgress', (event) => {
      if (event.jobId === jobId) onProgress(Math.max(0, Math.min(1, event.progress)));
    });
  }
  try {
    return await CardioSurfComposerModule.compose({
      jobId,
      cameraPath: options.cameraPath,
      gamePath: options.gamePath,
      planJson: options.planJson,
      outputPath: options.outputPath,
      ...(options.thumbnailPath ? { thumbnailPath: options.thumbnailPath } : {}),
    });
  } finally {
    subscription?.remove();
  }
}

export function cancelComposition(): void {
  try {
    CardioSurfComposerModule?.cancel();
  } catch {
    // Nothing running.
  }
}

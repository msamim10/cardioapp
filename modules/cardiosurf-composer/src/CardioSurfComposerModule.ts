import { type NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export type ComposeProgressEvent = {
  jobId: string;
  /** 0..1 from `AVAssetExportSession.progress`. */
  progress: number;
};

export type NativeComposeOptions = {
  jobId: string;
  /** Absolute paths (no `file://`). */
  cameraPath: string;
  gamePath: string;
  /** `CompositionPlan` (src/lib/compositionPlan.ts) as JSON. */
  planJson: string;
  outputPath: string;
  thumbnailPath?: string;
};

export type NativeComposeResult = {
  path: string;
  thumbnailPath: string | null;
  durationMs: number;
  fileBytes: number;
  composeMs: number;
};

type CardioSurfComposerEvents = {
  onComposeProgress(event: ComposeProgressEvent): void;
};

export type NativeProbeResult = {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

declare class CardioSurfComposerNativeModule extends NativeModule<CardioSurfComposerEvents> {
  isAvailable(): boolean;
  probe(path: string): Promise<NativeProbeResult>;
  compose(options: NativeComposeOptions): Promise<NativeComposeResult>;
  cancel(): void;
}

/**
 * `null` in Expo Go, on Android, on web, and in binaries built before the
 * module existed. Callers treat that as "sharing a run video is unavailable".
 */
const CardioSurfComposerModule =
  requireOptionalNativeModule<CardioSurfComposerNativeModule>('CardioSurfComposer');

export default CardioSurfComposerModule;

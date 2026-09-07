import { type NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export type ExternalDisplayChangeEvent = {
  /** A second display (AirPlay screen mirroring, HDMI adapter…) is attached. */
  connected: boolean;
  /** That display is mirroring the phone rather than showing a dedicated window. */
  mirrored: boolean;
  /** Raw `UIScreen.screens.count`; 1 means phone only. */
  screenCount: number;
};

type ExternalDisplayEvents = {
  onExternalDisplayChange(event: ExternalDisplayChangeEvent): void;
};

declare class ExternalDisplayNativeModule extends NativeModule<ExternalDisplayEvents> {
  isExternalDisplayConnected(): boolean;
  isMirrored(): boolean;
  getState(): ExternalDisplayChangeEvent;
}

/**
 * `null` in Expo Go, on Android, on web, and in any binary built before the
 * module was added. Callers must treat that as "detection unsupported", never as
 * "no TV".
 */
const ExternalDisplayModule =
  requireOptionalNativeModule<ExternalDisplayNativeModule>('ExternalDisplay');

export default ExternalDisplayModule;

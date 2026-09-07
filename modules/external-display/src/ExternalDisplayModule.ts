import { type NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export type ExternalDisplayChangeEvent = {
  /**
   * The phone is driving a TV by either path: a second display is attached
   * (`screenCount > 1`) or an AirPlay output route is selected (`airPlayActive`).
   */
  connected: boolean;
  /** A second display is mirroring the phone rather than showing a dedicated window. */
  mirrored: boolean;
  /** Raw `UIScreen.screens.count`; 1 means phone only. */
  screenCount: number;
  /**
   * The app's audio session is routed to an AirPlay receiver (what the native
   * AirPlay route picker sets). Video then plays on the receiver via external
   * playback; no second `UIScreen` is created for this.
   */
  airPlayActive: boolean;
  /** Receiver name(s) from the AirPlay route (e.g. "Living Room TV"); null when none. */
  airPlayDeviceName: string | null;
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

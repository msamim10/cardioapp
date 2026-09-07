import type { EventSubscription } from 'expo-modules-core';
import { useEffect, useState } from 'react';
import ExternalDisplayModule, { type ExternalDisplayChangeEvent } from './src/ExternalDisplayModule';

export type { ExternalDisplayChangeEvent } from './src/ExternalDisplayModule';

export type ExternalDisplayStatus = {
  /**
   * The native module is present (iOS build with the local module linked).
   * When false, every other field is false/null and means nothing; fall back
   * to asking the user.
   */
  supported: boolean;
  /** A TV is reachable by either path: second screen or AirPlay route. */
  connected: boolean;
  /** A second screen is mirroring the phone (Control Center → Screen Mirroring). */
  mirrored: boolean;
  /** The AirPlay route picker has an AirPlay receiver selected. */
  airPlayActive: boolean;
  /** Name of the selected AirPlay receiver, when iOS reports one. */
  airPlayDeviceName: string | null;
};

const UNSUPPORTED: ExternalDisplayStatus = {
  supported: false,
  connected: false,
  mirrored: false,
  airPlayActive: false,
  airPlayDeviceName: null,
};

/** True when real detection is available (iOS native build). */
export const isExternalDisplaySupported = ExternalDisplayModule !== null;

function fromEvent(event: ExternalDisplayChangeEvent): ExternalDisplayStatus {
  // Older binaries (built before AirPlay routing was observed) omit the last
  // two fields; treat them as "no route" rather than undefined.
  const airPlayActive = event.airPlayActive === true;
  const airPlayDeviceName =
    typeof event.airPlayDeviceName === 'string' && event.airPlayDeviceName.length > 0
      ? event.airPlayDeviceName
      : null;
  return {
    supported: true,
    connected: event.connected === true || airPlayActive,
    mirrored: event.mirrored === true,
    airPlayActive,
    airPlayDeviceName,
  };
}

function readStatus(): ExternalDisplayStatus {
  if (!ExternalDisplayModule) return UNSUPPORTED;
  try {
    return fromEvent(ExternalDisplayModule.getState());
  } catch {
    return UNSUPPORTED;
  }
}

/** Synchronous read. Returns `false` wherever detection is unsupported. */
export function isExternalDisplayConnected(): boolean {
  return readStatus().connected;
}

/** Synchronous read. Returns `false` wherever detection is unsupported. */
export function isExternalDisplayMirrored(): boolean {
  return readStatus().mirrored;
}

export function getExternalDisplayStatus(): ExternalDisplayStatus {
  return readStatus();
}

/**
 * Subscribe to connect/disconnect changes. No-op (returns an inert
 * subscription) where the native module is missing.
 */
export function addExternalDisplayListener(
  listener: (event: ExternalDisplayChangeEvent) => void,
): EventSubscription {
  if (!ExternalDisplayModule) {
    return { remove() {} };
  }
  return ExternalDisplayModule.addListener('onExternalDisplayChange', listener);
}

/**
 * Live TV-connection status. Re-reads on mount (the screen or route may already
 * be set up) and follows `UIScreen` connect/disconnect notifications plus
 * `AVAudioSession` route changes.
 */
export function useExternalDisplay(): ExternalDisplayStatus {
  const [status, setStatus] = useState<ExternalDisplayStatus>(readStatus);

  useEffect(() => {
    if (!ExternalDisplayModule) return;
    setStatus(readStatus());
    const subscription = addExternalDisplayListener((event) => {
      setStatus(fromEvent(event));
    });
    return () => subscription.remove();
  }, []);

  return status;
}

import type { EventSubscription } from 'expo-modules-core';
import { useEffect, useState } from 'react';
import ExternalDisplayModule, { type ExternalDisplayChangeEvent } from './src/ExternalDisplayModule';

export type { ExternalDisplayChangeEvent } from './src/ExternalDisplayModule';

export type ExternalDisplayStatus = {
  /**
   * The native module is present (iOS build with the local module linked).
   * When false, `connected` and `mirrored` are always false and mean nothing;
   * fall back to asking the user.
   */
  supported: boolean;
  connected: boolean;
  mirrored: boolean;
};

const UNSUPPORTED: ExternalDisplayStatus = { supported: false, connected: false, mirrored: false };

/** True when real detection is available (iOS native build). */
export const isExternalDisplaySupported = ExternalDisplayModule !== null;

function readStatus(): ExternalDisplayStatus {
  if (!ExternalDisplayModule) return UNSUPPORTED;
  try {
    const state = ExternalDisplayModule.getState();
    return { supported: true, connected: state.connected, mirrored: state.mirrored };
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
 * Live external-display status. Re-reads on mount (the screen may already be
 * attached) and follows `UIScreen` connect/disconnect notifications.
 */
export function useExternalDisplay(): ExternalDisplayStatus {
  const [status, setStatus] = useState<ExternalDisplayStatus>(readStatus);

  useEffect(() => {
    if (!ExternalDisplayModule) return;
    setStatus(readStatus());
    const subscription = addExternalDisplayListener((event) => {
      setStatus({ supported: true, connected: event.connected, mirrored: event.mirrored });
    });
    return () => subscription.remove();
  }, []);

  return status;
}

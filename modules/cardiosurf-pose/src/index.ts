import {
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
  onPose?: (event: { nativeEvent: NativePoseFrame }) => void;
  onStatus?: (event: { nativeEvent: { status: string } }) => void;
  style?: StyleProp<ViewStyle>;
};

export const isCardioSurfPoseAvailable =
  requireOptionalNativeModule('CardioSurfPose') !== null;

let NativeView: ComponentType<CardioSurfPoseViewProps> | null = null;
if (isCardioSurfPoseAvailable) {
  NativeView = requireNativeViewManager<CardioSurfPoseViewProps>('CardioSurfPose');
}

export function getCardioSurfPoseView() {
  return NativeView;
}

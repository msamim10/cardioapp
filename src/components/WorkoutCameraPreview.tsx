import Ionicons from '@expo/vector-icons/Ionicons';
import { getCardioSurfPoseView } from 'cardiosurf-pose';
import type { NativePoseFrame } from 'cardiosurf-pose';
import { CameraView } from 'expo-camera';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PoseOverlay } from '@/components/PoseOverlay';
import {
  POSE_JOINTS,
  PoseFeedback,
  PoseFrame,
  PoseScore,
  PoseTrackingMode,
} from '@/lib/poseTracking';
import { colors, font, radius, spacing } from '@/theme';

type WorkoutCameraPreviewProps = {
  active: boolean;
  onUnavailable?: () => void;
  onPoseFrame: (frame: PoseFrame) => void;
  onTrackingStatus?: (status: 'searching') => void;
  permission: { granted: boolean } | null;
  poseFrame: PoseFrame | null;
  poseFeedback: PoseFeedback;
  poseScore: PoseScore;
  /** Playback elapsed seconds for hybrid progress + action scoring. */
  playbackElapsed?: number;
  /** Playback duration seconds for hybrid progress + action scoring. */
  playbackDuration?: number;
  trackingMode: PoseTrackingMode;
  unavailableReason: string;
  variant?: 'companion' | 'pip' | 'setup';
};

export function WorkoutCameraPreview({
  active,
  onUnavailable,
  onPoseFrame,
  onTrackingStatus,
  permission,
  poseFrame,
  poseFeedback,
  poseScore,
  playbackElapsed = 0,
  playbackDuration = 0,
  trackingMode,
  unavailableReason,
  variant = 'companion',
}: WorkoutCameraPreviewProps) {
  const [appState, setAppState] = useState(AppState.currentState);
  const [ready, setReady] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const isForeground = appState === 'active';
  const cameraActive = active && isForeground;
  const NativePoseCamera = useMemo(() => getCardioSurfPoseView(), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  const openSettings = () => {
    Linking.openSettings().catch(() => {});
  };

  if (mountError && trackingMode === 'real') {
    if (variant === 'pip') return null;

    return (
      <CameraFallback
        icon="camera-outline"
        title="Camera preview unavailable"
        detail={
          __DEV__
            ? cameraErrorDetail(mountError)
            : 'Your workout will keep playing on the TV.'
        }
      />
    );
  }

  if (!cameraActive) {
    if (variant === 'pip') return null;

    return (
      <View style={styles.loading} accessible accessibilityLabel="Preparing form camera preview">
        <ActivityIndicator color={colors.lime} />
        <Text style={styles.loadingText}>
          Camera paused
        </Text>
      </View>
    );
  }

  if (trackingMode === 'unavailable') {
    return (
      <TrackingUnavailable
        onOpenSettings={permission?.granted === false ? openSettings : undefined}
        reason={unavailableReason}
        variant={variant}
      />
    );
  }

  if (trackingMode === 'real' && permission === null) {
    return (
      <View style={styles.loading} accessible accessibilityLabel="Checking camera access">
        <ActivityIndicator color={colors.lime} />
        <Text style={styles.loadingText}>Checking camera access…</Text>
      </View>
    );
  }

  const permissionGranted = permission?.granted === true;
  const realCameraReady =
    trackingMode === 'real' && permissionGranted && NativePoseCamera !== null;

  return (
    <View style={styles.preview} pointerEvents="none">
      {realCameraReady ? (
        <NativePoseCamera
          active={cameraActive}
          onPose={({ nativeEvent }) => {
            const frame = normalizeNativeFrame(nativeEvent);
            if (frame) onPoseFrame(frame);
            setReady(true);
          }}
          onStatus={({ nativeEvent }) => {
            if (nativeEvent.status === 'unavailable' || nativeEvent.status === 'error') {
              onUnavailable?.();
            } else if (nativeEvent.status === 'searching') {
              setReady(true);
              onTrackingStatus?.('searching');
            } else if (nativeEvent.status === 'tracking') {
              setReady(true);
            }
          }}
          style={StyleSheet.absoluteFill}
        />
      ) : permissionGranted && !mountError ? (
        <CameraView
          accessibilityLabel="Live front camera form preview"
          active={cameraActive}
          facing="front"
          mirror
          onCameraReady={() => setReady(true)}
          onMountError={({ message }) => {
            if (__DEV__) console.error('[WorkoutCameraPreview]', message);
            setMountError(message);
            onUnavailable?.();
          }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={styles.demoBackground}>
          <Ionicons name="camera-outline" size={variant === 'pip' ? 22 : 38} color={colors.textFaint} />
          {variant === 'companion' ? (
            <>
              <Text style={styles.fallbackTitle}>Camera access is off</Text>
              <Text style={styles.fallbackDetail}>Body tracking is disabled for this run.</Text>
              {Platform.OS === 'ios' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open app settings for camera access"
                  onPress={openSettings}
                  style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
                >
                  <Text style={styles.settingsButtonText}>Open Settings</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </View>
      )}
      {!ready && permissionGranted ? (
        <View style={styles.readyOverlay} pointerEvents="none">
          <ActivityIndicator color={colors.lime} />
        </View>
      ) : null}
      <PoseOverlay
        feedback={poseFeedback}
        frame={poseFrame}
        mode={trackingMode}
        playbackDuration={playbackDuration}
        playbackElapsed={playbackElapsed}
        score={poseScore}
        variant={variant}
      />
    </View>
  );
}

function normalizeNativeFrame(frame: NativePoseFrame): PoseFrame | null {
  const joints = new Set<string>(POSE_JOINTS);
  const keypoints = frame.keypoints
    .filter((point) => joints.has(point.name))
    .map((point) => ({
      ...point,
      name: point.name as (typeof POSE_JOINTS)[number],
    }));
  if (!keypoints.length) return null;
  return { ...frame, keypoints, origin: 'native' };
}

function cameraErrorDetail(message: string): string {
  if (/ExpoCamera|native module|view manager|isAvailableAsync/i.test(message)) {
    return 'ExpoCamera is missing from this app build. Rebuild and reinstall the iOS app.';
  }

  return `Camera error: ${message}`;
}

function CameraFallback({
  icon,
  title,
  detail,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.fallback} accessible={!action}>
      <Ionicons name={icon} size={28} color={colors.textDim} />
      <Text style={styles.fallbackTitle}>{title}</Text>
      <Text style={styles.fallbackDetail}>{detail}</Text>
      {action}
    </View>
  );
}

function TrackingUnavailable({
  onOpenSettings,
  reason,
  variant,
}: {
  onOpenSettings?: () => void;
  reason: string;
  variant: 'companion' | 'pip' | 'setup';
}) {
  const compact = variant === 'pip';
  return (
    <View style={[styles.unavailable, compact && styles.unavailableCompact]}>
      <Ionicons name="body-outline" size={compact ? 20 : 32} color={colors.orange} />
      <Text style={[styles.unavailableTitle, compact && styles.unavailableTitleCompact]}>
        TRACKING UNAVAILABLE
      </Text>
      {!compact ? <Text style={styles.fallbackDetail}>{reason}</Text> : null}
      {!compact && onOpenSettings ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open app settings for camera access"
          onPress={onOpenSettings}
          style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
        >
          <Text style={styles.settingsButtonText}>Open Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  loadingText: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: font.semibold,
  },
  readyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoBackground: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface2,
  },
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },
  unavailableCompact: {
    padding: spacing.xs,
  },
  unavailableTitle: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: font.black,
    letterSpacing: 1,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  unavailableTitleCompact: {
    fontSize: 6,
    letterSpacing: 0.3,
    marginTop: 3,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  fallbackTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: font.bold,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  fallbackDetail: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: font.medium,
    lineHeight: 18,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  settingsButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  settingsButtonText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: font.black,
  },
  pressed: {
    opacity: 0.78,
  },
});

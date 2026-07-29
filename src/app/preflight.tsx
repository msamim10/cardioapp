import Ionicons from '@expo/vector-icons/Ionicons';
import { isCardioSurfPoseAvailable } from 'cardiosurf-pose';
import { useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WorkoutCameraPreview } from '@/components/WorkoutCameraPreview';
import {
  INITIAL_POSE_FEEDBACK,
  INITIAL_POSE_SCORE,
  PoseAnalyzer,
  type PoseFeedback,
  type PoseFrame,
  type TrackingStatus,
} from '@/lib/poseTracking';
import { useProgress } from '@/lib/ProgressContext';
import { parseOptionalClassKeyParam } from '@/lib/progression';
import {
  INITIAL_PREFLIGHT_STATE,
  reducePreflight,
} from '@/lib/preflightState';
import {
  clearTrackingHandoff,
  createTrackingRunId,
  stageTrackingHandoff,
} from '@/lib/trackingSession';
import { colors, font, radius, spacing } from '@/theme';

const TRACKING_TIMEOUT_MS = 25_000;

export default function PreflightScreen() {
  const params = useLocalSearchParams<{
    level: string;
    name?: string;
    speed?: string;
    duration?: string;
    classKey?: string | string[];
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { startRun } = useProgress();
  const campaignClass = parseOptionalClassKeyParam(params.classKey);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [state, setState] = useState(INITIAL_PREFLIGHT_STATE);
  const [poseFrame, setPoseFrame] = useState<PoseFrame | null>(null);
  const [feedback, setFeedback] = useState<PoseFeedback>(INITIAL_POSE_FEEDBACK);
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('calibrating');
  const [requesting, setRequesting] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState('');
  const analyzerRef = useRef(new PoseAnalyzer());
  const stateRef = useRef(state);
  const launchedRef = useRef(false);
  const timeoutStartedRef = useRef(Date.now());
  const runIdRef = useRef(createTrackingRunId(params.level));
  stateRef.current = state;

  const detectorAvailable =
    Platform.OS === 'ios' && Device.isDevice && isCardioSurfPoseAvailable;
  const dispatch = useCallback((event: Parameters<typeof reducePreflight>[1]) => {
    setState((current) => reducePreflight(current, event));
  }, []);

  useEffect(() => {
    clearTrackingHandoff();
    return () => {
      if (!launchedRef.current) clearTrackingHandoff();
    };
  }, []);

  useEffect(() => {
    if (!permission) return;
    if (!detectorAvailable) {
      setUnavailableReason(
        Platform.OS !== 'ios'
          ? 'Real body tracking currently requires iOS.'
          : !Device.isDevice
            ? 'Real body tracking requires a physical iPhone.'
            : 'This app build does not include the Apple Vision body detector.',
      );
      dispatch({ type: 'UNAVAILABLE' });
      return;
    }
    if (permission.granted && stateRef.current.phase === 'permission') {
      timeoutStartedRef.current = Date.now();
      dispatch({ type: 'PERMISSION_GRANTED' });
    }
  }, [detectorAvailable, dispatch, permission]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || permission?.canAskAgain !== false) return;
      getPermission()
        .then((latest) => {
          if (!latest.granted) return;
          analyzerRef.current.reset();
          timeoutStartedRef.current = Date.now();
          dispatch({ type: 'PERMISSION_GRANTED' });
        })
        .catch(() => {});
    });
    return () => subscription.remove();
  }, [dispatch, getPermission, permission?.canAskAgain]);

  useEffect(() => {
    if (
      state.phase === 'permission' ||
      state.phase === 'countdown' ||
      state.phase === 'unavailable' ||
      state.phase === 'timed-out'
    ) {
      return;
    }
    const timer = setTimeout(() => dispatch({ type: 'TIMEOUT' }), Math.max(
      0,
      TRACKING_TIMEOUT_MS - (Date.now() - timeoutStartedRef.current),
    ));
    return () => clearTimeout(timer);
  }, [dispatch, state.phase]);

  useEffect(() => {
    if (state.phase !== 'countdown') return;
    const timer = setTimeout(() => dispatch({ type: 'COUNTDOWN_TICK' }), 1_000);
    return () => clearTimeout(timer);
  }, [dispatch, state.countdown, state.phase]);

  const launchWorkout = useCallback(
    (tracking: 'calibrated' | 'off') => {
      if (launchedRef.current) return;
      const capturedAt = Date.now();
      if (tracking === 'calibrated') {
        const snapshot = analyzerRef.current.calibrationSnapshot(capturedAt);
        if (
          !snapshot ||
          !stageTrackingHandoff(runIdRef.current, params.level, snapshot, capturedAt)
        ) {
          setUnavailableReason('Calibration could not be transferred. Please retry.');
          dispatch({ type: 'UNAVAILABLE' });
          return;
        }
        analyzerRef.current.markTrackingLost(capturedAt);
      } else {
        clearTrackingHandoff();
      }
      launchedRef.current = true;
      startRun({
        runId: runIdRef.current,
        levelId: params.level,
        durationMin: Number(params.duration) || 1,
        ...(campaignClass ? { classKey: campaignClass } : {}),
      });
      router.replace({
        pathname: '/workout',
        params: {
          level: params.level,
          name: params.name,
          speed: params.speed,
          tracking,
          trackingRunId: runIdRef.current,
        },
      });
    },
    [campaignClass, dispatch, params, router, startRun],
  );

  useEffect(() => {
    if (state.phase === 'countdown' && state.countdown === 0) {
      launchWorkout('calibrated');
    }
  }, [launchWorkout, state.countdown, state.phase]);

  const onPoseFrame = useCallback(
    (frame: PoseFrame) => {
      if (frame.origin !== 'native') return;
      const phase = stateRef.current.phase;
      if (phase === 'permission' || phase === 'unavailable' || phase === 'timed-out') return;
      const result = analyzerRef.current.process(frame);
      setPoseFrame({ ...frame, keypoints: result.keypoints });
      setFeedback(result.feedback);
      setTrackingStatus(result.status);

      if (result.status === 'searching' || result.status === 'reconnecting') {
        dispatch({ type: 'TRACKING_LOST' });
      } else if (result.status === 'calibrating') {
        dispatch({ type: 'CALIBRATION_PROGRESS' });
      } else if (phase === 'preparing' || phase === 'calibrating') {
        dispatch({ type: 'CALIBRATION_READY' });
      } else if (phase === 'stabilizing') {
        if (!result.move && result.feedback.readiness === 'ready') {
          dispatch({ type: 'STABLE_FRAME' });
        } else {
          dispatch({ type: 'TRACKING_LOST' });
        }
      } else if (
        phase === 'countdown' &&
        (result.move || result.feedback.readiness !== 'ready')
      ) {
        dispatch({ type: 'TRACKING_LOST' });
      }
    },
    [dispatch],
  );

  const enableCamera = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const next = await requestPermission();
      if (next.granted) {
        timeoutStartedRef.current = Date.now();
        dispatch({ type: 'PERMISSION_GRANTED' });
      } else {
        setUnavailableReason('Camera access is off. Enable it in Settings to track your body.');
        dispatch({ type: 'UNAVAILABLE' });
      }
    } catch {
      setUnavailableReason('Camera permission could not be requested. Please try again.');
      dispatch({ type: 'UNAVAILABLE' });
    } finally {
      setRequesting(false);
    }
  };

  const retry = () => {
    analyzerRef.current.reset();
    setPoseFrame(null);
    setFeedback(INITIAL_POSE_FEEDBACK);
    setTrackingStatus('calibrating');
    timeoutStartedRef.current = Date.now();
    dispatch({ type: 'RETRY' });
  };

  const cancel = () => {
    clearTrackingHandoff();
    router.back();
  };

  const cameraActive =
    permission?.granted === true &&
    detectorAvailable &&
    state.phase !== 'permission' &&
    state.phase !== 'unavailable' &&
    state.phase !== 'timed-out';

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {cameraActive ? (
        <WorkoutCameraPreview
          active
          onPoseFrame={onPoseFrame}
          onTrackingStatus={() => {
            analyzerRef.current.markTrackingLost();
            dispatch({ type: 'TRACKING_LOST' });
          }}
          onUnavailable={() => {
            setUnavailableReason('The Apple Vision body detector stopped unexpectedly.');
            dispatch({ type: 'UNAVAILABLE' });
          }}
          permission={permission}
          poseFrame={poseFrame}
          poseFeedback={feedback}
          poseScore={INITIAL_POSE_SCORE}
          trackingMode="real"
          unavailableReason={unavailableReason}
          variant="setup"
        />
      ) : (
        <View style={styles.emptyCamera} />
      )}

      {cameraActive ? <View pointerEvents="none" style={styles.vignette} /> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel camera setup"
        onPress={cancel}
        style={[styles.close, { top: insets.top + spacing.sm }]}
      >
        <Ionicons name="close" size={23} color={colors.white} />
      </Pressable>

      <View style={[styles.header, { top: insets.top + spacing.md }]}>
        <Text style={styles.eyebrow}>RUN SETUP</Text>
        <Text style={styles.runName} numberOfLines={1}>{params.name ?? 'Your run'}</Text>
      </View>

      {state.phase === 'permission' ? (
        <SetupCard
          icon="camera-outline"
          title="Turn on form tracking"
          detail="Your camera stays on-device and is never recorded. We’ll calibrate before the run starts."
          primary={permission?.canAskAgain === false ? 'OPEN SETTINGS' : 'ENABLE CAMERA'}
          loading={requesting}
          onPrimary={permission?.canAskAgain === false
            ? () => Linking.openSettings().catch(() => {})
            : enableCamera}
          onSecondary={() => launchWorkout('off')}
          secondary="CONTINUE WITHOUT TRACKING"
        />
      ) : state.phase === 'unavailable' || state.phase === 'timed-out' ? (
        <SetupCard
          icon={state.phase === 'timed-out' ? 'body-outline' : 'warning-outline'}
          title={state.phase === 'timed-out' ? 'Still looking for you' : 'Tracking unavailable'}
          detail={
            state.phase === 'timed-out'
              ? 'Step back so your shoulders and hips are visible, then retry.'
              : unavailableReason
          }
          primary={permission?.canAskAgain === false ? 'OPEN SETTINGS' : 'TRY AGAIN'}
          onPrimary={
            permission?.canAskAgain === false
              ? () => Linking.openSettings().catch(() => {})
              : permission?.granted
                ? retry
                : enableCamera
          }
          onSecondary={() => launchWorkout('off')}
          secondary="CONTINUE WITHOUT TRACKING"
        />
      ) : (
        <>
          <View style={styles.centerGuide} pointerEvents="none">
            <View style={styles.guideOval} />
            <View style={styles.floorGuide}>
              <View style={styles.floorDot} />
            </View>
          </View>
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityRole="summary"
            accessibilityLabel={
              state.phase === 'countdown'
                ? `Calibration ready. Starting in ${state.countdown}. Hold center.`
                : `${trackingStatus === 'searching' ? 'Step into frame.' : state.phase === 'stabilizing' ? 'Calibration ready.' : 'Stand centered.'} Place your phone securely. Step back 3 to 5 feet and keep your shoulders and hips in frame. Full body is best.`
            }
            style={[styles.guidance, { bottom: insets.bottom + spacing.xl }]}
          >
            {state.phase === 'countdown' ? (
              <>
                <Text style={styles.readyLabel}>CALIBRATION READY</Text>
                <Text style={styles.countdown}>{state.countdown}</Text>
                <Text style={styles.hint}>Hold center — your run is about to start</Text>
              </>
            ) : (
              <>
                <Text style={styles.guidanceTitle}>
                  {trackingStatus === 'searching'
                    ? 'Step into frame'
                    : state.phase === 'stabilizing'
                      ? 'Calibration ready'
                      : 'Stand centered'}
                </Text>
                <Text style={styles.setupGuidance}>
                  Place your phone securely.{'\n'}Step back 3–5 feet and keep your shoulders and hips in frame.
                </Text>
                <Text style={styles.hint}>
                  Full body is best, but shoulders and hips are sufficient to calibrate.
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.round(feedback.calibrationProgress * 100)}%` },
                    ]}
                  />
                </View>
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function SetupCard({
  icon,
  title,
  detail,
  primary,
  secondary,
  loading = false,
  onPrimary,
  onSecondary,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  primary: string;
  secondary: string;
  loading?: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardIcon}><Ionicons name={icon} size={30} color={colors.lime} /></View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardDetail}>{detail}</Text>
      <Pressable disabled={loading} onPress={onPrimary} style={styles.primary}>
        {loading ? <ActivityIndicator color={colors.black} /> : <Text style={styles.primaryText}>{primary}</Text>}
      </Pressable>
      <Pressable disabled={loading} onPress={onSecondary} style={styles.secondary}>
        <Text style={styles.secondaryText}>{secondary}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  emptyCamera: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderWidth: 0,
  },
  close: {
    position: 'absolute',
    left: spacing.lg,
    zIndex: 10,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  header: { position: 'absolute', left: 76, right: 76, alignItems: 'center' },
  eyebrow: { color: colors.lime, fontSize: 10, fontWeight: font.black, letterSpacing: 1.7 },
  runName: { color: colors.white, fontSize: 15, fontWeight: font.bold, marginTop: 2 },
  centerGuide: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideOval: {
    width: '48%',
    height: '62%',
    borderWidth: 1,
    borderRadius: 999,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  floorGuide: {
    position: 'absolute',
    bottom: '18%',
    width: '54%',
    height: 2,
    alignItems: 'center',
    backgroundColor: 'rgba(198,255,61,0.38)',
  },
  floorDot: { width: 10, height: 10, marginTop: -4, borderRadius: 5, backgroundColor: colors.lime },
  guidance: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(5,8,12,0.82)',
  },
  guidanceTitle: { color: colors.white, fontSize: 27, fontWeight: font.black, letterSpacing: -0.5 },
  setupGuidance: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: font.bold,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  readyLabel: { color: colors.lime, fontSize: 12, fontWeight: font.black, letterSpacing: 1.5 },
  countdown: { color: colors.white, fontSize: 96, lineHeight: 106, fontWeight: font.black },
  hint: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: font.semibold,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  progressTrack: {
    width: '100%',
    height: 5,
    marginTop: spacing.md,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.lime },
  card: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '24%',
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  cardIcon: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: 'rgba(198,255,61,0.1)',
  },
  cardTitle: { color: colors.white, fontSize: 27, fontWeight: font.black, marginTop: spacing.lg },
  cardDetail: { color: colors.textDim, fontSize: 15, lineHeight: 21, marginTop: spacing.sm },
  primary: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  primaryText: { color: colors.black, fontSize: 14, fontWeight: font.black, letterSpacing: 0.6 },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  secondaryText: { color: colors.textDim, fontSize: 12, fontWeight: font.bold, letterSpacing: 0.4 },
});

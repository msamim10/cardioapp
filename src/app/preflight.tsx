import Ionicons from '@expo/vector-icons/Ionicons';
import { isCardioSurfPoseAvailable } from 'cardiosurf-pose';
import { useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { LinearGradient } from 'expo-linear-gradient';
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
  logCalibrationAttempt,
  logCalibrationFailure,
  logCalibrationSuccess,
} from '@/lib/analytics';
import {
  loadCalibrationProfile,
  proportionsFromBaseline,
  proportionsMismatch,
  recordCalibrationComplete,
  shouldGuideCalibration,
  type BodyProportions,
} from '@/lib/calibrationProfile';
import type { CalibrationFailureReason } from '@/lib/funnelStore';
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
  PREFLIGHT_COUNTDOWN_SECONDS,
  PREFLIGHT_EXPRESS_COUNTDOWN_SECONDS,
  reducePreflight,
} from '@/lib/preflightState';
import {
  clearTrackingHandoff,
  createTrackingRunId,
  stageTrackingHandoff,
} from '@/lib/trackingSession';
import { colors, font, metric, radius, spacing, type } from '@/theme';

const TRACKING_TIMEOUT_MS = 25_000;

/**
 * Best-effort classification of WHY a calibration failed, from the last pose
 * frame's keypoints (coords are normalized 0..1). Used for local funnel drop-off
 * analysis — no person is the most common, followed by framing (too close/far)
 * and low-confidence keypoints (a good proxy for poor lighting).
 */
function deriveCalibrationFailureReason(frame: PoseFrame | null): CalibrationFailureReason {
  if (!frame || frame.keypoints.length === 0) return 'no_person';
  const confidences = frame.keypoints.map((k) => k.confidence);
  const avgConfidence =
    confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  if (avgConfidence < 0.35) return 'insufficient_lighting';
  const xs = frame.keypoints.map((k) => k.x);
  const ys = frame.keypoints.map((k) => k.y);
  const height = Math.max(...ys) - Math.min(...ys);
  const width = Math.max(...xs) - Math.min(...xs);
  // Body fills the frame → user is too close; body is tiny → too far.
  if (height > 0.9 || width > 0.72) return 'too_close';
  if (height < 0.32) return 'too_far';
  return 'unknown';
}

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
  // Guided mode teaches the framing; express mode is a silent sensor lock for
  // anyone who has already calibrated on this device at least once.
  const [guided, setGuided] = useState(true);
  const storedProportionsRef = useRef<BodyProportions | null>(null);
  const analyzerRef = useRef(new PoseAnalyzer());
  const stateRef = useRef(state);
  const launchedRef = useRef(false);
  const timeoutStartedRef = useRef(Date.now());
  const runIdRef = useRef(createTrackingRunId(params.level));
  stateRef.current = state;

  // Latest frame kept in a ref so the calibration-outcome effect (keyed on phase)
  // can classify a failure without re-subscribing on every frame.
  const latestFrameRef = useRef<PoseFrame | null>(null);
  latestFrameRef.current = poseFrame;
  const guidedRef = useRef(guided);
  guidedRef.current = guided;
  // True while a calibration cycle is in progress; gates attempt/outcome events
  // so a purely "unavailable" (no detector / permission denied) isn't a failure.
  const calibrationCycleRef = useRef(false);

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
    let active = true;
    loadCalibrationProfile()
      .then((profile) => {
        if (!active) return;
        storedProportionsRef.current = profile.proportions;
        setGuided(shouldGuideCalibration(profile));
      })
      .catch(() => {});
    return () => {
      active = false;
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

  // Calibration funnel instrumentation (Phase 4): one attempt per cycle, then a
  // success (reached the countdown) or a failure with a detected reason.
  useEffect(() => {
    const phase = state.phase;
    const calibrating =
      phase === 'preparing' || phase === 'calibrating' || phase === 'stabilizing';
    if (calibrating) {
      if (!calibrationCycleRef.current) {
        calibrationCycleRef.current = true;
        logCalibrationAttempt();
      }
      if (phase === 'stabilizing') {
        // A body whose proportions no longer match the stored ones is most
        // likely a different person on a shared device, so re-teach framing.
        const fresh = analyzerRef.current.calibrationSnapshot();
        const proportions = fresh ? proportionsFromBaseline(fresh.baseline) : null;
        if (proportionsMismatch(storedProportionsRef.current, proportions)) {
          setGuided(true);
        }
      }
      return;
    }
    if (phase === 'countdown') {
      if (calibrationCycleRef.current) {
        calibrationCycleRef.current = false;
        logCalibrationSuccess();
        const snapshot = analyzerRef.current.calibrationSnapshot();
        recordCalibrationComplete(
          snapshot ? proportionsFromBaseline(snapshot.baseline) : null,
        ).catch(() => {});
      }
      return;
    }
    if (phase === 'timed-out' || phase === 'unavailable') {
      if (calibrationCycleRef.current) {
        calibrationCycleRef.current = false;
        logCalibrationFailure(deriveCalibrationFailureReason(latestFrameRef.current));
      }
    }
  }, [state.phase]);

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
          dispatch({
            type: 'STABLE_FRAME',
            countdownFrom: guidedRef.current
              ? PREFLIGHT_COUNTDOWN_SECONDS
              : PREFLIGHT_EXPRESS_COUNTDOWN_SECONDS,
          });
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

      {cameraActive ? (
        <>
          <LinearGradient
            colors={['rgba(0,0,0,0.72)', 'rgba(0,0,0,0)']}
            pointerEvents="none"
            style={styles.topScrim}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.86)']}
            pointerEvents="none"
            style={styles.bottomScrim}
          />
        </>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel camera setup"
        onPress={cancel}
        style={[styles.close, { top: insets.top + spacing.sm }]}
      >
        <Ionicons name="close" size={23} color={colors.white} />
      </Pressable>

      <View style={[styles.header, { top: insets.top + spacing.md }]}>
        <Text style={styles.eyebrow}>
          {guided ? 'ONE-TIME SETUP' : 'SENSOR CHECK'}
        </Text>
        <Text style={styles.runName} numberOfLines={1}>{params.name ?? 'Your run'}</Text>
      </View>

      {state.phase === 'permission' ? (
        <SetupCard
          icon="camera-outline"
          title="Set up body tracking"
          detail="One time, then it runs itself. Your camera is processed on-device and never recorded or uploaded."
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
          title={state.phase === 'timed-out' ? 'No signal' : 'Tracking unavailable'}
          detail={
            state.phase === 'timed-out'
              ? 'Step back until your shoulders and hips are in frame, then try again. You can also train without tracking.'
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
            <View style={styles.reticle}>
              <View style={[styles.bracket, styles.bracketTL]} />
              <View style={[styles.bracket, styles.bracketTR]} />
              <View style={[styles.bracket, styles.bracketBL]} />
              <View style={[styles.bracket, styles.bracketBR]} />
            </View>
            <View style={styles.floorGuide} />
          </View>
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityRole="summary"
            accessibilityLabel={
              state.phase === 'countdown'
                ? `Body locked. Starting in ${state.countdown}. Hold still.`
                : `${trackingStatus === 'searching' ? 'No body detected. Step into frame.' : state.phase === 'stabilizing' ? 'Body locked. Hold still.' : 'Acquiring. Reading your body.'} Stand your phone up, then step back until your shoulders and hips are in frame. Signal ${Math.round(feedback.calibrationProgress * 100)} percent.`
            }
            style={[styles.guidance, { bottom: insets.bottom + spacing.xl }]}
          >
            {state.phase === 'countdown' ? (
              <>
                <Text style={styles.readyLabel}>LOCKED</Text>
                <Text style={styles.countdown}>{state.countdown}</Text>
              </>
            ) : (
              <>
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      state.phase === 'stabilizing' && styles.statusDotReady,
                    ]}
                  />
                  <Text style={styles.statusLabel}>
                    {trackingStatus === 'searching'
                      ? 'NO BODY DETECTED'
                      : state.phase === 'stabilizing'
                        ? 'BODY LOCKED'
                        : 'ACQUIRING'}
                  </Text>
                </View>
                <Text style={styles.guidanceTitle}>
                  {trackingStatus === 'searching'
                    ? 'Step into frame'
                    : state.phase === 'stabilizing'
                      ? 'Hold still'
                      : 'Reading your body'}
                </Text>
                {guided ? (
                  <Text style={styles.setupGuidance}>
                    Stand your phone up, then step back until your shoulders and hips
                    sit inside the brackets. Full body is ideal.
                  </Text>
                ) : null}
                <SignalMeter value={feedback.calibrationProgress} />
                {guided ? null : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Show setup instructions"
                    hitSlop={10}
                    onPress={() => setGuided(true)}
                    style={styles.helpLink}
                  >
                    <Text style={styles.helpLinkText}>Show setup guide</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const SIGNAL_SEGMENTS = 12;

/**
 * Segmented signal readout. Reads as sensor acquisition rather than a loading
 * bar, which is the distinction between instrument UI and game UI here.
 */
function SignalMeter({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  const lit = Math.round(clamped * SIGNAL_SEGMENTS);
  return (
    <View style={styles.signal}>
      <View style={styles.signalTrack}>
        {Array.from({ length: SIGNAL_SEGMENTS }, (_, index) => (
          <View
            key={index}
            style={[styles.segment, index < lit && styles.segmentLit]}
          />
        ))}
      </View>
      <Text style={styles.signalValue}>{Math.round(clamped * 100)}%</Text>
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
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 190 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 340 },
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
  eyebrow: { ...type.micro, color: colors.lime, letterSpacing: 1.7 },
  runName: { ...type.h3, color: colors.white, marginTop: 3 },
  centerGuide: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: { width: '62%', height: '58%' },
  bracket: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  bracketTL: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 },
  bracketTR: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 },
  bracketBL: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 },
  bracketBR: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 },
  floorGuide: {
    position: 'absolute',
    bottom: '20%',
    width: '46%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
  guidance: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.textFaint,
  },
  statusDotReady: { backgroundColor: colors.lime },
  statusLabel: {
    ...type.micro,
    color: colors.white,
    letterSpacing: 1.4,
  },
  guidanceTitle: {
    ...type.h1,
    color: colors.white,
    fontSize: 30,
    lineHeight: 34,
    textAlign: 'center',
  },
  setupGuidance: {
    ...type.body,
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  readyLabel: {
    ...type.micro,
    color: colors.lime,
    letterSpacing: 2,
  },
  countdown: {
    ...metric,
    color: colors.white,
    fontSize: 104,
    lineHeight: 112,
    fontWeight: font.heavy,
    letterSpacing: -3,
  },
  signal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  signalTrack: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  segment: {
    width: 9,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  segmentLit: { backgroundColor: colors.lime },
  signalValue: {
    ...metric,
    ...type.micro,
    color: colors.white,
    minWidth: 34,
    letterSpacing: 0.6,
  },
  helpLink: { marginTop: spacing.lg, paddingVertical: spacing.xs },
  helpLinkText: {
    ...type.bodySm,
    color: 'rgba(255,255,255,0.66)',
    fontWeight: font.bold,
  },
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
    backgroundColor: 'rgba(215,255,62,0.1)',
  },
  cardTitle: {
    ...type.h1,
    color: colors.white,
    fontSize: 27,
    lineHeight: 31,
    marginTop: spacing.lg,
  },
  cardDetail: { ...type.body, color: colors.textDim, marginTop: spacing.sm },
  primary: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    borderRadius: radius.button,
    backgroundColor: colors.lime,
  },
  primaryText: { ...type.action, color: colors.black },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  secondaryText: { color: colors.textDim, fontSize: 12, fontWeight: font.bold, letterSpacing: 0.4 },
});

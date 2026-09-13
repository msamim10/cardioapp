import Ionicons from '@expo/vector-icons/Ionicons';
import { isCardioSurfPoseAvailable } from 'cardiosurf-pose';
import { useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { LinearGradient } from 'expo-linear-gradient';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { BodyOutline } from '@/components/BodyOutline';
import { CalibrationIntroFigure } from '@/components/CalibrationIntroFigure';
import { ParticleBurst } from '@/components/ParticleBurst';
import { TvSetupGuide } from '@/components/TvSetupGuide';
import { WorkoutCameraPreview } from '@/components/WorkoutCameraPreview';
import {
  logCalibrationAttempt,
  logCalibrationFailure,
  logCalibrationMoveSkipped,
  logCalibrationSuccess,
} from '@/lib/analytics';
import { createCalibrationSounds, playHaptic, type FeedbackCue } from '@/lib/calibrationFeedback';
import {
  loadCalibrationProfile,
  proportionsFromBaseline,
  proportionsMismatch,
  recordCalibrationComplete,
  shouldGuideCalibration,
  type BodyProportions,
} from '@/lib/calibrationProfile';
import { useExternalDisplay } from '@/lib/externalDisplay';
import type { CalibrationFailureReason } from '@/lib/funnelStore';
import { resolveHudTheme, type HudTheme } from '@/lib/hudThemes';
import { useOnboarding } from '@/lib/OnboardingContext';
import {
  isIntensityKey,
  loadPlaySetup,
  saveFirstRunTrackingOff,
  type PlayScreen,
} from '@/lib/playSetup';
import {
  INITIAL_POSE_FEEDBACK,
  INITIAL_POSE_SCORE,
  PoseAnalyzer,
  type Move,
  type PoseFeedback,
  type PoseFrame,
} from '@/lib/poseTracking';
import {
  createPreflightFlowState,
  currentTestMove,
  END_CARD_MS,
  flowElapsedSeconds,
  isCameraPhase,
  MOVE_PROMPT,
  MOVE_TEST_ORDER,
  type PreflightFlowEvent,
  type PreflightOutcome,
  reducePreflightFlow,
  SYNC_LINES,
} from '@/lib/preflightFlow';
import { useProgress } from '@/lib/ProgressContext';
import { parseOptionalClassKeyParam } from '@/lib/progression';
import { FRAMING_MESSAGE, skeletonFraming } from '@/lib/skeletonFraming';
import {
  clearTrackingHandoff,
  createTrackingRunId,
  stageTrackingHandoff,
} from '@/lib/trackingSession';
import { colors, font, metric, radius, spacing, type } from '@/theme';

/** Reducer clock tick: drives the 10 s fallback offer and the dev timer. */
const TICK_MS = 500;
/** Phase 3 playful status lines rotate at this cadence. */
const SYNC_LINE_MS = 900;

const MOVE_ICON: Record<Move, keyof typeof Ionicons.glyphMap> = {
  Jump: 'arrow-up',
  Duck: 'arrow-down',
  Left: 'arrow-back',
  Right: 'arrow-forward',
};

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

/**
 * Calibration as a micro-game. Screen 1 ("Your body is the controller.")
 * asks for the camera; Screen 2 runs the phases of `preflightFlow.ts` on top
 * of the untouched `PoseAnalyzer`: framing coaching → move test drive (first
 * run only) → handoff. See docs/CALIBRATION_FLOW.md.
 */
export default function PreflightScreen() {
  const params = useLocalSearchParams<{
    level: string;
    name?: string;
    speed?: string;
    duration?: string;
    intensity?: string;
    classKey?: string | string[];
    /**
     * "Record my run" is on (level screen). Forwarded to the workout; also
     * keeps this screen's camera at the recording preset so the calibration
     * handoff sees the same frame size as the run.
     */
    record?: string;
    /**
     * Set by the onboarding recap. Calibration is the first-time ceremony: on
     * lock it hands off to the "first run is ready" screen (where the offer is
     * presented) instead of launching the player directly.
     */
    firstRun?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { startRun, hudThemeId, levelProgress } = useProgress();
  const { setCheckpoint } = useOnboarding();
  // Same palette the run will use, so the calibration skeleton matches.
  const hudTheme = useMemo(
    () => resolveHudTheme(hudThemeId, levelProgress.level),
    [hudThemeId, levelProgress.level]
  );
  const campaignClass = parseOptionalClassKeyParam(params.classKey);
  const intensity = isIntensityKey(params.intensity) ? params.intensity : undefined;
  const isFirstRun = params.firstRun === '1';
  const [playScreen, setPlayScreen] = useState<PlayScreen | null>(null);
  const [tvGuideOpen, setTvGuideOpen] = useState(false);
  // Real on iOS native builds (screen mirroring or an AirPlay route both count
  // as connected); `supported: false` elsewhere (then the pill is just the help
  // affordance and never claims a connection).
  const display = useExternalDisplay();
  const tvConnected = display.supported && display.connected;
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [state, setState] = useState(() =>
    createPreflightFlowState({ firstRun: isFirstRun, now: Date.now() }),
  );
  const [poseFrame, setPoseFrame] = useState<PoseFrame | null>(null);
  const [feedback, setFeedback] = useState<PoseFeedback>(INITIAL_POSE_FEEDBACK);
  const [requesting, setRequesting] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState('');
  // Guided mode keeps the longer Phase 3 countdown; express is the shorter
  // hold for anyone who has already calibrated on this device at least once.
  const [guided, setGuided] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [syncLine, setSyncLine] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigBurst, setBigBurst] = useState(0);
  const storedProportionsRef = useRef<BodyProportions | null>(null);
  const analyzerRef = useRef(new PoseAnalyzer());
  const soundsRef = useRef(createCalibrationSounds());
  const stateRef = useRef(state);
  const launchedRef = useRef(false);
  const runIdRef = useRef(createTrackingRunId(params.level));
  stateRef.current = state;

  // Latest frame kept in a ref so the calibration-outcome effect (keyed on phase)
  // can classify a failure without re-subscribing on every frame.
  const latestFrameRef = useRef<PoseFrame | null>(null);
  latestFrameRef.current = poseFrame;
  // True while a calibration cycle is in progress; gates attempt/outcome events
  // so a purely "unavailable" (no detector / permission denied) isn't a failure.
  const calibrationCycleRef = useRef(false);

  const detectorAvailable =
    Platform.OS === 'ios' && Device.isDevice && isCardioSurfPoseAvailable;
  const dispatch = useCallback((event: PreflightFlowEvent) => {
    setState((current) => reducePreflightFlow(current, event));
  }, []);

  const cue = useCallback((kind: FeedbackCue) => {
    playHaptic(kind);
    soundsRef.current.play(kind);
  }, []);

  useEffect(() => {
    clearTrackingHandoff();
    const sounds = soundsRef.current;
    sounds.preload();
    return () => {
      if (!launchedRef.current) clearTrackingHandoff();
      sounds.dispose();
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
    loadPlaySetup()
      .then((setup) => {
        if (active) setPlayScreen(setup.screen);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    dispatch({ type: 'SET_EXPRESS', express: !guided });
  }, [dispatch, guided]);

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
      dispatch({ type: 'UNAVAILABLE', now: Date.now() });
      return;
    }
    // Repeat runs skip Screen 1 when the camera is already allowed. The first
    // run always shows it: it is the ceremony, not just a permission prompt.
    if (permission.granted && stateRef.current.phase === 'permission' && !isFirstRun) {
      dispatch({ type: 'PERMISSION_GRANTED', now: Date.now() });
    }
  }, [detectorAvailable, dispatch, isFirstRun, permission]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || permission?.canAskAgain !== false) return;
      getPermission()
        .then((latest) => {
          if (!latest.granted) return;
          setPermissionDenied(false);
          analyzerRef.current.reset();
          dispatch({ type: 'PERMISSION_GRANTED', now: Date.now() });
        })
        .catch(() => {});
    });
    return () => subscription.remove();
  }, [dispatch, getPermission, permission?.canAskAgain]);

  // Reducer clock while the camera is live: fallback offer + dev timer.
  const cameraPhase = isCameraPhase(state.phase);
  useEffect(() => {
    if (!cameraPhase) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      dispatch({ type: 'TICK', now: current });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [cameraPhase, dispatch]);

  useEffect(() => {
    if (state.phase !== 'handoff') return;
    setSyncLine(0);
    const timer = setInterval(
      () => setSyncLine((index) => (index + 1) % SYNC_LINES.length),
      SYNC_LINE_MS,
    );
    return () => clearInterval(timer);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== 'handoff' || state.countdown === null) return;
    const timer = setTimeout(
      () => dispatch({ type: 'COUNTDOWN_TICK', now: Date.now() }),
      1_000,
    );
    return () => clearTimeout(timer);
  }, [dispatch, state.countdown, state.phase]);

  const launchWorkout = useCallback(
    (outcome: PreflightOutcome) => {
      if (launchedRef.current) return;
      const tracking: 'calibrated' | 'off' = outcome === 'off' ? 'off' : 'calibrated';
      if (isFirstRun) {
        // First-time ceremony: calibration is complete (onboarding_complete has
        // fired above), so hand off to the offer screen. The run launches from
        // there once access is granted; the in-run analyzer re-acquires the
        // body, since a snapshot would be stale by the time the paywall closes.
        launchedRef.current = true;
        clearTrackingHandoff();
        void saveFirstRunTrackingOff(tracking === 'off');
        setCheckpoint('first-run-ready');
        router.replace('/first-run-ready' as Href);
        return;
      }
      const capturedAt = Date.now();
      if (outcome === 'calibrated') {
        const snapshot = analyzerRef.current.calibrationSnapshot(capturedAt);
        if (
          !snapshot ||
          !stageTrackingHandoff(runIdRef.current, params.level, snapshot, capturedAt)
        ) {
          setUnavailableReason('Your setup could not be carried into the run. Please retry.');
          dispatch({ type: 'UNAVAILABLE', now: capturedAt });
          return;
        }
        analyzerRef.current.markTrackingLost(capturedAt);
      } else {
        // 'defaults': no snapshot on purpose — the run calibrates live from
        // its first frames (workout.tsx already handles a missing handoff).
        clearTrackingHandoff();
      }
      launchedRef.current = true;
      startRun({
        runId: runIdRef.current,
        levelId: params.level,
        durationMin: Number(params.duration) || 1,
        ...(campaignClass ? { classKey: campaignClass } : {}),
        ...(intensity ? { intensity } : {}),
      });
      router.replace({
        pathname: '/workout',
        params: {
          level: params.level,
          name: params.name,
          speed: params.speed,
          duration: params.duration,
          intensity,
          tracking,
          trackingRunId: runIdRef.current,
          ...(params.record === '1' && tracking !== 'off' ? { record: '1' } : {}),
        },
      });
    },
    [campaignClass, dispatch, intensity, isFirstRun, params, router, setCheckpoint, startRun],
  );

  // Route out once the flow completes. The first run holds the end card for
  // END_CARD_MS (with a burst) unless the camera never worked at all. The
  // launcher is read through a ref so a re-created callback cannot restart
  // the end-card timer.
  const launchRef = useRef(launchWorkout);
  launchRef.current = launchWorkout;
  const celebrate = state.phase === 'complete' && isFirstRun && state.outcome !== 'off';
  const outcome = state.phase === 'complete' ? state.outcome : null;
  useEffect(() => {
    if (!outcome) return;
    if (!celebrate) {
      launchRef.current(outcome);
      return;
    }
    setBigBurst((count) => count + 1);
    cue('celebrate');
    const timer = setTimeout(() => launchRef.current(outcome), END_CARD_MS);
    return () => clearTimeout(timer);
  }, [celebrate, cue, outcome]);

  // Calibration funnel instrumentation: one attempt per cycle, then a success
  // (reached the Phase 3 countdown — where `onboarding_complete` fires on the
  // first ever success) or a failure with a detected reason.
  const lockedIn = state.phase === 'handoff' && state.countdown !== null;
  useEffect(() => {
    const phase = state.phase;
    if (phase === 'framing' || phase === 'moves' || (phase === 'handoff' && !lockedIn)) {
      if (!calibrationCycleRef.current) {
        calibrationCycleRef.current = true;
        logCalibrationAttempt();
      }
      if (phase === 'handoff') {
        // A body whose proportions no longer match the stored ones is most
        // likely a different person on a shared device, so keep the longer hold.
        const fresh = analyzerRef.current.calibrationSnapshot();
        const proportions = fresh ? proportionsFromBaseline(fresh.baseline) : null;
        if (proportionsMismatch(storedProportionsRef.current, proportions)) {
          setGuided(true);
        }
      }
      return;
    }
    if (lockedIn) {
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
    if (phase === 'unavailable' || (phase === 'complete' && state.outcome === 'defaults')) {
      if (calibrationCycleRef.current) {
        calibrationCycleRef.current = false;
        logCalibrationFailure(deriveCalibrationFailureReason(latestFrameRef.current));
      }
    }
  }, [lockedIn, state.outcome, state.phase]);

  // Feedback: framing lock, each detected move, each phase transition.
  const framingOk = state.phase === 'framing' && state.framing === 'ok';
  useEffect(() => {
    if (framingOk) cue('tick');
  }, [cue, framingOk]);
  const completedCount = state.completedMoves.length;
  useEffect(() => {
    if (completedCount === 0) return;
    setBurst((count) => count + 1);
    cue('move');
  }, [completedCount, cue]);
  useEffect(() => {
    if (state.phase !== 'moves' && state.phase !== 'handoff') return;
    setBurst((count) => count + 1);
    cue('phase');
  }, [cue, state.phase]);

  const onPoseFrame = useCallback(
    (frame: PoseFrame) => {
      if (frame.origin !== 'native') return;
      if (!isCameraPhase(stateRef.current.phase)) return;
      const result = analyzerRef.current.process(frame);
      const smoothed = { ...frame, keypoints: result.keypoints };
      setPoseFrame(smoothed);
      setFeedback(result.feedback);
      dispatch({
        type: 'FRAME',
        now: frame.timestamp,
        framing: skeletonFraming(smoothed).verdict,
        status: result.status,
        move: result.move,
        readiness: result.feedback.readiness,
      });
    },
    [dispatch],
  );

  const enableCamera = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const next = await requestPermission();
      if (next.granted) {
        setPermissionDenied(false);
        dispatch({ type: 'PERMISSION_GRANTED', now: Date.now() });
      } else {
        setPermissionDenied(true);
      }
    } catch {
      setPermissionDenied(true);
    } finally {
      setRequesting(false);
    }
  };

  const retry = () => {
    analyzerRef.current.reset();
    setPoseFrame(null);
    setFeedback(INITIAL_POSE_FEEDBACK);
    dispatch({ type: 'RETRY', now: Date.now() });
  };

  const skipMove = () => {
    const move = currentTestMove(stateRef.current);
    if (!move) return;
    logCalibrationMoveSkipped(move);
    dispatch({ type: 'SKIP_MOVE', now: Date.now() });
  };

  const cancel = () => {
    clearTrackingHandoff();
    if (router.canGoBack()) {
      router.back();
    } else if (isFirstRun) {
      router.replace('/(onboarding)/make-it-real' as Href);
    } else {
      router.replace('/(tabs)');
    }
  };

  const cameraActive = permission?.granted === true && detectorAvailable && cameraPhase;
  const openSettings = () => Linking.openSettings().catch(() => {});
  const cameraOff = permission?.canAskAgain === false || permissionDenied;
  const testMove = currentTestMove(state);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {cameraActive ? (
        <WorkoutCameraPreview
          active
          recordingEnabled={params.record === '1'}
          onPoseFrame={onPoseFrame}
          onTrackingStatus={() => {
            analyzerRef.current.markTrackingLost();
            dispatch({ type: 'TRACKING_LOST', now: Date.now() });
          }}
          onUnavailable={() => {
            setUnavailableReason('The camera stopped unexpectedly.');
            dispatch({ type: 'UNAVAILABLE', now: Date.now() });
          }}
          permission={permission}
          poseFrame={poseFrame}
          poseFeedback={feedback}
          poseScore={INITIAL_POSE_SCORE}
          hudTheme={hudTheme}
          trackingMode="real"
          unavailableReason={unavailableReason}
          variant="setup"
        />
      ) : (
        <View style={styles.emptyCamera} />
      )}

      {cameraActive ? (
        <>
          {state.phase === 'framing' ? <BodyOutline verdict={state.framing} /> : null}
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

      <ParticleBurst trigger={burst} theme={hudTheme} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel camera setup"
        onPress={cancel}
        style={[styles.close, { top: insets.top + spacing.sm }]}
      >
        <Ionicons name="close" size={23} color={colors.white} />
      </Pressable>

      {cameraPhase ? (
        <View style={[styles.header, { top: insets.top + spacing.md }]}>
          <Text style={styles.eyebrow}>
            {state.phase === 'framing'
              ? 'STEP 1 · FRAME UP'
              : state.phase === 'moves'
                ? 'STEP 2 · TEST DRIVE'
                : isFirstRun
                  ? 'STEP 3 · SYNC'
                  : 'SYNC'}
          </Text>
          <Text style={styles.runName} numberOfLines={1}>{params.name ?? 'Your run'}</Text>
          {__DEV__ ? (
            <Text style={styles.devTimer}>
              {flowElapsedSeconds(state, now).toFixed(1)}s · {state.phase} ·{' '}
              {Math.max(0, (now - state.phaseStartedAt) / 1000).toFixed(1)}s
            </Text>
          ) : null}
        </View>
      ) : null}

      {playScreen === 'tv' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tvConnected ? 'TV connected. Open TV setup guide' : 'TV setup help'}
          hitSlop={8}
          onPress={() => setTvGuideOpen(true)}
          style={[styles.tvHelp, tvConnected && styles.tvHelpConnected, { top: insets.top + spacing.sm }]}
        >
          <Ionicons
            name={tvConnected ? 'tv' : 'tv-outline'}
            size={15}
            color={tvConnected ? colors.lime : colors.white}
          />
          <Text style={[styles.tvHelpText, tvConnected && styles.tvHelpTextConnected]}>
            {tvConnected ? 'TV connected' : display.supported ? 'Choose your TV' : 'Having trouble?'}
          </Text>
        </Pressable>
      ) : null}
      <TvSetupGuide visible={tvGuideOpen} onClose={() => setTvGuideOpen(false)} detection={display} />

      {state.phase === 'permission' ? (
        <IntroScreen
          compact={!isFirstRun}
          cameraOff={cameraOff}
          loading={requesting || !permission}
          topInset={insets.top}
          bottomInset={insets.bottom}
          hudTheme={hudTheme}
          recording={params.record === '1'}
          onEnable={enableCamera}
          onOpenSettings={openSettings}
          onContinueWithout={() =>
            dispatch({ type: 'CONTINUE_WITHOUT_CAMERA', now: Date.now() })
          }
        />
      ) : state.phase === 'unavailable' ? (
        detectorAvailable ? (
          <SetupCard
            icon="warning-outline"
            title="Camera tracking is off"
            detail={unavailableReason}
            primary={cameraOff ? 'OPEN SETTINGS' : 'TRY AGAIN'}
            onPrimary={cameraOff ? openSettings : permission?.granted ? retry : enableCamera}
            onSecondary={() =>
              dispatch({ type: 'CONTINUE_WITHOUT_CAMERA', now: Date.now() })
            }
            secondary="CONTINUE WITH DEFAULT SETTINGS"
          />
        ) : (
          // Simulator / Android / build without the detector: nothing to retry.
          <SetupCard
            icon="body-outline"
            title="Camera tracking is off"
            detail={unavailableReason}
            primary="CONTINUE WITH DEFAULT SETTINGS"
            onPrimary={() => dispatch({ type: 'CONTINUE_WITHOUT_CAMERA', now: Date.now() })}
            onSecondary={cancel}
            secondary="GO BACK"
          />
        )
      ) : null}

      {state.phase === 'framing' ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="summary"
          accessibilityLabel={`${FRAMING_MESSAGE[state.framing]}. Stand inside the outline so your head and feet are both visible.`}
          style={[styles.guidance, { bottom: insets.bottom + spacing.xl }]}
        >
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, state.framing === 'ok' && styles.statusDotReady]} />
            <Text style={styles.statusLabel}>
              {state.framing === 'ok'
                ? state.calibrated
                  ? 'LOCKED'
                  : 'READING'
                : state.trackingLost || state.framing === 'searching'
                  ? 'LOOKING FOR YOU'
                  : 'ADJUST'}
            </Text>
          </View>
          <Text style={[styles.guidanceTitle, state.framing === 'ok' && styles.guidanceTitleOk]}>
            {FRAMING_MESSAGE[state.framing]}
          </Text>
          <Text style={styles.setupGuidance}>
            {state.framing === 'searching'
              ? 'Prop your phone up, then step back until you fill the outline.'
              : state.framing === 'ok'
                ? 'Stay right there for a second.'
                : 'Head to feet inside the outline works best.'}
          </Text>
          {state.fallbackOffered ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                state.calibrated ? 'Good enough, continue' : 'Continue with default settings'
              }
              hitSlop={10}
              onPress={() => dispatch({ type: 'FALLBACK_CONTINUE', now: Date.now() })}
              style={styles.helpLink}
            >
              <Text style={styles.helpLinkText}>
                Having trouble?{' '}
                <Text style={styles.helpLinkStrong}>
                  {state.calibrated ? 'Good enough, continue' : 'Continue with default settings'}
                </Text>
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {state.phase === 'moves' && testMove ? (
        <>
          <View
            accessible
            accessibilityLiveRegion="assertive"
            accessibilityLabel={`${MOVE_PROMPT[testMove]} Move ${state.moveIndex + 1} of ${MOVE_TEST_ORDER.length}.`}
            pointerEvents="none"
            style={styles.movePrompt}
          >
            <Ionicons name={MOVE_ICON[testMove]} size={54} color={hudTheme.accent} />
            <Text style={[styles.movePromptText, { color: hudTheme.accent }]}>
              {MOVE_PROMPT[testMove]}
            </Text>
            {state.trackingLost ? (
              <Text style={styles.moveHint}>Step back into view</Text>
            ) : (
              <Text style={styles.moveHint}>Do it once. The game reads it live.</Text>
            )}
          </View>
          <View style={[styles.guidance, { bottom: insets.bottom + spacing.xl }]}>
            <View style={styles.moveDots}>
              {MOVE_TEST_ORDER.map((move, index) => (
                <View
                  key={move}
                  style={[
                    styles.moveDot,
                    index < state.moveIndex && { backgroundColor: hudTheme.accent },
                    index === state.moveIndex && styles.moveDotActive,
                  ]}
                />
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip this move"
              hitSlop={10}
              onPress={skipMove}
              style={styles.helpLink}
            >
              <Text style={styles.helpLinkText}>
                Having trouble? <Text style={styles.helpLinkStrong}>Skip this move</Text>
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {state.phase === 'handoff' ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="summary"
          accessibilityLabel={
            state.countdown !== null
              ? `Locked. Starting in ${state.countdown}. Hold still.`
              : `${SYNC_LINES[syncLine]} Stand still in the center.`
          }
          style={[styles.guidance, { bottom: insets.bottom + spacing.xl }]}
        >
          {state.countdown !== null ? (
            <>
              <Text style={styles.readyLabel}>LOCKED</Text>
              <Text style={styles.countdown}>{state.countdown}</Text>
            </>
          ) : (
            <>
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={hudTheme.accent} />
                <Text style={styles.statusLabel}>
                  {state.trackingLost ? 'LOOKING FOR YOU' : 'HOLD STILL'}
                </Text>
              </View>
              <Text style={styles.guidanceTitle}>{SYNC_LINES[syncLine]}</Text>
            </>
          )}
        </View>
      ) : null}

      {celebrate ? (
        <View style={styles.endCard} accessible accessibilityLiveRegion="assertive">
          <ParticleBurst trigger={bigBurst} theme={hudTheme} big count={26} duration={1_100} />
          <Text style={styles.endEyebrow}>YOU&apos;RE IN</Text>
          <Text style={styles.endTitle}>Your body is the controller.</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Screen 1. Full ceremony on the first run; the compact variant (repeat runs
 * that still lack camera access) keeps the same message with a smaller figure.
 */
function IntroScreen({
  compact,
  cameraOff,
  loading,
  topInset,
  bottomInset,
  hudTheme,
  recording,
  onEnable,
  onOpenSettings,
  onContinueWithout,
}: {
  compact: boolean;
  cameraOff: boolean;
  loading: boolean;
  topInset: number;
  bottomInset: number;
  hudTheme: HudTheme;
  recording: boolean;
  onEnable: () => void;
  onOpenSettings: () => void;
  onContinueWithout: () => void;
}) {
  return (
    <View style={[styles.intro, { paddingTop: topInset + 64, paddingBottom: bottomInset + spacing.lg }]}>
      <View style={styles.introFigure}>
        <CalibrationIntroFigure
          width={compact ? 132 : 180}
          height={compact ? 220 : 300}
          theme={hudTheme}
        />
      </View>
      <View style={styles.introCopy}>
        <Text style={styles.introTitle}>Your body is the controller.</Text>
        <Text style={styles.introSub}>Turn on your camera so the game can see your moves.</Text>
        <View style={styles.tip}>
          <Ionicons name="sunny-outline" size={15} color={colors.lime} />
          <Text style={styles.tipText}>
            Find some space and good lighting. You will need room to jump and dodge.
          </Text>
        </View>
      </View>
      <View style={styles.introActions}>
        {cameraOff ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={onOpenSettings}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Ionicons name="settings-outline" size={18} color={colors.black} />
              <Text style={styles.primaryText}>CAMERA ACCESS IS OFF — OPEN SETTINGS</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onContinueWithout}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>CONTINUE WITH DEFAULT SETTINGS</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: loading, busy: loading }}
              disabled={loading}
              onPress={onEnable}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              {loading ? (
                <ActivityIndicator color={colors.black} />
              ) : (
                <>
                  <Ionicons name="videocam" size={18} color={colors.black} />
                  <Text style={styles.primaryText}>TURN ON CAMERA</Text>
                </>
              )}
            </Pressable>
            <Text style={styles.privacy}>
              {recording
                ? 'Processed on your phone. Your run video stays on this device unless you share it.'
                : 'Processed on your phone. Not recorded unless you turn on "Record my run".'}
            </Text>
          </>
        )}
      </View>
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
  devTimer: {
    ...metric,
    marginTop: 4,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: font.bold,
  },
  tvHelp: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 10,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  tvHelpConnected: { borderWidth: 1, borderColor: colors.lime },
  tvHelpText: { color: colors.white, fontSize: 12, fontWeight: font.bold },
  tvHelpTextConnected: { color: colors.lime },
  eyebrow: { ...type.micro, color: colors.lime, letterSpacing: 1.7 },
  runName: { ...type.h3, color: colors.white, marginTop: 3 },
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
  guidanceTitleOk: { color: colors.lime },
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
  helpLink: { marginTop: spacing.lg, paddingVertical: spacing.xs },
  helpLinkText: {
    ...type.bodySm,
    color: 'rgba(255,255,255,0.66)',
    fontWeight: font.bold,
    textAlign: 'center',
  },
  helpLinkStrong: { color: colors.white, textDecorationLine: 'underline' },
  movePrompt: {
    position: 'absolute',
    top: '26%',
    left: spacing.xl,
    right: spacing.xl,
    alignItems: 'center',
  },
  movePromptText: {
    ...type.hero,
    fontSize: 58,
    lineHeight: 62,
    textAlign: 'center',
    marginTop: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  moveHint: {
    ...type.body,
    color: 'rgba(255,255,255,0.86)',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  moveDots: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  moveDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  moveDotActive: {
    width: 14,
    height: 14,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: 'transparent',
  },
  endCard: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.bg,
  },
  endEyebrow: { ...type.micro, color: colors.lime, letterSpacing: 2 },
  endTitle: {
    ...type.display,
    color: colors.white,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  intro: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.bg,
    justifyContent: 'space-between',
  },
  introFigure: { alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  introCopy: { gap: spacing.sm, paddingBottom: spacing.lg },
  introTitle: { ...type.display, color: colors.white, fontSize: 36, lineHeight: 39 },
  introSub: { ...type.body, color: colors.textDim, fontSize: 16 },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tipText: { ...type.bodySm, color: colors.textDim, flex: 1 },
  introActions: { gap: spacing.xs },
  privacy: { ...type.bodySm, color: colors.textFaint, textAlign: 'center', marginTop: spacing.sm },
  pressed: { opacity: 0.82 },
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    borderRadius: radius.button,
    backgroundColor: colors.lime,
  },
  primaryText: { ...type.action, color: colors.black, textAlign: 'center', flexShrink: 1 },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  secondaryText: { color: colors.textDim, fontSize: 12, fontWeight: font.bold, letterSpacing: 0.4 },
});

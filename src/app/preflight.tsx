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
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalibrationIntroFigure } from '@/components/CalibrationIntroFigure';
import { CalibrationTeaser, useTeaserPlayback, useTeaserPlayer } from '@/components/CalibrationTeaser';
import { FramingCoach } from '@/components/FramingCoach';
import { RunPipFrame, runPipSize } from '@/components/RunPip';
import { TvSetupGuide } from '@/components/TvSetupGuide';
import { WorkoutCameraPreview } from '@/components/WorkoutCameraPreview';
import {
  logCalibrationAttempt,
  logCalibrationFailure,
  logCalibrationSuccess,
  logCalibrationTeaserCompleted,
} from '@/lib/analytics';
import { createCalibrationSounds, playHaptic, type FeedbackCue } from '@/lib/calibrationFeedback';
import { proportionsFromBaseline, recordCalibrationComplete } from '@/lib/calibrationProfile';
import { useExternalDisplay } from '@/lib/externalDisplay';
import type { CalibrationFailureReason } from '@/lib/funnelStore';
import { resolveHudTheme, type HudTheme } from '@/lib/hudThemes';
import { useOnboarding } from '@/lib/OnboardingContext';
import {
  hasFreshCalibration,
  isIntensityKey,
  loadPlaySetup,
  peekPlaySetup,
  saveCalibrationBaseline,
  saveFirstRunTrackingOff,
  saveVoicePrompts,
  type PlayScreen,
} from '@/lib/playSetup';
import {
  INITIAL_POSE_FEEDBACK,
  INITIAL_POSE_SCORE,
  PoseAnalyzer,
  type PoseFeedback,
  type PoseFrame,
} from '@/lib/poseTracking';
import {
  createPreflightFlowState,
  flowElapsedSeconds,
  holdProgress,
  isCameraPhase,
  type PreflightFlowEvent,
  type PreflightOutcome,
  reducePreflightFlow,
  spokenPrompt,
  TEASER_CLIPS,
  teaserLandedCount,
} from '@/lib/preflightFlow';
import { useProgress } from '@/lib/ProgressContext';
import { parseOptionalClassKeyParam } from '@/lib/progression';
import { skeletonFraming } from '@/lib/skeletonFraming';
import {
  clearTrackingHandoff,
  createTrackingRunId,
  stageTrackingHandoff,
} from '@/lib/trackingSession';
import { createVoicePrompter } from '@/lib/voicePrompts';
import { colors, font, metric, radius, spacing, type } from '@/theme';

/** Reducer clock tick: drives the hold ring, the teaser's wall-clock guards and the dev timer. */
const TICK_MS = 100;
/** The camera PiP during the teaser: the run's PiP, 1.5× so the person can see themselves. */
const TEASER_PIP_SCALE = 1.5;
/** Thin PiP ring while shoulders/hips are not in view. */
const PIP_RING_SEARCHING = '#FFB340';

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
 * Calibration: a three-second hold, then a teaser of the run. Screen 1
 * ("Your body is the controller.") asks for the camera; then the far-mode
 * coach of `preflightFlow.ts` runs on top of the untouched `PoseAnalyzer`:
 * one huge instruction until head + shoulders + hips are in frame, a ring
 * while the user holds still, then — after an intro beat — three short clips
 * of real gameplay (jump, duck, left) play full-screen with the camera in the
 * run's PiP — the user copies each dodge, a landed move gets the run's
 * ✓ PERFECT pop, a missed one just moves on; there is no fail state. A short
 * "You're in." beat, then the run. Auto-advance throughout. See
 * docs/CALIBRATION_FLOW.md.
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
     * "Record my runs" is on. Forwarded to the workout; also keeps this
     * screen's camera at the recording preset so the calibration handoff sees
     * the same frame size as the run.
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
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
  const [voiceOn, setVoiceOn] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const analyzerRef = useRef(new PoseAnalyzer());
  const soundsRef = useRef(createCalibrationSounds());
  const voiceRef = useRef(createVoicePrompter(true));
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

  // Teaser footage: one muted player created with the screen (the bundled
  // asset is loaded long before the hold finishes); the hook mirrors the
  // reducer's step into it and feeds its clock back as VIDEO_TIME.
  const teaserPlayer = useTeaserPlayer();
  useTeaserPlayback(teaserPlayer, state, dispatch);

  const cue = useCallback((kind: FeedbackCue) => {
    playHaptic(kind);
    soundsRef.current.play(kind);
  }, []);

  useEffect(() => {
    clearTrackingHandoff();
    const sounds = soundsRef.current;
    const voice = voiceRef.current;
    sounds.preload();
    return () => {
      if (!launchedRef.current) clearTrackingHandoff();
      sounds.dispose();
      voice.stop();
    };
  }, []);

  // Once per session: a hold within CALIBRATION_SESSION_MS skips this screen
  // entirely. Decided from the cached setup when it is warm (no flash), else
  // once it loads. `null` = undecided, `true` = skipping (render nothing).
  const [sessionSkip, setSessionSkip] = useState<boolean | null>(() => {
    const cached = peekPlaySetup();
    return cached ? (!isFirstRun && hasFreshCalibration(cached.calibrationBaseline)) : null;
  });

  useEffect(() => {
    let active = true;
    loadPlaySetup()
      .then((setup) => {
        if (!active) return;
        setPlayScreen(setup.screen);
        setVoiceOn(setup.voicePrompts);
        voiceRef.current.setEnabled(setup.voicePrompts);
        setSessionSkip((current) =>
          current ?? (!isFirstRun && hasFreshCalibration(setup.calibrationBaseline)),
        );
      })
      .catch(() => {
        if (active) setSessionSkip((current) => current ?? false);
      });
    return () => {
      active = false;
    };
  }, [isFirstRun]);

  // Session skip: straight into the run with `framingCheck`. The workout's
  // countdown checks the body is in frame silently (coaching only if not) and
  // the in-run analyzer re-acquires the baseline from its first frames.
  useEffect(() => {
    if (sessionSkip !== true || launchedRef.current) return;
    if (!permission) return;
    if (!permission.granted || !detectorAvailable) {
      // Camera lost or no detector: the normal flow handles it.
      setSessionSkip(false);
      return;
    }
    launchedRef.current = true;
    clearTrackingHandoff();
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
        tracking: 'calibrated',
        trackingRunId: runIdRef.current,
        framingCheck: '1',
        ...(params.record === '1' ? { record: '1' } : {}),
      },
    });
  }, [campaignClass, detectorAvailable, intensity, params, permission, router, sessionSkip, startRun]);

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
    if (
      sessionSkip === false &&
      permission.granted &&
      stateRef.current.phase === 'permission' &&
      !isFirstRun
    ) {
      dispatch({ type: 'PERMISSION_GRANTED', now: Date.now() });
    }
  }, [detectorAvailable, dispatch, isFirstRun, permission, sessionSkip]);

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

  // Reducer clock while the camera is live: hold ring + dev timer.
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

  // Route out once the flow completes. The teaser's end beat has already
  // been shown by then (it is a step of the `teaser` phase), so nothing is
  // held here. The launcher is read through a ref so a re-created callback
  // cannot fire twice.
  const launchRef = useRef(launchWorkout);
  launchRef.current = launchWorkout;
  const outcome = state.phase === 'complete' ? state.outcome : null;
  useEffect(() => {
    if (!outcome) return;
    launchRef.current(outcome);
  }, [outcome]);

  // Teaser analytics: one event per teaser, on completion or skip.
  const teaserLoggedRef = useRef(false);
  const teaserStartedAt = state.teaserStartedAt;
  const skipped = state.skipped;
  const landedCount = teaserLandedCount(state);
  useEffect(() => {
    if (!outcome || teaserStartedAt === null || teaserLoggedRef.current) return;
    teaserLoggedRef.current = true;
    logCalibrationTeaserCompleted({
      landed: landedCount,
      skipped,
      durationMs: Date.now() - teaserStartedAt,
    });
  }, [landedCount, outcome, skipped, teaserStartedAt]);

  // Calibration funnel instrumentation: one attempt per cycle, then a success
  // (the hold completed with a baseline — where `onboarding_complete` fires on
  // the first ever success) or a failure with a detected reason. A successful
  // hold also stamps the once-per-session marker so the next run within the
  // session window skips this screen.
  const locked = state.phase === 'complete' && state.outcome === 'calibrated';
  useEffect(() => {
    const phase = state.phase;
    if (phase === 'framing' || phase === 'hold') {
      if (!calibrationCycleRef.current) {
        calibrationCycleRef.current = true;
        logCalibrationAttempt();
      }
      return;
    }
    if (locked) {
      if (calibrationCycleRef.current) {
        calibrationCycleRef.current = false;
        logCalibrationSuccess();
        const snapshot = analyzerRef.current.calibrationSnapshot();
        const proportions = snapshot ? proportionsFromBaseline(snapshot.baseline) : null;
        recordCalibrationComplete(proportions).catch(() => {});
        saveCalibrationBaseline({
          capturedAt: Date.now(),
          cameraFacing: 'front',
          orientation: windowWidth > windowHeight ? 'landscape' : 'portrait',
          torsoRatio: proportions?.torsoRatio ?? null,
          shoulderRatio: proportions?.shoulderRatio ?? null,
        }).catch(() => {});
      }
      return;
    }
    if (phase === 'unavailable' || (phase === 'complete' && state.outcome === 'defaults')) {
      if (calibrationCycleRef.current) {
        calibrationCycleRef.current = false;
        logCalibrationFailure(deriveCalibrationFailureReason(latestFrameRef.current));
      }
    }
  }, [locked, state.outcome, state.phase, windowHeight, windowWidth]);

  // Feedback: a tick when framing locks, the success cue (haptic + sound) and
  // a green PiP flash on every landed teaser clip, the celebration cue on the
  // end beat, and the success cue when the flow completes with a baseline.
  const holding = state.phase === 'hold';
  const inTeaser = state.phase === 'teaser';
  const onScoreCard = inTeaser && state.teaserStep === 'done';
  useEffect(() => {
    if (holding) cue('tick');
  }, [cue, holding]);
  useEffect(() => {
    if (landedCount > 0) cue('phase');
  }, [cue, landedCount]);
  useEffect(() => {
    if (onScoreCard) cue('celebrate');
  }, [cue, onScoreCard]);
  useEffect(() => {
    // Skipped straight out of the hold with a baseline: the end beat never
    // ran, so this is the only success cue.
    if (locked && teaserStartedAt === null) cue('phase');
  }, [cue, locked, teaserStartedAt]);

  // Spoken prompts follow the displayed (debounced) verdict; the prompter
  // rate-limits and never repeats the same line back to back. Nothing is said
  // after the hold: the teaser is silent except "Step in" (urgent: it may
  // recur once the body comes back and leaves again).
  const spoken = spokenPrompt(state);
  useEffect(() => {
    if (!spoken) return;
    voiceRef.current.say(spoken, Date.now(), spoken === 'Step in');
  }, [spoken]);

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

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    voiceRef.current.setEnabled(next);
    void saveVoicePrompts(next);
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

  if (sessionSkip !== false) {
    // Undecided or skipping: a blank frame beats a flash of the intro screen.
    return (
      <View style={styles.root}>
        <StatusBar hidden />
      </View>
    );
  }

  // The camera is one component instance throughout: full-screen for the
  // framing + hold, then the run's PiP (1.5×) bottom-right while the teaser
  // footage plays behind it. Only its container's style changes, so the
  // native camera session is never torn down mid-flow.
  const pipSize = runPipSize(windowWidth, TEASER_PIP_SCALE);
  // Same corner and offsets as the run (workout.tsx); Skip moves to the left.
  const pipPlacement = { bottom: Math.max(insets.bottom + spacing.lg, spacing.xl), right: spacing.lg };
  const cameraView = cameraActive ? (
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
  );
  const devTimer = __DEV__ ? (
    <Text style={styles.devTimer}>
      {flowElapsedSeconds(state, now).toFixed(1)}s · {state.phase} ·{' '}
      {Math.max(0, (now - state.phaseStartedAt) / 1000).toFixed(1)}s · restarts{' '}
      {state.holdRestarts}
      {inTeaser
        ? ` · clip ${Math.min(state.teaserClip + 1, TEASER_CLIPS.length)}/${TEASER_CLIPS.length} ${state.teaserStep ?? ''} ${state.teaserHits.map((hit) => hit ?? '-').join(',')} · video ${state.teaserVideoMs ?? '—'}`
        : ''}
    </Text>
  ) : null;

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {inTeaser && cameraActive ? (
        <CalibrationTeaser player={teaserPlayer} state={state} theme={hudTheme} />
      ) : null}

      <RunPipFrame
        expanded={!(inTeaser && cameraActive)}
        width={pipSize.width}
        height={pipSize.height}
        style={pipPlacement}
        ring={state.bodyVisible ? colors.lime : PIP_RING_SEARCHING}
        flash={landedCount}
      >
        {cameraView}
      </RunPipFrame>

      {cameraActive && !inTeaser ? (
        <>
          <LinearGradient
            colors={['rgba(0,0,0,0.72)', 'rgba(0,0,0,0)']}
            pointerEvents="none"
            style={styles.topScrim}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']}
            pointerEvents="none"
            style={styles.bottomScrim}
          />
          <FramingCoach
            verdict={state.framing}
            // The debounced verdict picks the instruction; the side comes from
            // the latest frame (stable: it only matters outside the centre band).
            stepSide={skeletonFraming(poseFrame).stepSide}
            holding={holding}
            progress={holdProgress(state, now)}
            accent={hudTheme.accent}
            hint={
              holding
                ? null
                : state.framing === 'searching' || state.framing === 'closer'
                  ? 'Head to hips is enough'
                  : null
            }
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

      {cameraPhase && !inTeaser ? (
        // Hidden during the teaser: the footage's own cue badge sits here and
        // nothing is written over the video.
        <View style={[styles.header, { top: insets.top + spacing.md }]}>
          <Text style={styles.eyebrow}>{holding ? 'LOCKING IN' : 'FRAME UP'}</Text>
          <Text style={styles.runName} numberOfLines={1}>{params.name ?? 'Your run'}</Text>
          {devTimer}
        </View>
      ) : null}

      {cameraPhase ? (
        <View style={[styles.topRight, { top: insets.top + spacing.sm }]}>
          {playScreen === 'tv' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tvConnected ? 'TV connected. Open TV setup guide' : 'TV setup help'}
              hitSlop={8}
              onPress={() => setTvGuideOpen(true)}
              style={[styles.roundControl, tvConnected && styles.roundControlOn]}
            >
              <Ionicons
                name={tvConnected ? 'tv' : 'tv-outline'}
                size={17}
                color={tvConnected ? colors.lime : colors.white}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Voice prompts"
            accessibilityState={{ checked: voiceOn }}
            hitSlop={8}
            onPress={toggleVoice}
            style={[styles.roundControl, voiceOn && styles.roundControlOn]}
          >
            <Ionicons
              name={voiceOn ? 'volume-high' : 'volume-mute'}
              size={18}
              color={voiceOn ? colors.lime : colors.white}
            />
          </Pressable>
        </View>
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

      {cameraPhase && !onScoreCard ? (
        // During the teaser the PiP owns the bottom-right corner, so Skip
        // (and the dev timer) sit bottom-left. Hidden on the end beat.
        <View style={[styles.footer, inTeaser && styles.footerTeaser, { bottom: insets.bottom + spacing.lg }]}>
          {inTeaser ? devTimer : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              inTeaser
                ? 'Skip the warm-up and start'
                : state.calibrated
                  ? 'Skip the hold and start'
                  : 'Skip camera setup and start with default settings'
            }
            hitSlop={12}
            onPress={() => dispatch({ type: 'SKIP', now: Date.now() })}
            style={({ pressed }) => [styles.skip, inTeaser && styles.skipSmall, pressed && styles.pressed]}
          >
            <Text style={[styles.skipText, inTeaser && styles.skipTextSmall]}>Skip</Text>
          </Pressable>
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
        <Text style={styles.introSub}>
          Turn on your camera, step back until you see yourself, hold still for three seconds.
        </Text>
        <View style={styles.tip}>
          <Ionicons name="body-outline" size={15} color={colors.lime} />
          <Text style={styles.tipText}>
            Head to hips in frame is all it needs. Legs are optional.
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
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 220 },
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
  topRight: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  roundControl: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  roundControlOn: { borderWidth: 1, borderColor: 'rgba(215,255,62,0.6)' },
  eyebrow: { ...type.micro, color: colors.lime, letterSpacing: 1.7 },
  runName: { ...type.h3, color: colors.white, marginTop: 3 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footerTeaser: { left: spacing.lg, right: undefined, alignItems: 'flex-start', gap: spacing.xs },
  skipSmall: { minHeight: 36, minWidth: 72, paddingHorizontal: spacing.md },
  skipTextSmall: { fontSize: 13 },
  skip: {
    minHeight: 44,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  skipText: { color: 'rgba(255,255,255,0.86)', fontSize: 14, fontWeight: font.bold, letterSpacing: 0.4 },
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

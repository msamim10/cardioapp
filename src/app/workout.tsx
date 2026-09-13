import Ionicons from '@expo/vector-icons/Ionicons';
import { isCardioSurfPoseAvailable } from 'cardiosurf-pose';
import { useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoAirPlayButton, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WorkoutCameraPreview } from '@/components/WorkoutCameraPreview';
import { Card, GradientButton, Pill, ProgressTrack, SpeedPill, StatReadout } from '@/components/ui';
import { logPoseLatency, logRunRecordingFailed } from '@/lib/analytics';
import { getBeatmap, getBeatmapHash } from '@/lib/beatmapRegistry';
import { requestRunNonce } from '@/lib/leaderboards';
import { peekRunNonce, stageRunNonce, stageRunSubmission } from '@/lib/runSubmission';
import { beatmapDurationMismatch, type BeatmapMove } from '@/lib/beatmaps';
import { CueJudge, INITIAL_CUE_SCORE, type CueScore } from '@/lib/cueScoring';
import { getLevel, getMode } from '@/lib/gameData';
import { resolveHudTheme } from '@/lib/hudThemes';
import { LatencyReservoir, latencyDeltas } from '@/lib/poseLatency';
import {
  applyRecognizedMove,
  countRecognizedMove,
  INITIAL_POSE_FEEDBACK,
  INITIAL_POSE_SCORE,
  PoseAnalyzer,
  PoseFrame,
  PoseTrackingMode,
  totalWorkoutScore,
} from '@/lib/poseTracking';
import {
  INTENSITY_META,
  isIntensityKey,
  targetSecondsForRun,
} from '@/lib/playSetup';
import { useProgress } from '@/lib/ProgressContext';
import { CLASS_META, caloriesForRun } from '@/lib/progression';
import { RunClock, TICK_INTERVAL_S } from '@/lib/runClock';
import { RunRecordingSession, isRunRecordingAvailable, stageRecordedRun } from '@/lib/runRecording';
import {
  clearTrackingHandoff,
  consumeTrackingHandoff,
} from '@/lib/trackingSession';
import { getVideoSource } from '@/lib/videoSources';
import { colors, font, metric, radius, spacing, type } from '@/theme';

/** mm:ss from a seconds value (clamped, non-negative). */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Run a player-touching operation, swallowing the case where expo-video has
 * already released the native shared object (e.g. on unmount / player
 * recreation). Accessing a released player throws
 * NativeSharedObjectNotFoundException, which must never crash teardown or a
 * late-resolving async callback.
 */
function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // Player was released before this ran; nothing to do.
  }
}

export default function WorkoutScreen() {
  const { level, speed, duration: durationParam, intensity: intensityParam, tracking, trackingRunId, fromOnboarding, record } =
    useLocalSearchParams<{
      level: string;
      name?: string;
      speed?: string;
      /** Target run length in minutes. The map loops until it is reached. */
      duration?: string;
      intensity?: string;
      tracking?: 'calibrated' | 'off';
      trackingRunId?: string;
      /** Set when launched from the onboarding ceremony; forwarded to the summary. */
      fromOnboarding?: string;
      /** "Record my run" (level screen): record the camera + a run log for the share video. */
      record?: string;
    }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [cameraPermission] = useCameraPermissions();
  useKeepAwake();

  const source = getVideoSource(level, 'vertical');

  // Playback speed comes from the run's intensity (0.85 / 1.0 / 1.2x), passed
  // as a route param so the level screen stays the single place that decides.
  const playbackRate = Number(speed) > 0 ? Number(speed) : 1;
  const intensityMeta = isIntensityKey(intensityParam) ? INTENSITY_META[intensityParam] : null;

  // Wall-clock target. When set, the map loops until the target is reached and
  // the run ends on the clock rather than at the end of the video. Without it
  // (legacy callers) the run ends when the video plays to its end, as before.
  const targetSeconds =
    Number(durationParam) > 0 ? targetSecondsForRun(Number(durationParam)) : 0;
  const timedRun = targetSeconds > 0;

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // Additive (AirPlay): tracks whether playback is routed to an external screen.
  const [onExternalScreen, setOnExternalScreen] = useState(false);
  // Wall-clock seconds of the run actually played (loops included, playback
  // rate divided out). This is what the HUD, calories, and the summary use.
  const [elapsed, setElapsed] = useState(0);
  // The run's total length in seconds: the target for timed runs, else the
  // video's natural duration once known.
  const [duration, setDuration] = useState(targetSeconds);
  const elapsedRef = useRef(0);
  const durationRef = useRef(targetSeconds);
  // The scoring clock: video-seconds accumulated across loops, seek/wrap/swap
  // classification and the "scoring active" gate (see runClock.ts). Rate and
  // loop mode are fixed for the life of this screen.
  const runClockRef = useRef<RunClock | null>(null);
  if (!runClockRef.current) {
    runClockRef.current = new RunClock({ playbackRate, loop: timedRun, tickIntervalS: TICK_INTERVAL_S });
  }
  const runClock = runClockRef.current;
  // Per-run pose latency samples + stale-drop count (bounded; summarized once).
  const latencyRef = useRef(new LatencyReservoir());
  const [devLatency, setDevLatency] = useState({ p50: 0, stale: 0, frames: 0 });
  const finishedRef = useRef(false);
  const [screenFocused, setScreenFocused] = useState(false);
  // This preference lasts for this workout. AirPlay always shows the companion
  // camera; returning to the phone restores the user's prior PiP choice.
  const [phonePipVisible, setPhonePipVisible] = useState(true);
  const [nativePoseUnavailable, setNativePoseUnavailable] = useState(false);
  // "Record my run": the camera writer + run log live for this screen only.
  // Recording needs the phone as the screen and a calibrated tracking run
  // (onboarding never sets `record`). See docs/RUN_RECORDING.md.
  const recordRequested =
    record === '1' && tracking === 'calibrated' && fromOnboarding !== '1' && isRunRecordingAvailable;
  const recordingRef = useRef<RunRecordingSession | null>(null);
  const [recordingState, setRecordingState] = useState<'idle' | 'starting' | 'recording' | 'ended'>('idle');
  const initialCalibrationRef = useRef(
    tracking === 'calibrated'
      ? consumeTrackingHandoff(trackingRunId, level)
      : null,
  );
  const initialCalibration = initialCalibrationRef.current;
  const [poseFrame, setPoseFrame] = useState<PoseFrame | null>(null);
  const [poseFeedback, setPoseFeedback] = useState(() =>
    initialCalibration
      ? {
          ...INITIAL_POSE_FEEDBACK,
          calibrationProgress: 1,
          instruction: 'Reacquiring your calibrated position…',
          reference: {
            centerX: initialCalibration.baseline.centerX,
            floorY: initialCalibration.baseline.ankleY,
            bodyHeight: initialCalibration.baseline.bodyHeight,
            bodyWidth: initialCalibration.baseline.shoulderWidth,
          },
        }
      : INITIAL_POSE_FEEDBACK,
  );
  const [poseScore, setPoseScore] = useState(INITIAL_POSE_SCORE);
  const poseScoreRef = useRef(poseScore);
  poseScoreRef.current = poseScore;
  // Timing-window scoring when this level ships a beatmap; otherwise null and
  // the free-scoring `applyRecognizedMove` path above is used unchanged.
  const beatmap = useMemo(() => getBeatmap(level), [level]);
  const cueJudgeRef = useRef<CueJudge | null>(null);
  if (beatmap && !cueJudgeRef.current) cueJudgeRef.current = new CueJudge(beatmap);
  const cueJudge = cueJudgeRef.current;
  const [cueScore, setCueScore] = useState<CueScore | null>(beatmap ? INITIAL_CUE_SCORE : null);
  const cueScoreRef = useRef(cueScore);
  cueScoreRef.current = cueScore;
  const [upcomingCue, setUpcomingCue] = useState<{ move: BeatmapMove; inMs: number } | null>(null);
  const durationWarnedRef = useRef(false);

  // Leaderboard nonce: requested once at run start for cued, timed runs. A
  // failure is non-fatal — the run still records locally, it just cannot be
  // submitted to the board.
  useEffect(() => {
    const runId = typeof trackingRunId === 'string' ? trackingRunId : null;
    const hash = getBeatmapHash(level);
    if (!beatmap || !runId || !hash || !timedRun || peekRunNonce(runId)) return;
    let cancelled = false;
    requestRunNonce(level, hash).then((nonce) => {
      if (!cancelled && nonce) stageRunNonce(runId, nonce);
    });
    return () => {
      cancelled = true;
    };
  }, [beatmap, level, timedRun, trackingRunId]);
  const poseAnalyzer = useRef(new PoseAnalyzer());
  const hydratedAnalyzerRef = useRef(false);
  if (initialCalibration && !hydratedAnalyzerRef.current) {
    poseAnalyzer.current.hydrateCalibration(initialCalibration);
    hydratedAnalyzerRef.current = true;
  }
  const poseLayoutRef = useRef(onExternalScreen);
  const realPoseCapable =
    tracking !== 'off' &&
    Platform.OS === 'ios' &&
    Device.isDevice &&
    isCardioSurfPoseAvailable &&
    !nativePoseUnavailable;
  const trackingMode: PoseTrackingMode =
    realPoseCapable && cameraPermission?.granted !== false
      ? 'real'
      : 'unavailable';
  const trackingUnavailableReason =
    cameraPermission?.granted === false
      ? 'Camera access is off. Enable it in Settings to track your body.'
      : nativePoseUnavailable
        ? 'The body detector stopped. Rebuild or reinstall the iOS development app.'
        : Platform.OS !== 'ios'
          ? 'Real body tracking currently requires iOS.'
          : !Device.isDevice
            ? 'Real body tracking requires a physical iPhone.'
            : !isCardioSurfPoseAvailable
              ? 'This app build does not include body tracking. Rebuild and reinstall it.'
              : 'Body tracking is unavailable.';
  const pipWidth = Math.min(120, Math.max(96, screenWidth * 0.28));
  const pipHeight = pipWidth * (4 / 3);

  // Additive (AirPlay): resolve the class + level for the companion dashboard.
  const { activeClass, activeRun, abandonRun, hudThemeId, levelProgress } = useProgress();
  const classKey = activeRun?.classKey ?? activeClass;
  // HUD palette: the persisted pick, but only if this device's level unlocks it.
  const hudTheme = useMemo(
    () => resolveHudTheme(hudThemeId, levelProgress.level),
    [hudThemeId, levelProgress.level]
  );
  const classMeta = CLASS_META[classKey];
  const levelInfo = getLevel(level);
  const worldInfo = getMode(level);
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : 0;
  const calories = caloriesForRun(elapsed / 60, classKey, intensityMeta?.effort ?? 1);

  // Recording starts once the map is `readyToPlay` and the run is unblocked
  // (not on a TV, tracking live). The session's first written frame is the
  // run log's wall-time zero; nothing is logged before that.
  const canRecord =
    recordRequested && trackingMode === 'real' && !onExternalScreen && typeof trackingRunId === 'string';
  useEffect(() => {
    if (!canRecord || status !== 'ready' || recordingRef.current || finishedRef.current) return;
    const session = new RunRecordingSession({
      runId: trackingRunId as string,
      levelId: level,
      levelName: levelInfo?.name ?? worldInfo?.name ?? level,
      intensity: intensityParam ?? null,
      playbackRate,
      targetSeconds,
      hudThemeId: hudTheme.id,
    });
    recordingRef.current = session;
    setRecordingState('starting');
    session.log.anchor(runClock.lastPositionSec);
    if (runClock.videoLengthSec > 0) session.log.setVideoLength(runClock.videoLengthSec);
    session.start().then(
      () => {
        if (recordingRef.current === session) setRecordingState('recording');
      },
      (error: unknown) => {
        if (recordingRef.current !== session) return;
        logRunRecordingFailed('record');
        console.warn('[recording] start failed', error);
        recordingRef.current = null;
        setRecordingState('ended');
      },
    );
  }, [canRecord, hudTheme.id, intensityParam, level, levelInfo, playbackRate, runClock, status, targetSeconds, trackingRunId, worldInfo]);

  // Moving the run to a TV mid-recording remounts the camera and the writer is
  // released with it (docs/RUN_RECORDING.md, "v1 does not record AirPlay
  // runs"); drop the recording rather than ship a truncated clip.
  useEffect(() => {
    if (!onExternalScreen || !recordingRef.current) return;
    recordingRef.current.cancel();
    recordingRef.current = null;
    setRecordingState('ended');
  }, [onExternalScreen]);

  // Unmount without finish/exit (e.g. the app was killed into a fresh route):
  // never leave the writer running.
  useEffect(
    () => () => {
      recordingRef.current?.cancel();
      recordingRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (trackingMode !== 'unavailable') return;
    setPoseFrame(null);
    setPoseFeedback(INITIAL_POSE_FEEDBACK);
    setPoseScore(INITIAL_POSE_SCORE);
  }, [trackingMode]);

  useEffect(() => {
    if (poseLayoutRef.current === onExternalScreen) return;
    poseLayoutRef.current = onExternalScreen;
    // AirPlay changes only the presentation surface (PiP vs companion), not
    // the front-camera source. Preserve the calibrated baseline across that
    // remount and use the normal guarded reacquisition to suppress handoff
    // actions. PoseAnalyzer still hard-resets itself if source dimensions
    // actually change beyond its safe threshold.
    clearTrackingHandoff();
    poseAnalyzer.current.markTrackingLost();
    setPoseFrame(null);
    setPoseFeedback((current) =>
      trackingMode === 'unavailable'
        ? INITIAL_POSE_FEEDBACK
        : {
            ...current,
            instruction: 'Reacquiring your calibrated position…',
            framingHint: 'Hold center while the camera reconnects',
          },
    );
  }, [onExternalScreen, trackingMode]);

  const handlePoseFrame = useCallback(
    (frame: PoseFrame) => {
      if (frame.origin !== 'native' || trackingMode === 'unavailable') return;
      // The analyzer always runs so tracking/calibration stay alive even while
      // the scoring gate is closed (paused, buffering, seeking, AirPlay swap).
      const result = poseAnalyzer.current.process(frame);
      const classifiedTs = Date.now();
      const deltas = latencyDeltas(frame, classifiedTs);
      if (deltas) latencyRef.current.record(deltas);
      setPoseFrame({ ...frame, keypoints: result.keypoints });
      setPoseFeedback(result.feedback);
      const recording = recordingRef.current;
      if (recording?.recording) recording.log.onPose({ keypoints: result.keypoints });
      if (result.move && runClock.isScoringActive(classifiedTs)) {
        // Combos chain on the VIDEO clock, not wall time or frame timestamps.
        const videoSec = runClock.videoTimeSec(classifiedTs);
        if (cueJudge) {
          // Beatmap level: grade against the nearest cue; tally the move only.
          const judgement = cueJudge.onMove(result.move, videoSec);
          setCueScore(cueJudge.score);
          if (recording?.recording) recording.log.onJudgement(judgement, videoSec, cueJudge.score, classifiedTs);
          setPoseScore((current) => countRecognizedMove(current, result.move!));
        } else {
          setPoseScore((current) =>
            applyRecognizedMove(current, result.move!, Math.round(videoSec * 1000)),
          );
        }
      }
    },
    [cueJudge, runClock, trackingMode],
  );

  const handleStaleFrame = useCallback(() => {
    latencyRef.current.recordStaleDrop();
  }, []);

  const handleTrackingStatus = useCallback(() => {
    poseAnalyzer.current.markTrackingLost();
    setPoseFrame(null);
    setPoseFeedback((current) => ({
      ...current,
      instruction: 'Tracking lost — step back into view',
      framingHint: 'Tracking lost — step back into view',
    }));
  }, []);

  const finish = useCallback(() => {
    // Reaching the target (timed run) or playToEnd (untimed) are the only paths
    // that may mark a run finished for campaign unlock.
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearTrackingHandoff();
    const latency = latencyRef.current.summary();
    logPoseLatency(latency);
    const cue = cueScoreRef.current;
    // With a beatmap the action points come from the cue judge; the playback
    // progress component is composed the same way in both modes.
    const actionScore = cue ? cue.score : poseScoreRef.current.score;
    const totalScore = totalWorkoutScore(actionScore, elapsedRef.current, durationRef.current);
    // Stop the camera writer BEFORE navigating: unmounting the camera view
    // releases the writer, so the file must be finalized while this screen is
    // still up. The clip + log are staged by runId for the summary to compose.
    const recording = recordingRef.current;
    recordingRef.current = null;
    let navigateAfter: Promise<unknown> = Promise.resolve();
    if (recording?.active && typeof trackingRunId === 'string') {
      const recorded = recording.finish({
        score: actionScore,
        totalScore,
        accuracy: cueJudgeRef.current?.accuracy ?? 0,
        maxCombo: cue ? cue.maxCombo : poseScoreRef.current.maxCombo,
        perfect: cue?.perfect ?? 0,
        good: cue?.good ?? 0,
        miss: cue?.miss ?? 0,
        elapsedSeconds: elapsedRef.current,
      });
      recorded.catch(() => logRunRecordingFailed('record'));
      stageRecordedRun(trackingRunId, recorded);
      // The writer finalizes in well under a second; never hold the summary
      // longer than that if it does not.
      navigateAfter = Promise.race([
        recorded.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } else {
      recording?.cancel();
    }
    // Stage the verbatim judgement log + nonce for the summary to submit. The
    // server replays this log, so it is the cue score (not the composed
    // workout score) that goes on the board.
    const judge = cueJudgeRef.current;
    const nonce = peekRunNonce(typeof trackingRunId === 'string' ? trackingRunId : undefined);
    if (judge && cue && nonce && typeof trackingRunId === 'string' && timedRun) {
      stageRunSubmission({
        runId: trackingRunId,
        levelId: level,
        beatmapHash: nonce.beatmapHash,
        nonce: nonce.nonce,
        playbackRate,
        targetSeconds,
        elapsedSeconds: elapsedRef.current,
        videoLengthSec: runClock.videoLengthSec,
        events: judge.events,
        spurious: cue.spurious,
        score: cue.score,
        maxCombo: cue.maxCombo,
        accuracy: judge.accuracy,
      });
    }
    void navigateAfter.then(() => router.replace({
      pathname: '/summary',
      params: {
        completed: '1',
        runId: trackingRunId,
        elapsedSeconds: String(elapsedRef.current),
        actionCounts: JSON.stringify(poseScoreRef.current.counts),
        poseScore: String(totalScore),
        maxCombo: String(cue ? cue.maxCombo : poseScoreRef.current.maxCombo),
        hasBeatmap: cue ? '1' : '0',
        perfectCount: String(cue?.perfect ?? 0),
        goodCount: String(cue?.good ?? 0),
        missCount: String(cue?.miss ?? 0),
        accuracy: String(cueJudgeRef.current?.accuracy ?? 0),
        latencyP50Ms: String(latency.metrics.total.p50),
        latencyP95Ms: String(latency.metrics.total.p95),
        staleFramesDropped: String(latency.staleFramesDropped),
        ...(fromOnboarding === '1' ? { fromOnboarding: '1' } : {}),
      },
    }));
  }, [fromOnboarding, level, playbackRate, router, runClock, targetSeconds, timedRun, trackingRunId]);

  const exitEarly = useCallback(() => {
    clearTrackingHandoff();
    // Abandoned runs are never kept: the writer is aborted and the file deleted.
    recordingRef.current?.cancel();
    recordingRef.current = null;
    // An abandoned run still reports its pipeline latency (no-op without frames).
    logPoseLatency(latencyRef.current.summary());
    // Backing out must not clear the map or unlock the next campaign step.
    abandonRun(typeof trackingRunId === 'string' ? trackingRunId : undefined);
    if (router.canGoBack()) {
      router.back();
    } else {
      // The onboarding launch replaces the whole stack, so there is nothing to
      // pop back to; Home is the honest destination.
      router.replace('/(tabs)');
    }
  }, [abandonRun, router, trackingRunId]);

  useEffect(() => () => clearTrackingHandoff(), []);

  const player = useVideoPlayer(source, (p) => {
    // Timed runs loop the map seamlessly until the wall-clock target; untimed
    // runs still end on playToEnd.
    p.loop = timedRun;
    p.playbackRate = playbackRate;
    // Additive (AirPlay): route video (not just audio) to the selected TV.
    p.allowsExternalPlayback = true;
    if (source) p.play();
  });

  const externalPlaybackRef = useRef<boolean | null>(null);
  const sourceOrientationRef = useRef<'vertical' | 'horizontal'>('vertical');
  const replacementGenerationRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  // Keep route state and source orientation in sync from both the initial
  // player state and subsequent AirPlay changes. Ref guards prevent the
  // listener from replacing a source already selected by the initial sync.
  const syncExternalPlayback = useCallback(
    (isExternalPlaybackActive: boolean) => {
      if (externalPlaybackRef.current === isExternalPlaybackActive) return;

      externalPlaybackRef.current = isExternalPlaybackActive;
      setOnExternalScreen(isExternalPlaybackActive);

      const nextOrientation = isExternalPlaybackActive ? 'horizontal' : 'vertical';
      if (sourceOrientationRef.current === nextOrientation) return;

      const nextSource = getVideoSource(level, nextOrientation);
      if (!nextSource) return;

      let resumeAt: number;
      let wasPlaying: boolean;
      let replacement: Promise<void>;
      const generation = replacementGenerationRef.current + 1;

      try {
        resumeAt = player.currentTime;
        wasPlaying = player.playing;
        // Ticks during the swap read ~0 from the new source; ignore them all.
        runClock.beginSwap();
        replacement = player.replaceAsync(nextSource);
      } catch {
        // The native player may already have been released during navigation.
        runClock.endSwap(runClock.lastPositionSec, runClock.videoLengthSec);
        return;
      }

      replacementGenerationRef.current = generation;
      sourceOrientationRef.current = nextOrientation;
      replacement
        .then(() => {
          if (replacementGenerationRef.current !== generation) return;
          let newLength = 0;
          safe(() => {
            player.playbackRate = playbackRate;
            player.loop = timedRun;
            if (resumeAt > 0) player.currentTime = resumeAt;
            if (wasPlaying) player.play();
            newLength = player.duration || 0;
          });
          // Anchor at resumeAt and adopt the new source's duration BEFORE
          // crediting resumes, so the first post-swap tick is a natural delta.
          runClock.endSwap(resumeAt, newLength);
          recordingRef.current?.log.onGate(runClock.isAdvancing(), resumeAt);
        })
        .catch(() => {
          if (replacementGenerationRef.current !== generation) return;
          runClock.endSwap(runClock.lastPositionSec, runClock.videoLengthSec);
        });
    },
    [level, playbackRate, player, runClock, timedRun],
  );

  useEffect(() => {
    if (!source) return;
    const endSub = player.addListener('playToEnd', () => {
      // Timed runs loop (player.loop = true): the end of a pass is not the end
      // of the run. The timeUpdate listener credits the wrap, so nothing to do.
      if (timedRun) return;
      safe(() => {
        elapsedRef.current = Math.max(elapsedRef.current, player.currentTime || 0);
      });
      finish();
    });
    const statusSub = player.addListener('statusChange', (e) => {
      if (e.status === 'error') setStatus('error');
      else if (e.status === 'readyToPlay') setStatus('ready');
      // Scoring gate: only `readyToPlay` counts; loading/buffering close it.
      runClock.setReady(e.status === 'readyToPlay');
      recordingRef.current?.log.onGate(runClock.isAdvancing(), runClock.lastPositionSec);
    });
    // Scoring gate: playing flag from the player itself, so an external pause
    // (Control Center, lock screen, AirPlay remote) closes it. On resume the
    // clock re-anchors to the current position to avoid a phantom delta.
    const playingSub = player.addListener('playingChange', ({ isPlaying }) => {
      let position = runClock.lastPositionSec;
      safe(() => {
        position = player.currentTime || 0;
      });
      runClock.setPlaying(isPlaying, position);
      recordingRef.current?.log.onGate(runClock.isAdvancing(), position);
    });
    safe(() => {
      runClock.setReady(player.status === 'readyToPlay');
      runClock.setPlaying(player.playing, player.currentTime || 0);
    });
    return () => {
      endSub.remove();
      statusSub.remove();
      playingSub.remove();
    };
  }, [finish, player, runClock, source, timedRun]);

  // Subscribe before reading the current value so a route selected on the
  // recap screen is handled even if it was active before this screen mounted.
  useEffect(() => {
    if (!source) return;
    const sub = player.addListener(
      'isExternalPlaybackActiveChange',
      ({ isExternalPlaybackActive }) => syncExternalPlayback(isExternalPlaybackActive),
    );
    safe(() => {
      syncExternalPlayback(player.isExternalPlaybackActive);
    });
    return () => sub.remove();
  }, [player, source, syncExternalPlayback]);

  // Capture actual playback time for every workout. For timed runs the video
  // position is folded into a wall-clock total across loops (rate divided out);
  // for untimed runs it is the position itself. Either way it drives the HUD,
  // the companion dashboard and the value persisted at completion.
  useEffect(() => {
    if (!source) return;
    player.timeUpdateEventInterval = TICK_INTERVAL_S;
    const startPosition = player.currentTime || 0;
    runClock.start(startPosition, player.duration || 0);
    if (timedRun) {
      durationRef.current = targetSeconds;
      setDuration(targetSeconds);
    } else {
      elapsedRef.current = startPosition;
      durationRef.current = player.duration || 0;
      setElapsed(startPosition);
      setDuration(durationRef.current);
    }
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const position = Math.max(0, currentTime);
      safe(() => {
        if (player.duration > 0) runClock.setLength(player.duration);
      });
      // Classify the tick (natural / wrap / seek / stall / ignored-during-swap)
      // and credit only natural playback and loop wraps. See runClock.ts.
      const tickKind = runClock.tick(position);
      const recording = recordingRef.current;
      if (recording?.recording) {
        if (runClock.videoLengthSec > 0) recording.log.setVideoLength(runClock.videoLengthSec);
        recording.log.onTick(tickKind, position, runClock.isAdvancing(), Date.now());
      }
      if (cueJudge) {
        // Cues follow the accumulated video clock; expire missed ones and
        // surface the next cue for the HUD. Loops wrap at the REAL source
        // length; the vertical map's timings are used even when the AirPlay
        // cut's duration differs (warned once — known limitation).
        const length = runClock.videoLengthSec;
        if (length > 0) {
          cueJudge.setVideoLength(length);
          if (!durationWarnedRef.current && beatmapDurationMismatch(cueJudge.beatmap, length)) {
            durationWarnedRef.current = true;
            console.warn(
              `[beatmaps] ${cueJudge.beatmap.levelId}: source is ${length.toFixed(1)}s, beatmap authored for ${cueJudge.beatmap.videoDurationSec.toFixed(1)}s; using vertical timings`,
            );
          }
        }
        const videoSec = runClock.videoTimeSec();
        const expired = cueJudge.onTick(videoSec);
        if (expired > 0) setCueScore(cueJudge.score);
        const next = cueJudge.upcoming(videoSec)[0];
        setUpcomingCue(next ? { move: next.move, inMs: Math.round((next.at - videoSec) * 1000) } : null);
        if (recording?.recording) {
          const now = Date.now();
          if (expired > 0) recording.log.onExpiry(expired, videoSec, cueJudge.score, now);
          recording.log.onUpcoming(next ? { move: next.move, at: next.at } : null, now);
        }
      }
      if (__DEV__) {
        setDevLatency({
          p50: latencyRef.current.p50Total(),
          stale: latencyRef.current.staleFramesDropped,
          frames: latencyRef.current.frames,
        });
      }
      if (!timedRun) {
        elapsedRef.current = position;
        setElapsed(position);
        if (runClock.videoLengthSec > 0) {
          durationRef.current = runClock.videoLengthSec;
          setDuration(runClock.videoLengthSec);
        }
        return;
      }
      const wall = runClock.wallElapsedSec();
      elapsedRef.current = wall;
      setElapsed(wall);
      if (wall >= targetSeconds) finish();
    });
    return () => {
      sub.remove();
      // Player may already be released on unmount; guard the reset so
      // teardown can't crash with NativeSharedObjectNotFoundException.
      safe(() => {
        player.timeUpdateEventInterval = 0;
      });
    };
  }, [cueJudge, finish, player, runClock, source, targetSeconds, timedRun]);

  // No streamable source configured: let the flow continue to results.
  if (!source) {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar hidden />
        <Ionicons name="videocam-off-outline" size={44} color={colors.textFaint} style={styles.fallbackIcon} />
        <Text style={styles.fallbackTitle}>Level not available yet</Text>
        <Text style={styles.fallbackSub}>This video isn&apos;t hosted yet. Choose another level to continue.</Text>
        <GradientButton label="Go back" icon="arrow-back" onPress={exitEarly} style={{ marginTop: spacing.xl, alignSelf: 'stretch' }} />
        <Pressable onPress={exitEarly} style={{ marginTop: spacing.lg }}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />

      {/* Additive (AirPlay): live form preview + compact companion dashboard on
          the phone while the run plays on the TV. */}
      {onExternalScreen ? (
        <View style={styles.companion}>
          <View
            style={[
              styles.companionInner,
              {
                paddingTop: insets.top + 56,
                paddingBottom: insets.bottom + spacing.md,
              },
            ]}
          >
            <View style={styles.companionCameraFrame}>
              <WorkoutCameraPreview
                active={screenFocused && onExternalScreen}
                recordingEnabled={recordRequested}
                onPoseFrame={handlePoseFrame}
                onStaleFrame={handleStaleFrame}
                onTrackingStatus={handleTrackingStatus}
                onUnavailable={() => setNativePoseUnavailable(true)}
                permission={cameraPermission}
                playbackDuration={duration}
                playbackElapsed={elapsed}
                poseFrame={poseFrame}
                poseFeedback={poseFeedback}
                poseScore={poseScore}
                cueScore={cueScore}
                upcomingCue={upcomingCue}
                hudTheme={hudTheme}
                trackingMode={trackingMode}
                unavailableReason={trackingUnavailableReason}
                variant="companion"
              />
            </View>

            <View style={styles.companionDashboard}>
              <Card style={styles.companionCard}>
                <Text style={styles.companionLevel} numberOfLines={1}>
                  {levelInfo?.name ?? worldInfo?.name ?? 'Your run'}
                </Text>

                <View style={styles.companionPills}>
                  <Pill icon={classMeta.icon} accent={classMeta.accent} label={classMeta.label} />
                  {intensityMeta ? (
                    <Pill icon={intensityMeta.icon} accent="lime" label={intensityMeta.label} />
                  ) : null}
                  <SpeedPill speedFactor={playbackRate} />
                </View>

                <View style={styles.companionStats}>
                  <StatReadout value={formatClock(elapsed)} label="Elapsed" />
                  <StatReadout value={`${calories}`} label="Calories" icon="flame" accent="orange" />
                  <StatReadout
                    value={duration > 0 ? `-${formatClock(remaining)}` : '--:--'}
                    label="Remaining"
                  />
                </View>

                <ProgressTrack value={progress} />
              </Card>
            </View>
          </View>
        </View>
      ) : tracking !== 'off' ? (
        phonePipVisible ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.pipPlacement,
              {
                bottom: Math.max(insets.bottom + spacing.lg, spacing.xl),
                right: spacing.lg,
                width: pipWidth,
                height: pipHeight,
              },
            ]}
          >
            <View style={styles.pipFrame} pointerEvents="none">
              <WorkoutCameraPreview
                active={screenFocused}
                recordingEnabled={recordRequested}
                onPoseFrame={handlePoseFrame}
                onStaleFrame={handleStaleFrame}
                onTrackingStatus={handleTrackingStatus}
                onUnavailable={() => setNativePoseUnavailable(true)}
                permission={cameraPermission}
                playbackDuration={duration}
                playbackElapsed={elapsed}
                poseFrame={poseFrame}
                poseFeedback={poseFeedback}
                poseScore={poseScore}
                cueScore={cueScore}
                upcomingCue={upcomingCue}
                hudTheme={hudTheme}
                trackingMode={trackingMode}
                unavailableReason={trackingUnavailableReason}
                variant="pip"
              />
            </View>
            {recordingState === 'starting' || recordingState === 'recording' ? (
              // The camera view is the recorder: hiding the PiP would unmount
              // it and end the clip, so the control is withheld while recording.
              <View
                style={styles.pipRecBadge}
                accessible
                accessibilityLabel="Recording your run"
                accessibilityLiveRegion="polite"
              >
                <View style={styles.pipRecDot} />
                <Text style={styles.pipRecText}>REC</Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hide camera preview"
                accessibilityHint="Hides the corner form preview for this workout"
                hitSlop={10}
                onPress={() => setPhonePipVisible(false)}
                style={({ pressed }) => [
                  styles.pipCloseButton,
                  pressed && styles.controlPressed,
                ]}
              >
                <Ionicons name="close" size={16} color={colors.white} />
              </Pressable>
            )}
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show camera preview"
            accessibilityHint="Restores the live front-camera form preview"
            hitSlop={10}
            onPress={() => setPhonePipVisible(true)}
            style={({ pressed }) => [
              styles.pipRestoreButton,
              {
                bottom: Math.max(insets.bottom + spacing.lg, spacing.xl),
                right: spacing.lg,
              },
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons name="camera-outline" size={19} color={colors.lime} />
          </Pressable>
        )
      ) : null}

      {/* Loading */}
      {status === 'loading' ? (
        <View style={styles.centerOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.lime} />
          <Text style={styles.loadingText}>Loading level…</Text>
        </View>
      ) : null}

      {/* Error / not uploaded yet */}
      {status === 'error' ? (
        <View style={styles.endOverlay}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textFaint} style={styles.fallbackIcon} />
          <Text style={styles.endTitle}>Level not ready yet</Text>
          <Text style={styles.fallbackSub}>This video is still uploading. Pick another level, or check back soon.</Text>
          <GradientButton label="Back" icon="arrow-back" onPress={exitEarly} style={{ alignSelf: 'stretch', marginTop: spacing.lg }} />
        </View>
      ) : null}

      {/* Single exit control — early exit abandons; does not record completion */}
      <Pressable
        onPress={exitEarly}
        style={[styles.exitBtn, { top: insets.top + spacing.sm }]}
        hitSlop={12}
      >
        <Ionicons name="close" size={22} color={colors.white} />
      </Pressable>

      {/* HUD: time remaining on the wall clock + run progress. On the phone it
          sits top-centre over the map; the companion dashboard carries its own
          readout when the run is on the TV. */}
      {!onExternalScreen && status === 'ready' && duration > 0 ? (
        <View
          pointerEvents="none"
          accessible
          accessibilityRole="timer"
          accessibilityLabel={`${formatClock(remaining)} remaining`}
          style={[styles.hud, { top: insets.top + spacing.sm }]}
        >
          <View style={styles.hudRow}>
            <Ionicons name="timer-outline" size={13} color={colors.lime} />
            <Text style={styles.hudTime}>-{formatClock(remaining)}</Text>
            {intensityMeta ? (
              <Text style={styles.hudMeta}>· {intensityMeta.label}</Text>
            ) : null}
          </View>
          <View style={styles.hudTrack}>
            <View style={[styles.hudFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          {__DEV__ && devLatency.frames > 0 ? (
            <Text style={styles.devReadout}>
              lat p50 {devLatency.p50}ms · stale {devLatency.stale} · {devLatency.frames}f
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Additive (AirPlay): AirPlay control + on-TV status pill. The REC
          indicator is never hidden while the writer is running. */}
      {Platform.OS === 'ios' ? (
        <View style={[styles.tvControls, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
          {recordingState === 'starting' || recordingState === 'recording' ? (
            <View style={styles.recPill} accessible accessibilityLabel="Recording your run">
              <View style={styles.recDot} />
              <Text style={styles.recPillText}>REC</Text>
            </View>
          ) : null}
          {onExternalScreen ? (
            <View style={styles.tvPill}>
              <Ionicons name="tv" size={13} color={colors.lime} />
              <Text style={styles.tvPillText}>On TV</Text>
            </View>
          ) : null}
          <View style={styles.airplayBtn}>
            <VideoAirPlayButton
              style={styles.airplayPicker}
              tint={colors.white}
              activeTint={colors.lime}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  fallbackIcon: { marginBottom: spacing.md },
  fallbackTitle: { color: colors.text, fontSize: 22, fontWeight: font.black },
  fallbackSub: { color: colors.textDim, fontSize: 14, fontWeight: font.medium, textAlign: 'center', marginTop: spacing.sm },
  link: { color: colors.lime, fontSize: 15, fontWeight: font.bold },
  centerOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.white, fontSize: 14, fontWeight: font.semibold, marginTop: spacing.md },
  exitBtn: {
    position: 'absolute',
    left: spacing.lg,
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hud: {
    position: 'absolute',
    alignSelf: 'center',
    left: 72,
    right: 72,
    alignItems: 'center',
    gap: 6,
  },
  hudRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  hudTime: { ...metric, color: colors.white, fontSize: 15, fontWeight: font.heavy, letterSpacing: -0.2 },
  hudMeta: { ...type.micro, color: 'rgba(255,255,255,0.72)' },
  hudTrack: {
    width: 120,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  hudFill: { height: '100%', backgroundColor: colors.lime },
  devReadout: { ...type.micro, color: 'rgba(255,255,255,0.55)' },
  tvControls: {
    position: 'absolute',
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tvPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  tvPillText: { color: colors.white, fontSize: 13, fontWeight: font.bold },
  recPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  recDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#FF3B30' },
  recPillText: { color: colors.white, fontSize: 12, fontWeight: font.black, letterSpacing: 1.2 },
  pipRecBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  pipRecDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#FF3B30' },
  pipRecText: { color: colors.white, fontSize: 10, fontWeight: font.black, letterSpacing: 1 },
  airplayBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  airplayPicker: { width: 24, height: 24 },
  endOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  endTitle: {
    color: colors.white,
    fontSize: 26,
    fontWeight: font.heavy,
    letterSpacing: -0.7,
    marginTop: spacing.sm,
  },
  pipPlacement: {
    position: 'absolute',
    borderRadius: radius.md,
    shadowColor: colors.black,
    shadowOpacity: 0.65,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  pipFrame: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radius.md,
  },
  pipCloseButton: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  pipRestoreButton: {
    position: 'absolute',
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'rgba(0,0,0,0.76)',
    shadowColor: colors.black,
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 10,
  },
  controlPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  companion: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
  },
  companionInner: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  companionCameraFrame: {
    flex: 1,
    minHeight: 180,
    overflow: 'hidden',
    borderRadius: radius.lg,
  },
  companionDashboard: {
    flexShrink: 0,
  },
  companionCard: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  companionLevel: {
    color: colors.text,
    fontSize: 18,
    fontWeight: font.bold,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  companionPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  companionStats: {
    flexDirection: 'row',
    alignSelf: 'stretch',
  },
});

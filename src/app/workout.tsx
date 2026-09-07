import Ionicons from '@expo/vector-icons/Ionicons';
import { isCardioSurfPoseAvailable } from 'cardiosurf-pose';
import { useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoAirPlayButton, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { getLevel, getMode } from '@/lib/gameData';
import {
  applyRecognizedMove,
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
  wallClockElapsed,
} from '@/lib/playSetup';
import { useProgress } from '@/lib/ProgressContext';
import { CLASS_META, caloriesForRun } from '@/lib/progression';
import {
  clearTrackingHandoff,
  consumeTrackingHandoff,
} from '@/lib/trackingSession';
import { getVideoSource } from '@/lib/videoSources';
import { colors, font, metric, radius, spacing, type } from '@/theme';

/**
 * How close to the end of the video the last position must have been for a
 * backwards jump to count as the loop wrapping (vs. a seek). timeUpdate fires
 * every 0.5s and the fastest rate is 1.2x, so a real wrap always lands inside.
 */
const LOOP_WRAP_WINDOW_S = 3;

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
  const { level, speed, duration: durationParam, intensity: intensityParam, tracking, trackingRunId, fromOnboarding } =
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
  // Video-seconds accumulated across loops, and the last position seen, so a
  // wrap back to 0 is counted as progress rather than a rewind.
  const videoPlayedRef = useRef(0);
  const lastPositionRef = useRef(0);
  const videoLengthRef = useRef(0);
  const finishedRef = useRef(false);
  const [screenFocused, setScreenFocused] = useState(false);
  // This preference lasts for this workout. AirPlay always shows the companion
  // camera; returning to the phone restores the user's prior PiP choice.
  const [phonePipVisible, setPhonePipVisible] = useState(true);
  const [nativePoseUnavailable, setNativePoseUnavailable] = useState(false);
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
  const { activeClass, activeRun, abandonRun } = useProgress();
  const classKey = activeRun?.classKey ?? activeClass;
  const classMeta = CLASS_META[classKey];
  const levelInfo = getLevel(level);
  const worldInfo = getMode(level);
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : 0;
  const calories = caloriesForRun(elapsed / 60, classKey, intensityMeta?.effort ?? 1);

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
      const result = poseAnalyzer.current.process(frame);
      setPoseFrame({ ...frame, keypoints: result.keypoints });
      setPoseFeedback(result.feedback);
      if (result.move) {
        setPoseScore((current) => applyRecognizedMove(current, result.move!, frame.timestamp));
      }
    },
    [trackingMode],
  );

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
    router.replace({
      pathname: '/summary',
      params: {
        completed: '1',
        runId: trackingRunId,
        elapsedSeconds: String(elapsedRef.current),
        actionCounts: JSON.stringify(poseScoreRef.current.counts),
        poseScore: String(
          totalWorkoutScore(
            poseScoreRef.current.score,
            elapsedRef.current,
            durationRef.current,
          ),
        ),
        ...(fromOnboarding === '1' ? { fromOnboarding: '1' } : {}),
      },
    });
  }, [fromOnboarding, router, trackingRunId]);

  const exitEarly = useCallback(() => {
    clearTrackingHandoff();
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
        replacement = player.replaceAsync(nextSource);
      } catch {
        // The native player may already have been released during navigation.
        return;
      }

      replacementGenerationRef.current = generation;
      sourceOrientationRef.current = nextOrientation;
      replacement
        .then(() => {
          if (replacementGenerationRef.current !== generation) return;
          safe(() => {
            player.playbackRate = playbackRate;
            player.loop = timedRun;
            if (resumeAt > 0) player.currentTime = resumeAt;
            if (wasPlaying) player.play();
          });
        })
        .catch(() => {});
    },
    [level, playbackRate, player, timedRun],
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
    });
    return () => {
      endSub.remove();
      statusSub.remove();
    };
  }, [finish, player, source, timedRun]);

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
    player.timeUpdateEventInterval = 0.5;
    const startPosition = player.currentTime || 0;
    lastPositionRef.current = startPosition;
    videoLengthRef.current = player.duration || 0;
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
        if (player.duration > 0) videoLengthRef.current = player.duration;
      });
      if (!timedRun) {
        elapsedRef.current = position;
        setElapsed(position);
        if (videoLengthRef.current > 0) {
          durationRef.current = videoLengthRef.current;
          setDuration(videoLengthRef.current);
        }
        return;
      }
      const last = lastPositionRef.current;
      const length = videoLengthRef.current;
      let delta = position - last;
      if (delta < 0) {
        // Either the loop wrapped (we were within a beat of the end: credit the
        // tail of the previous pass plus the head of this one) or a seek —
        // e.g. the AirPlay source swap briefly reporting 0 before it resumes —
        // which must not count as time moved.
        const nearEnd = length > 0 && length - last < LOOP_WRAP_WINDOW_S;
        delta = nearEnd ? length - last + position : 0;
      }
      // Ignore absurd jumps; a legitimate delta is never more than a few s.
      if (delta > 0 && delta < 30) videoPlayedRef.current += delta;
      lastPositionRef.current = position;
      const wall = wallClockElapsed(videoPlayedRef.current, playbackRate);
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
  }, [finish, playbackRate, player, source, targetSeconds, timedRun]);

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
                onPoseFrame={handlePoseFrame}
                onTrackingStatus={handleTrackingStatus}
                onUnavailable={() => setNativePoseUnavailable(true)}
                permission={cameraPermission}
                playbackDuration={duration}
                playbackElapsed={elapsed}
                poseFrame={poseFrame}
                poseFeedback={poseFeedback}
                poseScore={poseScore}
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
                onPoseFrame={handlePoseFrame}
                onTrackingStatus={handleTrackingStatus}
                onUnavailable={() => setNativePoseUnavailable(true)}
                permission={cameraPermission}
                playbackDuration={duration}
                playbackElapsed={elapsed}
                poseFrame={poseFrame}
                poseFeedback={poseFeedback}
                poseScore={poseScore}
                trackingMode={trackingMode}
                unavailableReason={trackingUnavailableReason}
                variant="pip"
              />
            </View>
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
        </View>
      ) : null}

      {/* Additive (AirPlay): AirPlay control + on-TV status pill. */}
      {Platform.OS === 'ios' ? (
        <View style={[styles.tvControls, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
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

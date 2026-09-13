import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/ui';
import { logRunRecordingCompleted, logRunRecordingFailed, logRunRecordingShared } from '@/lib/analytics';
import { DEFAULT_HUD_THEME_ID, getHudTheme } from '@/lib/hudThemes';
import {
  ComposeError,
  composeRecordedRun,
  consumeRecordedRun,
  deleteRunVideo,
  discardRecordedRun,
  toFileUri,
  type ComposedRunVideo,
  type RecordedRun,
} from '@/lib/runRecording';
import { colors, font, radius, spacing, type } from '@/theme';

const MISS_RED = '#FF3B30';

type Phase =
  | { kind: 'hidden' }
  | { kind: 'waiting' }
  | { kind: 'composing'; progress: number }
  | { kind: 'ready'; video: ComposedRunVideo }
  | { kind: 'failed'; message: string };

/**
 * "Your run video" on the summary. Consumes the clip + run log the workout
 * staged for this run, composes the share video (progress → thumbnail) and
 * offers Save to Photos / Share / Delete. Renders nothing when the run was not
 * recorded. See docs/RUN_RECORDING.md.
 */
export function RunVideoCard({
  runId,
  ready,
  levelName,
  score,
  accuracy,
  maxCombo,
  personalBest,
  hudThemeId,
}: {
  runId: string | undefined;
  /** The summary's numbers are final (the run is attached); composing waits for this. */
  ready: boolean;
  levelName: string;
  score: number;
  /** 0..1 */
  accuracy: number;
  maxCombo: number;
  personalBest: boolean;
  hudThemeId: string | null | undefined;
}) {
  // Consume the staged run exactly once for this mount.
  const pendingRef = useRef<Promise<RecordedRun> | null | undefined>(undefined);
  if (pendingRef.current === undefined) pendingRef.current = consumeRecordedRun(runId);
  const [phase, setPhase] = useState<Phase>(() => (pendingRef.current ? { kind: 'waiting' } : { kind: 'hidden' }));
  const [recorded, setRecorded] = useState<RecordedRun | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState<'photos' | 'share' | null>(null);
  const [saved, setSaved] = useState(false);
  const startedRef = useRef(false);
  // End-card inputs are read when composing starts, never re-composed later.
  const endCardRef = useRef({ levelName, score, accuracy, maxCombo, personalBest, hudThemeId });
  endCardRef.current = { levelName, score, accuracy, maxCombo, personalBest, hudThemeId };

  // 1. Wait for the workout's writer to finalize the clip + log.
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return undefined;
    let mounted = true;
    pending.then(
      (result) => {
        if (mounted) setRecorded(result);
        else discardRecordedRun(result);
      },
      () => {
        logRunRecordingFailed('record');
        if (mounted) {
          setPhase({
            kind: 'failed',
            message: 'The camera recording ended early, so there is no video for this run.',
          });
        }
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  // 2. Compose once the summary's numbers are final.
  useEffect(() => {
    if (!recorded || !ready || startedRef.current) return undefined;
    startedRef.current = true;
    let mounted = true;
    setPhase({ kind: 'composing', progress: 0 });
    const inputs = endCardRef.current;
    const theme = getHudTheme(inputs.hudThemeId) ?? getHudTheme(DEFAULT_HUD_THEME_ID)!;
    composeRecordedRun(recorded, {
      theme: { accent: theme.accent, perfect: theme.perfect, good: theme.good, miss: theme.miss },
      endCard: {
        levelName: inputs.levelName,
        score: Math.round(inputs.score),
        accuracyPct: Math.round(inputs.accuracy * 100),
        maxCombo: inputs.maxCombo,
        personalBest: inputs.personalBest,
      },
      onProgress: (progress) => {
        if (mounted) setPhase({ kind: 'composing', progress });
      },
    })
      .then((video) => {
        logRunRecordingCompleted({ durationMs: video.durationMs, composeMs: video.composeMs, fileBytes: video.fileBytes });
        if (mounted) setPhase({ kind: 'ready', video });
      })
      .catch((error: unknown) => {
        const stage = error instanceof ComposeError ? error.stage : 'compose';
        logRunRecordingFailed(stage);
        discardRecordedRun(recorded);
        if (!mounted) return;
        setPhase({
          kind: 'failed',
          message:
            stage === 'asset'
              ? "Recording isn't available for this map yet, so the video could not be built."
              : 'Your run video could not be built this time.',
        });
      });
    return () => {
      // The export keeps running natively; the result is simply not shown.
      mounted = false;
    };
  }, [ready, recorded]);

  if (phase.kind === 'hidden') return null;

  const video = phase.kind === 'ready' ? phase.video : null;

  const saveToPhotos = async () => {
    if (!video || busy) return;
    setBusy('photos');
    try {
      // Add-only: iOS shows the "Add Photos Only" prompt (NSPhotoLibraryAddUsageDescription).
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert('Photos access needed', 'Allow CardioSurf to add to your Photos to save the video.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(toFileUri(video.path));
      logRunRecordingShared('photos');
      setSaved(true);
    } catch {
      Alert.alert('Could not save', 'The video could not be saved to Photos. Try sharing it instead.');
    } finally {
      setBusy(null);
    }
  };

  const shareVideo = async () => {
    if (!video || busy) return;
    setBusy('share');
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'Save the video to Photos and share it from there.');
        return;
      }
      await Sharing.shareAsync(toFileUri(video.path), {
        mimeType: 'video/mp4',
        UTI: 'public.mpeg-4',
        dialogTitle: 'Share your run',
      });
      logRunRecordingShared('share');
    } catch {
      // Dismissed.
    } finally {
      setBusy(null);
    }
  };

  const removeVideo = () => {
    if (!video) return;
    Alert.alert('Delete this video?', 'It is only stored on this phone; deleting cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRunVideo(video);
          setExportOpen(false);
          setPhase({ kind: 'hidden' });
        },
      },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <Ionicons name="videocam" size={16} color={MISS_RED} />
          <Text style={styles.title}>Your run video</Text>
        </View>
        {video ? <Text style={styles.meta}>{formatDuration(video.durationMs)}</Text> : null}
      </View>

      {phase.kind === 'waiting' || phase.kind === 'composing' ? (
        <View style={styles.progressBlock} accessibilityLiveRegion="polite">
          <View style={styles.progressRow}>
            <ActivityIndicator color={colors.lime} />
            <Text style={styles.body}>
              {phase.kind === 'waiting' ? 'Saving your recording…' : 'Building your video…'}
            </Text>
            {phase.kind === 'composing' ? (
              <Text style={styles.percent}>{Math.round(phase.progress * 100)}%</Text>
            ) : null}
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round((phase.kind === 'composing' ? phase.progress : 0) * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.note}>Stays on your phone. Nothing is uploaded unless you share it.</Text>
        </View>
      ) : null}

      {phase.kind === 'failed' ? (
        <View style={styles.progressRow}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textFaint} />
          <Text style={[styles.body, { flex: 1 }]}>{phase.message}</Text>
        </View>
      ) : null}

      {video ? (
        <>
          <Pressable
            onPress={() => setExportOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Preview and share your run video"
            style={({ pressed }) => [styles.preview, pressed && { opacity: 0.85 }]}
          >
            {video.thumbnailPath ? (
              <Image source={{ uri: toFileUri(video.thumbnailPath) }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbFallback]}>
                <Ionicons name="film-outline" size={28} color={colors.textFaint} />
              </View>
            )}
            <View style={styles.playBadge}>
              <Ionicons name="play" size={18} color={colors.black} />
            </View>
          </Pressable>
          <View style={styles.actions}>
            <Pressable
              onPress={saveToPhotos}
              accessibilityRole="button"
              disabled={busy !== null}
              style={({ pressed }) => [styles.btn, pressed && { opacity: 0.72 }]}
            >
              {busy === 'photos' ? (
                <ActivityIndicator color={colors.text} size="small" />
              ) : (
                <Ionicons name={saved ? 'checkmark-circle' : 'download-outline'} size={16} color={saved ? colors.lime : colors.text} />
              )}
              <Text style={styles.btnText}>{saved ? 'Saved' : 'Save to Photos'}</Text>
            </Pressable>
            <Pressable
              onPress={shareVideo}
              accessibilityRole="button"
              disabled={busy !== null}
              style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && { opacity: 0.72 }]}
            >
              {busy === 'share' ? (
                <ActivityIndicator color={colors.black} size="small" />
              ) : (
                <Ionicons name="share-outline" size={16} color={colors.black} />
              )}
              <Text style={[styles.btnText, { color: colors.black }]}>Share</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {video ? (
        <ExportSheet
          visible={exportOpen}
          video={video}
          saved={saved}
          busy={busy}
          onClose={() => setExportOpen(false)}
          onSave={saveToPhotos}
          onShare={shareVideo}
          onDelete={removeVideo}
        />
      ) : null}
    </View>
  );
}

function ExportSheet({
  visible,
  video,
  saved,
  busy,
  onClose,
  onSave,
  onShare,
  onDelete,
}: {
  visible: boolean;
  video: ComposedRunVideo;
  saved: boolean;
  busy: 'photos' | 'share' | null;
  onClose: () => void;
  onSave: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Your run video</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textDim} />
            </Pressable>
          </View>
          {visible ? <RunVideoPreview path={video.path} /> : null}
          <Text style={styles.sheetMeta}>
            {formatDuration(video.durationMs)} · {formatBytes(video.fileBytes)} · 720×1280 · silent
          </Text>
          <GradientButton
            label={saved ? 'Saved to Photos' : 'Save to Photos'}
            icon={saved ? 'checkmark-circle' : 'download-outline'}
            accent="lime"
            onPress={busy !== null || saved ? undefined : onSave}
            style={busy !== null || saved ? { opacity: 0.6 } : undefined}
          />
          <Pressable
            onPress={onShare}
            accessibilityRole="button"
            disabled={busy !== null}
            style={({ pressed }) => [styles.sheetBtn, pressed && { opacity: 0.72 }]}
          >
            <Ionicons name="share-outline" size={18} color={colors.text} />
            <Text style={styles.sheetBtnText}>Share…</Text>
          </Pressable>
          <Pressable onPress={onDelete} accessibilityRole="button" style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={15} color={MISS_RED} />
            <Text style={styles.deleteText}>Delete video</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function RunVideoPreview({ path }: { path: string }) {
  const player = useVideoPlayer({ uri: toFileUri(path) }, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <View style={styles.previewFrame}>
      <VideoView style={styles.previewVideo} player={player} contentFit="contain" nativeControls />
    </View>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { color: colors.text, fontSize: 17, fontWeight: font.heavy, letterSpacing: -0.3 },
  meta: { ...type.micro, color: colors.textDim },
  progressBlock: { gap: spacing.sm },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  body: { ...type.bodySm, color: colors.textDim },
  percent: { marginLeft: 'auto', color: colors.text, fontSize: 13, fontWeight: font.bold, fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.lime },
  note: { ...type.micro, color: colors.textFaint },
  preview: {
    alignSelf: 'center',
    width: 126,
    height: 224,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { ...StyleSheet.absoluteFillObject },
  thumbFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  playBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  btnPrimary: { backgroundColor: colors.lime, borderColor: colors.lime },
  btnText: { color: colors.text, fontSize: 14, fontWeight: font.bold },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    gap: spacing.md,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...type.h2, color: colors.text },
  sheetMeta: { ...type.micro, color: colors.textDim, textAlign: 'center' },
  previewFrame: {
    alignSelf: 'center',
    width: 198,
    height: 352,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.black,
  },
  previewVideo: { width: '100%', height: '100%' },
  sheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 50,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  sheetBtnText: { color: colors.text, fontSize: 15, fontWeight: font.bold },
  deleteBtn: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.xs },
  deleteText: { color: MISS_RED, fontSize: 13, fontWeight: font.semibold },
});
